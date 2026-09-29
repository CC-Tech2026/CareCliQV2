"""Participant demand vs. staff capacity for the MD hub.

Replaces the hub's placeholder numbers with figures computed from real data:

- Waiting list: participant intakes still at the "enquiry" stage (new
  enquiries not yet screened) and the weekly hours they've requested.
- Available hours this week: for each active support worker, their stated
  maximum weekly hours (worker_availability.max_hours_per_week), reduced for
  any unavailability days this week, minus hours already rostered. Split by
  how reliable that capacity is: part-time/full-time staff are "reliable",
  casual staff (or anyone without an employment type) are "casual", since
  their hours aren't guaranteed.

Workers who haven't set their availability are counted, not guessed at.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any, Iterable

from ..core.timezone import app_today, request_timezone
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

RELIABLE_EMPLOYMENT_TYPES = frozenset({"part_time", "full_time"})
CANCELLED_SHIFT_STATUSES = frozenset({"cancelled"})


@dataclass(frozen=True)
class WorkerCapacity:
    reliable_hours: float
    casual_hours: float
    workers_counted: int
    workers_without_availability: int


def week_bounds(today: date) -> tuple[date, date]:
    """Monday–Sunday week containing ``today``."""
    start = today - timedelta(days=today.weekday())
    return start, start + timedelta(days=6)


def _parse_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _shift_hours(shift: dict) -> float:
    minutes = shift.get("duration_minutes")
    if minutes is not None:
        try:
            return max(0.0, float(minutes) / 60)
        except (TypeError, ValueError):
            pass
    try:
        start = datetime.fromisoformat(str(shift["scheduled_start"]).replace("Z", "+00:00"))
        end = datetime.fromisoformat(str(shift["scheduled_end"]).replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError):
        return 0.0
    return max(0.0, (end - start).total_seconds() / 3600)


def waitlist_summary(intakes: Iterable[dict]) -> dict[str, float]:
    enquiries = [i for i in intakes if i.get("status") == "enquiry"]
    hours = 0.0
    for intake in enquiries:
        try:
            hours += max(0.0, float(intake.get("service_hours_required") or 0))
        except (TypeError, ValueError):
            continue
    return {"count": len(enquiries), "hours": round(hours, 1)}


def compute_capacity(
    workers: Iterable[dict],
    availability: dict[str, dict],
    shifts: Iterable[dict],
    blackouts: Iterable[dict],
    week_start: date,
) -> WorkerCapacity:
    """Spare rostered capacity for the week starting ``week_start``.

    ``availability`` maps user_id -> worker_availability row. ``shifts`` are
    that week's shifts; ``blackouts`` are worker_blackout_dates rows that may
    overlap it."""
    week_days = [week_start + timedelta(days=i) for i in range(7)]
    rostered: dict[str, float] = defaultdict(float)
    for shift in shifts:
        worker_id = str(shift.get("worker_id") or "")
        if worker_id and shift.get("status") not in CANCELLED_SHIFT_STATUSES:
            rostered[worker_id] += _shift_hours(shift)

    blackout_days: dict[str, set[date]] = defaultdict(set)
    for row in blackouts:
        start, end = _parse_date(row.get("start_date")), _parse_date(row.get("end_date"))
        if not start or not end:
            continue
        for day in week_days:
            if start <= day <= end:
                blackout_days[str(row.get("user_id"))].add(day)

    reliable = casual = 0.0
    counted = without = 0
    for worker in workers:
        worker_id = str(worker.get("id"))
        avail = availability.get(worker_id)
        if not avail:
            without += 1
            continue
        counted += 1
        max_hours = float(avail.get("max_hours_per_week") or 0)
        # ISO weekday numbers (1 = Monday) the worker says they're available.
        available_days = {int(d) for d in (avail.get("available_days") or []) if str(d).isdigit()}
        if available_days:
            open_days = [d for d in week_days if d.isoweekday() in available_days]
            unavailable = [d for d in open_days if d in blackout_days.get(worker_id, set())]
            if open_days:
                max_hours *= (len(open_days) - len(unavailable)) / len(open_days)
        spare = max(0.0, max_hours - rostered.get(worker_id, 0.0))
        if (worker.get("employment_type") or "") in RELIABLE_EMPLOYMENT_TYPES:
            reliable += spare
        else:
            casual += spare
    return WorkerCapacity(
        reliable_hours=round(reliable, 1),
        casual_hours=round(casual, 1),
        workers_counted=counted,
        workers_without_availability=without,
    )


def _rows(query) -> list[dict]:
    try:
        return [r for r in (query.execute().data or []) if isinstance(r, dict)]
    except Exception as exc:  # a missing optional table shouldn't take the hub down
        logger.warning("demand/capacity query failed: %s", exc)
        return []


def get_demand_capacity(org_id: str) -> dict[str, Any]:
    supabase = get_supabase_admin()
    week_start, week_end = week_bounds(app_today())
    # Week boundaries on the office's clock, not midnight UTC.
    tz = request_timezone()
    week_start_at = datetime.combine(week_start, time.min, tzinfo=tz)
    week_end_at = datetime.combine(week_end + timedelta(days=1), time.min, tzinfo=tz)

    intakes = _rows(
        supabase.table("participant_intakes")
        .select("status, service_hours_required")
        .eq("organization_id", org_id)
        .eq("status", "enquiry")
    )
    workers = _rows(
        supabase.table("users")
        .select("id, employment_type")
        .eq("organization_id", org_id)
        .eq("role", "support_worker")
        .eq("is_active", True)
    )
    worker_ids = [str(w["id"]) for w in workers if w.get("id")]
    availability: dict[str, dict] = {}
    shifts: list[dict] = []
    blackouts: list[dict] = []
    if worker_ids:
        availability = {
            str(r["user_id"]): r
            for r in _rows(
                supabase.table("worker_availability")
                .select("user_id, available_days, max_hours_per_week")
                .in_("user_id", worker_ids)
            )
        }
        shifts = _rows(
            supabase.table("shifts")
            .select("worker_id, status, scheduled_start, scheduled_end, duration_minutes")
            .eq("organization_id", org_id)
            .gte("scheduled_start", week_start_at.isoformat())
            .lt("scheduled_start", week_end_at.isoformat())
        )
        blackouts = _rows(
            supabase.table("worker_blackout_dates")
            .select("user_id, start_date, end_date")
            .in_("user_id", worker_ids)
            .lte("start_date", week_end.isoformat())
            .gte("end_date", week_start.isoformat())
        )

    capacity = compute_capacity(workers, availability, shifts, blackouts, week_start)
    return {
        "waitlist": waitlist_summary(intakes),
        "capacity": {
            "reliable_hours": capacity.reliable_hours,
            "casual_hours": capacity.casual_hours,
            "workers_counted": capacity.workers_counted,
            "workers_without_availability": capacity.workers_without_availability,
            "week_start": week_start.isoformat(),
        },
    }
