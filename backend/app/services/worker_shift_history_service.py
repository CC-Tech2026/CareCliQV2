"""Worker shift history — CARECLIQV2-285."""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any, Optional

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


def _history_row(shift: dict[str, Any]) -> dict[str, Any]:
    validation = _get_session_validation(shift)
    score = validation.get("compliance_score")
    feedback = _feedback_summary_for_shift(str(shift.get("id") or ""))
    shift_date = shift.get("scheduled_start") or shift.get("clocked_out_at") or shift.get("updated_at")
    return {
        "id": shift.get("id"),
        "shift_date": shift_date,
        "participant_id": shift.get("participant_id"),
        "participant_name": shift.get("participant_name"),
        "participant_first_name": _participant_first_name(shift.get("participant_name")),
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
                "duration_minutes, status, session_id, tasks, clocked_out_at, updated_at"
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

        shift_day = _parse_date(str(shift.get("scheduled_start") or "")[:10])
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

    evidence_items: list[dict[str, Any]] = []
    for task in tasks:
        photo_item = _photo_evidence_item(task)
        if photo_item:
            evidence_items.append(photo_item)
        if task.get("voice_evidence"):
            evidence_items.append({
                "task_id": task.get("task_id"),
                "label": task.get("label"),
                "type": "voice",
                "url": task.get("voice_evidence"),
            })

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
            .select("id, shift_id, status, file_url, expires_at, created_at")
            .eq("requested_by", worker_id)
            .gte("expires_at", now)
            .eq("status", "ready")
            .order("created_at", desc=True)
            .limit(20)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise
