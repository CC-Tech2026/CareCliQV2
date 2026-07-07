"""Random compliance check-in scheduling for 6+ hour shifts."""

from __future__ import annotations

import logging
import random
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID

from .fcm_service import send_fcm_to_user
from .push_service import send_push_to_user
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

RANDOM_CHECKIN_MIN_SHIFT_SECS = 6 * 3600
RANDOM_CHECKIN_RESPONSE_SECS = 5 * 60
RANDOM_CHECKIN_MIN_GAP_SECS = 60 * 60
RANDOM_CHECKIN_MAX_GAP_SECS = 120 * 60
RANDOM_CHECKIN_START_BUFFER_SECS = 90 * 60
RANDOM_CHECKIN_END_BUFFER_SECS = 30 * 60
RANDOM_CHECKIN_COUNT_OPTIONS = (2, 3)

COMPLIANCE_CHECKIN_TITLE = "Compliance Check-in Required"
COMPLIANCE_CHECKIN_BODY = "Please complete your compliance check-in within 5 minutes."

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
        get_supabase_admin().table("shift_scheduled_checkins").select("id").limit(1).execute()
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


def uses_random_checkins(duration_secs: int) -> bool:
    return duration_secs >= RANDOM_CHECKIN_MIN_SHIFT_SECS


def _shift_end_estimate(shift: dict, clock_in: datetime) -> datetime:
    scheduled_end = _parse_dt(shift.get("scheduled_end"))
    if scheduled_end and scheduled_end > clock_in:
        return scheduled_end
    duration_mins = int(shift.get("duration_minutes") or 0)
    if duration_mins >= 360:
        return clock_in + timedelta(minutes=duration_mins)
    scheduled_start = _parse_dt(shift.get("scheduled_start"))
    if scheduled_start and scheduled_end and scheduled_end > clock_in:
        return scheduled_end
    return clock_in + timedelta(hours=8)


def generate_random_checkin_times(
    clock_in: datetime,
    shift_end: datetime,
    count: int,
    *,
    rng: Optional[random.Random] = None,
) -> list[datetime]:
    """Return `count` check-in times spaced ~1–2 hours apart within the shift window."""
    if count <= 0:
        return []

    rng = rng or random.Random()
    usable_start = clock_in + timedelta(seconds=RANDOM_CHECKIN_START_BUFFER_SECS)
    usable_end = shift_end - timedelta(seconds=RANDOM_CHECKIN_END_BUFFER_SECS)
    if usable_end <= usable_start:
        usable_end = shift_end - timedelta(minutes=15)
        usable_start = clock_in + timedelta(minutes=30)
    if usable_end <= usable_start:
        midpoint = clock_in + (shift_end - clock_in) / 2
        return [midpoint] * count

    span_secs = (usable_end - usable_start).total_seconds()
    min_gap = float(RANDOM_CHECKIN_MIN_GAP_SECS)
    max_gap = float(min(RANDOM_CHECKIN_MAX_GAP_SECS, span_secs))

    if span_secs < min_gap * max(0, count - 1):
        step = span_secs / count
        return sorted(
            usable_start + timedelta(seconds=step * (i + 0.5))
            for i in range(count)
        )

    for _ in range(200):
        times: list[datetime] = []
        cursor = usable_start + timedelta(seconds=rng.uniform(0, min(span_secs * 0.2, 1800)))
        while len(times) < count:
            times.append(cursor)
            if len(times) >= count:
                break
            remaining_slots = count - len(times)
            remaining_secs = (usable_end - cursor).total_seconds()
            min_next = min_gap
            max_next = min(max_gap, remaining_secs - min_gap * (remaining_slots - 1))
            if max_next < min_next:
                break
            cursor = cursor + timedelta(seconds=rng.uniform(min_next, max_next))
        if len(times) == count and all(
            (times[i + 1] - times[i]).total_seconds() >= RANDOM_CHECKIN_MIN_GAP_SECS
            for i in range(len(times) - 1)
        ):
            return times

    step = span_secs / (count + 1)
    return sorted(usable_start + timedelta(seconds=step * (i + 1)) for i in range(count))


def _is_valid_uuid(value: Any) -> bool:
    try:
        UUID(str(value))
        return True
    except (ValueError, TypeError):
        return False


