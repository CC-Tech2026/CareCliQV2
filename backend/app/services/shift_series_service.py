"""Regular schedules (shift series).

A series is a participant's standing arrangement: these days, these hours,
this worker (or open), every week or every second week, ongoing or until a
date. Shifts are made for the next HORIZON_DAYS and topped up by the
scheduler as days pass, so regular support doesn't run out.

Each shift made from a series carries series_id and series_date; the database
allows one per series per day, so a top-up that runs twice (two API servers,
a retry) can't double-book.

Changing a series "from a date" changes the future shifts that still look the
way the series made them. A shift someone changed by hand (other times,
another worker) is left alone, and so is anything that has started, finished
or been cancelled.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from . import agreement_support_service, roster_eligibility_service, shift_task_service
from ..core.timezone import participant_timezone
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

# How far ahead shifts exist. Long enough for workers to plan and for the
# roster to show the coming fortnight or month; short enough that changing a
# series touches a manageable number of shifts.
HORIZON_DAYS = 56
# A shift in one of these, not yet started, can still be changed or removed.
CHANGEABLE_STATUSES = ("scheduled", "unassigned", "offered")
DAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


class SeriesError(Exception):
    """Something the coordinator needs to fix (shown to them as is)."""


# ── Dates and times ───────────────────────────────────────────────────────────

def _as_date(value: Any) -> Optional[date]:
    if value is None or value == "":
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    return date.fromisoformat(str(value)[:10])


def _as_time(value: Any) -> time:
    if isinstance(value, time):
        return value
    parts = [int(p) for p in str(value).split(":")[:2]]
    return time(parts[0], parts[1])


def _parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def fits(series: dict, day: date) -> bool:
    """Whether the series has a shift on this day."""
    start = _as_date(series["start_date"])
    end = _as_date(series.get("end_date"))
    if day < start or (end is not None and day > end):
        return False
    if day.weekday() not in {int(d) for d in series["days_of_week"]}:
        return False
    anchor = start - timedelta(days=start.weekday())
    return ((day - anchor).days // 7) % max(1, int(series.get("interval_weeks") or 1)) == 0


def occurrence_dates(series: dict, first: date, last: date) -> list[date]:
    out: list[date] = []
    day = first
    while day <= last:
        if fits(series, day):
            out.append(day)
        day += timedelta(days=1)
    return out


def window(series: dict, day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """The shift's start and end in UTC: wall-clock times on that day in the
    participant's branch, past midnight when the end is at or before the start."""
    start_t, end_t = _as_time(series["start_time"]), _as_time(series["end_time"])
    start = datetime.combine(day, start_t, tzinfo=tz)
    end = datetime.combine(day, end_t, tzinfo=tz)
    if end <= start:
        end += timedelta(days=1)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def describe(series: dict) -> str:
    """"Mon, Wed, Fri 09:00 to 12:00, every 2 weeks" """
    days = ", ".join(DAY_NAMES[int(d)] for d in sorted({int(d) for d in series["days_of_week"]}))
    times = f"{_as_time(series['start_time']).strftime('%H:%M')} to {_as_time(series['end_time']).strftime('%H:%M')}"
    every = int(series.get("interval_weeks") or 1)
    return f"{days} {times}" + ("" if every == 1 else f", every {every} weeks")


def _today(tz: ZoneInfo) -> date:
    return datetime.now(tz).date()


def _is_duplicate(exc: Exception) -> bool:
    text = str(exc).lower()
    return "23505" in text or "duplicate key" in text


# ── Helpers shared with the coordinator API ───────────────────────────────────

def _coordinator():
    # The roster's own conflict check and insert, so a series books exactly
    # the way a coordinator would. Imported late: that module imports this one.
    from ..api import coordinator

    return coordinator


