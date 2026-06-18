from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from ..core.access import get_user_id, get_user_organization_id, is_support_worker
from ..core.security import get_current_user
from ..schemas.session import GoalProgressNote, SessionCreate
from ..services import audit_service, evidence_upload_service, funding_service, goals_service, participant_service, session_service, shift_service
from ..services.compliance_rules_catalog import enrich_rule_results, get_rules_catalog
from ..services.supabase_client import get_supabase_admin


router = APIRouter(prefix="/worker", tags=["worker"])


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


class WorkerNoteCreate(BaseModel):
    notes: str = Field(min_length=1)
    session_date: date = Field(default_factory=date.today)
    session_type: str = "progress_note"
    duration_minutes: int = Field(default=1, ge=1)
    goals_addressed: list[str] = Field(default_factory=list)


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


class ShiftTasksUpdate(BaseModel):
    tasks: list[ShiftTaskItem]


class CustomTaskCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)


class EndShiftBody(BaseModel):
    force: bool = False


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


def _compliance_trend(sessions: list[dict], days: int) -> list[dict]:
    """Daily average compliance scores for the last N days (inclusive of today)."""
    days = max(1, min(days, 90))
    start = date.today() - timedelta(days=days - 1)
    day_scores: dict[str, list[float]] = defaultdict(list)
    day_counts: dict[str, int] = defaultdict(int)

    for session in sessions:
        session_day = _date_part(session.get("session_date"))
        if not session_day:
            continue
        try:
            if date.fromisoformat(session_day) < start:
                continue
        except ValueError:
            continue
        day_counts[session_day] += 1
        if session.get("compliance_score") is not None:
            day_scores[session_day].append(float(session["compliance_score"]))

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