def _list_scheduled_checkins(session_id: str) -> list[dict[str, Any]]:
    if not _is_valid_uuid(session_id) or not _schema_available():
        return []
    try:
        resp = (
            get_supabase_admin()
            .table("shift_scheduled_checkins")
            .select("*")
            .eq("session_id", session_id)
            .order("scheduled_at")
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        raise


def ensure_random_checkin_schedule(
    *,
    session_id: str,
    shift_id: str,
    worker_id: str,
    organization_id: str,
    shift: dict,
    clock_in: datetime,
) -> list[dict[str, Any]]:
    """Create 2–3 random check-in times for a 6+ hour shift if not already scheduled."""
    if not _schema_available():
        return []

    existing = _list_scheduled_checkins(session_id)
    if existing:
        return existing

    shift_end = _shift_end_estimate(shift, clock_in)
    duration_secs = int((shift_end - clock_in).total_seconds())
    if duration_secs < RANDOM_CHECKIN_MIN_SHIFT_SECS:
        return []

    count = secrets.choice(RANDOM_CHECKIN_COUNT_OPTIONS)
    times = generate_random_checkin_times(clock_in, shift_end, count)
    rows: list[dict[str, Any]] = []
    now = _now().isoformat()

    for idx, scheduled_at in enumerate(times, start=1):
        row = {
            "session_id": session_id,
            "shift_id": shift_id,
            "worker_id": worker_id,
            "organization_id": organization_id or None,
            "sequence_number": idx,
            "scheduled_at": scheduled_at.isoformat(),
            "status": "pending",
            "updated_at": now,
        }
        rows.append(row)

    try:
        resp = get_supabase_admin().table("shift_scheduled_checkins").insert(rows).execute()
        inserted = resp.data or rows
        get_supabase_admin().table("sessions").update({
            "random_checkins_scheduled": True,
            "updated_at": now,
        }).eq("id", session_id).execute()
        return inserted
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        raise


def required_random_checkins(session_id: str, duration_secs: int) -> int:
    if not uses_random_checkins(duration_secs):
        return 0
    scheduled = _list_scheduled_checkins(session_id)
    if scheduled:
        return len(scheduled)
    return min(RANDOM_CHECKIN_COUNT_OPTIONS)


def evaluate_random_checkin_window(
    *,
    now: datetime,
    scheduled_checkins: list[dict[str, Any]],
    on_break: bool,
    last_checkin_at: Optional[datetime],
    duration_secs: int,
    checkin_count: int,
) -> dict[str, Any]:
    """Eligibility for random compliance check-ins (6+ hour shifts)."""
    applicable = uses_random_checkins(duration_secs)
    required = len(scheduled_checkins) if scheduled_checkins else min(RANDOM_CHECKIN_COUNT_OPTIONS)
    completed = sum(1 for row in scheduled_checkins if row.get("status") == "completed")

    base: dict[str, Any] = {
        "applicable": applicable,
        "can_submit_checkin": False,
        "block_reason": None,
        "cooldown_remaining_secs": 0,
        "next_checkin_due_secs": 0,
        "checkin_overdue": False,
        "checkins_completed": completed if scheduled_checkins else checkin_count,
        "checkins_required": required,
        "last_checkin_at": last_checkin_at.isoformat() if last_checkin_at else None,
        "checkin_response_window_secs": RANDOM_CHECKIN_RESPONSE_SECS,
        "uses_random_schedule": True,
    }
    if not applicable:
        return base

    if on_break:
        base["block_reason"] = "on_break"
        return base

    prompted = next((row for row in scheduled_checkins if row.get("status") == "prompted"), None)
    if prompted:
        deadline = _parse_dt(prompted.get("response_deadline_at"))
        if deadline and now <= deadline:
            base.update({
                "can_submit_checkin": True,
                "checkin_overdue": True,
                "next_checkin_due_secs": 0,
            })
            return base
        if deadline and now > deadline:
            base.update({
                "checkin_overdue": True,
                "next_checkin_due_secs": 0,
            })
            return base

    pending_future = [
        row for row in scheduled_checkins
        if row.get("status") == "pending" and (_parse_dt(row.get("scheduled_at")) or now) > now
    ]
    if pending_future:
        next_at = _parse_dt(pending_future[0].get("scheduled_at"))
        if next_at:
            secs_until = max(0, int((next_at - now).total_seconds()))
            base["next_checkin_due_secs"] = secs_until
            base["block_reason"] = "not_due_yet"
        return base

    overdue_pending = [
        row for row in scheduled_checkins
        if row.get("status") == "pending" and (_parse_dt(row.get("scheduled_at")) or now) <= now
    ]
    if overdue_pending:
        base.update({
            "checkin_overdue": True,
            "next_checkin_due_secs": 0,
        })
    return base


def _dismiss_checkin_notification(worker_id: str, reference_key: str) -> None:
    from .user_notification_store import dismiss_notifications_by_reference

    dismiss_notifications_by_reference(worker_id, reference_key)


async def _send_compliance_checkin_push(
    *,
    worker_id: str,
    shift_id: str,
    session_id: str,
    scheduled_checkin_id: str,
) -> None:
    data = {
        "type": "compliance_checkin",
        "shift_id": shift_id,
        "session_id": session_id,
        "scheduled_checkin_id": scheduled_checkin_id,
        "action_url": f"/my-shifts/{shift_id}",
    }
    fcm_sent = await send_fcm_to_user(
        worker_id,
        title=COMPLIANCE_CHECKIN_TITLE,
        body=COMPLIANCE_CHECKIN_BODY,
        data=data,
        android_channel_id="safety-alerts",
    )
    if not fcm_sent:
        await send_push_to_user(
            worker_id,
            title=COMPLIANCE_CHECKIN_TITLE,
            body=COMPLIANCE_CHECKIN_BODY,
            data=data,
            priority="high",
        )


def _create_coordinator_missed_flag(
    *,
    session: dict,
    shift: dict,
    organization_id: str,
    sequence_number: int,
) -> None:
    from .long_shift_service import _insert_shift_alert

    participant = shift.get("participant_name") or "participant"
    org_id = str(shift.get("organization_id") or organization_id or "")
    shift_id = str(shift.get("id") or "")
    _insert_shift_alert(
        shift_id,
        org_id,
        "random_checkin_missed",
        f"Missed compliance check-in #{sequence_number} on {participant}'s shift.",
        "warning",
    )

    flags = list(session.get("compliance_flags") or [])
    flags.append({
        "check_id": 16,
        "severity": "AMBER",
        "message": f"Compliance check-in #{sequence_number} missed (no response within 5 minutes).",
        "action_required": "Follow up with support worker.",
    })
    try:
        get_supabase_admin().table("sessions").update({
            "compliance_flags": flags,
            "updated_at": _now().isoformat(),
        }).eq("id", session.get("id")).execute()
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            logger.debug("compliance_flags update failed: %s", exc)


async def _prompt_scheduled_checkin(row: dict[str, Any], session: dict, shift: dict) -> None:
    now = _now()
    scheduled_id = str(row["id"])
    worker_id = str(row["worker_id"])
    shift_id = str(row["shift_id"])
    session_id = str(row["session_id"])
    sequence = int(row.get("sequence_number") or 1)
    reference_key = f"compliance_checkin:{scheduled_id}"

    deadline = now + timedelta(seconds=RANDOM_CHECKIN_RESPONSE_SECS)
    try:
        get_supabase_admin().table("shift_scheduled_checkins").update({
            "status": "prompted",
            "prompted_at": now.isoformat(),
            "response_deadline_at": deadline.isoformat(),
            "notification_reference_key": reference_key,
            "updated_at": now.isoformat(),
        }).eq("id", scheduled_id).eq("status", "pending").execute()
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            logger.debug("scheduled checkin prompt update failed: %s", exc)
        return

    from .user_notification_store import create_user_notification

    create_user_notification(
        user_id=worker_id,
        organization_id=str(row.get("organization_id") or "") or None,
        event_type="compliance_checkin",
        title=COMPLIANCE_CHECKIN_TITLE,
        body=COMPLIANCE_CHECKIN_BODY,
        severity="high",
        shift_id=shift_id,
        action_url=f"/my-shifts/{shift_id}",
        payload={
            "scheduled_checkin_id": scheduled_id,
            "session_id": session_id,
            "sequence_number": sequence,
        },
        banner_style="orange",
        reference_key=reference_key,
    )

    await _send_compliance_checkin_push(
        worker_id=worker_id,
        shift_id=shift_id,
        session_id=session_id,
        scheduled_checkin_id=scheduled_id,
    )


async def _mark_scheduled_checkin_missed(
    row: dict[str, Any],
    session: dict,
    shift: dict,
    organization_id: str,
) -> None:
    scheduled_id = str(row["id"])
    now = _now().isoformat()
    try:
        get_supabase_admin().table("shift_scheduled_checkins").update({
            "status": "missed",
            "updated_at": now,
        }).eq("id", scheduled_id).eq("status", "prompted").execute()
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            logger.debug("missed checkin update failed: %s", exc)
        return

    ref = row.get("notification_reference_key")
    if ref:
        _dismiss_checkin_notification(str(row["worker_id"]), str(ref))

    _create_coordinator_missed_flag(
        session=session,
        shift=shift,
        organization_id=organization_id,
        sequence_number=int(row.get("sequence_number") or 1),
    )


def complete_scheduled_checkin(
    *,
    session_id: str,
    worker_id: str,
    shift_checkin_id: str,
) -> None:
    """Link a submitted check-in to the active prompted schedule and dismiss notifications."""
    if not _schema_available():
        return
    try:
        resp = (
            get_supabase_admin()
            .table("shift_scheduled_checkins")
            .select("id, notification_reference_key")
            .eq("session_id", session_id)
            .eq("worker_id", worker_id)
            .eq("status", "prompted")
            .order("prompted_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return
        row = rows[0]
        now = _now().isoformat()
        get_supabase_admin().table("shift_scheduled_checkins").update({
            "status": "completed",
            "shift_checkin_id": shift_checkin_id,
            "updated_at": now,
        }).eq("id", row["id"]).execute()
        ref = row.get("notification_reference_key")
        if ref:
            _dismiss_checkin_notification(worker_id, str(ref))
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            logger.debug("complete_scheduled_checkin failed: %s", exc)


async def run_random_checkin_pass() -> int:
    """Trigger due random check-ins and mark missed responses."""
    if not _schema_available():
        return 0

    now = _now()
    actions = 0

    try:
        shifts_resp = (
            get_supabase_admin()
            .table("shifts")
            .select(
                "id, organization_id, worker_id, participant_id, participant_name, "
                "clocked_in_at, clocked_out_at, scheduled_start, scheduled_end, "
                "duration_minutes, session_id, status"
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
        logger.warning("random checkin shift query failed: %s", exc)
        return 0

    for shift in shifts:
        clock_in = _parse_dt(shift.get("clocked_in_at"))
        if not clock_in:
            continue
        duration_secs = int((now - clock_in).total_seconds())
        if duration_secs < RANDOM_CHECKIN_MIN_SHIFT_SECS:
            continue

        session_id = shift.get("session_id")
        if not session_id:
            continue

        session: dict[str, Any] = {}
        try:
            sresp = (
                get_supabase_admin()
                .table("sessions")
                .select("id, compliance_flags, random_checkins_scheduled")
                .eq("id", session_id)
                .limit(1)
                .execute()
            )
            session = (sresp.data or [{}])[0]
        except Exception:
            session = {"id": session_id}

        ensure_random_checkin_schedule(
            session_id=str(session_id),
            shift_id=str(shift["id"]),
            worker_id=str(shift["worker_id"]),
            organization_id=str(shift.get("organization_id") or ""),
            shift=shift,
            clock_in=clock_in,
        )

        scheduled = _list_scheduled_checkins(str(session_id))
        for row in scheduled:
            if row.get("status") != "pending":
                continue
            scheduled_at = _parse_dt(row.get("scheduled_at"))
            if scheduled_at and scheduled_at <= now:
                await _prompt_scheduled_checkin(row, session, shift)
                actions += 1

        for row in scheduled:
            if row.get("status") != "prompted":
                continue
            deadline = _parse_dt(row.get("response_deadline_at"))
            if deadline and now > deadline:
                await _mark_scheduled_checkin_missed(
                    row,
                    session,
                    shift,
                    str(shift.get("organization_id") or ""),
                )
                actions += 1

    return actions
