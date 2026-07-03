from __future__ import annotations

import json
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

# ✅ NEW: Minimal session creation (fixes 422 error)
class CreateMeetingSessionRequest(BaseModel):
    meeting_date: Optional[str] = None  # ISO date YYYY-MM-DD
    meeting_type: str = "check_in"
    conversation_context: Optional[dict[str, Any]] = None  # {participant_priorities, coordinator_observations, agreed_outcomes}
    participant_id: Optional[str] = None  # Optional: if participant already selected in UI (e.g., from participant details page)


class MeetingSessionResponse(BaseModel):
    session_id: str
    created_at: str


# DEPRECATED: Old request model (participant_id required)
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


# ✅ NEW: Stage 1 resolution output
class Stage1ResolutionResponse(BaseModel):
    session_id: str
    raw_transcript: str
    clean_transcript: str
    resolved_names: dict[str, Any]
    segment_ids: list[dict[str, Any]]
    participant_id: Optional[str] = None
    stage_1_status: str = "complete"


# ✅ NEW: Stage 2 extraction output
class Stage2ExtractionResponse(BaseModel):
    session_id: str
    goals: list[dict[str, Any]] = []
    tasks: list[dict[str, Any]] = []
    extraction_metadata: dict[str, Any]
    stage_2_status: str = "complete"


class PreFilledNames(BaseModel):
    coordinator_name: Optional[str] = None
    participant_name: Optional[str] = None
    others: list[str] = []


# ── Helpers ────────────────────────────────────────────────────────────────────

def _require_coordinator(current_user: dict) -> None:
    if not is_coordinator_role(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only support coordinators can access plan meetings.",
        )


# ── Endpoints ──────────────────────────────────────────────────────────────────

