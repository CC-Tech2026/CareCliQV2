"""Check 16 — Long Shift Engagement: activity tracking, check-ins, breaks, evaluation."""

from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Any, Optional

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

LONG_SHIFT_THRESHOLD_SECS = 4 * 3600
CHECKIN_GAP_SECS = 90 * 60
CHECKIN_COOLDOWN_SECS = 30 * 60
CHECKIN_EARLY_WINDOW_SECS = 15 * 60
ACTIVITY_GAP_FAIL_SECS = 120 * 60
BREAK_COMPLIANT_SECS = 15 * 60
LONG_SHIFT_BREAK_THRESHOLD_SECS = 6 * 3600
THREE_HOUR_BLOCK_SECS = 3 * 3600
OFFLINE_GAP_GRACE_SECS = 3 * 3600
# v1 org policy: one meal/rest break per long shift (end before starting another is N/A).
MAX_BREAKS_PER_SESSION = 1

CHECKIN_STATUSES = frozenset({"GOING_WELL", "NEEDS_ATTENTION", "INCIDENT_REPORTED"})
EMERGENCY_CHECKIN_STATUSES = frozenset({"NEEDS_ATTENTION", "INCIDENT_REPORTED"})

_SCHEMA_PROBE: Optional[bool] = None


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return (
        "does not exist" in err
        or "42703" in err
        or "pgrst" in err
        or "could not find" in err
    )


def _schema_available() -> bool:
    global _SCHEMA_PROBE
    if _SCHEMA_PROBE is not None:
        return _SCHEMA_PROBE
    try:
        get_supabase_admin().table("shift_activity_events").select("id").limit(1).execute()
        _SCHEMA_PROBE = True
    except Exception as exc:
        _SCHEMA_PROBE = False if _is_missing_schema_error(exc) else True
    return _SCHEMA_PROBE


def _parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        raw = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _patient_id(session: dict, shift: Optional[dict] = None) -> Optional[str]:
    pid = session.get("participant_id") or session.get("patient_id")
    if pid:
        return str(pid)
    if shift:
        sp = shift.get("participant_id")
        return str(sp) if sp else None
    return None


def _session_duration_secs(session: dict, shift: Optional[dict] = None) -> int:
    if shift and shift.get("clocked_in_at") and shift.get("clocked_out_at"):
        start = _parse_dt(shift["clocked_in_at"])
        end = _parse_dt(shift["clocked_out_at"])
        if start and end:
            return max(0, int((end - start).total_seconds()))
    if shift and shift.get("clocked_in_at") and not shift.get("clocked_out_at"):
        start = _parse_dt(shift["clocked_in_at"])
        if start:
            return max(0, int((_now() - start).total_seconds()))
    start = _parse_dt(session.get("start_time"))
    if start:
        return max(0, int((_now() - start).total_seconds()))
    mins = int(session.get("duration_minutes") or 0)
    return mins * 60


def _planned_shift_duration_secs(shift: Optional[dict], session: dict) -> int:
    """Scheduled shift length (not elapsed time), used to decide random check-ins."""
    if shift:
        start = _parse_dt(shift.get("scheduled_start"))
        end = _parse_dt(shift.get("scheduled_end"))
        if start and end and end > start:
            return max(0, int((end - start).total_seconds()))
        mins = int(shift.get("duration_minutes") or 0)
        if mins > 0:
            return mins * 60
    mins = int(session.get("duration_minutes") or 0)
    if mins > 0:
        return mins * 60
    return _session_duration_secs(session, shift)


def _required_checkins(shift_hours: float, duration_secs: int, session_id: Optional[str] = None) -> int:
    """Check-in count required for compliance evaluation."""
    from .random_checkin_service import required_random_checkins, uses_random_checkins

    if uses_random_checkins(duration_secs):
        return required_random_checkins(session_id or "", duration_secs)
    if duration_secs < LONG_SHIFT_THRESHOLD_SECS:
        return 0
    per_ninety = max(1, math.floor(shift_hours / 1.5))
    if shift_hours >= 6:
        per_block = math.ceil(shift_hours / 3)
        return max(per_ninety, per_block)
    return per_ninety