def _latest_rule_results(sessions: list[dict]) -> tuple[list[dict], str | None]:
    """Return rules from the most recently checked scored session."""
    scored = [
        s for s in sessions
        if s.get("compliance_score") is not None
    ]
    if not scored:
        return [], None

    def _sort_key(session: dict) -> str:
        return str(
            session.get("compliance_checked_at")
            or session.get("updated_at")
            or session.get("session_date")
            or ""
        )

    latest = sorted(scored, key=_sort_key, reverse=True)[0]
    insights = _safe_json(latest.get("ai_insights"))
    rules_result = insights.get("rules_result") if isinstance(insights, dict) else {}
    rules = rules_result.get("rules") if isinstance(rules_result, dict) else []
    return rules if isinstance(rules, list) else [], str(latest.get("id"))


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
            or participant.get("plan_management")
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
    return {
        "id": session.get("id"),
        "participant_id": session.get("participant_id") or session.get("patient_id"),
        "session_date": session.get("session_date"),
        "session_type": session.get("session_type"),
        "duration_minutes": session.get("duration_minutes"),
        "status": session.get("status"),
        "notes": note_text,
        "legal_record_text": session.get("legal_record_text") or note_text,
        "compliance_score": session.get("compliance_score"),
        "compliance_status": _score_status(session.get("compliance_score")),
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
    participants = await participant_service.get_all_participants(current_user)
    rows: list[dict] = []
    for participant in participants:
        participant_id = str(participant.get("id"))
        sessions = await _worker_sessions_for_participant(participant_id, current_user)
        rows.append(_client_row(participant, sessions))
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
async def my_compliance(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    sessions = await session_service.get_all_sessions(500, current_user)
    scored = [s for s in sessions if s.get("compliance_score") is not None]
    scores = [float(s["compliance_score"]) for s in scored]
    average = round(sum(scores) / len(scores), 1) if scores else 0
    return {
        "average_score": average,
        "status": _score_status(average),
        "total_sessions": len(sessions),
        "reviewed_sessions": len(scored),
        "at_risk": sum(1 for score in scores if score < 85),
        "sessions": [_session_payload(session) for session in sessions],
    }


@router.get("/compliance-detail")
async def worker_compliance_detail(
    days: int = Query(default=7, ge=7, le=30),
    current_user: dict = Depends(get_current_user),
):
    """Real-time compliance score, 12-rule breakdown, red flags, and daily trend."""
    _require_worker(current_user)
    sessions = await session_service.get_all_sessions(500, current_user)
    scored = [s for s in sessions if s.get("compliance_score") is not None]
    scores = [float(s["compliance_score"]) for s in scored]
    average = round(sum(scores) / len(scores), 1) if scores else 0

    raw_rules, _ = _latest_rule_results(sessions)
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


@router.post("/my-clients/{participant_id}/notes", status_code=status.HTTP_201_CREATED)
async def create_my_client_note(
    participant_id: str,
    body: WorkerNoteCreate,
    current_user: dict = Depends(get_current_user),
):
    await _assigned_participant(participant_id, current_user)
    _require_worker_ready_for_sessions(current_user)
    payload = SessionCreate(
        participant_id=participant_id,
        session_date=body.session_date,
        duration_minutes=body.duration_minutes,
        session_type=body.session_type,
        notes=body.notes,
        goals_addressed=body.goals_addressed,
        status="completed",
    )
    try:
        session = await session_service.create_session(payload, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participant not found")
    await audit_service.log_action(
        action_type="worker.note.created",
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
    current_user: dict = Depends(get_current_user),
):
    """List shifts for the authenticated support worker (CARECLIQV2-116)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    shifts = shift_service.list_shifts_for_worker(worker_id, org_id, filter)
    return {"shifts": shifts, "filter": filter}


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
    shift = shift_service.get_shift_detail_for_worker(shift_id, worker_id, org_id)
    if not shift:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    return shift


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
async def worker_clock_in(shift_id: str, current_user: dict = Depends(get_current_user)):
    """Clock in to a shift and initialise the task checklist (CARECLIQV2-116 / CARECLIQV2-134)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    try:
        shift = shift_service.clock_in_shift(shift_id, worker_id, org_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    if not shift:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
    await audit_service.log_action(
        action_type="worker.shift.clocked_in",
        entity_type="shift",
        entity_id=shift_id,
        user_id=worker_id,
        organization_id=org_id,
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
    shift = shift_service.update_shift_tasks(shift_id, worker_id, org_id, tasks)
    if not shift:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
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


@router.post("/shifts/{shift_id}/acknowledge-risks")
async def worker_acknowledge_risks(shift_id: str, current_user: dict = Depends(get_current_user)):
    """Log risk acknowledgement before shift start (CARECLIQV2-158)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    shift = shift_service.acknowledge_shift_risks(shift_id, worker_id, org_id)
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


@router.post("/shifts/{shift_id}/end-shift")
async def worker_end_shift(
    shift_id: str,
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
    return shift


@router.post("/sessions/{session_id}/upload-evidence")
async def worker_upload_session_evidence(
    session_id: str,
    body: UploadEvidenceBody,
    current_user: dict = Depends(get_current_user),
):
    """Upload task evidence media to object storage (CARECLIQV2-230)."""
    _require_worker(current_user)
    if body.session_id != session_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="session_id mismatch")

    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)

    try:
        result = evidence_upload_service.upload_session_evidence_media(
            session_id=session_id,
            worker_id=worker_id,
            organization_id=org_id,
            evidence_items=[item.model_dump() for item in body.evidence],
            files=body.files,
        )
    except ValueError as exc:
        msg = str(exc)
        if "exceeds" in msg.lower() or "mb limit" in msg.lower():
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=msg) from exc
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg) from exc

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


@router.post("/sessions/{session_id}/evidence")
async def worker_sync_task_evidence(
    session_id: str,
    body: TaskEvidenceSyncBody,
    current_user: dict = Depends(get_current_user),
):
    """Sync task-specific evidence captured during a shift session (CARECLIQV2-228)."""
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    evidence = [item.model_dump() for item in body.evidence]
    result = shift_service.sync_session_task_evidence(session_id, worker_id, org_id, evidence)
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
