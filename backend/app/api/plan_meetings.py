from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel

from ..core.access import get_user_id, get_user_organization_id, is_coordinator_role
from ..core.security import get_current_user
from ..services.supabase_client import get_supabase_admin
from ..services.plan_meeting_service import (
    generate_plan_meeting_suggestions,
    apply_plan_meeting_suggestions,
)
from ..services.ai_service import _build_openai_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/coordinator", tags=["plan-meetings"])


# ── Request / response models ──────────────────────────────────────────────────

class RecordMeetingRequest(BaseModel):
    participant_id: str
    meeting_date: str                          # ISO date YYYY-MM-DD
    meeting_type: str = "check_in"
    attendees: list[str] = []
    conversation_notes: Optional[str] = None
    participant_priorities: Optional[str] = None
    coordinator_observations: Optional[str] = None
    agreed_outcomes: Optional[str] = None


class ApplySuggestionsRequest(BaseModel):
    accepted_goals: list[dict[str, Any]] = []
    accepted_tasks: list[dict[str, Any]] = []


class TranscriptionResponse(BaseModel):
    transcript: str


# ── Helpers ────────────────────────────────────────────────────────────────────

def _require_coordinator(current_user: dict) -> None:
    if not is_coordinator_role(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only support coordinators can access plan meetings.",
        )


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/plan-meetings", status_code=status.HTTP_201_CREATED)
async def record_plan_meeting(
    body: RecordMeetingRequest,
    current_user: dict = Depends(get_current_user),
):
    """Record a coordinator-led plan meeting for a participant."""
    _require_coordinator(current_user)
    organization_id = get_user_organization_id(current_user)
    coordinator_id = get_user_id(current_user)
    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc).isoformat()

    payload = {
        "participant_id": body.participant_id,
        "organization_id": organization_id,
        "coordinator_id": coordinator_id,
        "meeting_date": body.meeting_date,
        "meeting_type": body.meeting_type,
        "attendees": body.attendees,
        "conversation_notes": body.conversation_notes,
        "participant_priorities": body.participant_priorities,
        "coordinator_observations": body.coordinator_observations,
        "agreed_outcomes": body.agreed_outcomes,
        "suggestions_status": "pending_review",
        "created_at": now,
        "updated_at": now,
    }

    try:
        resp = supabase.table("participant_plan_meetings").insert(payload).execute()
    except Exception as exc:
        logger.exception("Failed to record plan meeting: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to record plan meeting.")

    if not resp.data:
        raise HTTPException(status_code=500, detail="Insert returned no data.")

    return {"meeting": resp.data[0]}


@router.get("/participants/{participant_id}/plan-meetings")
async def list_plan_meetings(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    """List all plan meetings recorded for a participant, newest first."""
    _require_coordinator(current_user)
    organization_id = get_user_organization_id(current_user)
    supabase = get_supabase_admin()

    try:
        resp = (
            supabase.table("participant_plan_meetings")
            .select(
                "id, meeting_date, meeting_type, attendees, suggestions_status, "
                "ai_generated_at, created_at, coordinator_id, "
                "participant_priorities, coordinator_observations, agreed_outcomes"
            )
            .eq("participant_id", participant_id)
            .eq("organization_id", organization_id)
            .order("meeting_date", desc=True)
            .execute()
        )
    except Exception as exc:
        logger.exception("Failed to list plan meetings: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to load plan meetings.")

    return {"meetings": resp.data or []}


@router.get("/plan-meetings/pending")
async def list_pending_meetings(
    current_user: dict = Depends(get_current_user),
):
    """Return meetings with AI suggestions awaiting coordinator review (dashboard banner)."""
    _require_coordinator(current_user)
    organization_id = get_user_organization_id(current_user)
    supabase = get_supabase_admin()

    try:
        resp = (
            supabase.table("participant_plan_meetings")
            .select(
                "id, participant_id, meeting_date, meeting_type, "
                "ai_generated_at, suggestions_status"
            )
            .eq("organization_id", organization_id)
            .eq("suggestions_status", "pending_review")
            .not_.is_("ai_suggestions_raw", "null")
            .order("ai_generated_at", desc=True)
            .execute()
        )
    except Exception as exc:
        logger.exception("Failed to list pending meetings: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to load pending meetings.")

    return {"pending": resp.data or [], "count": len(resp.data or [])}


@router.get("/plan-meetings/{meeting_id}")
async def get_plan_meeting(
    meeting_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get a single plan meeting including AI suggestions."""
    _require_coordinator(current_user)
    organization_id = get_user_organization_id(current_user)
    supabase = get_supabase_admin()

    try:
        resp = (
            supabase.table("participant_plan_meetings")
            .select("*")
            .eq("id", meeting_id)
            .eq("organization_id", organization_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.exception("Failed to get plan meeting: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to load plan meeting.")

    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Plan meeting not found.")

    return {"meeting": rows[0]}


@router.post("/plan-meetings/{meeting_id}/ai-review")
async def trigger_ai_review(
    meeting_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Run AI analysis on a recorded meeting to generate goal and task suggestions."""
    _require_coordinator(current_user)
    organization_id = get_user_organization_id(current_user)

    try:
        suggestions = generate_plan_meeting_suggestions(
            meeting_id=meeting_id,
            organization_id=organization_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.exception("AI review failed for meeting %s: %s", meeting_id, exc)
        raise HTTPException(status_code=500, detail="AI review failed.")

    return {
        "meeting_id": meeting_id,
        "suggestions": suggestions,
    }


@router.post("/plan-meetings/transcribe", response_model=TranscriptionResponse)
async def transcribe_plan_meeting_audio(
    audio_file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Transcribe audio recording using OpenAI Whisper API."""
    _require_coordinator(current_user)
    
    if not audio_file.filename:
        raise HTTPException(status_code=400, detail="Audio file is required.")
    
    # Validate file size (limit to 25MB - OpenAI Whisper limit)
    file_content = await audio_file.read()
    if len(file_content) > 25 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="Audio file too large. Maximum size is 25MB.",
        )
    
    try:
        client = _build_openai_client()
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=("recording.webm", file_content),
        )
        transcript = response.text.strip()
        
        if not transcript:
            raise HTTPException(
                status_code=422,
                detail="Audio could not be transcribed. Please try again with clearer audio.",
            )
        
        return TranscriptionResponse(transcript=transcript)
    
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Transcription failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Transcription failed. Please try again.",
        )


@router.post("/plan-meetings/{meeting_id}/apply")
async def apply_suggestions(
    meeting_id: str,
    body: ApplySuggestionsRequest,
    current_user: dict = Depends(get_current_user),
):
    """Apply coordinator-approved suggestions: creates goals and task templates."""
    _require_coordinator(current_user)
    organization_id = get_user_organization_id(current_user)
    coordinator_id = get_user_id(current_user)

    try:
        result = apply_plan_meeting_suggestions(
            meeting_id=meeting_id,
            organization_id=organization_id,
            coordinator_id=coordinator_id,
            accepted_goals=body.accepted_goals,
            accepted_tasks=body.accepted_tasks,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.exception("Failed to apply suggestions for meeting %s: %s", meeting_id, exc)
        raise HTTPException(status_code=500, detail="Failed to apply suggestions.")

    return result
