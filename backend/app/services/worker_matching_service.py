"""Weekly-availability-slot signal for shift/worker matching.

`_detect_worker_conflicts` (coordinator.py) already checks shift overlaps,
blackout dates, and weekly max-hours; `_check_skill_match` already checks
required-skill coverage. Neither checks the granular preferred/available/
unavailable weekly slot grid (worker_weekly_availability_slots) a worker can
set — that's the one signal genuinely missing from the existing
available-workers ranking, and what this module adds.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from .worker_availability_service import (
    emergency_overrides_batch,
    get_slot_status_for_shift,
    raw_slot_statuses_batch,
    slot_for_hour,
)
from ..core.timezone import parse_shift_datetime, request_timezone

_SLOT_HOUR_BOUNDARIES = (
    (0, 12, "morning"),
    (12, 17, "afternoon"),
    (17, 24, "evening"),
)  # mirrors slot_for_hour()'s own cutoffs — kept in lockstep with it deliberately

_PROBE_HOUR_BY_SLOT = {"morning": 9, "afternoon": 14, "evening": 18}


def _slots_touched(start_local: datetime, end_local: Optional[datetime]) -> list[str]:
    """Every time_slot (morning/afternoon/evening) the shift's hours overlap,
    treating it as a single day's hour-of-day range (a shift over 24h long
    just touches all three, which is a fine simplification for support work)."""
    if not end_local or end_local <= start_local:
        return [slot_for_hour(start_local.hour)]
    start_hour = start_local.hour + start_local.minute / 60
    end_hour = min(start_hour + (end_local - start_local).total_seconds() / 3600, 24)
    touched = [name for lo, hi, name in _SLOT_HOUR_BOUNDARIES if start_hour < hi and end_hour > lo]
    return touched or [slot_for_hour(start_local.hour)]


def _worst_status(statuses: list[Optional[str]]) -> str:
    """'preferred' for the whole shift beats 'available'; any 'unavailable'
    segment drags the whole shift down, since a worker who can only cover
    part of it isn't a clean match."""
    clean = [s for s in statuses if s]
    if not clean:
        return "available"
    if "unavailable" in clean:
        return "unavailable"
    if all(s == "preferred" for s in clean):
        return "preferred"
    return "available"


def availability_status_for_shift(worker_id: str, scheduled_start: str, scheduled_end: Optional[str], tz=None) -> str:
    """'preferred' | 'available' | 'unavailable' for this worker across every
    weekly-availability slot the shift touches. Reuses get_slot_status_for_shift
    (handles the emergency-override edge case already)."""
    zone = tz or request_timezone()
    start_local = parse_shift_datetime(scheduled_start).astimezone(zone)
    end_local = parse_shift_datetime(scheduled_end).astimezone(zone) if scheduled_end else None
    statuses = [
        get_slot_status_for_shift(worker_id, start_local.replace(hour=_PROBE_HOUR_BY_SLOT[slot], minute=0))
        for slot in _slots_touched(start_local, end_local)
    ]
    return _worst_status(statuses)


def availability_statuses_for_shift_batch(
    worker_ids: list[str], scheduled_start: str, scheduled_end: Optional[str], tz=None
) -> dict[str, str]:
    """Batch form of availability_status_for_shift for many workers against
    one shift window - two queries total regardless of how many workers or
    slots are involved, instead of up to several queries per worker (each
    touched slot used to call get_slot_status_for_shift, and that in turn
    called get_availability - itself several sequential queries - fresh every
    time). Used by coordinator.py's get_available_workers, which used to
    call availability_status_for_shift once per team member in a loop."""
    if not worker_ids:
        return {}
    zone = tz or request_timezone()
    start_local = parse_shift_datetime(scheduled_start).astimezone(zone)
    end_local = parse_shift_datetime(scheduled_end).astimezone(zone) if scheduled_end else None
    touched = _slots_touched(start_local, end_local)
    dow = start_local.isoweekday()

    raw = raw_slot_statuses_batch(worker_ids, dow, touched)
    overridden = emergency_overrides_batch(worker_ids, start_local.date().isoformat())

    out: dict[str, str] = {}
    for wid in worker_ids:
        if wid in overridden:
            out[wid] = "available"
            continue
        per_slot = raw.get(wid, {})
        out[wid] = _worst_status([per_slot.get(slot) for slot in touched])
    return out