def _org_gap_settings(organization_id: str) -> dict[str, int]:
    """Per-org thresholds (Q1 v2-ready); defaults match addendum v1."""
    settings = {
        "checkin_gap_secs": CHECKIN_GAP_SECS,
        "activity_gap_fail_secs": ACTIVITY_GAP_FAIL_SECS,
        "long_shift_threshold_secs": LONG_SHIFT_THRESHOLD_SECS,
    }
    if not organization_id:
        return settings
    try:
        resp = (
            get_supabase_admin()
            .table("organization_long_shift_settings")
            .select("checkin_gap_minutes, activity_gap_fail_minutes, long_shift_threshold_hours")
            .eq("organization_id", organization_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if rows:
            row = rows[0]
            settings["checkin_gap_secs"] = int(row.get("checkin_gap_minutes") or 90) * 60
            settings["activity_gap_fail_secs"] = int(row.get("activity_gap_fail_minutes") or 120) * 60
            settings["long_shift_threshold_secs"] = int(
                float(row.get("long_shift_threshold_hours") or 4) * 3600
            )
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            logger.debug("org long-shift settings lookup failed: %s", exc)
    return settings


def _active_break_state(session_id: str) -> tuple[bool, Optional[datetime]]:
    if not session_id or not _schema_available():
        return False, None
    try:
        brk = (
            get_supabase_admin()
            .table("shift_breaks")
            .select("break_start_at")
            .eq("session_id", session_id)
            .is_("break_end_at", "null")
            .order("break_start_at", desc=True)
            .limit(1)
            .execute()
        )
        if brk.data:
            return True, _parse_dt(brk.data[0].get("break_start_at"))
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            logger.debug("active break lookup failed: %s", exc)
    return False, None


def _compute_current_gap(
    *,
    now: datetime,
    last_activity_at: Optional[datetime],
    clocked_in_at: Optional[datetime],
    on_break: bool = False,
    break_started_at: Optional[datetime] = None,
    offline_since_at: Optional[datetime] = None,
    gap_paused_secs: int = 0,
) -> int:
    """Gap since last activity; frozen during break/offline (Q2)."""
    anchor = last_activity_at or clocked_in_at
    if not anchor:
        return 0
    effective_now = now
    if on_break and break_started_at and break_started_at > anchor:
        effective_now = min(effective_now, break_started_at)
    if offline_since_at and offline_since_at > anchor:
        effective_now = min(effective_now, offline_since_at)
    return max(0, int((effective_now - anchor).total_seconds()) - gap_paused_secs)


def _engagement_score_band(score: Optional[int]) -> str:
    if score is None:
        return "unknown"
    if score >= 80:
        return "fully_engaged"
    if score >= 60:
        return "mostly_engaged"
    if score >= 40:
        return "low_engagement"
    return "review_required"


def _update_long_shift_flag(session_id: str, duration_secs: int) -> None:
    if duration_secs < LONG_SHIFT_THRESHOLD_SECS:
        return
    try:
        get_supabase_admin().table("sessions").update({
            "is_long_shift": True,
            "updated_at": _now().isoformat(),
        }).eq("id", session_id).execute()
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            logger.debug("is_long_shift update failed: %s", exc)


def _previous_event_time(session_id: Optional[str], shift_id: str) -> Optional[datetime]:
    supabase = get_supabase_admin()
    try:
        if session_id:
            resp = (
                supabase.table("shift_activity_events")
                .select("occurred_at")
                .eq("session_id", session_id)
                .order("occurred_at", desc=True)
                .limit(1)
                .execute()
            )
            rows = resp.data or []
            if rows:
                return _parse_dt(rows[0].get("occurred_at"))
        resp = (
            supabase.table("shift_activity_events")
            .select("occurred_at")
            .eq("shift_id", shift_id)
            .order("occurred_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if rows:
            return _parse_dt(rows[0].get("occurred_at"))
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            logger.debug("previous event lookup failed: %s", exc)
    return None


def _refresh_billable_duration(session_id: str, shift: dict) -> None:
    clock_in = _parse_dt(shift.get("clocked_in_at"))
    clock_out = _parse_dt(shift.get("clocked_out_at")) or _now()
    if not clock_in:
        return
    gross = max(0, int((clock_out - clock_in).total_seconds()))
    try:
        sess = (
            get_supabase_admin()
            .table("sessions")
            .select("break_duration_secs")
            .eq("id", session_id)
            .limit(1)
            .execute()
        )
        rows = sess.data or []
        break_secs = int((rows[0] or {}).get("break_duration_secs") or 0) if rows else 0
        billable = max(0, gross - break_secs)
        get_supabase_admin().table("sessions").update({
            "billable_duration_secs": billable,
            "updated_at": _now().isoformat(),
        }).eq("id", session_id).execute()
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            logger.debug("billable_duration update failed: %s", exc)


def record_activity(
    *,
    shift_id: str,
    event_type: str,
    worker_id: str,
    patient_id: Optional[str] = None,
    session_id: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
    is_billable: bool = True,
    occurred_at: Optional[datetime] = None,
) -> Optional[dict[str, Any]]:
    """Insert engagement event and update session cache columns."""
    if not _schema_available():
        return None

    now = occurred_at or _now()
    prev = _previous_event_time(session_id, shift_id)
    gap_secs = max(0, int((now - prev).total_seconds())) if prev else 0

    row = {
        "shift_id": shift_id,
        "session_id": session_id,
        "event_type": event_type,
        "occurred_at": now.isoformat(),
        "worker_id": worker_id,
        "patient_id": patient_id,
        "metadata": metadata or {},
        "is_billable": is_billable,
        "gap_before_secs": gap_secs,
    }
    try:
        resp = get_supabase_admin().table("shift_activity_events").insert(row).execute()
        inserted = (resp.data or [row])[0]
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        raise

    if session_id:
        try:
            sess_resp = (
                get_supabase_admin()
                .table("sessions")
                .select("max_gap_secs, checkin_count")
                .eq("id", session_id)
                .limit(1)
                .execute()
            )
            sess_rows = sess_resp.data or []
            current_max = int((sess_rows[0] or {}).get("max_gap_secs") or 0) if sess_rows else 0
            updates: dict[str, Any] = {
                "last_activity_at": now.isoformat(),
                "max_gap_secs": max(current_max, gap_secs),
                "updated_at": now.isoformat(),
            }
            if event_type == "CHECK_IN":
                count = int((sess_rows[0] or {}).get("checkin_count") or 0) if sess_rows else 0
                updates["checkin_count"] = count + 1
            get_supabase_admin().table("sessions").update(updates).eq("id", session_id).execute()
        except Exception as exc:
            if not _is_missing_schema_error(exc):
                logger.debug("session engagement cache update failed: %s", exc)

    return inserted


def record_activity_for_session(
    session: dict,
    event_type: str,
    worker_id: str,
    metadata: Optional[dict[str, Any]] = None,
    is_billable: bool = True,
) -> Optional[dict[str, Any]]:
    """Convenience wrapper when a session dict is already loaded."""
    from .shift_service import get_shift_for_session

    shift = get_shift_for_session(session)
    if not shift:
        return None
    session_id = str(session.get("id") or "")
    shift_id = str(shift.get("id") or "")
    if not session_id or not shift_id:
        return None
    duration = _session_duration_secs(session, shift)
    _update_long_shift_flag(session_id, duration)
    return record_activity(
        shift_id=shift_id,
        session_id=session_id,
        event_type=event_type,
        worker_id=worker_id,
        patient_id=_patient_id(session, shift),
        metadata=metadata,
        is_billable=is_billable,
    )


def _evaluate_checkin_window(
    *,
    now: datetime,
    last_activity_at: Optional[datetime],
    last_checkin_at: Optional[datetime],
    clocked_in_at: Optional[datetime],
    on_break: bool,
    duration_secs: int,
    checkin_count: int = 0,
    shift_hours: float = 0.0,
    checkin_gap_secs: int = CHECKIN_GAP_SECS,
    break_started_at: Optional[datetime] = None,
    offline_since_at: Optional[datetime] = None,
    gap_paused_secs: int = 0,
) -> dict[str, Any]:
    """Pure eligibility rules for worker check-in button (v2 cooldown + due window)."""
    required_checkins = _required_checkins(shift_hours, duration_secs)
    base: dict[str, Any] = {
        "applicable": duration_secs >= LONG_SHIFT_THRESHOLD_SECS,
        "can_submit_checkin": False,
        "block_reason": None,
        "cooldown_remaining_secs": 0,
        "next_checkin_due_secs": 0,
        "checkin_overdue": False,
        "checkins_completed": checkin_count,
        "checkins_required": required_checkins,
        "last_checkin_at": last_checkin_at.isoformat() if last_checkin_at else None,
        "checkin_gap_secs": checkin_gap_secs,
        "checkin_cooldown_secs": CHECKIN_COOLDOWN_SECS,
        "checkin_early_window_secs": CHECKIN_EARLY_WINDOW_SECS,
    }
    if not base["applicable"]:
        return base

    if on_break:
        base["block_reason"] = "on_break"
        return base

    current_gap = _compute_current_gap(
        now=now,
        last_activity_at=last_activity_at,
        clocked_in_at=clocked_in_at,
        on_break=on_break,
        break_started_at=break_started_at,
        offline_since_at=offline_since_at,
        gap_paused_secs=gap_paused_secs,
    )
    secs_until_due = max(0, checkin_gap_secs - current_gap)
    overdue = current_gap >= checkin_gap_secs

    cooldown_remaining = 0
    if last_checkin_at:
        elapsed_since_checkin = max(0, int((now - last_checkin_at).total_seconds()))
        cooldown_remaining = max(0, CHECKIN_COOLDOWN_SECS - elapsed_since_checkin)

    due_window_open = secs_until_due <= CHECKIN_EARLY_WINDOW_SECS
    can_submit = due_window_open and cooldown_remaining == 0

    base.update({
        "can_submit_checkin": can_submit,
        "cooldown_remaining_secs": cooldown_remaining,
        "next_checkin_due_secs": secs_until_due,
        "checkin_overdue": overdue,
    })
    if not can_submit:
        if cooldown_remaining > 0:
            base["block_reason"] = "cooldown"
        elif not due_window_open:
            base["block_reason"] = "not_due_yet"
    return base


def get_checkin_status(
    session_id: str,
    worker_id: str,
    organization_id: str,
) -> Optional[dict[str, Any]]:
    """Return check-in eligibility, cooldown, and next due window for the worker UI."""
    if not _schema_available():
        return None
    from .shift_service import _get_worker_session_or_none, get_shift_for_session

    session = _get_worker_session_or_none(session_id, worker_id, organization_id)
    if not session:
        return None
    shift = get_shift_for_session(session)
    if not shift or str(shift.get("worker_id") or "") != str(worker_id):
        return None

    now = _now()
    duration_secs = _session_duration_secs(session, shift)
    shift_hours = duration_secs / 3600 if duration_secs else 0.0
    last_activity = _parse_dt(session.get("last_activity_at"))
    clocked_in = _parse_dt(shift.get("clocked_in_at"))
    checkin_count = int(session.get("checkin_count") or 0)

    last_checkin_at: Optional[datetime] = None
    try:
        last_resp = (
            get_supabase_admin()
            .table("shift_checkins")
            .select("submitted_at")
            .eq("session_id", session_id)
            .order("submitted_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = last_resp.data or []
        if rows:
            last_checkin_at = _parse_dt(rows[0].get("submitted_at"))
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            raise

    on_break = False
    break_started_at: Optional[datetime] = None
    on_break, break_started_at = _active_break_state(session_id)
    org_settings = _org_gap_settings(organization_id)
    offline_since = _parse_dt(session.get("offline_since_at"))
    gap_paused = int(session.get("gap_paused_secs") or 0)

    from .random_checkin_service import (
        evaluate_random_checkin_window,
        uses_random_checkins,
        _list_scheduled_checkins,
    )

    planned_secs = _planned_shift_duration_secs(shift, session)
    scheduled = _list_scheduled_checkins(session_id)
    if scheduled or uses_random_checkins(planned_secs):
        return evaluate_random_checkin_window(
            now=now,
            scheduled_checkins=scheduled,
            on_break=on_break,
            last_checkin_at=last_checkin_at,
            duration_secs=max(planned_secs, duration_secs),
            checkin_count=checkin_count,
        )

    return _evaluate_checkin_window(
        now=now,
        last_activity_at=last_activity,
        last_checkin_at=last_checkin_at,
        clocked_in_at=clocked_in,
        on_break=on_break,
        duration_secs=duration_secs,
        checkin_count=checkin_count,
        shift_hours=shift_hours,
        checkin_gap_secs=org_settings["checkin_gap_secs"],
        break_started_at=break_started_at,
        offline_since_at=offline_since,
        gap_paused_secs=gap_paused,
    )


def submit_checkin(
    session_id: str,
    worker_id: str,
    organization_id: str,
    *,
    status: str,
    note: Optional[str] = None,
    prompt_triggered_at: Optional[str] = None,
    gap_at_prompt_secs: Optional[int] = None,
) -> Optional[dict[str, Any]]:
    if not _schema_available():
        return None
    status_norm = str(status or "").strip().upper()
    if status_norm not in CHECKIN_STATUSES:
        raise ValueError("Invalid check-in status.")

    from .shift_service import _get_worker_session_or_none, get_shift_for_session

    session = _get_worker_session_or_none(session_id, worker_id, organization_id)
    if not session:
        return None
    shift = get_shift_for_session(session)
    if not shift or str(shift.get("worker_id") or "") != str(worker_id):
        return None

    if status_norm not in EMERGENCY_CHECKIN_STATUSES:
        eligibility = get_checkin_status(session_id, worker_id, organization_id)
        if eligibility and not eligibility.get("can_submit_checkin"):
            reason = eligibility.get("block_reason")
            if reason == "on_break":
                raise ValueError("End your break before checking in.")
            if reason == "cooldown":
                mins = max(1, math.ceil(int(eligibility.get("cooldown_remaining_secs") or 0) / 60))
                raise ValueError(
                    f"Please wait {mins} minute(s) before submitting another routine check-in."
                )
            if reason == "not_due_yet":
                mins = max(1, math.ceil(int(eligibility.get("next_checkin_due_secs") or 0) / 60))
                raise ValueError(
                    f"Next check-in is not due yet. You can check in in about {mins} minute(s)."
                )
            raise ValueError("Check-in is not available right now.")

    shift_id = str(shift["id"])
    patient_id = _patient_id(session, shift)
    now = _now()

    from .random_checkin_service import _list_scheduled_checkins, uses_random_checkins

    prompted = _parse_dt(prompt_triggered_at)
    planned_secs = _planned_shift_duration_secs(shift, session)
    if not prompted and (uses_random_checkins(planned_secs) or _list_scheduled_checkins(session_id)):
        scheduled = _list_scheduled_checkins(session_id)
        active = next((row for row in scheduled if row.get("status") == "prompted"), None)
        if active:
            prompted = _parse_dt(active.get("prompted_at"))
    prompted = prompted or now
    response_secs = max(0, int((now - prompted).total_seconds()))
    note_text = (note or "").strip()[:500] or None

    row = {
        "session_id": session_id,
        "shift_id": shift_id,
        "worker_id": worker_id,
        "patient_id": patient_id,
        "status": status_norm,
        "note": note_text,
        "prompt_triggered_at": prompted.isoformat(),
        "submitted_at": now.isoformat(),
        "response_time_secs": response_secs,
        "gap_at_prompt_secs": gap_at_prompt_secs,
        "coordinator_notified": status_norm != "GOING_WELL",
    }
    try:
        resp = get_supabase_admin().table("shift_checkins").insert(row).execute()
        checkin = (resp.data or [row])[0]
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        raise

    record_activity(
        shift_id=shift_id,
        session_id=session_id,
        event_type="CHECK_IN",
        worker_id=worker_id,
        patient_id=patient_id,
        metadata={"check_in_id": checkin.get("id"), "status": status_norm},
    )

    if status_norm != "GOING_WELL":
        _notify_coordinator_attention(session, shift, status_norm, note_text)

    from .random_checkin_service import complete_scheduled_checkin

    if checkin.get("id"):
        complete_scheduled_checkin(
            session_id=session_id,
            worker_id=worker_id,
            shift_checkin_id=str(checkin["id"]),
        )

    if status_norm == "INCIDENT_REPORTED":
        incident_id = _create_incident_for_checkin(
            session=session,
            shift=shift,
            worker_id=worker_id,
            organization_id=organization_id,
            note=note_text,
        )
        if incident_id and checkin.get("id"):
            try:
                get_supabase_admin().table("shift_checkins").update({
                    "linked_incident_id": incident_id,
                }).eq("id", checkin["id"]).execute()
                checkin["linked_incident_id"] = incident_id
            except Exception as exc:
                logger.debug("linked_incident_id update failed: %s", exc)

    return checkin


def _create_incident_for_checkin(
    *,
    session: dict,
    shift: dict,
    worker_id: str,
    organization_id: str,
    note: Optional[str],
) -> Optional[str]:
    """Create a minimal incident record when worker reports via check-in."""
    import uuid

    participant_id = _patient_id(session, shift)
    if not participant_id:
        return None
    incident_id = str(uuid.uuid4())
    now = _now().isoformat()
    description = (note or "Incident reported during long-shift check-in.").strip()
    try:
        get_supabase_admin().table("incidents").insert({
            "id": incident_id,
            "organization_id": organization_id,
            "user_id": worker_id,
            "created_by": worker_id,
            "participant_id": participant_id,
            "session_id": session.get("id"),
            "shift_id": shift.get("id"),
            "title": "Long-shift check-in incident",
            "description": description[:2000],
            "incident_type": "other",
            "severity": "high",
            "status": "reported",
            "incident_date": now,
            "reported_date": now,
            "ndis_reportable": False,
            "practice_standard": "Standard 2.3 — Incident management",
        }).execute()
        return incident_id
    except Exception as exc:
        logger.debug("check-in incident create failed: %s", exc)
        return None


def start_break(
    session_id: str,
    worker_id: str,
    organization_id: str,
) -> Optional[dict[str, Any]]:
    if not _schema_available():
        return None
    from .shift_service import _get_worker_session_or_none, get_shift_for_session

    session = _get_worker_session_or_none(session_id, worker_id, organization_id)
    if not session:
        return None
    shift = get_shift_for_session(session)
    if not shift or str(shift.get("worker_id") or "") != str(worker_id):
        return None
    shift_id = str(shift["id"])
    patient_id = _patient_id(session, shift)

    try:
        active = (
            get_supabase_admin()
            .table("shift_breaks")
            .select("id")
            .eq("session_id", session_id)
            .is_("break_end_at", "null")
            .limit(1)
            .execute()
        )
        if active.data:
            raise ValueError("A break is already in progress.")
        if MAX_BREAKS_PER_SESSION is not None:
            completed = (
                get_supabase_admin()
                .table("shift_breaks")
                .select("id", count="exact")
                .eq("session_id", session_id)
                .not_.is_("break_end_at", "null")
                .execute()
            )
            if int(completed.count or 0) >= MAX_BREAKS_PER_SESSION:
                raise ValueError(
                    "Only one break is allowed per shift. "
                    "Your break has already been logged for this session."
                )
    except ValueError:
        raise
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        raise

    now = _now()
    try:
        count_resp = (
            get_supabase_admin()
            .table("shift_breaks")
            .select("id", count="exact")
            .eq("session_id", session_id)
            .execute()
        )
        break_number = int(count_resp.count or 0) + 1
    except Exception:
        break_number = 1

    row = {
        "session_id": session_id,
        "shift_id": shift_id,
        "worker_id": worker_id,
        "break_start_at": now.isoformat(),
        "break_number": break_number,
    }
    try:
        resp = get_supabase_admin().table("shift_breaks").insert(row).execute()
        brk = (resp.data or [row])[0]
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        raise

    record_activity(
        shift_id=shift_id,
        session_id=session_id,
        event_type="BREAK_START",
        worker_id=worker_id,
        patient_id=patient_id,
        metadata={"break_id": brk.get("id")},
        is_billable=False,
    )
    return brk


def end_break(
    session_id: str,
    worker_id: str,
    organization_id: str,
) -> Optional[dict[str, Any]]:
    if not _schema_available():
        return None
    from .shift_service import _get_worker_session_or_none, get_shift_for_session

    session = _get_worker_session_or_none(session_id, worker_id, organization_id)
    if not session:
        return None
    shift = get_shift_for_session(session)
    if not shift or str(shift.get("worker_id") or "") != str(worker_id):
        return None
    shift_id = str(shift["id"])
    patient_id = _patient_id(session, shift)

    try:
        resp = (
            get_supabase_admin()
            .table("shift_breaks")
            .select("*")
            .eq("session_id", session_id)
            .is_("break_end_at", "null")
            .order("break_start_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        raise
    if not rows:
        raise ValueError("No active break to end.")

    brk = rows[0]
    start = _parse_dt(brk.get("break_start_at"))
    now = _now()
    duration = max(0, int((now - start).total_seconds())) if start else 0
    is_compliant = duration >= BREAK_COMPLIANT_SECS
    updates = {
        "break_end_at": now.isoformat(),
        "duration_secs": duration,
        "is_compliant": is_compliant,
    }
    try:
        upd = (
            get_supabase_admin()
            .table("shift_breaks")
            .update(updates)
            .eq("id", brk["id"])
            .execute()
        )
        ended = (upd.data or [{**brk, **updates}])[0]
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        raise

    record_activity(
        shift_id=shift_id,
        session_id=session_id,
        event_type="BREAK_END",
        worker_id=worker_id,
        patient_id=patient_id,
        metadata={"break_id": brk.get("id"), "duration_secs": duration},
        is_billable=False,
    )

    try:
        all_breaks = (
            get_supabase_admin()
            .table("shift_breaks")
            .select("duration_secs")
            .eq("session_id", session_id)
            .execute()
        )
        total_break = sum(int(b.get("duration_secs") or 0) for b in (all_breaks.data or []))
        get_supabase_admin().table("sessions").update({
            "break_duration_secs": total_break,
            "updated_at": now.isoformat(),
        }).eq("id", session_id).execute()
        _refresh_billable_duration(session_id, shift)
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            logger.debug("break totals update failed: %s", exc)

    return ended


def get_break_status(
    session_id: str,
    worker_id: str,
    organization_id: str,
) -> Optional[dict[str, Any]]:
    """Return active break + completed break summary for UI validation."""
    if not _schema_available():
        return None
    from .shift_service import _get_worker_session_or_none

    session = _get_worker_session_or_none(session_id, worker_id, organization_id)
    if not session:
        return None
    try:
        completed_resp = (
            get_supabase_admin()
            .table("shift_breaks")
            .select("duration_secs")
            .eq("session_id", session_id)
            .not_.is_("break_end_at", "null")
            .execute()
        )
        completed_rows = completed_resp.data or []
        completed_breaks = len(completed_rows)
        total_break_secs = sum(int(r.get("duration_secs") or 0) for r in completed_rows)

        active_resp = (
            get_supabase_admin()
            .table("shift_breaks")
            .select("id, break_start_at, break_number")
            .eq("session_id", session_id)
            .is_("break_end_at", "null")
            .order("break_start_at", desc=True)
            .limit(1)
            .execute()
        )
        row = (active_resp.data or [None])[0]

        max_breaks = MAX_BREAKS_PER_SESSION
        can_start = True
        block_reason: Optional[str] = None

        if row:
            can_start = False
            block_reason = "break_in_progress"
            start = _parse_dt(row.get("break_start_at"))
            elapsed_secs = max(0, int((_now() - start).total_seconds())) if start else 0
            return {
                "active": True,
                "id": row.get("id"),
                "break_start_at": row.get("break_start_at"),
                "break_number": row.get("break_number"),
                "elapsed_secs": elapsed_secs,
                "completed_breaks": completed_breaks,
                "total_break_secs": total_break_secs,
                "max_breaks_per_shift": max_breaks,
                "can_start_break": can_start,
                "block_reason": block_reason,
            }

        if max_breaks is not None and completed_breaks >= max_breaks:
            can_start = False
            block_reason = "break_limit_reached"

        return {
            "active": False,
            "completed_breaks": completed_breaks,
            "total_break_secs": total_break_secs,
            "max_breaks_per_shift": max_breaks,
            "can_start_break": can_start,
            "block_reason": block_reason,
        }
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        raise


def get_active_break(
    session_id: str,
    worker_id: str,
    organization_id: str,
) -> Optional[dict[str, Any]]:
    """Backward-compatible wrapper — prefer get_break_status()."""
    return get_break_status(session_id, worker_id, organization_id)


def get_session_timeline(session_id: str) -> list[dict[str, Any]]:
    if not _schema_available():
        return []
    try:
        resp = (
            get_supabase_admin()
            .table("shift_activity_events")
            .select("*")
            .eq("session_id", session_id)
            .order("occurred_at")
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        raise


def evaluate_check16(session: dict, shift: Optional[dict] = None) -> dict[str, Any]:
    """Evaluate Check 16 sub-checks and return a compliance rule result dict."""
    if shift is None:
        from .shift_service import get_shift_for_session
        shift = get_shift_for_session(session)

    duration_secs = _session_duration_secs(session, shift)
    is_long = bool(session.get("is_long_shift")) or duration_secs >= LONG_SHIFT_THRESHOLD_SECS
    if not is_long:
        return {
            "rule": "R16",
            "status": "pass",
            "severity": "medium",
            "message": "R16: Not a long shift (< 4 hours) — check not applicable",
            "details": {"applicable": False},
        }

    session_id = str(session.get("id") or "")
    max_gap = int(session.get("max_gap_secs") or 0)
    checkin_count = int(session.get("checkin_count") or 0)
    shift_hours = duration_secs / 3600

    from .random_checkin_service import uses_random_checkins, _list_scheduled_checkins

    result_16a = max_gap <= ACTIVITY_GAP_FAIL_SECS
    if uses_random_checkins(duration_secs):
        scheduled = _list_scheduled_checkins(session_id)
        if scheduled:
            completed_scheduled = sum(1 for row in scheduled if row.get("status") == "completed")
            missed_scheduled = sum(1 for row in scheduled if row.get("status") == "missed")
            required_checkins = len(scheduled)
            checkin_count = completed_scheduled
            result_16b = completed_scheduled >= required_checkins and missed_scheduled == 0
        else:
            required_checkins = _required_checkins(shift_hours, duration_secs, session_id)
            result_16b = checkin_count >= required_checkins
    else:
        required_checkins = _required_checkins(shift_hours, duration_secs, session_id)
        result_16b = checkin_count >= required_checkins
    missed_checkins = max(0, required_checkins - checkin_count)

    result_16c = True
    if duration_secs >= LONG_SHIFT_BREAK_THRESHOLD_SECS:
        try:
            breaks = (
                get_supabase_admin()
                .table("shift_breaks")
                .select("is_compliant")
                .eq("session_id", session_id)
                .execute()
            ).data or []
            result_16c = any(b.get("is_compliant") for b in breaks)
        except Exception:
            result_16c = False

    score_deduction = 0
    if not result_16a:
        score_deduction += 4
    if not result_16b:
        score_deduction += min(3, missed_checkins)

    engagement_score = max(0, 100 - (score_deduction * 17))
    all_pass = result_16a and result_16b and result_16c

    flags: list[dict[str, Any]] = []
    if not result_16a:
        flags.append({
            "check_id": 16,
            "severity": "AMBER",
            "message": f"Activity gap of {max_gap // 60} minutes detected on a {shift_hours:.1f}-hour shift.",
            "action_required": "Review shift timeline with worker.",
        })
    if not result_16b:
        flags.append({
            "check_id": 16,
            "severity": "AMBER",
            "message": f"{missed_checkins} check-in(s) missed. {checkin_count} of {required_checkins} completed.",
            "action_required": "Ensure worker completes check-ins on long shifts.",
        })
    if not result_16c:
        flags.append({
            "check_id": 16,
            "severity": "PURPLE",
            "message": "No break recorded on a 6+ hour shift.",
            "action_required": None,
        })

    if session_id and _schema_available():
        try:
            engagement_payload = {
                "16a": result_16a,
                "16b": result_16b,
                "16c": result_16c,
                "engagement_score": engagement_score,
                "max_gap_mins": max_gap // 60,
                "checkins_completed": checkin_count,
                "checkins_required": required_checkins,
                "break_compliant": result_16c,
                "score_band": _engagement_score_band(engagement_score),
            }
            get_supabase_admin().table("sessions").update({
                "engagement_score": engagement_score,
                "is_long_shift": True,
                "compliance_flags": flags,
                "engagement_check16": engagement_payload,
                "updated_at": _now().isoformat(),
            }).eq("id", session_id).execute()
        except Exception:
            pass

    status = "pass" if all_pass else "warning"
    if not result_16a or not result_16b:
        status = "warning"

    message_parts = []
    if not result_16a:
        message_parts.append(f"max gap {max_gap // 60} min")
    if not result_16b:
        message_parts.append(f"{missed_checkins} missed check-in(s)")
    if not result_16c:
        message_parts.append("no compliant break")

    message = (
        f"R16: Long shift engagement passed ({engagement_score}/100)"
        if all_pass
        else f"R16: Long shift engagement issues — {'; '.join(message_parts)}"
    )

    return {
        "rule": "R16",
        "status": status,
        "severity": "medium",
        "weight": 6,
        "message": message,
        "details": {
            "applicable": True,
            "engagement_score": engagement_score,
            "16a": result_16a,
            "16b": result_16b,
            "16c": result_16c,
            "max_gap_mins": max_gap // 60,
            "checkins_completed": checkin_count,
            "checkins_required": required_checkins,
            "break_compliant": result_16c,
            "flags": flags,
        },
    }


def _derive_live_status(current_gap_secs: int) -> str:
    if current_gap_secs >= ACTIVITY_GAP_FAIL_SECS:
        return "RED"
    if current_gap_secs >= CHECKIN_GAP_SECS:
        return "AMBER"
    return "GREEN"


def _insert_shift_alert(
    shift_id: str,
    org_id: str,
    alert_type: str,
    message: str,
    severity: str,
) -> None:
    try:
        existing = (
            get_supabase_admin()
            .table("alerts")
            .select("id")
            .eq("shift_id", shift_id)
            .eq("alert_type", alert_type)
            .eq("is_read", False)
            .limit(1)
            .execute()
        )
        if existing.data:
            return
        get_supabase_admin().table("alerts").insert({
            "organization_id": org_id,
            "shift_id": shift_id,
            "alert_type": alert_type,
            "message": message,
            "severity": severity,
            "is_read": False,
        }).execute()
    except Exception as exc:
        logger.debug("shift alert insert failed: %s", exc)


def _notify_coordinator_attention(
    session: dict,
    shift: dict,
    status: str,
    note: Optional[str],
) -> None:
    org_id = str(shift.get("organization_id") or session.get("organization_id") or "")
    participant = shift.get("participant_name") or "participant"
    body = note or f"Worker reported {status.replace('_', ' ').lower()} during shift."
    severity = "critical" if status == "INCIDENT_REPORTED" else "warning"
    _insert_shift_alert(
        str(shift.get("id") or ""),
        org_id,
        "long_shift_checkin_attention",
        f"{participant}: {body}",
        severity,
    )


async def _prompt_worker_checkin(worker_id: str, shift_id: str, gap_mins: int) -> None:
    from .push_service import send_push_to_user
    from .notification_service import notify_worker

    title = "Shift check-in"
    body = f"No activity for {gap_mins} minutes — tap to confirm you are OK."
    await send_push_to_user(
        worker_id,
        title=title,
        body=body,
        data={"shift_id": shift_id, "type": "long_shift_checkin"},
        priority="high",
    )
    try:
        await notify_worker(
            user_id=worker_id,
            org_id=None,
            event="long_shift_checkin",
            title=title,
            message=body,
            reference_key=f"long_shift_checkin:{shift_id}",
            severity="high",
            action_url=f"/my-shifts/{shift_id}",
            shift_id=shift_id,
            alert_type="long_shift_checkin",
        )
    except Exception as exc:
        logger.debug("in-app check-in notification failed: %s", exc)


def build_live_shift_engagement(shift: dict, session: Optional[dict] = None) -> dict[str, Any]:
    """Enrich a live shift row with Check 16 engagement fields."""
    session = session or {}
    session_id = str(session.get("id") or shift.get("session_id") or "")
    now = _now()
    last_activity = _parse_dt(session.get("last_activity_at"))
    clock_in = _parse_dt(shift.get("clocked_in_at"))
    duration_secs = _session_duration_secs(session, shift) if session_id else (
        max(0, int((now - clock_in).total_seconds())) if clock_in else 0
    )
    on_break, break_started_at = _active_break_state(session_id) if session_id else (False, None)
    offline_since = _parse_dt(session.get("offline_since_at"))
    gap_paused = int(session.get("gap_paused_secs") or 0)
    org_id = str(shift.get("organization_id") or session.get("organization_id") or "")
    org_settings = _org_gap_settings(org_id)
    current_gap = _compute_current_gap(
        now=now,
        last_activity_at=last_activity,
        clocked_in_at=clock_in,
        on_break=on_break,
        break_started_at=break_started_at,
        offline_since_at=offline_since,
        gap_paused_secs=gap_paused,
    )
    shift_hours = duration_secs / 3600 if duration_secs else 0
    required_checkins = _required_checkins(shift_hours, duration_secs, session_id)
    checkin_count = int(session.get("checkin_count") or 0)

    from .random_checkin_service import uses_random_checkins, _list_scheduled_checkins

    next_checkin_due = None
    if uses_random_checkins(duration_secs):
        scheduled = _list_scheduled_checkins(session_id) if session_id else []
        completed_scheduled = sum(1 for row in scheduled if row.get("status") == "completed")
        checkin_count = completed_scheduled or checkin_count
        prompted = next((row for row in scheduled if row.get("status") == "prompted"), None)
        pending = next(
            (
                row for row in scheduled
                if row.get("status") == "pending"
                and (_parse_dt(row.get("scheduled_at")) or now) > now
            ),
            None,
        )
        if prompted:
            next_checkin_due = 0
        elif pending:
            scheduled_at = _parse_dt(pending.get("scheduled_at"))
            if scheduled_at:
                next_checkin_due = max(0, int((scheduled_at - now).total_seconds()))
    else:
        checkin_gap = org_settings["checkin_gap_secs"]
        next_checkin_due = (
            max(0, checkin_gap - current_gap) if duration_secs >= LONG_SHIFT_THRESHOLD_SECS else None
        )

    engagement_score = session.get("engagement_score")
    break_logged = int(session.get("break_duration_secs") or 0) > 0
    break_elapsed_secs = 0
    if on_break and break_started_at:
        break_elapsed_secs = max(0, int((now - break_started_at).total_seconds()))

    last_event_type = None
    if session_id and _schema_available():
        try:
            ev = (
                get_supabase_admin()
                .table("shift_activity_events")
                .select("event_type")
                .eq("session_id", session_id)
                .order("occurred_at", desc=True)
                .limit(1)
                .execute()
            )
            if ev.data:
                last_event_type = ev.data[0].get("event_type")
        except Exception:
            pass

    status = _derive_live_status(current_gap) if duration_secs >= LONG_SHIFT_THRESHOLD_SECS else "GREEN"
    checkin_gap = org_settings["checkin_gap_secs"]
    if next_checkin_due is None and not uses_random_checkins(duration_secs):
        next_checkin_due = max(0, checkin_gap - current_gap) if duration_secs >= LONG_SHIFT_THRESHOLD_SECS else None
    coordinator_alerted = current_gap >= checkin_gap

    return {
        "session_id": session_id or None,
        "duration_secs": duration_secs,
        "current_gap_secs": current_gap,
        "engagement_status": status,
        "status": status,
        "checkins_completed": checkin_count,
        "checkins_required": required_checkins,
        "next_checkin_due_secs": next_checkin_due,
        "break_logged": break_logged,
        "on_break": on_break,
        "break_started_at": break_started_at.isoformat() if break_started_at else None,
        "break_elapsed_secs": break_elapsed_secs,
        "break_compliant": bool(session.get("break_duration_secs", 0) >= BREAK_COMPLIANT_SECS),
        "engagement_score": engagement_score,
        "engagement_score_band": _engagement_score_band(
            int(engagement_score) if engagement_score is not None else None
        ),
        "last_activity_type": last_event_type,
        "last_activity_at": session.get("last_activity_at"),
        "is_long_shift": duration_secs >= LONG_SHIFT_THRESHOLD_SECS,
        "coordinator_alerted": coordinator_alerted,
        "offline": offline_since is not None,
        "billable_duration_secs": session.get("billable_duration_secs"),
        "break_duration_secs": session.get("break_duration_secs"),
    }


async def run_long_shift_monitor_pass() -> int:
    """Monitor active long shifts; notify coordinators on 90/120 min gaps."""
    if not _schema_available():
        return 0
    notified = 0
    now = _now()
    try:
        shifts_resp = (
            get_supabase_admin()
            .table("shifts")
            .select(
                "id, organization_id, worker_id, participant_id, participant_name, "
                "clocked_in_at, session_id, status"
            )
            .in_("status", ["in_progress", "clocked_in"])
            .not_.is_("clocked_in_at", "null")
            .is_("clocked_out_at", "null")
            .execute()
        )
        shifts = shifts_resp.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return 0
        logger.warning("long shift monitor query failed: %s", exc)
        return 0

    for shift in shifts:
        clock_in = _parse_dt(shift.get("clocked_in_at"))
        if not clock_in:
            continue
        duration_secs = int((now - clock_in).total_seconds())
        if duration_secs < LONG_SHIFT_THRESHOLD_SECS:
            continue

        session_id = shift.get("session_id")
        session: dict[str, Any] = {}
        if session_id:
            try:
                sresp = (
                    get_supabase_admin()
                    .table("sessions")
                    .select(
                        "id, last_activity_at, max_gap_secs, checkin_count, "
                        "break_duration_secs, engagement_score, is_long_shift, "
                        "offline_since_at, gap_paused_secs, billable_duration_secs"
                    )
                    .eq("id", session_id)
                    .limit(1)
                    .execute()
                )
                session = (sresp.data or [{}])[0]
            except Exception:
                session = {}

        engagement = build_live_shift_engagement(shift, session)
        gap_secs = engagement["current_gap_secs"]
        gap_mins = gap_secs // 60
        if gap_mins < 90:
            continue

        severity = "RED" if gap_mins >= 120 else "AMBER"
        org_id = str(shift.get("organization_id") or "")
        participant = shift.get("participant_name") or "participant"

        alert_type = "long_shift_gap_red" if severity == "RED" else "long_shift_gap_amber"
        msg = (
            f"URGENT: No activity for {gap_mins} minutes on {participant}'s shift. Welfare check recommended."
            if severity == "RED"
            else f"No activity recorded for {gap_mins} minutes on {participant}'s shift."
        )
        _insert_shift_alert(
            str(shift.get("id") or ""),
            org_id,
            alert_type,
            msg,
            "critical" if severity == "RED" else "warning",
        )
        notified += 1

        worker_id = shift.get("worker_id")
        if worker_id and 90 <= gap_mins < 120:
            from .random_checkin_service import uses_random_checkins

            if not uses_random_checkins(duration_secs):
                try:
                    await _prompt_worker_checkin(str(worker_id), str(shift.get("id") or ""), gap_mins)
                except Exception as exc:
                    logger.debug("worker check-in push failed: %s", exc)

    return notified


def get_engagement_summary(
    organization_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> dict[str, Any]:
    if not _schema_available():
        return {"total_long_shifts": 0, "passed_check16": 0, "pass_rate_pct": 0.0, "distribution": []}
    try:
        query = (
            get_supabase_admin()
            .table("sessions")
            .select("id, engagement_score, is_long_shift, compliance_score")
            .eq("organization_id", organization_id)
            .eq("is_long_shift", True)
        )
        if start_date:
            query = query.gte("session_date", start_date)
        if end_date:
            query = query.lte("session_date", end_date)
        resp = query.execute()
        rows = resp.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return {"total_long_shifts": 0, "passed_check16": 0, "pass_rate_pct": 0.0, "distribution": []}
        raise

    passed = sum(1 for r in rows if int(r.get("engagement_score") or 0) >= 80)
    total = len(rows)
    buckets = {"80_100": 0, "60_79": 0, "40_59": 0, "below_40": 0}
    for r in rows:
        score = int(r.get("engagement_score") or 0)
        if score >= 80:
            buckets["80_100"] += 1
        elif score >= 60:
            buckets["60_79"] += 1
        elif score >= 40:
            buckets["40_59"] += 1
        else:
            buckets["below_40"] += 1

    return {
        "total_long_shifts": total,
        "passed_check16": passed,
        "pass_rate_pct": round(passed / total * 100, 1) if total else 0.0,
        "distribution": buckets,
    }


def mark_session_offline(
    session_id: str,
    worker_id: str,
    organization_id: str,
) -> Optional[dict[str, Any]]:
    """Q2: pause gap timer when device goes offline after last check-in."""
    from .shift_service import _get_worker_session_or_none

    session = _get_worker_session_or_none(session_id, worker_id, organization_id)
    if not session:
        return None
    now = _now()
    offline_since = _parse_dt(session.get("offline_since_at"))
    if offline_since:
        return {"session_id": session_id, "offline_since_at": offline_since.isoformat(), "already_offline": True}
    try:
        get_supabase_admin().table("sessions").update({
            "offline_since_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }).eq("id", session_id).execute()
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        raise
    return {"session_id": session_id, "offline_since_at": now.isoformat(), "gap_timer_paused": True}


def mark_session_online(
    session_id: str,
    worker_id: str,
    organization_id: str,
) -> Optional[dict[str, Any]]:
    """Q2: resume gap timer on reconnect; accumulate paused time up to grace limit."""
    from .shift_service import _get_worker_session_or_none, get_shift_for_session

    session = _get_worker_session_or_none(session_id, worker_id, organization_id)
    if not session:
        return None
    shift = get_shift_for_session(session)
    offline_since = _parse_dt(session.get("offline_since_at"))
    now = _now()
    gap_paused = int(session.get("gap_paused_secs") or 0)
    if offline_since:
        paused = max(0, int((now - offline_since).total_seconds()))
        gap_paused += min(paused, OFFLINE_GAP_GRACE_SECS)
    updates: dict[str, Any] = {
        "offline_since_at": None,
        "gap_paused_secs": gap_paused,
        "last_activity_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    try:
        get_supabase_admin().table("sessions").update(updates).eq("id", session_id).execute()
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        raise
    if shift:
        record_activity(
            shift_id=str(shift["id"]),
            session_id=session_id,
            event_type="NOTE_SAVED",
            worker_id=worker_id,
            patient_id=_patient_id(session, shift),
            metadata={"source": "offline_reconnect"},
            occurred_at=now,
        )
    return get_worker_activity_summary(session_id, worker_id, organization_id)


def get_worker_activity_summary(
    session_id: str,
    worker_id: str,
    organization_id: str,
) -> Optional[dict[str, Any]]:
    """Neutral worker-facing activity summary (Q5 — no engagement score)."""
    from .shift_service import _get_worker_session_or_none, get_shift_for_session

    session = _get_worker_session_or_none(session_id, worker_id, organization_id)
    if not session:
        return None
    shift = get_shift_for_session(session)
    if not shift:
        return None
    now = _now()
    on_break, break_started_at = _active_break_state(session_id)
    last_activity = _parse_dt(session.get("last_activity_at"))
    clock_in = _parse_dt(shift.get("clocked_in_at"))
    current_gap = _compute_current_gap(
        now=now,
        last_activity_at=last_activity,
        clocked_in_at=clock_in,
        on_break=on_break,
        break_started_at=break_started_at,
        offline_since_at=_parse_dt(session.get("offline_since_at")),
        gap_paused_secs=int(session.get("gap_paused_secs") or 0),
    )
    duration_secs = _session_duration_secs(session, shift)
    gross_secs = duration_secs
    break_secs = int(session.get("break_duration_secs") or 0)
    billable = session.get("billable_duration_secs")
    if billable is None and clock_in:
        billable = max(0, gross_secs - break_secs)
    return {
        "session_id": session_id,
        "is_long_shift": duration_secs >= LONG_SHIFT_THRESHOLD_SECS,
        "last_activity_at": session.get("last_activity_at"),
        "minutes_since_activity": current_gap // 60,
        "current_gap_secs": current_gap,
        "on_break": on_break,
        "offline": session.get("offline_since_at") is not None,
        "checkins_completed": int(session.get("checkin_count") or 0),
        "break_duration_secs": break_secs,
        "billable_duration_secs": billable,
        "gross_duration_secs": gross_secs,
        "timeline_event_count": len(get_session_timeline(session_id)),
    }


def get_audit_engagement_pack(
    organization_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> dict[str, Any]:
    """Audit pack sections 2, 3a, 6 and billable reconciliation (addendum §7)."""
    summary = get_engagement_summary(organization_id, start_date, end_date)
    if not _schema_available():
        return {
            "engagement_compliance_kpi": summary,
            "long_shift_engagement_log": [],
            "check16_compliance_row": {"rule": "R16", "period_result": "n/a", "sessions_flagged": 0},
            "billable_reconciliation": [],
        }

    try:
        query = (
            get_supabase_admin()
            .table("sessions")
            .select(
                "id, session_date, participant_id, worker_id, shift_id, "
                "duration_minutes, checkin_count, max_gap_secs, break_duration_secs, "
                "billable_duration_secs, engagement_score, engagement_check16, compliance_flags, "
                "is_long_shift"
            )
            .eq("organization_id", organization_id)
            .eq("is_long_shift", True)
        )
        if start_date:
            query = query.gte("session_date", start_date)
        if end_date:
            query = query.lte("session_date", end_date)
        sessions = query.execute().data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return {
                "engagement_compliance_kpi": summary,
                "long_shift_engagement_log": [],
                "check16_compliance_row": {"rule": "R16", "period_result": "n/a", "sessions_flagged": 0},
                "billable_reconciliation": [],
            }
        raise

    engagement_log: list[dict[str, Any]] = []
    reconciliation: list[dict[str, Any]] = []
    flagged = 0

    for sess in sessions:
        session_id = str(sess.get("id") or "")
        shift_id = sess.get("shift_id")
        shift: dict[str, Any] = {}
        if shift_id:
            try:
                sresp = (
                    get_supabase_admin()
                    .table("shifts")
                    .select("clocked_in_at, clocked_out_at, duration_minutes")
                    .eq("id", shift_id)
                    .limit(1)
                    .execute()
                )
                shift = (sresp.data or [{}])[0]
            except Exception:
                shift = {}

        duration_mins = int(sess.get("duration_minutes") or shift.get("duration_minutes") or 0)
        shift_hours = duration_mins / 60 if duration_mins else 0
        required = _required_checkins(shift_hours, duration_mins * 60, session_id)
        completed = int(sess.get("checkin_count") or 0)
        score = int(sess.get("engagement_score") or 0)
        check16 = sess.get("engagement_check16") or {}
        flags = sess.get("compliance_flags") or []
        if score < 80 or flags:
            flagged += 1

        alerts_count = 0
        if shift_id:
            try:
                aresp = (
                    get_supabase_admin()
                    .table("alerts")
                    .select("id", count="exact")
                    .eq("shift_id", shift_id)
                    .in_("alert_type", ["long_shift_gap_amber", "long_shift_gap_red", "long_shift_checkin_attention"])
                    .execute()
                )
                alerts_count = int(aresp.count or 0)
            except Exception:
                pass

        participant = None
        worker = None
        pid = sess.get("participant_id")
        wid = sess.get("worker_id")
        if pid:
            try:
                presp = get_supabase_admin().table("patients").select("full_name").eq("id", pid).limit(1).execute()
                participant = (presp.data or [{}])[0].get("full_name")
            except Exception:
                pass
        if wid:
            try:
                wresp = get_supabase_admin().table("users").select("full_name").eq("id", wid).limit(1).execute()
                worker = (wresp.data or [{}])[0].get("full_name")
            except Exception:
                pass

        engagement_log.append({
            "session_id": session_id,
            "session_date": sess.get("session_date"),
            "participant_name": participant,
            "worker_name": worker,
            "shift_duration_hours": round(shift_hours, 1),
            "checkins_completed": completed,
            "checkins_required": required,
            "max_activity_gap_mins": int(sess.get("max_gap_secs") or 0) // 60,
            "break_duration_mins": int(sess.get("break_duration_secs") or 0) // 60,
            "engagement_score": score,
            "engagement_score_band": _engagement_score_band(score),
            "check16_passed": score >= 80,
            "sub_checks": {
                "16a": check16.get("16a"),
                "16b": check16.get("16b"),
                "16c": check16.get("16c"),
            },
            "coordinator_alerts": alerts_count,
            "flags": flags,
        })

        clock_in = _parse_dt(shift.get("clocked_in_at"))
        clock_out = _parse_dt(shift.get("clocked_out_at"))
        billed_secs = duration_mins * 60
        billable_secs = int(sess.get("billable_duration_secs") or 0)
        if clock_in and clock_out and not billable_secs:
            gross = max(0, int((clock_out - clock_in).total_seconds()))
            billable_secs = max(0, gross - int(sess.get("break_duration_secs") or 0))
        discrepancy_secs = billed_secs - billable_secs if billed_secs and billable_secs else 0
        reconciliation.append({
            "session_id": session_id,
            "participant_name": participant,
            "billed_hours": round(billed_secs / 3600, 2) if billed_secs else None,
            "billable_hours": round(billable_secs / 3600, 2) if billable_secs else None,
            "break_hours": round(int(sess.get("break_duration_secs") or 0) / 3600, 2),
            "discrepancy_hours": round(discrepancy_secs / 3600, 2) if discrepancy_secs else 0,
            "flagged": abs(discrepancy_secs) > 300,
        })

    period_pass = summary.get("pass_rate_pct", 0) >= 80 if summary.get("total_long_shifts") else True
    return {
        "engagement_compliance_kpi": {
            **summary,
            "label": "Engagement compliance",
            "description": "Percentage of long shifts that passed Check 16 (score >= 80)",
        },
        "long_shift_engagement_log": engagement_log,
        "check16_compliance_row": {
            "rule": "R16",
            "name": "Long shift engagement",
            "period_result": "pass" if period_pass else "review",
            "sessions_flagged": flagged,
            "pass_rate_pct": summary.get("pass_rate_pct", 0),
        },
        "billable_reconciliation": reconciliation,
    }