# ✅ NEW: Create meeting session (MINIMAL - fixes 422 error)
@router.post("/plan-meetings/sessions", status_code=status.HTTP_201_CREATED)
async def create_meeting_session(
    body: CreateMeetingSessionRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Create a new plan meeting recording session.
    
    ⚠️ IMPORTANT: Participant matching happens AFTER transcription (Stage 1), not here.
    
    Only requires: organization_id (from JWT), coordinator_id (from JWT), timestamp.
    Names and participant resolution happen post-transcription.
    
    Returns: session_id for audio upload + transcription.
    """
    _require_coordinator(current_user)
    organization_id = get_user_organization_id(current_user)
    coordinator_id = get_user_id(current_user)
    
    # ✅ FIX: Validate required fields are present
    if not organization_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User organization_id not found in JWT claims. Ensure you have organization membership."
        )
    if not coordinator_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User ID not found in JWT claims. Ensure you are properly authenticated."
        )
    
    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc).isoformat()

    payload = {
        "organization_id": organization_id,
        "coordinator_id": coordinator_id,
        "participant_id": body.participant_id,  # Optional: if already known from UI context (e.g., participant details page)
        "created_at": now,
        "recorded_at": now,
        "meeting_type": body.meeting_type,
        "conversation_context": body.conversation_context or {},
        "stage_1_status": "pending",
        "stage_2_status": "pending",
        "review_status": "pending",
    }

    try:
        resp = supabase.table("plan_meeting_sessions").insert(payload).execute()
    except Exception as exc:
        logger.exception("Failed to create plan meeting session. Payload: %s. Error: %s", payload, exc)
        # Re-raise with better error message for client
        error_msg = str(exc)
        if "relation" in error_msg.lower() and "does not exist" in error_msg.lower():
            raise HTTPException(status_code=500, detail="Database table not found. Ensure migrations 090+ have been applied.")
        elif "foreign key" in error_msg.lower():
            raise HTTPException(status_code=500, detail=f"Foreign key constraint error: {error_msg[:100]}")
        else:
            raise HTTPException(status_code=500, detail=f"Failed to create plan meeting session: {error_msg[:200]}")

    if not resp.data:
        raise HTTPException(status_code=500, detail="Insert returned no data.")

    session = resp.data[0]
    return MeetingSessionResponse(
        session_id=session["id"],
        created_at=session["created_at"],
    )


@router.post("/plan-meetings")
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


# ═══════════════════════════════════════════════════════════════════════════════
# TWO-STAGE PIPELINE ENDPOINTS: Name Resolution + Goal Extraction
# ═══════════════════════════════════════════════════════════════════════════════

def _parse_speaker_segments(raw_text: str) -> list[dict[str, Any]]:
    """
    Parse speaker-diarized transcript into structured segments.
    
    Expects format: "Speaker A: ...", "Speaker B: ...", etc.
    (This is what Whisper returns with speaker diarization enabled.)
    
    Returns: [{"segment_id": "s1", "start": "00:00:00", "speaker_label": "Speaker A", "text": "..."}]
    """
    segments = []
    lines = raw_text.split("\n")
    segment_id = 0
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        # Try to parse "Speaker X: text" format
        if ":" in line:
            parts = line.split(":", 1)
            speaker = parts[0].strip()
            text = parts[1].strip() if len(parts) > 1 else ""
            
            segments.append({
                "segment_id": f"s{segment_id}",
                "start": "00:00:00",  # TODO: Parse from transcript metadata if available
                "speaker_label": speaker,
                "text": text,
            })
            segment_id += 1
        else:
            # Single-speaker or untagged line
            segments.append({
                "segment_id": f"s{segment_id}",
                "start": "00:00:00",
                "speaker_label": "Speaker",
                "text": line,
            })
            segment_id += 1
    
    return segments


@router.post("/plan-meetings/{session_id}/transcribe-and-resolve", status_code=status.HTTP_200_OK)
async def transcribe_and_resolve_names(
    session_id: str,
    audio_file: UploadFile = File(...),
    coordinator_name: str | None = None,
    participant_name: str | None = None,
    others: str = "[]",  # JSON string
    current_user: dict = Depends(get_current_user),
):
    """
    ✅ STAGE 1: Transcribe audio + resolve speaker names + clean transcript
    
    Flow:
    1. Transcribe audio using Whisper (with speaker diarization)
    2. Run Stage 1 prompt to resolve speakers to real names
    3. Clean transcript (fix ASR errors without changing meaning)
    4. Store results in plan_meeting_sessions
    5. Attempt participant matching by name
    
    Returns:
        - clean_transcript: speaker-attributed, cleaned transcript
        - resolved_names: { Speaker A -> Coordinator John, ... }
        - segment_ids: preserved for Stage 2 citation
        - flags: confidence issues, unresolved speakers, ambiguities
    """
    _require_coordinator(current_user)
    organization_id = get_user_organization_id(current_user)
    supabase = get_supabase_admin()
    
    # Check session exists and belongs to this org
    try:
        session_resp = (
            supabase.table("plan_meeting_sessions")
            .select("*")
            .eq("id", session_id)
            .eq("organization_id", organization_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.exception("Failed to fetch session: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to fetch session.")
    
    sessions = session_resp.data or []
    if not sessions:
        raise HTTPException(status_code=404, detail="Session not found.")
    
    session = sessions[0]
    
    # ✅ STEP 1: Transcribe audio
    try:
        audio_bytes = await audio_file.read()
        logger.info(f"Audio file read: {len(audio_bytes)} bytes, filename: {audio_file.filename}, content-type: {audio_file.content_type}")
        
        # Validate file size (25MB limit)
        if len(audio_bytes) > 25 * 1024 * 1024:
            logger.error(f"Audio file exceeds 25 MB: {len(audio_bytes)} bytes")
            raise HTTPException(status_code=413, detail="Audio file exceeds 25 MB limit.")
        
        if len(audio_bytes) < 1000:
            logger.warning(f"Audio file very small: {len(audio_bytes)} bytes - may be invalid or silent")
        
        # Call Whisper
        client = _build_openai_client()
        logger.info(f"Calling Whisper with {len(audio_bytes)} bytes, format: {audio_file.content_type}")
        try:
            transcript_response = client.audio.transcriptions.create(
                model="whisper-1",
                file=(audio_file.filename or "audio.webm", audio_bytes, audio_file.content_type or "audio/webm"),
                response_format="verbose_json",
                language="en",
            )
            logger.info(f"Whisper response received successfully")
        except Exception as whisper_exc:
            logger.error(f"Whisper API error: {whisper_exc}")
            raise
        
        raw_text = transcript_response.text or ""
        logger.info(f"Transcription result: {len(raw_text)} chars")
        
        if not raw_text or raw_text.strip() == "":
            logger.warning("Whisper returned empty transcript - audio may be silent or inaudible")
            raise ValueError("Whisper returned empty or inaudible audio. Please ensure your microphone is working and try again with clearer audio.")
        
        logger.debug(f"Raw transcript: {raw_text[:200]}")
        raw_transcript_segments = _parse_speaker_segments(raw_text)
        logger.info(f"Parsed {len(raw_transcript_segments)} transcript segments")
        
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Transcription step failed with exception: {type(exc).__name__}: {exc}")
        error_detail = str(exc)[:200]
        # Update session with error status
        try:
            supabase.table("plan_meeting_sessions").update({
                "stage_1_status": "error",
                "stage_1_error": f"Transcription failed: {error_detail}",
                "stage_1_completed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", session_id).execute()
            logger.info(f"Updated session {session_id} with error status")
        except Exception as db_exc:
            logger.warning("Failed to update session error status: %s", db_exc)
        raise HTTPException(status_code=422, detail=f"Could not transcribe audio: {error_detail}")
    
    # ✅ STEP 2: Run Stage 1 prompt (name resolution & cleanup)
    try:
        import json
        
        # Parse pre-filled names
        prefilled_names = []
        if coordinator_name:
            prefilled_names.append({"name": coordinator_name, "role": "coordinator"})
        if participant_name:
            prefilled_names.append({"name": participant_name, "role": "participant"})
        try:
            others_list = json.loads(others) if others != "[]" else []
            for other_name in others_list:
                # Handle both string and dict formats
                if isinstance(other_name, dict) and "name" in other_name:
                    prefilled_names.append(other_name)  # Already in dict format
                elif isinstance(other_name, str):
                    prefilled_names.append({"name": other_name, "role": "other"})
                logger.debug(f"Parsed other name: {other_name}")
        except (json.JSONDecodeError, TypeError) as parse_exc:
            logger.warning(f"Failed to parse 'others' list: {parse_exc}")
            pass
        
        logger.info(f"Prefilled names: {json.dumps(prefilled_names)}")
        
        # Gather meeting context
        meeting_context = {
            "meeting_type": session.get("meeting_type"),
            "conversation_context": session.get("conversation_context", {}),
        }
        
        # Import and run Stage 1
        from ..services.plan_meeting_service import run_stage_1_name_resolution
        
        stage_1_result = await run_stage_1_name_resolution(
            session_id=session_id,
            organization_id=organization_id,
            raw_transcript_segments=raw_transcript_segments,
            prefilled_names=prefilled_names or None,
            meeting_context=meeting_context,
        )
        
    except ValueError as exc:
        logger.exception("Stage 1 failed: %s", exc)
        error_detail = str(exc)[:200]
        # Update session with error status
        try:
            supabase.table("plan_meeting_sessions").update({
                "stage_1_status": "error",
                "stage_1_error": error_detail,
                "stage_1_completed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", session_id).execute()
        except Exception as db_exc:
            logger.warning("Failed to update session error status: %s", db_exc)
        raise HTTPException(status_code=422, detail=f"Name resolution failed: {error_detail}")
    except Exception as exc:
        logger.exception("Unexpected error in Stage 1: %s", exc)
        error_detail = str(exc)[:200]
        # Update session with error status
        try:
            supabase.table("plan_meeting_sessions").update({
                "stage_1_status": "error",
                "stage_1_error": error_detail,
                "stage_1_completed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", session_id).execute()
        except Exception as db_exc:
            logger.warning("Failed to update session error status: %s", db_exc)
        raise HTTPException(status_code=500, detail=f"Stage 1 processing failed: {error_detail}")
    
    # ✅ STEP 3: Try to match participant by resolved names (only if not already set)
    participant_id = session.get("participant_id")  # Use already-set participant_id if available
    resolved_speakers = stage_1_result.get("resolved_speakers", [])
    
    if not participant_id:
        # Only attempt name matching if participant_id wasn't provided at session creation
        for speaker in resolved_speakers:
            if speaker.get("confidence") in ("confirmed", "likely"):
                name = speaker.get("resolved_name", "")
                try:
                    p_resp = (
                        supabase.table("participants")
                        .select("id")
                        .ilike("full_name", f"%{name}%")
                        .eq("organization_id", organization_id)
                        .limit(1)
                        .execute()
                    )
                    if p_resp.data:
                        participant_id = p_resp.data[0]["id"]
                        break
                except Exception:
                    pass
    
    # ✅ STEP 4: Update session with participant_id if newly matched
    if participant_id and participant_id != session.get("participant_id"):
        try:
            supabase.table("plan_meeting_sessions").update({
                "participant_id": participant_id,
            }).eq("id", session_id).execute()
        except Exception as exc:
            logger.warning("Failed to update session with participant_id: %s", exc)
    
    return {
        "session_id": session_id,
        "raw_transcript": raw_transcript_segments,  # Return as array of segments
        "clean_transcript": stage_1_result.get("clean_transcript", []),  # Return as array of segments
        "resolved_names": {
            speaker["speaker_label"]: {
                "name": speaker.get("resolved_name"),
                "confidence": speaker.get("confidence"),
            }
            for speaker in resolved_speakers
        },
        "segment_ids": stage_1_result.get("clean_transcript", []),
        "participant_id": participant_id,
        "flags": stage_1_result.get("flags", []),
        "stage_1_status": "complete",
    }


@router.post("/plan-meetings/{session_id}/extract-goals-tasks", status_code=status.HTTP_200_OK)
async def extract_goals_and_tasks(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    ✅ STAGE 2: Extract NDIS goals and core support tasks
    
    Prerequisites:
    - Session must have stage_1_status = 'complete'
    - Must have clean_transcript and segment_ids from Stage 1
    
    Returns:
        - draft_goals: NDIS goals extracted from transcript
        - draft_tasks: Core support tasks
        - attention_flags: Safety risks, restrictive practices, ambiguities
    """
    _require_coordinator(current_user)
    organization_id = get_user_organization_id(current_user)
    supabase = get_supabase_admin()
    
    # Check session and its Stage 1 completion
    try:
        session_resp = (
            supabase.table("plan_meeting_sessions")
            .select("*")
            .eq("id", session_id)
            .eq("organization_id", organization_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.exception("Failed to fetch session: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to fetch session.")
    
    sessions = session_resp.data or []
    if not sessions:
        raise HTTPException(status_code=404, detail="Session not found.")
    
    session = sessions[0]
    
    # Verify Stage 1 is complete
    if session.get("stage_1_status") != "complete":
        raise HTTPException(
            status_code=400,
            detail=f"Stage 1 must be complete first. Current status: {session.get('stage_1_status')}"
        )
    
    # Get clean transcript from Stage 1 (stored as JSON string in database)
    clean_transcript_json = session.get("clean_transcript") or "[]"
    try:
        if isinstance(clean_transcript_json, str):
            clean_transcript = json.loads(clean_transcript_json)
        else:
            clean_transcript = clean_transcript_json
        
        if not clean_transcript:
            raise HTTPException(status_code=400, detail="No clean transcript from Stage 1. Run transcribe-and-resolve first.")
    except (json.JSONDecodeError, TypeError) as exc:
        logger.error(f"Failed to parse clean_transcript: {exc}")
        raise HTTPException(status_code=400, detail="Invalid clean transcript format from Stage 1.")
    
    # ✅ STEP 1: Run Stage 2 prompt
    try:
        from ..services.plan_meeting_service import run_stage_2_goal_extraction
        
        stage_2_result = await run_stage_2_goal_extraction(
            session_id=session_id,
            organization_id=organization_id,
            clean_transcript=clean_transcript,
        )
        
        logger.info(f"Stage 2 result: {len(stage_2_result.get('draft_goals', []))} goals, {len(stage_2_result.get('draft_tasks', []))} tasks")
        logger.debug(f"Goals: {stage_2_result.get('draft_goals', [])[:1]}")  # Log first goal as example
        
    except ValueError as exc:
        logger.exception("Stage 2 failed: %s", exc)
        raise HTTPException(status_code=422, detail=f"Goal extraction failed: {exc}")
    except Exception as exc:
        logger.exception("Unexpected error in Stage 2: %s", exc)
        raise HTTPException(status_code=500, detail="Stage 2 processing failed.")
    
    return {
        "session_id": session_id,
        "goals": stage_2_result.get("draft_goals", []),
        "tasks": stage_2_result.get("draft_tasks", []),
        "attention_flags": stage_2_result.get("attention_flags", []),
        "extraction_metadata": {
            "completed_at": datetime.now(timezone.utc).isoformat(),
        },
        "stage_2_status": "complete",
    }