async def _worker_blocked(worker_id: str, org_id: str, shift_type: str) -> Optional[str]:
    """Why this worker can't be rostered at all (credentials, training), or None."""
    try:
        await roster_eligibility_service.ensure_worker_can_be_rostered(
            worker_id, org_id, shift_type, supabase=get_supabase_admin(),
        )
    except roster_eligibility_service.WorkerNotEligibleError as exc:
        return str(exc)
    return None


def _hard_conflict(supabase, worker_id: str, org_id: str, start: datetime, end: datetime, tz: ZoneInfo,
                   exclude_shift_id: Optional[str] = None) -> Optional[str]:
    conflicts = _coordinator()._detect_worker_conflicts(
        supabase, worker_id, org_id, start, end, exclude_shift_id=exclude_shift_id, tz=tz,
    )
    hard = next((c for c in conflicts if c.get("severity") == "error"), None)
    return (hard.get("message") or "Not free then") if hard else None


def _participant(supabase, participant_id: str, org_id: str) -> dict:
    rows = (
        supabase.table("participants")
        .select("id, full_name, address")
        .eq("id", participant_id)
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    ).data or []
    if not rows:
        raise SeriesError("Participant not found.")
    return rows[0]


# ── Making shifts ─────────────────────────────────────────────────────────────

