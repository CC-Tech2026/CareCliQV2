"""Shifts that need cover because the worker is on leave.

A worker's leave (worker_blackout_dates) is entered by a coordinator, by the
worker in the app, or by approving their time-off request. Any shift still
rostered to them on one of those days, from now on, needs someone else. This
finds them across the organisation (or for one worker), and releases chosen
ones back to open shifts so they can be filled or offered.

Days are the shift's own local day (the participant's branch), the same day a
coordinator sees it on the roster.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from ..core.timezone import participant_timezone
from . import audit_service

logger = logging.getLogger(__name__)

# Rostered and not started. Offered shifts are waiting on someone else's yes,
# and anything started, done or cancelled is past changing.
NEEDS_COVER_STATUSES = ("scheduled",)
_CHUNK = 150


def _as_date(value: Any) -> Optional[date]:
    try:
        return date.fromisoformat(str(value)[:10]) if value else None
    except ValueError:
        return None


def _parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _staff_ids(org_id: str) -> list[str]:
    from ..api.coordinator import _org_staff_ids  # late: that module imports services

    return sorted(_org_staff_ids(org_id))


def _rows(query) -> list[dict]:
    return [r for r in (query.execute().data or []) if isinstance(r, dict)]


def find_clashes(supabase, org_id: str, *, worker_id: Optional[str] = None) -> list[dict]:
    """Every coming shift rostered to someone on a day they're on leave,
    soonest first, each with the leave it falls in."""
    workers = [worker_id] if worker_id else _staff_ids(org_id)
    if not workers:
        return []
    # A day's margin either side of UTC; the exact local day is checked below.
    since = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    leave: dict[str, list[dict]] = {}
    for i in range(0, len(workers), _CHUNK):
        for row in _rows(
            supabase.table("worker_blackout_dates")
            .select("user_id, start_date, end_date, reason")
            .in_("user_id", workers[i:i + _CHUNK])
            .gte("end_date", since)
        ):
            leave.setdefault(str(row["user_id"]), []).append(row)
    if not leave:
        return []

    now = datetime.now(timezone.utc)
    latest = max(_as_date(r["end_date"]) for rows in leave.values() for r in rows if _as_date(r["end_date"]))
    until = (datetime.combine(latest, datetime.min.time(), timezone.utc) + timedelta(days=2)).isoformat()
    on_leave = sorted(leave)
    shifts: list[dict] = []
    for i in range(0, len(on_leave), _CHUNK):
        shifts += _rows(
            supabase.table("shifts")
            .select("id, organization_id, worker_id, participant_id, participant_name, scheduled_start, scheduled_end, status")
            .eq("organization_id", org_id)
            .in_("worker_id", on_leave[i:i + _CHUNK])
            .in_("status", list(NEEDS_COVER_STATUSES))
            .gte("scheduled_start", now.isoformat())
            .lte("scheduled_start", until)
        )
    if not shifts:
        return []

    zones: dict[str, Any] = {}
    out: list[dict] = []
    for s in shifts:
        start = _parse_dt(s.get("scheduled_start"))
        if not start:
            continue
        pid = str(s.get("participant_id") or "")
        if pid not in zones:
            zones[pid] = participant_timezone(pid or s, organization_id=org_id)
        tz = zones[pid]
        day = start.astimezone(tz).date()
        hit = next(
            (b for b in leave.get(str(s["worker_id"]), [])
             if _as_date(b["start_date"]) and _as_date(b["end_date"]) and _as_date(b["start_date"]) <= day <= _as_date(b["end_date"])),
            None,
        )
        if hit:
            out.append({
                "day": day.isoformat(),
                "shift_id": s["id"],
                "worker_id": str(s["worker_id"]),
                "participant_id": s.get("participant_id"),
                "participant_name": s.get("participant_name") or "Participant",
                "scheduled_start": s["scheduled_start"],
                "scheduled_end": s.get("scheduled_end"),
                "timezone": str(tz),
                "leave": {"start_date": str(hit["start_date"])[:10], "end_date": str(hit["end_date"])[:10], "reason": hit.get("reason")},
            })
    if not out:
        return []

    _add_details(supabase, org_id, out)
    out.sort(key=lambda c: c["scheduled_start"])
    return out


def _add_details(supabase, org_id: str, clashes: list[dict]) -> None:
    """Worker names, and which regular schedule made each shift (if the
    database has migration 262; without it, none did)."""
    ids = sorted({c["worker_id"] for c in clashes})
    names = {
        str(u["id"]): u.get("full_name")
        for u in _rows(supabase.table("users").select("id, full_name").in_("id", ids).eq("organization_id", org_id))
    }
    series: dict[str, Any] = {}
    try:
        shift_ids = [c["shift_id"] for c in clashes]
        for i in range(0, len(shift_ids), _CHUNK):
            for r in _rows(supabase.table("shifts").select("id, series_id").in_("id", shift_ids[i:i + _CHUNK])):
                series[str(r["id"])] = r.get("series_id")
    except Exception:
        series = {}
    for c in clashes:
        c["worker_name"] = names.get(c["worker_id"]) or "Worker"
        c["series_id"] = series.get(str(c["shift_id"]))


def count_for_worker(supabase, org_id: str, worker_id: str, *, within: Optional[tuple[str, str]] = None) -> int:
    """How many of their coming shifts fall in their leave; `within` (start,
    end) counts only shifts in those days, e.g. leave just approved."""
    try:
        clashes = find_clashes(supabase, org_id, worker_id=worker_id)
        if within:
            first, last = within
            clashes = [c for c in clashes if first <= c["day"] <= last]
        return len(clashes)
    except Exception as exc:
        logger.warning("Leave clash count for %s failed: %s", worker_id, exc)
        return 0


async def release(supabase, org_id: str, shift_ids: list[str], user_id: Optional[str]) -> dict:
    """Make the chosen shifts open shifts. Only ones that still clash with the
    worker's leave are released (a shift reassigned or started meanwhile is
    left alone); each worker hears once, with how many."""
    clashes = {str(c["shift_id"]): c for c in find_clashes(supabase, org_id)}
    released: list[dict] = []
    skipped: list[dict] = []
    stamp = datetime.now(timezone.utc).isoformat()
    for sid in dict.fromkeys(str(s) for s in shift_ids):
        clash = clashes.get(sid)
        if not clash:
            skipped.append({"shift_id": sid, "reason": "No longer clashes with leave"})
            continue
        (
            supabase.table("shifts")
            .update({"worker_id": None, "status": "unassigned", "cannot_attend_reason": None, "updated_at": stamp})
            .eq("id", sid)
            .eq("worker_id", clash["worker_id"])
            .eq("status", "scheduled")
            .execute()
        )
        released.append(clash)
        try:
            await audit_service.log_action(
                action_type="coordinator.shift.released_for_leave",
                entity_type="shift",
                entity_id=sid,
                user_id=user_id,
                organization_id=org_id,
                before_state={"worker_id": clash["worker_id"], "status": "scheduled"},
                after_state={"worker_id": None, "status": "unassigned"},
                details={"leave": clash["leave"], "scheduled_start": clash["scheduled_start"]},
            )
        except Exception as exc:
            logger.warning("Audit for released shift %s failed: %s", sid, exc)

    by_worker: dict[str, list[dict]] = {}
    for c in released:
        by_worker.setdefault(c["worker_id"], []).append(c)
    for worker_id, items in by_worker.items():
        n = len(items)
        try:
            supabase.table("worker_notifications").insert({
                "user_id": worker_id,
                "organization_id": org_id,
                "type": "shift_unassigned",
                "shift_id": items[0]["shift_id"] if n == 1 else None,
                "title": "Shifts during your leave",
                "body": f"{n} shift{'' if n == 1 else 's'} during your leave {'has' if n == 1 else 'have'} been handed on for someone else to cover.",
            }).execute()
        except Exception as exc:
            logger.warning("Leave release notice to %s failed: %s", worker_id, exc)
    return {"released_count": len(released), "skipped": skipped}


def reason_label(code: Optional[str]) -> str:
    """"annual_leave" -> "Annual leave", for the leave entry an approval makes."""
    text = (code or "time_off").replace("_", " ").strip()
    return text[:1].upper() + text[1:]
