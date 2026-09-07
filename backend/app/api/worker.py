from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal, Optional
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field

from ..core.access import get_user_id, get_user_organization_id, is_support_worker
from ..core.security import get_current_user
from ..core.timezone import app_today, shift_local_date
from ..models.billing_period import normalize_plan_management_type, plan_management_type_label
from ..schemas.session import GoalProgressNote, SessionCreate
from ..services import (
    ai_service,
    audit_service,
    evidence_upload_service,
    funding_service,
    goals_service,
    medication_document_service,
    medication_service,
    participant_service,
    session_service,
    shift_offer_service,
    shift_service,
    travel_expense_service,
)
from ..services.compliance_evidence_service import get_evidence_metadata, list_session_evidence_metadata
from ..services import shift_signature_service
from ..services.evidence_access_service import verify_and_download_evidence
from ..services.compliance_engine import ComplianceBlockedError, run_compliance_check
from ..services.compliance_rules_catalog import enrich_rule_results, get_rules_catalog
from ..services.notification_service import notify_office_worker_message, notify_password_reset_requested
from ..services.settings_service import get_physical_exam_session_types
from ..services.supabase_client import get_supabase_admin


router = APIRouter(prefix="/worker", tags=["worker"])
logger = logging.getLogger(__name__)


class WorkerSessionCreate(BaseModel):
    session_date: date = Field(default_factory=date.today)
    duration_minutes: int = Field(default=60, ge=1)
    session_type: str = "support_work"
    notes: Optional[str] = None
    goals_addressed: list[str] = Field(default_factory=list)
    status: str = "draft"
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    activities_performed: Optional[str] = None
    outcomes: Optional[str] = None
    participant_response: Optional[str] = None
    progress_toward_goals: Optional[str] = None
    # SCRUM-226: structured per-goal documentation
    goal_progress_notes: list[GoalProgressNote] = Field(default_factory=list)
    # SCRUM-227: participant choice & control narrative
    participant_choice_control: Optional[str] = None


class ShiftTaskItem(BaseModel):
    task_id: str
    type: str = "default"
    label: str
    description: str = ""
    completed: bool = False
    completed_at: Optional[str] = None
    checked_at: Optional[str] = None
    evidence_status: Optional[str] = None
    evidence_added_at: Optional[str] = None
    evidence_ids: Optional[list[str]] = None
    has_photo: Optional[bool] = None
    has_voice: Optional[bool] = None
    has_text_notes: Optional[bool] = None
    note: str = ""
    context_note: str = ""
    order: int = 0
    mandatory: Optional[bool] = None
    goal_id: Optional[str] = None
    goal_title: Optional[str] = None
    outcome_tip: Optional[str] = None
    photo_evidence: Optional[str] = None
    voice_evidence: Optional[str] = None
    photo_thumbnails: Optional[list[str]] = None
    voice_duration_seconds: Optional[int] = None
    marked_na: Optional[bool] = None
    na_reason: Optional[str] = None
    na_marked_at: Optional[str] = None


class ShiftTasksUpdate(BaseModel):
    tasks: list[ShiftTaskItem]


class CustomTaskCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)


class EndShiftBody(BaseModel):
    force: bool = False


class ShiftSignatureBody(BaseModel):
    confirm_tasks_accurate: bool
    confirm_safety_followed: bool
    confirm_no_unreported_incidents: bool
    signature_svg: str = Field(min_length=1)
    signature_png_data_url: str = Field(min_length=1)


class ClockInLocationBody(BaseModel):
    lat: float
    lng: float
    accuracy: Optional[float] = None


class ClockInBody(BaseModel):
    method: Literal["gps", "qr"]
    location: Optional[ClockInLocationBody] = None
    qr_token: Optional[str] = None
    client_timestamp: Optional[str] = None
    claimed_km: Optional[float] = Field(default=None, gt=0, le=2000)


class TaskEvidenceItem(BaseModel):
    evidence_id: str
    task_id: str
    session_id: str
    type: str
    content: str
    goal_id: Optional[str] = None
    duration_seconds: Optional[int] = None
    file_size_bytes: Optional[int] = None
    created_at: str
    synced: bool = False


class TaskEvidenceSyncBody(BaseModel):
    evidence: list[TaskEvidenceItem]


class ShiftVisitNoteCreate(BaseModel):
    content: str = Field(min_length=1)
    category: Optional[str] = None
    session_id: Optional[str] = None


class SessionNoteEditBody(BaseModel):
    content: str = Field(min_length=1)


class SessionNoteItem(BaseModel):
    note_id: str = Field(min_length=1)
    session_id: Optional[str] = None
    task_id: Optional[str] = None
    goal_id: Optional[str] = None
    content: str = Field(min_length=1)
    created_at: Optional[str] = None
    auto_saved_at: Optional[str] = None
    synced: bool = False
    note_type: Optional[str] = None
    file_name: Optional[str] = None
    attachment_urls: Optional[list[str]] = None


class SessionNotesSyncBody(BaseModel):
    notes: list[SessionNoteItem]


class ShiftOfficeMessageCreate(BaseModel):
    message: str = Field(min_length=1)
    priority: Literal["normal", "urgent", "emergency"] = "normal"
    attachment_data: Optional[list[str]] = None


class MessageReplyCreate(BaseModel):
    message: str = Field(min_length=1)


class UploadEvidenceMeta(BaseModel):
    evidence_id: str
    task_id: str
    type: str
    filename: Optional[str] = None
    size_bytes: Optional[int] = None
    mime_type: Optional[str] = None
    goal_id: Optional[str] = None
    duration_seconds: Optional[int] = None
    created_at: str
    content: Optional[str] = None


class UploadEvidenceBody(BaseModel):
    session_id: str
    evidence: list[UploadEvidenceMeta]
    files: dict[str, str] = {}


def _require_worker(user: dict) -> None:
    if not is_support_worker(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Support worker access required.")


def _require_worker_active(user: dict) -> None:
    """Blocks a deactivated worker from starting/documenting a shift or
    taking on new work, even with a still-valid token - the frontend already
    keeps them off these pages during normal use (ProtectedRoute.tsx gates on
    is_active), but this is the real enforcement boundary against a direct
    API call, since is_active isn't part of the JWT and a deactivated
    worker's existing session isn't revoked. Deliberately narrow: only the
    handful of endpoints that represent actually performing paid support
    work call this (clock-in/out, session creation, shift-offer accept) -
    self-service pages (credentials, training) never do, since a worker
    deactivated for a self-fixable reason still needs those to work."""
    result = (
        get_supabase_admin()
        .table("users")
        .select("is_active, deactivation_reason")
        .eq("id", get_user_id(user))
        .maybe_single()
        .execute()
    )
    profile = result.data if result else {}
    if profile.get("is_active") is False:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been deactivated. Contact your organisation admin.",
        )


# ── Worker-Participant Matching Enhancement, Phase 1 — self-service tags ──────
# A worker can browse the org's tag catalog, add/remove tags describing their
# own interests or (consented) lived experience, and mark any tag
# visible_to_coordinator_only. Coordinators/MD manage the catalog itself and
# can also tag a worker on their behalf (coordinator.py) - this is the
# worker's own door onto the same participant_tags/worker_tags data.