async def generate(supabase, series: dict, *, through: Optional[date] = None, created_by: Optional[str] = None) -> dict:
    """Make the series' shifts from the day after generated_through (or today)
    up to `through` (default: HORIZON_DAYS ahead). A day the worker can't do
    (another shift, leave) becomes an open shift rather than being skipped.
    Returns {"created": [...], "opened": [{"date", "reason"}], "skipped": [...]}"""
    org_id = str(series["organization_id"])
    participant_id = str(series["participant_id"])
    tz = participant_timezone(participant_id, organization_id=org_id)
    today = _today(tz)
    last = through or (today + timedelta(days=HORIZON_DAYS))
    end = _as_date(series.get("end_date"))
    if end is not None:
        last = min(last, end)
    done_through = _as_date(series.get("generated_through"))
    first = max(_as_date(series["start_date"]), today, (done_through + timedelta(days=1)) if done_through else today)

    result: dict[str, list] = {"created": [], "opened": [], "skipped": []}
    if first > last:
        return result

    participant = _participant(supabase, participant_id, org_id)
    coord = _coordinator()
    care_coordinator_id = coord._resolve_care_coordinator_id(supabase, participant_id, org_id)
    gate = agreement_support_service.rostering_gate(participant_id, org_id)
    worker_id = str(series["worker_id"]) if series.get("worker_id") else None
    shift_type = series.get("shift_type") or "standard_support"
    blocked = await _worker_blocked(worker_id, org_id, shift_type) if worker_id else None
    task_ids = [str(t) for t in (series.get("selected_task_ids") or [])] or None
    now = datetime.now(timezone.utc)

    for day in occurrence_dates(series, first, last):
        if gate is not None and not agreement_support_service.covers_any(gate, day):
            result["skipped"].append({"date": day.isoformat(), "reason": "No signed service agreement covers this day"})
            continue
        start, finish = window(series, day, tz)
        if start <= now:
            continue
        reason = blocked
        if worker_id and not reason:
            reason = _hard_conflict(supabase, worker_id, org_id, start, finish, tz)
        assigned = worker_id if worker_id and not reason else None
        stamp = now.isoformat()
        payload: dict[str, Any] = {
            "id": str(uuid.uuid4()),
            "organization_id": org_id,
            "participant_id": participant_id,
            "participant_name": participant.get("full_name"),
            "participant_address": participant.get("address"),
            "shift_type": shift_type,
            "scheduled_start": start.isoformat(),
            "scheduled_end": finish.isoformat(),
            "duration_minutes": int((finish - start).total_seconds() // 60),
            "status": "scheduled" if assigned else "unassigned",
            "created_by": created_by or series.get("created_by"),
            "created_at": stamp,
            "updated_at": stamp,
            "care_coordinator_id": care_coordinator_id,
            "expected_price_item_code": series.get("expected_price_item_code"),
            "series_id": str(series["id"]),
            "series_date": day.isoformat(),
        }
        if assigned:
            payload["worker_id"] = assigned
        if series.get("service_agreement_support_id"):
            payload["service_agreement_support_id"] = str(series["service_agreement_support_id"])
        try:
            inserted = (coord._insert_shift_with_legacy_fallback(supabase, payload).data or [None])[0] or payload
        except Exception as exc:
            if _is_duplicate(exc):
                continue  # Already made (another server, or a shift kept for this day).
            logger.warning("Series %s: shift for %s not made: %s", series["id"], day, exc)
            result["skipped"].append({"date": day.isoformat(), "reason": "Couldn't be saved"})
            continue
        try:
            shift_task_service.attach_tasks_to_new_shift(
                supabase, shift={**payload, **inserted}, org_id=org_id, selected_task_ids=task_ids,
            )
        except Exception as exc:
            logger.warning("Series %s: tasks for %s not attached: %s", series["id"], day, exc)
        result["created"].append(inserted)
        if worker_id and not assigned:
            result["opened"].append({"date": day.isoformat(), "shift_id": payload["id"], "reason": reason})

    supabase.table("shift_series").update({
        "generated_through": last.isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", series["id"]).execute()
    series["generated_through"] = last.isoformat()
    return result


async def run_series_pass() -> int:
    """Scheduler: top every running series up to HORIZON_DAYS ahead."""
    supabase = get_supabase_admin()
    today = datetime.now(timezone.utc).date()
    cutoff = (today + timedelta(days=HORIZON_DAYS - 1)).isoformat()
    try:
        rows = (
            supabase.table("shift_series")
            .select("*")
            .or_(f"generated_through.is.null,generated_through.lt.{cutoff}")
            .limit(2000)
            .execute()
        ).data or []
    except Exception as exc:
        if "shift_series" in str(exc):
            return 0  # Migration 262 not run here yet.
        raise
    # Ended ones have nothing left to make.
    rows = [r for r in rows if not r.get("end_date") or _as_date(r["end_date"]) >= today]
    made = 0
    for series in rows:
        try:
            made += len((await generate(supabase, series))["created"])
        except Exception as exc:
            logger.warning("Series %s top-up failed: %s", series.get("id"), exc)
    return made


# ── Reading ───────────────────────────────────────────────────────────────────

def get_series(supabase, series_id: str, org_id: str) -> dict:
    rows = (
        supabase.table("shift_series").select("*").eq("id", series_id).eq("organization_id", org_id).limit(1).execute()
    ).data or []
    if not rows:
        raise SeriesError("Regular schedule not found.")
    return rows[0]


def list_series(supabase, org_id: str, *, participant_id: Optional[str] = None, include_ended: bool = False) -> list[dict]:
    query = supabase.table("shift_series").select("*").eq("organization_id", org_id)
    if participant_id:
        query = query.eq("participant_id", participant_id)
    rows = query.order("created_at", desc=False).limit(1000).execute().data or []
    if not include_ended:
        # "Today" in each participant's own branch, the same day stopping a
        # schedule counts from (UTC is a day behind Adelaide each morning).
        local_today: dict[str, date] = {}

        def today_for(pid: str) -> date:
            if pid not in local_today:
                local_today[pid] = _today(participant_timezone(pid, organization_id=org_id))
            return local_today[pid]

        rows = [r for r in rows if not r.get("end_date") or _as_date(r["end_date"]) >= today_for(str(r["participant_id"]))]

    people_ids = sorted({str(r["worker_id"]) for r in rows if r.get("worker_id")})
    participant_ids = sorted({str(r["participant_id"]) for r in rows})
    workers = {
        str(u["id"]): u
        for u in (
            supabase.table("users").select("id, full_name").in_("id", people_ids)
            .eq("organization_id", org_id).execute().data or []
        )
    } if people_ids else {}
    participants = {
        str(p["id"]): p
        for p in (
            supabase.table("participants").select("id, full_name").in_("id", participant_ids)
            .eq("organization_id", org_id).execute().data or []
        )
    } if participant_ids else {}

    # The next shift still to come, and how many of the coming ones are open.
    upcoming: dict[str, dict] = {}
    if rows:
        now = datetime.now(timezone.utc).isoformat()
        shifts = (
            supabase.table("shifts").select("series_id, scheduled_start, status, worker_id")
            .in_("series_id", [str(r["id"]) for r in rows]).gte("scheduled_start", now)
            .neq("status", "cancelled").order("scheduled_start").limit(5000).execute().data or []
        )
        for s in shifts:
            entry = upcoming.setdefault(str(s["series_id"]), {"next_start": s["scheduled_start"], "open": 0, "count": 0})
            entry["count"] += 1
            if not s.get("worker_id"):
                entry["open"] += 1

    out = []
    for r in rows:
        w = workers.get(str(r.get("worker_id"))) if r.get("worker_id") else None
        info = upcoming.get(str(r["id"]), {})
        out.append({
            **r,
            "summary": describe(r),
            "participant_name": (participants.get(str(r["participant_id"])) or {}).get("full_name") or "Participant",
            "worker_name": (w or {}).get("full_name"),
            "next_start": info.get("next_start"),
            # The participant's zone: the schedule's times are on that clock.
            "timezone": str(participant_timezone(str(r["participant_id"]), organization_id=org_id)),
            "upcoming_count": info.get("count", 0),
            "upcoming_open": info.get("open", 0),
        })
    return out


# ── Creating, changing, ending ────────────────────────────────────────────────

def _clean_days(days: list[int]) -> list[int]:
    cleaned = sorted({int(d) for d in days if 0 <= int(d) <= 6})
    if not cleaned:
        raise SeriesError("Pick at least one day.")
    return cleaned


async def create_series(supabase, org_id: str, user_id: Optional[str], data: dict) -> dict:
    participant_id = str(data["participant_id"])
    _participant(supabase, participant_id, org_id)
    start_date = _as_date(data["start_date"])
    end_date = _as_date(data.get("end_date"))
    if end_date is not None and end_date < start_date:
        raise SeriesError("The end date is before the start date.")
    shift_type = (data.get("shift_type") or "standard_support").strip().lower()
    worker_id = data.get("worker_id") or None
    if worker_id:
        why = await _worker_blocked(str(worker_id), org_id, shift_type)
        if why:
            raise SeriesError(why)
    expected = data.get("expected_price_item_code")
    line_id = data.get("service_agreement_support_id")
    if line_id:
        line = agreement_support_service.resolve_line_for_shift(
            supabase, line_id=str(line_id), participant_id=participant_id, org_id=org_id,
        )
        expected = expected or line["support_item_code"]
    row = {
        "id": str(uuid.uuid4()),
        "organization_id": org_id,
        "participant_id": participant_id,
        "worker_id": worker_id,
        "days_of_week": _clean_days(data["days_of_week"]),
        "start_time": _as_time(data["start_time"]).strftime("%H:%M"),
        "end_time": _as_time(data["end_time"]).strftime("%H:%M"),
        "interval_weeks": int(data.get("interval_weeks") or 1),
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat() if end_date else None,
        "shift_type": shift_type,
        "expected_price_item_code": expected,
        "service_agreement_support_id": str(line_id) if line_id else None,
        "selected_task_ids": [str(t) for t in (data.get("selected_task_ids") or [])],
        "created_by": user_id,
    }
    if row["start_time"] == row["end_time"]:
        raise SeriesError("The shift starts and ends at the same time.")
    series = (supabase.table("shift_series").insert(row).execute().data or [row])[0]
    made = await generate(supabase, series, created_by=user_id)
    if worker_id and made["created"]:
        await _notify(supabase, str(worker_id), org_id, "Regular shifts assigned",
                      f"You've been given regular shifts: {describe(series)}. They're in your schedule.")
    return {"series": series, **_counts(made)}


def _counts(made: dict) -> dict:
    return {
        "created_count": len(made["created"]),
        "opened": made["opened"],
        "skipped": made["skipped"],
    }


def _untouched_future(supabase, series: dict, from_date: date, tz: ZoneInfo) -> tuple[list[dict], int]:
    """The series' shifts from from_date that haven't started and still look
    the way the series made them; and how many others were changed by hand."""
    rows = (
        supabase.table("shifts")
        .select("id, worker_id, status, scheduled_start, scheduled_end, series_date, shift_type")
        .eq("series_id", str(series["id"]))
        .gte("series_date", from_date.isoformat())
        .limit(2000)
        .execute()
    ).data or []
    now = datetime.now(timezone.utc)
    start_t, end_t = _as_time(series["start_time"]), _as_time(series["end_time"])
    worker = str(series["worker_id"]) if series.get("worker_id") else None
    untouched, by_hand = [], 0
    for r in rows:
        start, end = _parse_dt(r.get("scheduled_start")), _parse_dt(r.get("scheduled_end"))
        if r.get("status") not in CHANGEABLE_STATUSES or not start or start <= now:
            continue
        same_times = (
            start.astimezone(tz).time().replace(second=0, microsecond=0) == start_t
            and end is not None and end.astimezone(tz).time().replace(second=0, microsecond=0) == end_t
        )
        # A day the worker couldn't do is made open; that's still the series' doing.
        same_worker = (str(r["worker_id"]) if r.get("worker_id") else None) in (worker, None)
        if same_times and same_worker:
            untouched.append(r)
        else:
            by_hand += 1
    return untouched, by_hand


async def change_series(supabase, org_id: str, series_id: str, from_date: date, changes: dict,
                        user_id: Optional[str] = None) -> dict:
    """Apply changes to the series from from_date: the shifts it made from then
    on move to the new days, times or worker; ones changed by hand stay put."""
    old = get_series(supabase, series_id, org_id)
    tz = participant_timezone(str(old["participant_id"]), organization_id=org_id)
    from_date = max(from_date, _today(tz))
    if not changes:
        # Nothing to change: no shifts rewritten and no one told anything.
        made = await generate(supabase, old, created_by=user_id)
        return {"series": old, "updated_count": 0, "removed_count": 0, "created_count": len(made["created"]),
                "left_alone_count": 0, "opened": made["opened"], "skipped": made["skipped"]}
    new = dict(old)
    for key in ("worker_id", "start_time", "end_time", "interval_weeks", "end_date", "shift_type",
                "expected_price_item_code"):
        if key in changes:
            new[key] = changes[key]
    if "days_of_week" in changes:
        new["days_of_week"] = _clean_days(changes["days_of_week"])
    if "start_time" in changes:
        new["start_time"] = _as_time(new["start_time"]).strftime("%H:%M")
    if "end_time" in changes:
        new["end_time"] = _as_time(new["end_time"]).strftime("%H:%M")
    if new["start_time"] == new["end_time"]:
        raise SeriesError("The shift starts and ends at the same time.")
    new["worker_id"] = new.get("worker_id") or None
    new_worker = str(new["worker_id"]) if new.get("worker_id") else None
    old_worker = str(old["worker_id"]) if old.get("worker_id") else None
    shift_type = new.get("shift_type") or "standard_support"
    if new_worker and new_worker != old_worker:
        why = await _worker_blocked(new_worker, org_id, shift_type)
        if why:
            raise SeriesError(why)

    untouched, by_hand = _untouched_future(supabase, old, from_date, tz)
    stamp = datetime.now(timezone.utc).isoformat()
    updated = removed = 0
    opened: list[dict] = []
    for shift in untouched:
        day = _as_date(shift["series_date"])
        if not fits(new, day):
            supabase.table("shifts").delete().eq("id", shift["id"]).execute()
            removed += 1
            continue
        start, finish = window(new, day, tz)
        reason = None
        if new_worker:
            reason = _hard_conflict(supabase, new_worker, org_id, start, finish, tz, exclude_shift_id=shift["id"])
        patch: dict[str, Any] = {
            "scheduled_start": start.isoformat(),
            "scheduled_end": finish.isoformat(),
            "duration_minutes": int((finish - start).total_seconds() // 60),
            "shift_type": shift_type,
            "worker_id": new_worker if new_worker and not reason else None,
            "status": "scheduled" if new_worker and not reason else "unassigned",
            "updated_at": stamp,
        }
        if "expected_price_item_code" in changes:
            patch["expected_price_item_code"] = new.get("expected_price_item_code")
        supabase.table("shifts").update(patch).eq("id", shift["id"]).execute()
        updated += 1
        if new_worker and reason:
            opened.append({"date": day.isoformat(), "shift_id": shift["id"], "reason": reason})

    # Save the new pattern, then make any days it adds (from from_date up to
    # where shifts had already been made, and on to the usual horizon).
    done_through = _as_date(old.get("generated_through"))
    restart = from_date - timedelta(days=1)
    row_patch = {k: new[k] for k in ("worker_id", "days_of_week", "start_time", "end_time", "interval_weeks",
                                      "end_date", "shift_type", "expected_price_item_code")}
    row_patch["updated_at"] = stamp
    if done_through is None or restart < done_through:
        row_patch["generated_through"] = restart.isoformat()
    supabase.table("shift_series").update(row_patch).eq("id", series_id).execute()
    new.update(row_patch)
    made = await generate(supabase, new, created_by=user_id)
    opened += made["opened"]

    if old_worker and old_worker != new_worker:
        await _notify(supabase, old_worker, org_id, "Regular shifts changed",
                      f"Your regular shifts ({describe(old)}) are with someone else from {_day_text(from_date)}.")
    if new_worker and (new_worker != old_worker):
        await _notify(supabase, new_worker, org_id, "Regular shifts assigned",
                      f"You've been given regular shifts from {_day_text(from_date)}: {describe(new)}.")
    elif new_worker and (updated or removed or made["created"]):
        await _notify(supabase, new_worker, org_id, "Regular shifts changed",
                      f"From {_day_text(from_date)} your regular shifts are {describe(new)}.")
    return {
        "series": new,
        "updated_count": updated,
        "removed_count": removed,
        "created_count": len(made["created"]),
        "left_alone_count": by_hand,
        "opened": opened,
        "skipped": made["skipped"],
    }


async def end_series(supabase, org_id: str, series_id: str, from_date: date) -> dict:
    """Stop the series: no shifts from from_date on. Shifts it made from then
    that haven't started are removed, unless someone changed them by hand."""
    series = get_series(supabase, series_id, org_id)
    tz = participant_timezone(str(series["participant_id"]), organization_id=org_id)
    from_date = max(from_date, _today(tz))
    untouched, by_hand = _untouched_future(supabase, series, from_date, tz)
    for shift in untouched:
        supabase.table("shifts").delete().eq("id", shift["id"]).execute()
    end_date = from_date - timedelta(days=1)
    supabase.table("shift_series").update({
        "end_date": end_date.isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", series_id).execute()
    if series.get("worker_id") and untouched:
        await _notify(supabase, str(series["worker_id"]), org_id, "Regular shifts ended",
                      f"Your regular shifts ({describe(series)}) stop from {_day_text(from_date)}.")
    return {"removed_count": len(untouched), "left_alone_count": by_hand, "end_date": end_date.isoformat()}


def _day_text(day: date) -> str:
    return f"{DAY_NAMES[day.weekday()]} {day.day} {day.strftime('%b')}"


async def _notify(supabase, user_id: str, org_id: str, title: str, body: str) -> None:
    await _coordinator()._send_worker_notification(supabase, user_id, org_id, "shift_assigned", None, title, body)
