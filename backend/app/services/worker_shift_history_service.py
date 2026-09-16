"""Worker shift history — CARECLIQV2-285."""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any, Optional

from ..core.timezone import participant_timezone, shift_local_date
from .shift_service import get_shift_by_id
from .shift_validation_service import (
    build_compliance_explanation,
    compliance_score_band,
    compute_shift_validation,
)
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

HISTORY_LIMIT = 60
TREND_SHIFT_LIMIT = 30


def _is_browsable_media_url(value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    lowered = value.strip().lower()
    return lowered.startswith(("http://", "https://", "data:", "blob:"))


def _photo_evidence_item(task: dict[str, Any]) -> dict[str, Any] | None:
    thumbs = task.get("photo_thumbnails") or []
    photo_ref = task.get("photo_evidence")
    has_photo = bool(photo_ref or thumbs or task.get("has_photo"))
    if not has_photo:
        return None

    browsable_thumb = next((t for t in thumbs if _is_browsable_media_url(t)), None)
    browsable_photo = photo_ref if _is_browsable_media_url(photo_ref) else None
    thumbnail_url = browsable_thumb or (thumbs[0] if thumbs else None) or browsable_photo

    evidence_id: str | None = None
    if photo_ref and not _is_browsable_media_url(photo_ref):
        evidence_id = str(photo_ref)
    elif not thumbnail_url:
        evidence_ids = task.get("evidence_ids") or []
        if evidence_ids:
            evidence_id = str(evidence_ids[0])

    if not thumbnail_url and not evidence_id:
        return None

    return {
        "task_id": task.get("task_id"),
        "label": task.get("label"),
        "type": "photo",
        "url": browsable_photo or thumbnail_url,
        "thumbnail_url": thumbnail_url,
        "evidence_id": evidence_id,
    }


def _is_missing_schema(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg or "pgrst" in msg


def _participant_first_name(participant_name: str | None) -> str:
    return (participant_name or "Participant").split()[0]


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _shift_duration_minutes(shift: dict[str, Any]) -> int | None:
    if shift.get("duration_minutes"):
        return int(shift["duration_minutes"])
    start = shift.get("scheduled_start")
    end = shift.get("scheduled_end")
    if not start or not end:
        return None
    try:
        dt_start = datetime.fromisoformat(str(start).replace("Z", "+00:00"))
        dt_end = datetime.fromisoformat(str(end).replace("Z", "+00:00"))
        return max(0, int((dt_end - dt_start).total_seconds() // 60))
    except ValueError:
        return None


def _get_session_validation(shift: dict[str, Any]) -> dict[str, Any]:
    session_id = shift.get("session_id")
    if session_id:
        try:
            resp = (
                get_supabase_admin()
                .table("sessions")
                .select("id, end_validation, notes, compliance_input_text")
                .eq("id", str(session_id))
                .limit(1)
                .execute()
            )
            row = (resp.data or [None])[0]
            if row and row.get("end_validation"):
                validation = dict(row["end_validation"])
                if "compliance_score" in validation:
                    return validation
        except Exception as exc:
            if not _is_missing_schema(exc):
                logger.debug("session end_validation lookup failed: %s", exc)
    tasks = shift.get("tasks") or []
    return compute_shift_validation(tasks)


def _feedback_summary_for_shift(shift_id: str) -> dict[str, Any]:
    try:
        resp = (
            get_supabase_admin()
            .table("shift_feedback")
            .select("id, acknowledged_at, submitted_at")
            .eq("shift_id", shift_id)
            .order("submitted_at", desc=True)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return {"count": 0, "has_unread": False}
        raise
    unread = sum(1 for r in rows if not r.get("acknowledged_at"))
    return {"count": len(rows), "has_unread": unread > 0, "unread_count": unread}


def _worker_display_name(worker_id: str | None) -> str | None:
    if not worker_id:
        return None
    try:
        resp = (
            get_supabase_admin()
            .table("users")
            .select("full_name, first_name, email")
            .eq("id", str(worker_id))
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
        if not row:
            return None
        return (
            row.get("full_name")
            or row.get("first_name")
            or (str(row.get("email") or "").split("@")[0])
        )
    except Exception:
        return None


def _task_evidence_items(task: dict[str, Any]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    photo_item = _photo_evidence_item(task)
    if photo_item:
        items.append({**photo_item, "type": "photo"})
    if task.get("voice_evidence") or task.get("has_voice"):
        items.append({
            "task_id": task.get("task_id"),
            "label": task.get("label"),
            "type": "voice",
        })
    note_text = str(task.get("note") or task.get("context_note") or "").strip()
    if len(note_text) >= 20:
        items.append({
            "task_id": task.get("task_id"),
            "label": task.get("label"),
            "type": "written note",
        })
    return items


def _history_row(shift: dict[str, Any]) -> dict[str, Any]:
    validation = _get_session_validation(shift)
    score = validation.get("compliance_score")
    feedback = _feedback_summary_for_shift(str(shift.get("id") or ""))
    # Calendar day in the participant's branch zone (a UTC timestamp sliced
    # to a date filed early-morning shifts under the previous day).
    tz = participant_timezone(shift, organization_id=shift.get("organization_id"))
    shift_when = shift.get("scheduled_start") or shift.get("clocked_out_at") or shift.get("updated_at")
    shift_day = shift_local_date(shift_when, tz)
    shift_date = shift_day.isoformat() if shift_day else shift_when
    worker_id = shift.get("worker_id")
    created_by = shift.get("created_by")
    coordinator_email = None
    if created_by:
        try:
            resp = (
                get_supabase_admin()
                .table("users")
                .select("email")
                .eq("id", str(created_by))
                .limit(1)
                .execute()
            )
            row = (resp.data or [None])[0]
            if row:
                coordinator_email = str(row.get("email") or "").strip() or None
        except Exception:
            pass
    return {
        "id": shift.get("id"),
        "shift_date": shift_date,
        "timezone": str(tz),
        "scheduled_start": shift.get("scheduled_start"),
        "scheduled_end": shift.get("scheduled_end"),
        "clocked_in_at": shift.get("clocked_in_at"),
        "clocked_out_at": shift.get("clocked_out_at"),
        "participant_id": shift.get("participant_id"),
        "participant_name": shift.get("participant_name"),
        "participant_first_name": _participant_first_name(shift.get("participant_name")),
        "worker_id": worker_id,
        "worker_name": _worker_display_name(str(worker_id) if worker_id else None),
        "coordinator_id": created_by,
        "coordinator_email": coordinator_email,
        "duration_minutes": _shift_duration_minutes(shift),
        "compliance_score": score,
        "compliance_band": compliance_score_band(score),
        "compliance_explanation": build_compliance_explanation(validation),
        "has_feedback": feedback["count"] > 0,
        "has_unread_feedback": feedback.get("has_unread", False),
        "feedback_count": feedback["count"],
        "status": shift.get("status"),
    }


def list_completed_shifts(
    worker_id: str,
    organization_id: str,
    *,
    participant_ids: list[str] | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    compliance_band: str | None = None,
) -> dict[str, Any]:
    try:
        resp = (
            get_supabase_admin()
            .table("shifts")
            .select(
                "id, participant_id, participant_name, scheduled_start, scheduled_end, "
                "duration_minutes, status, session_id, tasks, clocked_in_at, clocked_out_at, "
                "updated_at, worker_id"
            )
            .eq("worker_id", worker_id)
            .eq("organization_id", organization_id)
            .eq("status", "completed")
            .order("scheduled_start", desc=True)
            .limit(200)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return {"shifts": [], "participants": []}
        raise

    filtered: list[dict[str, Any]] = []
    participant_map: dict[str, str] = {}

    for shift in rows:
        pid = str(shift.get("participant_id") or "")
        pname = shift.get("participant_name") or "Participant"
        if pid:
            participant_map[pid] = _participant_first_name(pname)

        if participant_ids and pid not in participant_ids:
            continue

        shift_day = shift_local_date(shift.get("scheduled_start"), participant_timezone(shift))
        if date_from and shift_day and shift_day < date_from:
            continue
        if date_to and shift_day and shift_day > date_to:
            continue

        row = _history_row(shift)
        if compliance_band and compliance_band != "all":
            if row["compliance_band"] != compliance_band:
                continue
        filtered.append(row)

    filtered = filtered[:HISTORY_LIMIT]
    participants = [
        {"id": pid, "first_name": name}
        for pid, name in sorted(participant_map.items(), key=lambda x: x[1].lower())
    ]
    return {"shifts": filtered, "participants": participants}


_EVENT_LABELS = {
    "worker.shift.clocked_in": "Clocked in",
    "worker.shift.checked_in_verified": "Clocked in (verified)",
    "worker.shift.ended": "Clocked out / shift ended",
    "worker.shift.tasks_updated": "Task checklist updated",
    "worker.shift.note_created": "Visit note added",
    "worker.session.evidence_uploaded": "Evidence uploaded",
    "worker.session.evidence_synced": "Evidence synced",
    "worker.session.notes_synced": "Notes synced",
    "worker.shift.session_started": "Session started",
    "worker.shift.signed": "Shift signed off",
    "worker.safety_protocol.acknowledged": "Safety card acknowledged",
    "worker.briefing.alert_acknowledged": "Pre-shift alert acknowledged",
    "worker.briefing.acknowledged": "Pre-shift briefing acknowledged",
    "worker.shift.risks_acknowledged": "Risks acknowledged",
    "coordinator.shift.assigned": "Assigned by coordinator",
    "coordinator.shift.unassigned": "Unassigned by coordinator",
}


def get_shift_event_timeline(
    shift_id: str,
    worker_id: str,
    organization_id: str,
) -> list[dict[str, Any]] | None:
    """Chronological audit_logs entries for a shift's whole lifecycle
    (clock-in through clock-out), including its linked session's events -
    reuses audit_logs as the source of truth rather than a parallel event
    table, since clock-in/out, acknowledgements, task updates, notes, and
    evidence uploads already write there (see the action_type keys in
    _EVENT_LABELS for exactly what's covered)."""
    shift = get_shift_by_id(shift_id)
    if not shift:
        return None
    if str(shift.get("worker_id") or "") != str(worker_id):
        return None
    if str(shift.get("organization_id") or "") != str(organization_id):
        return None

    session_id = shift.get("session_id")
    supabase = get_supabase_admin()
    try:
        query = supabase.table("audit_logs").select(
            "action_type, entity_type, entity_id, user_id, details, created_at"
        )
        if session_id:
            query = query.or_(f"and(entity_type.eq.shift,entity_id.eq.{shift_id}),and(entity_type.eq.session,entity_id.eq.{session_id})")
        else:
            query = query.eq("entity_type", "shift").eq("entity_id", shift_id)
        resp = query.order("created_at").execute()
        rows = resp.data or []
    except Exception:
        return []

    actor_ids = {str(r["user_id"]) for r in rows if r.get("user_id")}
    names_by_id: dict[str, str] = {}
    if actor_ids:
        try:
            profiles = supabase.table("users").select("id, full_name").in_("id", list(actor_ids)).execute()
            names_by_id = {str(p["id"]): p.get("full_name") or "Team member" for p in (profiles.data or [])}
        except Exception:
            pass

    timeline = []
    for row in rows:
        action_type = row.get("action_type") or ""
        timeline.append({
            "action_type": action_type,
            "label": _EVENT_LABELS.get(action_type, action_type.replace(".", " ").replace("_", " ")),
            "actor_name": names_by_id.get(str(row.get("user_id") or "")),
            "details": row.get("details") or {},
            "created_at": row.get("created_at"),
        })
    return timeline


def get_shift_history_detail(
    shift_id: str,
    worker_id: str,
    organization_id: str,
) -> dict[str, Any] | None:
    shift = get_shift_by_id(shift_id)
    if not shift:
        return None
    if str(shift.get("worker_id") or "") != str(worker_id):
        return None
    if str(shift.get("organization_id") or "") != str(organization_id):
        return None
    if shift.get("status") != "completed":
        return None

    validation = _get_session_validation(shift)
    score = validation.get("compliance_score")
    # Deliberately the raw shifts.tasks JSONB, NOT _resolve_shift_checklist_
    # tasks()/the normalized shift_tasks table: shift_tasks only ever stores
    # completed/note/marked_na (see _sync_shift_tasks_progress in
    # shift_service.py) - has_photo/has_voice/photo_evidence/voice_evidence
    # are never written there, only into this JSONB column. Using the
    # "preferred" normalized source here would silently strip photo/voice
    # evidence from the compliance picture. This also matches what
    # end_shift() itself reads when it computes and caches the validation
    # this function falls back to, so the two stay consistent.
    tasks = shift.get("tasks") or []

    notes = ""
    session_id = shift.get("session_id")
    if session_id:
        try:
            resp = (
                get_supabase_admin()
                .table("sessions")
                .select("notes, compliance_input_text")
                .eq("id", str(session_id))
                .limit(1)
                .execute()
            )
            sess = (resp.data or [None])[0] or {}
            notes = (sess.get("compliance_input_text") or sess.get("notes") or "").strip()
        except Exception:
            pass

    # The current per-task composer (mobile) writes documentation exclusively
    # to shift_visit_notes - sessions.notes/compliance_input_text is a legacy
    # single free-text field from before that redesign and is never populated
    # by it. Without this, a shift fully documented task-by-task showed up
    # here (and in the auto-generated AI PDF summary, which reads this same
    # "notes" field) as if nothing was written at all. Timestamps are kept
    # inline so this also serves as a readable audit trail of when each note
    # was actually captured, not just what it said.
    session_notes: list[dict[str, Any]] = []
    try:
        vn_resp = (
            get_supabase_admin()
            .table("shift_visit_notes")
            .select("id, content, task_id, category, created_at, worker_id")
            .eq("shift_id", shift_id)
            .order("created_at")
            .execute()
        )
        task_label_by_id = {
            str(t.get("task_id")): t.get("label") for t in tasks if t.get("task_id")
        }
        visit_note_lines: list[str] = []
        for row in vn_resp.data or []:
            content = (row.get("content") or "").strip()
            if not content:
                continue
            task_id = str(row.get("task_id") or "")
            label = task_label_by_id.get(task_id)
            created_at = row.get("created_at") or ""
            timestamp = str(created_at)[:16].replace("T", " ")
            prefix = f"[{timestamp}] {label}: " if label else f"[{timestamp}] "
            visit_note_lines.append(f"{prefix}{content}")
            session_notes.append({
                "id": row.get("id"),
                "task_id": task_id or None,
                "task_label": label,
                "content": content,
                "category": row.get("category"),
                "created_at": created_at,
            })
        if visit_note_lines:
            notes = "\n\n".join(part for part in (notes, "\n\n".join(visit_note_lines)) if part)
    except Exception as exc:
        if not _is_missing_schema(exc):
            logger.debug("shift_visit_notes lookup failed for history detail: %s", exc)

    evidence_items: list[dict[str, Any]] = []
    for task in tasks:
        for item in _task_evidence_items(task):
            if not any(
                e.get("task_id") == item.get("task_id") and e.get("type") == item.get("type")
                for e in evidence_items
            ):
                evidence_items.append(item)

    feedback_items: list[dict[str, Any]] = []
    try:
        fb_resp = (
            get_supabase_admin()
            .table("shift_feedback")
            .select(
                "id, strengths, areas_to_improve, action_items, submitted_at, "
                "acknowledged_at, coordinator_id"
            )
            .eq("shift_id", shift_id)
            .order("submitted_at", desc=False)
            .execute()
        )
        for fb in fb_resp.data or []:
            coord_name = _coordinator_display_name(str(fb.get("coordinator_id") or ""))
            feedback_items.append({
                **fb,
                "coordinator_name": coord_name,
            })
    except Exception as exc:
        if not _is_missing_schema(exc):
            logger.debug("feedback load failed: %s", exc)

    signature = None
    try:
        from .shift_signature_service import get_shift_signature

        signature = get_shift_signature(shift_id)
    except Exception:
        pass

    return {
        **_history_row(shift),
        "tasks": tasks,
        "validation": validation,
        "flagged_tasks": validation.get("flagged_tasks") or [],
        "notes": notes,
        "session_notes": session_notes,
        "evidence": evidence_items,
        "feedback": feedback_items,
        "shift_signature": signature,
        "session_id": session_id,
    }


def _coordinator_display_name(user_id: str) -> str:
    if not user_id:
        return "Coordinator"
    try:
        resp = (
            get_supabase_admin()
            .table("users")
            .select("full_name, first_name, email")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
        if not row:
            return "Coordinator"
        return (
            row.get("full_name")
            or row.get("first_name")
            or (str(row.get("email") or "").split("@")[0])
            or "Coordinator"
        )
    except Exception:
        return "Coordinator"


def get_compliance_trend(
    worker_id: str,
    organization_id: str,
    *,
    limit: int = TREND_SHIFT_LIMIT,
) -> list[dict[str, Any]]:
    result = list_completed_shifts(worker_id, organization_id)
    shifts = result.get("shifts") or []
    trend = []
    for row in reversed(shifts[:limit]):
        trend.append({
            "shift_id": row.get("id"),
            "date": str(row.get("shift_date") or "")[:10],
            "score": row.get("compliance_score"),
            "compliance_band": row.get("compliance_band"),
        })
    return trend


def list_shift_exports(worker_id: str) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc).isoformat()
    try:
        resp = (
            get_supabase_admin()
            .table("shift_export_requests")
            .select(
                "id, shift_id, status, file_url, expires_at, created_at, auto_generated"
            )
            .eq("requested_by", worker_id)
            .eq("status", "ready")
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise
    visible: list[dict[str, Any]] = []
    for row in rows:
        if row.get("auto_generated"):
            visible.append(row)
            continue
        expires = row.get("expires_at")
        if expires and str(expires) >= now:
            visible.append(row)
    return visible