@router.get("/tag-catalog")
async def worker_tag_catalog(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required.")
    from ..services import tag_service

    return tag_service.list_tag_catalog(org_id)


@router.get("/tags")
async def worker_own_tags(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    from ..services import tag_service

    return tag_service.list_worker_tags(get_user_id(current_user), include_private=True)


class WorkerOwnTagBody(BaseModel):
    tag_id: str
    notes: Optional[str] = None
    visible_to_coordinator_only: bool = False


@router.post("/tags", status_code=201)
async def add_worker_own_tag(body: WorkerOwnTagBody, current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    from ..services import tag_service

    worker_id = get_user_id(current_user)
    return tag_service.add_worker_tag(worker_id, body.tag_id, worker_id, body.notes, body.visible_to_coordinator_only)


@router.delete("/tags/{tag_id}", status_code=204)
async def remove_worker_own_tag(tag_id: str, current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    from ..services import tag_service

    tag_service.remove_worker_tag(get_user_id(current_user), tag_id)
    return None


class MatchingPreferencesBody(BaseModel):
    matching_opt_in: bool


@router.patch("/matching-preferences")
async def update_matching_preferences(body: MatchingPreferencesBody, current_user: dict = Depends(get_current_user)):
    """Lets a worker opt out of interest/lived-experience-based shift ranking
    (Phase 2) entirely, while keeping any tags already on file for their own
    reference."""
    _require_worker(current_user)
    from ..services import tag_service

    tag_service.set_matching_opt_in(get_user_id(current_user), body.matching_opt_in)
    return {"ok": True}


# ── Worker-Participant Matching Enhancement, Phase 3 — worker-side feedback ──
# Worker's own optional reflection on a completed shift, independent of the
# coordinator's outcome_rating/participant_response - either side can arrive
# first (see migration 146's comment on shift_match_feedback).

class ShiftMatchWorkerFeedbackBody(BaseModel):
    worker_feedback: str


@router.post("/shifts/{shift_id}/match-feedback")
async def submit_shift_match_worker_feedback(
    shift_id: str, body: ShiftMatchWorkerFeedbackBody, current_user: dict = Depends(get_current_user)
):
    _require_worker(current_user)
    if not body.worker_feedback.strip():
        raise HTTPException(status_code=422, detail="worker_feedback is required.")
    from ..services import shift_match_feedback_service

    try:
        return shift_match_feedback_service.record_worker_feedback(
            shift_id, get_user_id(current_user), body.worker_feedback.strip()
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/account/request-password-reset")
async def request_password_reset(current_user: dict = Depends(get_current_user)):
    """Support workers can't change their own password (org policy) — this
    notifies their coordinators/MD, who can send a reset link from the
    worker's staff profile (see coordinator.py's send-password-reset)."""
    _require_worker(current_user)
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required.")
    await notify_password_reset_requested(
        org_id=org_id,
        worker_id=get_user_id(current_user),
        worker_name=current_user.get("full_name") or current_user.get("email") or "",
    )
    return {"message": "Your coordinator has been notified and will send you a reset link."}


def _require_worker_ready_for_sessions(user: dict) -> None:
    result = (
        get_supabase_admin()
        .table("users")
        .select("onboarding_completed, onboarding_complete")
        .eq("id", get_user_id(user))
        .maybe_single()
        .execute()
    )
    profile = result.data if result else {}
    if not bool(profile.get("onboarding_completed") or profile.get("onboarding_complete")):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Complete the worker onboarding checklist before starting sessions or creating notes.",
        )


async def _assigned_participant(participant_id: str, user: dict) -> dict:
    _require_worker(user)
    participant = await participant_service.get_participant_by_id(participant_id, user)
    if not participant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participant not found")
    return participant


def _score_status(score) -> str:
    if score is None:
        return "at_risk"
    value = float(score)
    if value >= 85:
        return "compliant"
    if value >= 60:
        return "at_risk"
    return "non_compliant"


def _date_part(value: Any) -> str:
    if not value:
        return ""
    return str(value)[:10]


def _safe_json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return {}
    return value if value is not None else {}


def _session_compliance_score(session: dict) -> float | None:
    """Prefer sessions.compliance_score; fall back to end_validation / task validation."""
    raw = session.get("compliance_score")
    if raw is not None:
        try:
            return float(raw)
        except (TypeError, ValueError):
            pass
    end_validation = _safe_json(session.get("end_validation"))
    if isinstance(end_validation, dict) and end_validation.get("compliance_score") is not None:
        try:
            return float(end_validation["compliance_score"])
        except (TypeError, ValueError):
            pass
    tasks = session.get("tasks")
    if isinstance(tasks, list) and tasks:
        try:
            from ..services.shift_validation_service import compute_shift_validation

            derived = compute_shift_validation(tasks).get("compliance_score")
            if derived is not None:
                return float(derived)
        except Exception:
            return None
    return None


def _session_calendar_date(session: dict) -> str:
    """Care-day for compliance trend/history.

    Prefer APP_TIMEZONE local day of start_time so Score Trend / Session History
    match Shifts → Past (scheduled_start local). session_date alone can be a day
    early when stored from a UTC timestamptz cast. Overnight completions finished
    today still map onto Today.
    """
    today = app_today()
    care: date | None = shift_local_date(session.get("start_time"))
    if care is None:
        session_day = _date_part(session.get("session_date"))
        if session_day:
            try:
                care = date.fromisoformat(session_day)
            except ValueError:
                care = None

    if str(session.get("status") or "").lower() == "completed":
        completed_local: date | None = None
        for key in ("completed_at", "updated_at", "end_time"):
            completed_local = shift_local_date(session.get(key))
            if completed_local:
                break
        if completed_local == today:
            if care is None or care == today or care == today - timedelta(days=1):
                return today.isoformat()

    if care is not None:
        return care.isoformat()
    local = shift_local_date(session.get("created_at"))
    return local.isoformat() if local else ""


def _compliance_trend(sessions: list[dict], days: int) -> list[dict]:
    """Daily average compliance scores for the last N days (inclusive of today)."""
    days = max(1, min(days, 90))
    start = app_today() - timedelta(days=days - 1)
    day_scores: dict[str, list[float]] = defaultdict(list)
    day_counts: dict[str, int] = defaultdict(int)

    for session in sessions:
        session_day = _session_calendar_date(session)
        if not session_day:
            continue
        try:
            if date.fromisoformat(session_day) < start:
                continue
        except ValueError:
            continue
        day_counts[session_day] += 1
        score = _session_compliance_score(session)
        if score is not None:
            day_scores[session_day].append(score)

    trend: list[dict] = []
    for offset in range(days):
        day = (start + timedelta(days=offset)).isoformat()
        scores = day_scores.get(day, [])
        trend.append({
            "date": day,
            "avg_score": round(sum(scores) / len(scores), 1) if scores else None,
            "session_count": day_counts.get(day, 0),
        })
    return trend


async def _latest_rule_results(sessions: list[dict]) -> tuple[list[dict], str | None]:
    """Return rules from the newest scored session that has a rule breakdown.

    Sessions can have compliance_score from end_validation / task checks without
    R1–R12 results. Walk newest-first so the UI does not show all-pending rules
    while an average score still exists from older engine runs.
    """
    scored = [
        s for s in sessions
        if _session_compliance_score(s) is not None
    ]
    if not scored:
        return [], None

    def _sort_key(session: dict) -> str:
        return str(
            session.get("compliance_checked_at")
            or session.get("updated_at")
            or _session_calendar_date(session)
            or session.get("session_date")
            or ""
        )

    for session in sorted(scored, key=_sort_key, reverse=True):
        session_id = str(session.get("id") or "")
        if not session_id:
            continue

        insights = _safe_json(session.get("ai_insights"))
        rules_result = insights.get("rules_result") if isinstance(insights, dict) else {}
        rules = rules_result.get("rules") if isinstance(rules_result, dict) else []
        if isinstance(rules, list) and rules:
            return rules, session_id

        logs = await funding_service.get_compliance_audit_logs(session_id)
        if logs:
            all_rules = logs[0].get("all_rules")
            if isinstance(all_rules, list) and all_rules:
                return all_rules, session_id

    latest_id = str(sorted(scored, key=_sort_key, reverse=True)[0].get("id") or "") or None
    return [], latest_id


def _limited_participant(participant: dict) -> dict:
    return {
        "id": participant.get("id"),
        "full_name": participant.get("full_name"),
        "ndis_number": participant.get("ndis_number"),
        "date_of_birth": participant.get("date_of_birth"),
        "plan_status": participant.get("plan_status"),
        "plan_start_date": participant.get("plan_start_date"),
        "plan_end_date": participant.get("plan_end_date"),
        "plan_management_type": (
            participant.get("plan_management_type")
            or participant.get("plan_status")
            or "Not recorded"
        ),
        "primary_disability": participant.get("primary_disability"),
        "allergies": participant.get("allergies"),
        "communication_preferences": participant.get("communication_preferences"),
        "behaviour_support_plan": participant.get("behaviour_support_plan"),
        "restricted_behavioural_notes": participant.get("restricted_behavioural_notes"),
        "goals": participant.get("goals") or [],
        "limited_medical_history": {
            "primary_disability": participant.get("primary_disability"),
            "biological_sex": participant.get("biological_sex"),
        },
    }


def _session_payload(session: dict) -> dict:
    note_text = session.get("translated_english_note") or session.get("compliance_input_text") or session.get("notes")
    score = _session_compliance_score(session)
    return {
        "id": session.get("id"),
        "participant_id": session.get("participant_id") or session.get("patient_id"),
        "session_date": _session_calendar_date(session) or session.get("session_date"),
        "session_type": session.get("session_type"),
        "duration_minutes": session.get("duration_minutes"),
        "status": session.get("status"),
        "notes": note_text,
        "legal_record_text": session.get("legal_record_text") or note_text,
        "compliance_score": score,
        "compliance_status": _score_status(score),
        "goals_addressed": session.get("goals_addressed") or [],
        "translation_status": session.get("translation_status"),
        # SCRUM-226
        "goal_progress_notes": session.get("goal_progress_notes") or [],
        # SCRUM-227
        "participant_choice_control": session.get("participant_choice_control"),
    }


def _client_row(participant: dict, sessions: list[dict]) -> dict:
    scores = [float(s["compliance_score"]) for s in sessions if s.get("compliance_score") is not None]
    worst_score = min(scores) if scores else None
    last_seen = sessions[0].get("session_date") if sessions else None
    return {
        **_limited_participant(participant),
        "last_seen": last_seen,
        "compliance_score": round(worst_score, 1) if worst_score is not None else None,
        "compliance_status": _score_status(worst_score),
    }


async def _worker_sessions_for_participant(participant_id: str, user: dict) -> list[dict]:
    participant = await _assigned_participant(participant_id, user)
    sessions = await session_service.get_sessions_by_participant(participant_id, user)
    current_user_id = get_user_id(user)
    own_sessions = [
        session
        for session in sessions
        if current_user_id in {
            str(session.get("worker_id") or ""),
            str(session.get("support_worker_id") or ""),
            str(session.get("owner_user_id") or ""),
            str(session.get("created_by") or ""),
        }
    ]
    if not own_sessions:
        return []
    await audit_service.log_action(
        action_type="worker.sessions.viewed",
        entity_type="participant",
        entity_id=participant_id,
        user_id=current_user_id,
        organization_id=get_user_organization_id(user),
        details={"participant_name": participant.get("full_name")},
    )
    return own_sessions


@router.get("/my-clients")
async def my_clients(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    participants = await participant_service.get_participants_list_light(current_user)
    worker_id = get_user_id(current_user) or ""
    participant_ids = [str(participant.get("id")) for participant in participants if participant.get("id")]
    sessions_by_participant = await session_service.get_worker_sessions_grouped(
        participant_ids,
        worker_id,
        current_user,
    )
    rows: list[dict] = []
    for participant in participants:
        participant_id = str(participant.get("id"))
        sessions = sessions_by_participant.get(participant_id, [])
        rows.append(_client_row(participant, sessions))
    if participant_ids:
        await audit_service.log_action(
            action_type="worker.sessions.viewed",
            entity_type="participant",
            entity_id=None,
            user_id=worker_id,
            organization_id=get_user_organization_id(current_user),
            details={"participant_count": len(participant_ids), "source": "my_clients_list"},
        )
    return rows


@router.get("/my-clients/{participant_id}")
async def my_client_detail(participant_id: str, current_user: dict = Depends(get_current_user)):
    participant = await _assigned_participant(participant_id, current_user)
    sessions = await _worker_sessions_for_participant(participant_id, current_user)
    # Enrich participant with priority-sorted active goals (no funding data)
    enriched_goals = await goals_service.get_goals_for_participant(participant_id, active_only=True)
    if enriched_goals:
        participant = {**participant, "goals": enriched_goals}
    await audit_service.log_action(
        action_type="worker.participant.viewed",
        entity_type="participant",
        entity_id=participant_id,
        user_id=get_user_id(current_user),
        organization_id=get_user_organization_id(current_user),
    )
    return {
        "participant": _client_row(participant, sessions),
        "sessions": [_session_payload(session) for session in sessions],
        "notes": [_session_payload(session) for session in sessions if session.get("notes")],
        "compliance": [
            _session_payload(session)
            for session in sessions
            if session.get("compliance_score") is not None or session.get("translation_status") in {"failed", "pending", "unsupported"}
        ],
    }


@router.get("/my-clients/{participant_id}/sessions")
async def my_client_sessions(participant_id: str, current_user: dict = Depends(get_current_user)):
    sessions = await _worker_sessions_for_participant(participant_id, current_user)
    return [_session_payload(session) for session in sessions]


@router.get("/my-clients/{participant_id}/ndis-plan")
async def my_client_ndis_plan(participant_id: str, current_user: dict = Depends(get_current_user)):
    participant = await _assigned_participant(participant_id, current_user)
    plan = await funding_service.get_plan_for_participant(participant_id)
    # Fetch enriched goals (priority-sorted, active only, no funding data) from goals_service
    enriched_goals = await goals_service.get_goals_for_participant(participant_id, active_only=False)
    return {
        "participant_id": participant_id,
        "participant_name": participant.get("full_name"),
        "read_only": True,
        "goals": enriched_goals or participant.get("goals") or [],
        "plan": plan or {
            "has_plan": False,
            "plan_status": participant.get("plan_status"),
            "plan_start_date": participant.get("plan_start_date"),
            "plan_end_date": participant.get("plan_end_date"),
        },
    }


@router.get("/my-compliance")
async def my_compliance(
    sessions_limit: Optional[int] = Query(default=None, ge=0, le=50),
    sessions_offset: int = Query(default=0, ge=0),
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    sessions = await session_service.get_worker_own_sessions(current_user, limit=500)
    sessions = sorted(
        sessions,
        key=lambda s: (
            _session_calendar_date(s) or "",
            str(s.get("updated_at") or s.get("created_at") or ""),
        ),
        reverse=True,
    )
    scored = [s for s in sessions if _session_compliance_score(s) is not None]
    scores = [_session_compliance_score(s) for s in scored]
    scores = [float(v) for v in scores if v is not None]
    average = round(sum(scores) / len(scores), 1) if scores else 0
    compliant_sessions = sum(
        1 for session in scored if _score_status(_session_compliance_score(session)) == "compliant"
    )
    session_payloads = [_session_payload(session) for session in sessions]
    total_sessions = len(session_payloads)
    if sessions_limit is not None:
        page_sessions = session_payloads[sessions_offset : sessions_offset + sessions_limit]
    else:
        page_sessions = session_payloads
    return {
        "average_score": average,
        "status": _score_status(average),
        "total_sessions": len(sessions),
        "reviewed_sessions": len(scored),
        "at_risk": sum(1 for score in scores if score < 85),
        "compliant_sessions": compliant_sessions,
        "sessions": page_sessions,
        "sessions_total": total_sessions,
        "latest_session": session_payloads[0] if session_payloads else None,
    }


@router.get("/compliance-detail")
async def worker_compliance_detail(
    days: int = Query(default=7, ge=7, le=30),
    current_user: dict = Depends(get_current_user),
):
    """Real-time compliance score, 12-rule breakdown, red flags, and daily trend."""
    _require_worker(current_user)
    sessions = await session_service.get_worker_own_sessions(current_user, limit=500)
    scored = [s for s in sessions if _session_compliance_score(s) is not None]
    scores = [float(v) for v in (_session_compliance_score(s) for s in scored) if v is not None]
    average = round(sum(scores) / len(scores), 1) if scores else 0

    raw_rules, _ = await _latest_rule_results(sessions)
    rules = enrich_rule_results(raw_rules)
    failed_rules = [
        {
            "rule": r.get("rule"),
            "label": r.get("label"),
            "message": r.get("message"),
            "explanation": r.get("explanation"),
            "severity": r.get("severity"),
            "enforcement_tier": r.get("enforcement_tier"),
        }
        for r in rules
        if r.get("status") in {"fail", "warning"}
    ]

    return {
        "score": average,
        "status": _score_status(average),
        "reviewed_sessions": len(scored),
        "rules": rules,
        "failed_rules": failed_rules,
        "rules_catalog": get_rules_catalog(),
        "trend": _compliance_trend(sessions, days),
        "trend_days": days,
    }


@router.post("/my-clients/{participant_id}/sessions", status_code=status.HTTP_201_CREATED)
async def create_my_client_session(
    participant_id: str,
    body: WorkerSessionCreate,
    current_user: dict = Depends(get_current_user),
):
    await _assigned_participant(participant_id, current_user)
    _require_worker_active(current_user)
    _require_worker_ready_for_sessions(current_user)
    # Auto-populate goals_addressed from goal_progress_notes if not explicitly provided
    goals_addressed = body.goals_addressed or [
        note.goal_id for note in body.goal_progress_notes if note.goal_id
    ]
    payload = SessionCreate(
        participant_id=participant_id,
        session_date=body.session_date,
        duration_minutes=body.duration_minutes,
        session_type=body.session_type,
        notes=body.notes,
        goals_addressed=goals_addressed,
        status=body.status,
        start_time=body.start_time,
        end_time=body.end_time,
        activities_performed=body.activities_performed,
        outcomes=body.outcomes,
        participant_response=body.participant_response,
        progress_toward_goals=body.progress_toward_goals,
        goal_progress_notes=body.goal_progress_notes,
        participant_choice_control=body.participant_choice_control,
    )
    try:
        session = await session_service.create_session(payload, current_user)
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participant not found")
    await audit_service.log_action(
        action_type="worker.session.created",
        entity_type="session",
        entity_id=session.get("id", ""),
        user_id=get_user_id(current_user),
        organization_id=get_user_organization_id(current_user),
        after_state={"participant_id": participant_id, "session_type": body.session_type},
    )
    return _session_payload(session)


@router.get("/shifts")
async def worker_shifts(
    filter: str = Query(default="today", alias="filter"),
    limit: Optional[int] = Query(default=None, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: dict = Depends(get_current_user),
):
    """List shifts for the authenticated support worker (CARECLIQV2-116)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    return shift_service.list_shifts_for_worker(
        worker_id,
        org_id,
        filter,
        limit=limit,
        offset=offset,
    )


@router.get("/shifts/counts")
async def worker_shift_counts(current_user: dict = Depends(get_current_user)):
    """Per-filter shift counts for My Shifts tabs (CARECLIQV2-133)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    counts = shift_service.count_shifts_for_worker(worker_id, org_id)
    return {"counts": counts}


@router.get("/shifts/{shift_id}")
async def worker_shift_detail(shift_id: str, current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    try:
        shift = shift_service.get_shift_detail_for_worker(shift_id, worker_id, org_id)
    except shift_service.ShiftAccessDenied as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    if not shift:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    return shift


@router.get("/shifts/{shift_id}/participant-risks")
async def worker_shift_participant_risks(shift_id: str, current_user: dict = Depends(get_current_user)):
    """Structured safety alerts for a shift (CARECLIQV2-158)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    payload = shift_service.get_participant_risks_for_worker(shift_id, worker_id, org_id)
    if not payload:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    return payload


@router.get("/shifts/{shift_id}/support-instructions")
async def worker_shift_support_instructions(shift_id: str, current_user: dict = Depends(get_current_user)):
    """Category-based support instructions for a shift (CARECLIQV2-157)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    payload = shift_service.get_support_instructions_for_worker(shift_id, worker_id, org_id)
    if not payload:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    return payload


@router.get("/shifts/{shift_id}/participant-profile")
async def worker_shift_participant_profile(shift_id: str, current_user: dict = Depends(get_current_user)):
    """Read-only participant profile for an assigned shift (CARECLIQV2-195)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    payload = shift_service.get_participant_profile_for_worker(shift_id, worker_id, org_id)
    if not payload:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    return payload


class CannotAttendBody(BaseModel):
    reason: Optional[str] = None


@router.patch("/shifts/{shift_id}/cannot-attend")
async def worker_shift_cannot_attend(
    shift_id: str,
    body: CannotAttendBody = CannotAttendBody(),
    current_user: dict = Depends(get_current_user),
):
    """Worker-initiated cancellation — vacates the shift back to 'unassigned'
    and notifies coordinators, the reverse of a coordinator cancelling on the
    worker (notify_shift_cancelled)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    try:
        updated = await shift_offer_service.mark_cannot_attend(
            shift_id=shift_id, worker_id=worker_id, org_id=org_id, reason=body.reason,
        )
    except shift_offer_service.ShiftOfferError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await audit_service.log_action(
        action_type="worker.shift.cannot_attend",
        entity_type="shift",
        entity_id=shift_id,
        user_id=worker_id,
        organization_id=org_id,
        details={"reason": body.reason},
    )
    return {"shift_id": shift_id, "shift": updated}


@router.post("/shifts/{shift_id}/offer/accept")
async def worker_shift_offer_accept(shift_id: str, current_user: dict = Depends(get_current_user)):
    """Accept a pending ranked shift offer — assigns the shift to this
    worker. Never triggered automatically; this is the only path that
    confirms an offer into an actual assignment."""
    _require_worker(current_user)
    _require_worker_active(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    try:
        updated = await shift_offer_service.accept_offer(shift_id=shift_id, worker_id=worker_id, org_id=org_id)
    except shift_offer_service.ShiftOfferError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    await audit_service.log_action(
        action_type="worker.shift_offer.accepted",
        entity_type="shift",
        entity_id=shift_id,
        user_id=worker_id,
        organization_id=org_id,
    )
    return {"shift_id": shift_id, "shift": updated}


class DeclineOfferBody(BaseModel):
    reason: Optional[str] = None


@router.post("/shifts/{shift_id}/offer/decline")
async def worker_shift_offer_decline(
    shift_id: str,
    body: DeclineOfferBody = DeclineOfferBody(),
    current_user: dict = Depends(get_current_user),
):
    """Decline a pending ranked shift offer — auto-advances to the next
    ranked candidate, or notifies coordinators if none remain."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    try:
        await shift_offer_service.decline_offer(
            shift_id=shift_id, worker_id=worker_id, org_id=org_id, reason=body.reason,
        )
    except shift_offer_service.ShiftOfferError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    await audit_service.log_action(
        action_type="worker.shift_offer.declined",
        entity_type="shift",
        entity_id=shift_id,
        user_id=worker_id,
        organization_id=org_id,
        details={"reason": body.reason},
    )
    return {"shift_id": shift_id}


@router.get("/shifts/{shift_id}/offer")
async def worker_shift_offer_summary(shift_id: str, current_user: dict = Depends(get_current_user)):
    """Safe, decision-only summary for a shift this worker has been offered
    but not yet accepted or declined. Deliberately does NOT reuse
    get_shift_detail_for_worker (worker_id-gated, full participant profile) —
    a pending offer has no worker_id on the shift yet, so that endpoint
    always 403s here, and even if it didn't, the full profile shouldn't be
    visible before the worker has committed to the shift. Returns just
    enough to decide: first name, timing, shift type."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    try:
        offer = shift_offer_service._get_pending_offer(shift_id=shift_id, worker_id=worker_id)
    except shift_offer_service.ShiftOfferError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No pending offer found for this shift")
    shift = shift_service.get_shift_by_id(shift_id)
    if not shift or str(shift.get("organization_id") or "") != org_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    participant_name = (shift.get("participant_name") or "").strip()
    return {
        "offer_id": offer.get("id"),
        "shift_id": shift_id,
        "participant_first_name": participant_name.split()[0] if participant_name else None,
        "scheduled_start": shift.get("scheduled_start"),
        "scheduled_end": shift.get("scheduled_end"),
        "shift_type": shift.get("shift_type"),
        "offered_at": offer.get("offered_at"),
    }


def _require_shift_owner(shift_id: str, current_user: dict) -> dict:
    """Load a shift row and confirm it belongs to the authenticated worker's org/assignment."""
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    shift = shift_service.get_shift_by_id(shift_id)
    if not shift:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    if str(shift.get("worker_id") or "") != str(worker_id) or str(shift.get("organization_id") or "") != str(org_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to this shift.")
    return shift


@router.get("/shifts/{shift_id}/medication-checklist")
async def worker_shift_medication_checklist(shift_id: str, current_user: dict = Depends(get_current_user)):
    """Scheduled medication doses due within this shift's window (Medication Management v1)."""
    _require_worker(current_user)
    shift = _require_shift_owner(shift_id, current_user)
    org_id = get_user_organization_id(current_user)
    return {"checklist": medication_service.build_shift_medication_checklist(shift, org_id)}


@router.post("/shifts/{shift_id}/medications/{medication_id}/verification-photo", status_code=status.HTTP_201_CREATED)
async def worker_upload_medication_verification_photo(
    shift_id: str,
    medication_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Store the point-of-administration photo required for a high-risk medication before the
    administration outcome can be submitted (Medication Safety Addendum step 3). Returns the
    stored file's URL — pass it as verification_photo_url on the administration POST."""
    _require_worker(current_user)
    shift = _require_shift_owner(shift_id, current_user)
    org_id = get_user_organization_id(current_user)
    medication = medication_service.get_medication(medication_id, org_id)
    if str(medication.get("participant_id")) != str(shift.get("participant_id")):
        raise HTTPException(status_code=422, detail="Medication does not belong to this shift's participant.")
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=422, detail="File is empty.")
    result = await medication_document_service.upload_document(
        medication["participant_id"],
        org_id,
        get_user_id(current_user),
        file_bytes=contents,
        filename=file.filename or "verification-photo",
        content_type=file.content_type or "",
        document_type="verification_photo",
        medication_id=medication_id,
        skip_extraction=True,
    )
    return {"url": result["document"]["file_url"]}


class MedicationAdministrationBody(BaseModel):
    scheduled_time: Optional[str] = None
    administered_time: Optional[str] = None
    action: Literal["given", "refused", "missed", "withheld", "administration_error"]
    reason_code: Optional[str] = None
    directed_by: Optional[str] = None
    dose_given: Optional[str] = None
    notes: Optional[str] = None
    prn_reason: Optional[str] = None
    voice_captured: bool = False
    error_subtype: Optional[str] = None
    verification_photo_url: Optional[str] = None
    # Late-discovery correction only: references the original given_*/administration_error row
    # this one corrects. Left null for an immediate self-reported error (that's a standalone row).
    corrects_administration_id: Optional[str] = None
    error_discovered_at: Optional[str] = None


@router.post("/shifts/{shift_id}/medications/{medication_id}/administrations", status_code=status.HTTP_201_CREATED)
async def worker_log_medication_administration(
    shift_id: str,
    medication_id: str,
    body: MedicationAdministrationBody,
    current_user: dict = Depends(get_current_user),
):
    """Log a scheduled-dose or PRN administration event during a shift (append-only ledger).
    given_on_time/given_late/given_early is classified automatically from the timestamps —
    the worker only picks the base action (given/refused/missed/withheld/administration_error).
    Pass corrects_administration_id to log a late-discovered error against someone else's
    earlier entry instead of your own in-the-moment one — the original row is never edited."""
    _require_worker(current_user)
    shift = _require_shift_owner(shift_id, current_user)
    org_id = get_user_organization_id(current_user)
    worker_id = get_user_id(current_user)
    medication = medication_service.get_medication(medication_id, org_id)
    if str(medication.get("participant_id")) != str(shift.get("participant_id")):
        raise HTTPException(status_code=422, detail="Medication does not belong to this shift's participant.")
    if body.corrects_administration_id:
        original = medication_service.get_administration(body.corrects_administration_id, org_id)
        if str(original.get("medication_id")) != str(medication_id) or str(original.get("shift_id")) != str(shift_id):
            raise HTTPException(status_code=422, detail="corrects_administration_id must reference an administration for this same medication and shift.")
    return medication_service.create_administration(
        medication=medication,
        shift=shift,
        organization_id=org_id,
        administered_by=worker_id,
        action=body.action,
        scheduled_time=body.scheduled_time,
        administered_time=body.administered_time,
        reason_code=body.reason_code,
        directed_by=body.directed_by,
        dose_given=body.dose_given,
        notes=body.notes,
        prn_reason=body.prn_reason,
        voice_captured=body.voice_captured,
        error_subtype=body.error_subtype,
        verification_photo_url=body.verification_photo_url,
        corrects_administration_id=body.corrects_administration_id,
        error_discovered_at=body.error_discovered_at,
        error_discovered_by=worker_id if body.corrects_administration_id else None,
    )


@router.get("/shifts/{shift_id}/prn-medications")
async def worker_shift_prn_medications(shift_id: str, current_user: dict = Depends(get_current_user)):
    """Active PRN medications for this shift's participant, plus doses awaiting an effect note."""
    _require_worker(current_user)
    shift = _require_shift_owner(shift_id, current_user)
    org_id = get_user_organization_id(current_user)
    return medication_service.build_shift_prn_medications(shift, org_id)


class MedicationEffectBody(BaseModel):
    effect_observed: str
    voice_captured: bool = False


@router.patch("/medication-administrations/{administration_id}/effect")
async def worker_log_prn_effect(
    administration_id: str,
    body: MedicationEffectBody,
    current_user: dict = Depends(get_current_user),
):
    """Follow-up: record the observed effect of an already-logged PRN dose."""
    _require_worker(current_user)
    org_id = get_user_organization_id(current_user)
    return medication_service.record_prn_effect(
        administration_id,
        org_id,
        body.effect_observed,
        body.voice_captured,
    )


class MedicationReasonBody(BaseModel):
    reason_code: Optional[str] = None
    notes: Optional[str] = None


@router.patch("/medication-administrations/{administration_id}/reason")
async def worker_attach_medication_reason(
    administration_id: str,
    body: MedicationReasonBody,
    current_user: dict = Depends(get_current_user),
):
    """Follow-up: attach a reason to a dose that came back given_late/given_early — the worker
    couldn't have known that classification in advance of submitting it."""
    _require_worker(current_user)
    org_id = get_user_organization_id(current_user)
    return medication_service.attach_administration_reason(administration_id, org_id, body.reason_code, body.notes)


@router.get("/shifts/{shift_id}/participant-preferences")
async def worker_shift_participant_preferences(shift_id: str, current_user: dict = Depends(get_current_user)):
    """Read-only participant preferences for an assigned shift (CARECLIQV2-196)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    payload = shift_service.get_participant_preferences_for_worker(shift_id, worker_id, org_id)
    if not payload:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    return payload


@router.post("/shifts/{shift_id}/clock-in")
async def worker_clock_in(
    shift_id: str,
    body: ClockInBody,
    current_user: dict = Depends(get_current_user),
):
    """Clock in to a shift with GPS/QR verification (CARECLIQV2-197)."""
    _require_worker(current_user)
    _require_worker_active(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    location = body.location.model_dump() if body.location else None
    try:
        shift = shift_service.clock_in_shift(
            shift_id,
            worker_id,
            org_id,
            method=body.method,
            location=location,
            qr_token=body.qr_token,
            client_timestamp=body.client_timestamp,
        )
    except shift_service.ShiftAlreadyClockedIn as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except shift_service.ShiftNotScheduledToday as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        message = str(exc)
        status_code = (
            status.HTTP_422_UNPROCESSABLE_ENTITY
            if any(
                phrase in message.lower()
                for phrase in ("too early", "too far", "window closed", "requires", "invalid qr", "qr code")
            )
            else status.HTTP_409_CONFLICT
        )
        raise HTTPException(status_code=status_code, detail=message)
    if not shift:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    action_type = (
        "worker.shift.checked_in_verified"
        if body and body.method
        else "worker.shift.clocked_in"
    )
    await audit_service.log_action(
        action_type=action_type,
        entity_type="shift",
        entity_id=shift_id,
        user_id=worker_id,
        organization_id=org_id,
        details={
            "method": body.method if body else None,
            "verified": shift.get("clock_in_verified"),
        },
    )
    await travel_expense_service.auto_save_mileage_on_clock_in(
        shift_id=shift_id,
        worker_id=worker_id,
        organization_id=org_id,
        participant_address=shift.get("participant_address"),
        claimed_km_override=body.claimed_km,
    )
    return shift


@router.patch("/shifts/{shift_id}/tasks")
async def worker_update_shift_tasks(
    shift_id: str,
    body: ShiftTasksUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Persist task checklist changes (CARECLIQV2-134)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    tasks = [task.model_dump() for task in body.tasks]
    try:
        shift = shift_service.update_shift_tasks(shift_id, worker_id, org_id, tasks)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    if not shift:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    completed = sum(1 for t in tasks if t.get("completed"))
    await audit_service.log_action(
        action_type="worker.shift.tasks_updated",
        entity_type="shift",
        entity_id=shift_id,
        user_id=worker_id,
        organization_id=org_id,
        details={"task_count": len(tasks), "completed_count": completed},
    )
    return shift


@router.post("/shifts/{shift_id}/tasks/custom", status_code=status.HTTP_201_CREATED)
async def worker_add_custom_task(
    shift_id: str,
    body: CustomTaskCreate,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    try:
        shift = shift_service.add_custom_shift_task(shift_id, worker_id, org_id, body.label)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    if not shift:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    return shift


@router.delete("/shifts/{shift_id}/tasks/{task_id}")
async def worker_delete_custom_task(
    shift_id: str,
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Remove a worker-added custom task from the shift checklist."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    try:
        shift = shift_service.delete_custom_shift_task(shift_id, worker_id, org_id, task_id)
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=message)
    if not shift:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    return shift


class BriefingAlertAckBody(BaseModel):
    alert_id: str


class BriefingCompleteBody(BaseModel):
    scrolled_to_bottom: bool = True


@router.get("/shifts/{shift_id}/briefing")
async def worker_shift_briefing(shift_id: str, current_user: dict = Depends(get_current_user)):
    """Pre-shift briefing payload (CARECLIQV2-267)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    from ..services import briefing_service

    try:
        return briefing_service.get_briefing_for_worker(shift_id, worker_id, org_id)
    except briefing_service.ShiftAccessDenied as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.post("/shifts/{shift_id}/briefing/acknowledge-alert")
async def worker_acknowledge_briefing_alert(
    shift_id: str,
    body: BriefingAlertAckBody,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    from ..services import briefing_service

    try:
        payload = briefing_service.acknowledge_briefing_alert(
            shift_id, body.alert_id, worker_id, org_id
        )
    except briefing_service.ShiftAccessDenied as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    await audit_service.log_action(
        action_type="worker.shift.briefing_alert_acknowledged",
        entity_type="shift",
        entity_id=shift_id,
        user_id=worker_id,
        organization_id=org_id,
        details={"alert_id": body.alert_id},
    )
    return payload


@router.post("/shifts/{shift_id}/briefing/complete")
async def worker_complete_briefing(
    shift_id: str,
    body: BriefingCompleteBody,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    from ..services import briefing_service

    try:
        payload = briefing_service.complete_briefing(
            shift_id,
            worker_id,
            org_id,
            scrolled_to_bottom=body.scrolled_to_bottom,
        )
    except briefing_service.ShiftAccessDenied as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    await audit_service.log_action(
        action_type="worker.shift.briefing_completed",
        entity_type="shift",
        entity_id=shift_id,
        user_id=worker_id,
        organization_id=org_id,
    )
    return payload


@router.post("/shifts/{shift_id}/acknowledge-risks")
async def worker_acknowledge_risks(shift_id: str, current_user: dict = Depends(get_current_user)):
    """Log risk acknowledgement before shift start (CARECLIQV2-158)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    try:
        shift = shift_service.acknowledge_shift_risks(shift_id, worker_id, org_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    if not shift:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    await audit_service.log_action(
        action_type="worker.shift.risks_acknowledged",
        entity_type="shift",
        entity_id=shift_id,
        user_id=worker_id,
        organization_id=org_id,
    )
    return shift


from ..schemas.safety_protocol import SafetyProtocolAcknowledge
from ..services import safety_protocol_service


async def _worker_can_access_participant(
    participant_id: str,
    current_user: dict,
) -> bool:
    participant = await participant_service.get_participant_by_id(participant_id, current_user)
    if participant:
        return True
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    return shift_service.worker_has_shift_for_participant(
        participant_id,
        str(worker_id or ""),
        str(org_id or ""),
    )


@router.get("/participants/{participant_id}/safety-protocol")
async def worker_get_safety_protocol(
    participant_id: str,
    shift_id: Optional[str] = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    """Participant safety protocols for worker (read-only)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    if not await _worker_can_access_participant(participant_id, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participant not found")
    protocol = safety_protocol_service.get_protocol(participant_id, str(org_id or ""))
    return safety_protocol_service.enrich_protocol_for_worker(
        protocol, worker_id=worker_id, shift_id=shift_id
    )


@router.post("/participants/{participant_id}/safety-protocol/acknowledge")
async def worker_acknowledge_safety_protocol(
    participant_id: str,
    body: SafetyProtocolAcknowledge,
    current_user: dict = Depends(get_current_user),
):
    """Log mandatory safety card acknowledgement."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    if not await _worker_can_access_participant(participant_id, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participant not found")
    try:
        result = safety_protocol_service.acknowledge_protocol(
            worker_id=worker_id,
            participant_id=participant_id,
            organization_id=str(org_id or ""),
            content_version=body.content_version,
            org_content_version=body.org_content_version,
            shift_id=body.shift_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    await audit_service.log_action(
        action_type="worker.safety_protocol.acknowledged",
        entity_type="participant",
        entity_id=participant_id,
        user_id=worker_id,
        organization_id=org_id,
        after_state={"content_version": body.content_version},
    )
    return result


@router.post("/shifts/{shift_id}/start-session")
async def worker_start_session(shift_id: str, current_user: dict = Depends(get_current_user)):
    """Start an active session from a clocked-in shift (CARECLIQV2-116 comment 10051)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    try:
        shift = shift_service.start_shift_session(shift_id, worker_id, org_id, current_user)
    except ValueError as exc:
        message = str(exc)
        if "Participant" in message:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participant not found")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)
    if not shift:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")

    session_id = shift.get("session_id")
    await audit_service.log_action(
        action_type="worker.shift.session_started",
        entity_type="shift",
        entity_id=shift_id,
        user_id=worker_id,
        organization_id=org_id,
        after_state={"session_id": str(session_id)},
    )
    return shift


@router.post("/shifts/{shift_id}/clock-out")
async def worker_clock_out(shift_id: str, current_user: dict = Depends(get_current_user)):
    """Clock out without starting a session (CARECLIQV2-127)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    try:
        shift = shift_service.clock_out_without_session(shift_id, worker_id, org_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    if not shift:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    await audit_service.log_action(
        action_type="worker.shift.clocked_out",
        entity_type="shift",
        entity_id=shift_id,
        user_id=worker_id,
        organization_id=org_id,
    )
    return shift


async def _run_shift_documentation_compliance_check(
    shift: dict,
    current_user: dict,
    *,
    persist: bool,
) -> dict:
    """Run the real R1-R12 rules engine (compliance_engine.run_compliance_check)
    against a shift's documentation so far.

    Distinct from compute_shift_validation's compliance_score (task evidence -
    did the worker document each required task): this is the documentation-
    quality axis (is the note itself NDIS-compliant - length, language, goal
    references, incident/RP handling, etc). The engine expects one
    consolidated note; the current per-task mobile composer writes many small
    notes to shift_visit_notes instead, so those get aggregated first via
    shift_service.aggregate_shift_visit_notes_text - this is the bridge that
    lets the existing rules engine run for shift-based work at all, since
    nothing previously called it outside the legacy single-note session flow.

    When persist=True (end-of-shift), the result is saved into
    sessions.ai_insights.rules_result / compliance_checked_at - the exact
    field the worker's existing /compliance-detail dashboard already reads
    via _latest_rule_results, so no dashboard changes were needed, only real
    data reaching it.
    """
    session_id = shift.get("session_id")
    if not session_id:
        return {"available": False, "reason": "This shift hasn't started a session yet."}

    session = await session_service.get_session_by_id(str(session_id), current_user)
    if not session:
        return {"available": False, "reason": "Session not found."}

    notes_text = shift_service.aggregate_shift_visit_notes_text(str(shift.get("id") or ""))
    if not notes_text.strip():
        return {"available": False, "reason": "No documentation recorded yet for this shift."}

    participant_id = session.get("participant_id") or session.get("patient_id")
    participant = None
    if participant_id:
        participant = await participant_service.get_participant_by_id(participant_id, current_user)

    session_for_analysis = {
        **session,
        "notes": notes_text,
        "compliance_input_text": notes_text,
        "activities_performed": "",
        "outcomes": "",
        "participant_response": "",
        "progress_toward_goals": "",
    }

    existing_sessions: list[dict] = []
    if participant_id:
        existing_sessions = await session_service.get_sessions_by_participant(participant_id, current_user)
    custom_physical_types = await get_physical_exam_session_types()

    budget_context = None
    if participant_id:
        plan = await funding_service.get_plan_for_participant(participant_id)
        budget_context = funding_service.build_budget_alignment_context(session_for_analysis, plan)

    duration_context = shift_service.build_duration_consistency_context(session_for_analysis)

    try:
        rules_result = run_compliance_check(
            session_for_analysis,
            participant,
            existing_sessions,
            custom_physical_types,
            budget_context=budget_context,
            duration_context=duration_context,
        )
    except ComplianceBlockedError:
        return {"available": False, "reason": "Not enough documentation recorded yet to check."}

    enriched_rules = enrich_rule_results(rules_result.get("rules"))
    result = {
        "available": True,
        "score": rules_result.get("score"),
        "passed": rules_result.get("passed"),
        "warnings": rules_result.get("warnings"),
        "failed": rules_result.get("failed"),
        "total_rules": rules_result.get("total_rules"),
        "rules": enriched_rules,
        "failed_rules": [r for r in enriched_rules if r.get("status") in {"fail", "warning"}],
    }

    if persist:
        try:
            existing_ai = session.get("ai_insights") or {}
            if isinstance(existing_ai, str):
                existing_ai = json.loads(existing_ai) if existing_ai.strip() else {}
            if not isinstance(existing_ai, dict):
                existing_ai = {}
            existing_ai["rules_result"] = rules_result
            get_supabase_admin().table("sessions").update({
                "ai_insights": json.dumps(existing_ai),
                "compliance_checked_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", str(session_id)).execute()
        except Exception as exc:
            logger.warning(
                "Failed to persist shift documentation compliance check for session %s: %s",
                session_id, exc,
            )

    return result


@router.get("/shifts/{shift_id}/documentation-compliance-check")
async def worker_shift_documentation_compliance_check(
    shift_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Read-only, no-side-effect preview of the real 12-rule documentation
    check against a shift's notes so far - safe to poll periodically while a
    shift is in progress (unlike /sessions/{id}/save-with-ai, this makes no AI
    call and never mutates session status)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    shift = shift_service.get_shift_by_id(shift_id)
    if not shift or str(shift.get("worker_id") or "") != str(worker_id) or str(shift.get("organization_id") or "") != str(org_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    return await _run_shift_documentation_compliance_check(shift, current_user, persist=False)


@router.post("/shifts/{shift_id}/end-shift")
async def worker_end_shift(
    shift_id: str,
    background_tasks: BackgroundTasks,
    body: EndShiftBody = EndShiftBody(),
    current_user: dict = Depends(get_current_user),
):
    """End shift and complete linked session (CARECLIQV2-156)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    try:
        shift = shift_service.end_shift(shift_id, worker_id, org_id, force=body.force)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    if not shift:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    await audit_service.log_action(
        action_type="worker.shift.ended",
        entity_type="shift",
        entity_id=shift_id,
        user_id=worker_id,
        organization_id=org_id,
        after_state={"session_id": shift.get("session_id")},
    )

    async def _auto_summary_and_notify() -> None:
        from ..services import shift_pdf_export_service

        try:
            shift_pdf_export_service.run_auto_shift_summary_export(shift_id, worker_id, org_id)
            await shift_pdf_export_service.notify_shift_summary_ready(worker_id, shift_id)
        except Exception as exc:
            logger.warning("auto shift summary failed for %s: %s", shift_id, exc)

    async def _documentation_check() -> None:
        # Off the critical path deliberately: this does several DB round-trips
        # (note aggregation, goal/budget/duration context, the rules engine
        # itself) that used to sit in front of the end-shift response the
        # worker is waiting on - often on a weak connection right as they
        # leave a client's home. It's supplementary to the task-evidence
        # score end_shift() already computed synchronously above, so nothing
        # worker-facing depends on this finishing before the response returns.
        try:
            await _run_shift_documentation_compliance_check(shift, current_user, persist=True)
        except Exception as exc:
            logger.warning("Documentation compliance check failed for shift %s: %s", shift_id, exc)
            # Same marker as save_session_with_ai's unexpected-failure case
            # (backend/app/api/sessions.py) — without this, the linked
            # session looks identical to "compliance check never run".
            session_id = shift.get("session_id")
            if session_id:
                try:
                    get_supabase_admin().table("sessions").update({
                        "compliance_check_status": "failed",
                        "compliance_check_error": str(exc)[:500],
                    }).eq("id", str(session_id)).execute()
                except Exception as marker_err:
                    logger.warning(
                        "Could not persist compliance_check_status=failed marker for session %s: %s",
                        session_id, marker_err,
                    )

    background_tasks.add_task(_auto_summary_and_notify)
    background_tasks.add_task(_documentation_check)
    return shift


@router.post("/sessions/{session_id}/upload-evidence")
async def worker_upload_session_evidence(
    session_id: str,
    body: UploadEvidenceBody,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Upload task evidence media to object storage (CARECLIQV2-230)."""
    _require_worker(current_user)
    if body.session_id != session_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="session_id mismatch")

    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    ip_address = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")

    try:
        result = evidence_upload_service.upload_session_evidence_media(
            session_id=session_id,
            worker_id=worker_id,
            organization_id=org_id,
            evidence_items=[item.model_dump() for item in body.evidence],
            files=body.files,
            uploaded_by=worker_id,
            ip_address=ip_address,
            user_agent=user_agent,
        )
    except ValueError as exc:
        msg = str(exc)
        if "exceeds" in msg.lower() or "mb limit" in msg.lower():
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=msg) from exc
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg) from exc
    except Exception as exc:
        logger.exception("upload-evidence failed for session %s", session_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc) or "Evidence upload failed",
        ) from exc

    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    await audit_service.log_action(
        action_type="worker.session.evidence_uploaded",
        entity_type="session",
        entity_id=session_id,
        user_id=worker_id,
        organization_id=org_id,
        after_state={"uploaded_count": len(result.get("uploaded_evidence") or [])},
    )
    return result


@router.get("/sessions/{session_id}/notes")
async def worker_list_session_notes(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """List session progress notes (CARECLIQV2-231)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    notes = shift_service.list_session_notes(session_id, worker_id, org_id)
    if notes is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return notes


@router.post("/sessions/{session_id}/notes")
async def worker_sync_session_notes(
    session_id: str,
    body: SessionNotesSyncBody,
    current_user: dict = Depends(get_current_user),
):
    """Sync session/task-linked notes from the worker client (CARECLIQV2-231)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    items = [item.model_dump() for item in body.notes]
    for item in items:
        if item.get("session_id") and item["session_id"] != session_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="session_id mismatch")
    result = await shift_service.sync_session_notes(session_id, worker_id, org_id, items)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    await audit_service.log_action(
        action_type="worker.session.notes_synced",
        entity_type="session",
        entity_id=session_id,
        user_id=worker_id,
        organization_id=org_id,
        after_state={"synced_count": len(result.get("notes") or [])},
    )
    return result


@router.delete("/sessions/{session_id}/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def worker_delete_session_note(
    session_id: str,
    note_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Remove a session note (CARECLIQV2-231)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    deleted = shift_service.delete_session_note(session_id, note_id, worker_id, org_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    await audit_service.log_action(
        action_type="worker.session.note_deleted",
        entity_type="session",
        entity_id=session_id,
        user_id=worker_id,
        organization_id=org_id,
        after_state={"note_id": note_id},
    )
    return None


@router.patch("/sessions/{session_id}/notes/{note_id}")
async def worker_edit_session_note(
    session_id: str,
    note_id: str,
    body: SessionNoteEditBody,
    current_user: dict = Depends(get_current_user),
):
    """Edit a session note without overwriting it — the previous version is
    kept and marked superseded, never deleted."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    try:
        note = await shift_service.edit_shift_visit_note(note_id, worker_id, org_id, body.content)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    if str(note.get("session_id") or "") != str(session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    await audit_service.log_action(
        action_type="worker.session.note_edited",
        entity_type="session",
        entity_id=session_id,
        user_id=worker_id,
        organization_id=org_id,
        details={"note_id": note_id, "new_version_id": note.get("id")},
    )
    return shift_service._note_payload_from_row(note)


@router.get("/sessions/{session_id}/notes/{note_id}/versions")
async def worker_list_session_note_versions(
    session_id: str,
    note_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Full version history for one session note (original + every edit)."""
    _require_worker(current_user)
    org_id = get_user_organization_id(current_user)
    versions = shift_service.list_shift_visit_note_versions(note_id, org_id)
    if versions is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    return {
        "versions": [
            {**shift_service._note_payload_from_row(v), "is_current": v.get("is_current", False)}
            for v in versions
        ]
    }


@router.post("/sessions/{session_id}/transcribe")
async def worker_transcribe_session_audio(
    session_id: str,
    audio_file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Speech-to-text for worker voice notes. Returns transcript only — does not mutate session notes."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    session_notes = shift_service.list_session_notes(session_id, worker_id, org_id)
    if session_notes is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    filename = audio_file.filename or "voice-note.m4a"
    contents = await audio_file.read()
    if not contents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Audio file is empty")
    if len(contents) > 25 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Audio file too large. Maximum size is 25MB.",
        )

    try:
        text = await ai_service.transcribe_audio(contents, filename)
        transcript = (text or "").strip()
        if not transcript:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Could not transcribe audio. Please try again with clearer speech.",
            )
        return {"transcript": transcript}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Worker voice note transcription failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Transcription failed. Please try again.",
        )


@router.post("/sessions/{session_id}/evidence")
async def worker_sync_task_evidence(
    session_id: str,
    body: TaskEvidenceSyncBody,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Sync task-specific evidence captured during a shift session (CARECLIQV2-228)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    evidence = [item.model_dump() for item in body.evidence]
    result = shift_service.sync_session_task_evidence(
        session_id,
        worker_id,
        org_id,
        evidence,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    await audit_service.log_action(
        action_type="worker.session.evidence_synced",
        entity_type="session",
        entity_id=session_id,
        user_id=worker_id,
        organization_id=org_id,
        after_state={"synced_count": len(result.get("synced_ids") or [])},
    )
    return result


@router.get("/shifts/{shift_id}/notes")
async def worker_list_shift_notes(shift_id: str, current_user: dict = Depends(get_current_user)):
    """List visit/daily notes for a shift (CARECLIQV2-209)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    notes = shift_service.list_shift_visit_notes(shift_id, worker_id, org_id)
    if notes is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    return notes


@router.post("/shifts/{shift_id}/notes", status_code=status.HTTP_201_CREATED)
async def worker_create_shift_note(
    shift_id: str,
    body: ShiftVisitNoteCreate,
    current_user: dict = Depends(get_current_user),
):
    """Create a visit/daily note during a shift (CARECLIQV2-209)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    try:
        note = await shift_service.create_shift_visit_note(
            shift_id,
            worker_id,
            org_id,
            content=body.content,
            category=body.category,
            session_id=body.session_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    await audit_service.log_action(
        action_type="worker.shift.note_created",
        entity_type="shift",
        entity_id=shift_id,
        user_id=worker_id,
        organization_id=org_id,
        details={"category": body.category},
    )
    return note


@router.get("/shifts/{shift_id}/messages")
async def worker_list_shift_messages(shift_id: str, current_user: dict = Depends(get_current_user)):
    """List office messages for a shift (CARECLIQV2-213)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    messages = shift_service.list_shift_office_messages(shift_id, worker_id, org_id)
    if messages is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    return messages


@router.post("/shifts/{shift_id}/messages", status_code=status.HTTP_201_CREATED)
async def worker_create_shift_message(
    shift_id: str,
    body: ShiftOfficeMessageCreate,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    """Send a message to office during a shift (CARECLIQV2-213)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    try:
        row = shift_service.create_shift_office_message(
            shift_id,
            worker_id,
            org_id,
            message=body.message,
            priority=body.priority,
            attachment_data=body.attachment_data,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    background_tasks.add_task(
        notify_office_worker_message,
        org_id=org_id,
        shift_id=shift_id,
        worker_id=worker_id,
        message=body.message,
        priority=body.priority,
    )
    return row


@router.get("/shifts/{shift_id}/location")
async def worker_shift_location(shift_id: str, current_user: dict = Depends(get_current_user)):
    """Navigation and location details for a shift (CARECLIQV2-214)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    payload = shift_service.get_shift_location_details(shift_id, worker_id, org_id)
    if not payload:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    return payload


@router.get("/messages")
async def get_worker_messages(
    limit: int = Query(default=50, le=200),
    unread_only: bool = Query(default=False),
    current_user: dict = Depends(get_current_user),
):
    """Get coordinator messages for the support worker (CARECLIQV2-XXX)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    supabase = get_supabase_admin()
    
    try:
        # Get coordinator messages and credential reminders targeted at this worker
        query = (
            supabase.table("alerts")
            .select("id, alert_type, title, message, severity, is_read, created_at, patient_id, session_id, shift_id")
            .eq("organization_id", org_id)
            .eq("recipient_user_id", worker_id)
            .order("created_at", desc=True)
            .limit(limit)
        )
        if unread_only:
            query = query.eq("is_read", False)
        
        result = query.execute()
        return {
            "messages": result.data or [],
            "count": len(result.data or []),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch messages: {exc}")


@router.post("/messages/{message_id}/read")
async def mark_worker_message_read(
    message_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Mark a coordinator message as read."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    supabase = get_supabase_admin()
    
    try:
        # Verify this alert exists and is targeted at this worker
        msg = (
            supabase.table("alerts")
            .select("id")
            .eq("id", message_id)
            .eq("organization_id", org_id)
            .eq("recipient_user_id", worker_id)
            .maybe_single()
            .execute()
        )
        if not msg.data:
            raise HTTPException(status_code=404, detail="Message not found")
        
        # Mark as read
        supabase.table("alerts").update({"is_read": True}).eq("id", message_id).execute()
        return {"success": True, "message_id": message_id}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to mark message as read: {exc}")


@router.post("/messages/{message_id}/reply")
async def reply_to_message(
    message_id: str,
    body: MessageReplyCreate,
    current_user: dict = Depends(get_current_user),
):
    """
    Worker sends a reply to a coordinator message.
    
    Args:
        message_id: ID of the original message to reply to
        body: Request body with 'message' field containing the reply text
        current_user: Authenticated user details
    
    Returns:
        Success response with new reply message ID
    """
    _require_worker(current_user)
    
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    supabase = get_supabase_admin()
    
    reply_text = body.message.strip()
    if not reply_text:
        raise HTTPException(status_code=400, detail="Reply message cannot be empty")
    
    try:
        # Verify the original message exists and is targeted at this worker
        original_msg = (
            supabase.table("alerts")
            .select("id, recipient_user_id, patient_id, session_id")
            .eq("id", message_id)
            .eq("organization_id", org_id)
            .eq("recipient_user_id", worker_id)
            .maybe_single()
            .execute()
        )
        if not original_msg.data:
            raise HTTPException(status_code=404, detail="Original message not found")
        
        # Get coordinator who sent the original message
        # For now, we'll create the reply as a new alert for all coordinators in the org
        # In a real scenario, you'd track who sent the original message
        
        # Create reply alert
        reply_id = str(uuid4())
        reply_alert = {
            "id": reply_id,
            "organization_id": org_id,
            "alert_type": "worker_reply",
            "title": f"Reply from Worker",
            "message": reply_text,
            "severity": "medium",
            "is_read": False,
            "patient_id": original_msg.data.get("patient_id"),
            "session_id": original_msg.data.get("session_id"),
            "sender_user_id": worker_id,  # Track who replied
            "related_message_id": message_id,  # Link to original message
        }
        
        supabase.table("alerts").insert(reply_alert).execute()
        
        return {"success": True, "reply_id": reply_id}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to send reply: {exc}")


@router.post("/shifts/{shift_id}/sign")
async def worker_sign_shift(
    shift_id: str,
    body: ShiftSignatureBody,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Submit digital signature before ending shift (CARECLIQV2-270)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    device_id = request.headers.get("x-device-id")
    ip_address = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    try:
        result = shift_signature_service.submit_shift_signature(
            shift_id,
            worker_id,
            org_id,
            confirm_tasks_accurate=body.confirm_tasks_accurate,
            confirm_safety_followed=body.confirm_safety_followed,
            confirm_no_unreported_incidents=body.confirm_no_unreported_incidents,
            signature_svg=body.signature_svg,
            signature_png_data_url=body.signature_png_data_url,
            device_id=device_id,
            ip_address=ip_address,
            user_agent=user_agent,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await audit_service.log_action(
        action_type="worker.shift.signed",
        entity_type="shift",
        entity_id=shift_id,
        user_id=worker_id,
        organization_id=org_id,
    )
    return result


@router.get("/sessions/{session_id}/evidence-metadata")
async def worker_list_evidence_metadata(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Chain-of-custody metadata for session evidence (CARECLIQV2-271)."""
    _require_worker(current_user)
    org_id = get_user_organization_id(current_user)
    worker_id = get_user_id(current_user)
    try:
        resp = (
            get_supabase_admin()
            .table("sessions")
            .select("id, worker_id, support_worker_id, owner_user_id, created_by, organization_id")
            .eq("id", session_id)
            .maybe_single()
            .execute()
        )
        session = resp.data if resp else None
    except Exception:
        session = None
    if not session or str(session.get("organization_id")) != str(org_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    owner_ids = {
        str(session.get("worker_id") or ""),
        str(session.get("support_worker_id") or ""),
        str(session.get("owner_user_id") or ""),
        str(session.get("created_by") or ""),
    }
    if worker_id not in owner_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    items = list_session_evidence_metadata(session_id, org_id)
    return {"evidence": [i for i in items if str(i.get("uploaded_by")) == str(worker_id)]}


@router.get("/evidence/{evidence_id}/download")
async def worker_download_evidence(
    evidence_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Download evidence with integrity verification (CARECLIQV2-271)."""
    _require_worker(current_user)
    user_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    meta = get_evidence_metadata(evidence_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Evidence not found")
    if str(meta.get("uploaded_by")) != str(user_id):
        raise HTTPException(status_code=403, detail="You can only download your own evidence uploads")
    file_bytes, metadata = await verify_and_download_evidence(
        evidence_id, request, user_id, org_id
    )
    from fastapi.responses import Response

    mime = metadata.get("mime_type") or "application/octet-stream"
    return Response(content=file_bytes, media_type=mime)


# ── Check 16 — Long shift engagement ─────────────────────────────────────────


class LongShiftCheckinBody(BaseModel):
    status: str
    note: Optional[str] = Field(default=None, max_length=500)
    prompt_triggered_at: Optional[str] = None
    gap_at_prompt_secs: Optional[int] = None


@router.post("/sessions/{session_id}/checkins", status_code=status.HTTP_201_CREATED)
async def worker_submit_checkin(
    session_id: str,
    body: LongShiftCheckinBody,
    current_user: dict = Depends(get_current_user),
):
    """Submit a long-shift engagement check-in (Check 16 T2)."""
    _require_worker(current_user)
    from ..services import long_shift_service

    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    try:
        result = long_shift_service.submit_checkin(
            session_id,
            worker_id,
            org_id,
            status=body.status,
            note=body.note,
            prompt_triggered_at=body.prompt_triggered_at,
            gap_at_prompt_secs=body.gap_at_prompt_secs,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return result


class MissedCheckinReasonBody(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


@router.post("/sessions/{session_id}/checkins/{scheduled_checkin_id}/missed-reason")
async def worker_submit_missed_checkin_reason(
    session_id: str,
    scheduled_checkin_id: str,
    body: MissedCheckinReasonBody,
    current_user: dict = Depends(get_current_user),
):
    """Explain why a random compliance check-in was missed (required before shift submission)."""
    _require_worker(current_user)
    from ..services import random_checkin_service

    worker_id = get_user_id(current_user)
    try:
        ok = random_checkin_service.submit_missed_checkin_reason(
            scheduled_checkin_id=scheduled_checkin_id,
            worker_id=worker_id,
            reason=body.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Check-in not found")
    return {"ok": True}


@router.get("/sessions/{session_id}/checkins/status")
async def worker_session_checkin_status(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Check-in eligibility, cooldown, and next due window for a session."""
    _require_worker(current_user)
    from ..services import long_shift_service

    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    result = long_shift_service.get_checkin_status(session_id, worker_id, org_id)
    if result is None:
        session = shift_service._get_worker_session_or_none(session_id, worker_id, org_id)
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        return {
            "applicable": False,
            "can_submit_checkin": False,
            "block_reason": None,
            "cooldown_remaining_secs": 0,
            "next_checkin_due_secs": 0,
            "checkin_overdue": False,
            "checkins_completed": 0,
            "checkins_required": 0,
        }
    return result


@router.get("/shifts/{shift_id}/checkins/status")
async def worker_shift_checkin_status(
    shift_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Check-in status for the worker's shift (uses linked session)."""
    _require_worker(current_user)
    from ..services import long_shift_service

    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    shift = shift_service._get_worker_shift_or_none(shift_id, worker_id, org_id)
    if not shift:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    session_id = shift.get("session_id")
    if not session_id:
        return {
            "applicable": False,
            "can_submit_checkin": False,
            "block_reason": None,
            "cooldown_remaining_secs": 0,
            "next_checkin_due_secs": 0,
            "checkin_overdue": False,
            "checkins_completed": 0,
            "checkins_required": 0,
        }
    result = long_shift_service.get_checkin_status(str(session_id), worker_id, org_id)
    if result is None:
        return {
            "applicable": False,
            "can_submit_checkin": False,
            "block_reason": None,
            "cooldown_remaining_secs": 0,
            "next_checkin_due_secs": 0,
            "checkin_overdue": False,
            "checkins_completed": 0,
            "checkins_required": 0,
        }
    return result


@router.post("/sessions/{session_id}/breaks/start", status_code=status.HTTP_201_CREATED)
async def worker_start_break(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Start a billable-paused break timer on an active long shift."""
    _require_worker(current_user)
    from ..services import long_shift_service

    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    try:
        result = long_shift_service.start_break(session_id, worker_id, org_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return result


@router.post("/sessions/{session_id}/breaks/end")
async def worker_end_break(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """End the active break and update billable duration."""
    _require_worker(current_user)
    from ..services import long_shift_service

    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    try:
        result = long_shift_service.end_break(session_id, worker_id, org_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return result


@router.get("/shifts/{shift_id}/breaks/status")
async def worker_shift_break_status(
    shift_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Break status for the worker's shift (uses linked session). Fallback when session route unavailable."""
    _require_worker(current_user)
    from ..services import long_shift_service

    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    shift = shift_service._get_worker_shift_or_none(shift_id, worker_id, org_id)
    if not shift:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    session_id = shift.get("session_id")
    if not session_id:
        return {
            "active": False,
            "completed_breaks": 0,
            "total_break_secs": 0,
            "max_breaks_per_shift": long_shift_service.MAX_BREAKS_PER_SESSION,
            "can_start_break": True,
            "block_reason": None,
        }
    result = long_shift_service.get_break_status(str(session_id), worker_id, org_id)
    if result is None:
        return {
            "active": False,
            "completed_breaks": 0,
            "total_break_secs": 0,
            "max_breaks_per_shift": long_shift_service.MAX_BREAKS_PER_SESSION,
            "can_start_break": True,
            "block_reason": None,
        }
    return result


@router.get("/sessions/{session_id}/breaks/active")
async def worker_get_active_break(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Return active break status and elapsed time for the worker's session."""
    _require_worker(current_user)
    from ..services import long_shift_service

    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    result = long_shift_service.get_break_status(session_id, worker_id, org_id)
    if result is None:
        session = shift_service._get_worker_session_or_none(session_id, worker_id, org_id)
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        return {
            "active": False,
            "completed_breaks": 0,
            "total_break_secs": 0,
            "max_breaks_per_shift": long_shift_service.MAX_BREAKS_PER_SESSION,
            "can_start_break": True,
            "block_reason": None,
        }
    return result


@router.get("/sessions/{session_id}/timeline")
async def worker_session_timeline(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Activity timeline for a shift session (Check 16 audit view)."""
    _require_worker(current_user)
    from ..services import long_shift_service

    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    session = shift_service._get_worker_session_or_none(session_id, worker_id, org_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    events = long_shift_service.get_session_timeline(session_id)
    return {"session_id": session_id, "events": events}


@router.post("/sessions/{session_id}/engagement/offline")
async def worker_session_offline(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Pause gap timer when worker device goes offline (Check 16 Q2)."""
    _require_worker(current_user)
    from ..services import long_shift_service

    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    result = long_shift_service.mark_session_offline(session_id, worker_id, org_id)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return result


@router.post("/sessions/{session_id}/engagement/heartbeat")
async def worker_session_heartbeat(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Resume gap timer on reconnect and return neutral activity summary."""
    _require_worker(current_user)
    from ..services import long_shift_service

    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    result = long_shift_service.mark_session_online(session_id, worker_id, org_id)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return result


@router.get("/sessions/{session_id}/engagement/summary")
async def worker_session_activity_summary(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Neutral worker activity summary — no engagement score (Q5)."""
    _require_worker(current_user)
    from ..services import long_shift_service

    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    result = long_shift_service.get_worker_activity_summary(session_id, worker_id, org_id)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return result
