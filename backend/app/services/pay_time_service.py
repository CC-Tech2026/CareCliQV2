"""Paid time: the hours a worker is paid for, kept apart from billed time.

Billing caps a shift at the rostered time unless a coordinator approves the
extra (shift_verification_service.billable_minutes): that's what the NDIS
plan pays for. Wages don't work that way. A worker who stays 40 minutes late
to settle a participant is paid for the 40 minutes whether or not they can be
billed. So paid time is clock-in to clock-out, never capped at the roster.

CareCliQ only works out *when* the worker worked. The provider's payroll
system (Employment Hero, Xero, ...) works out what that's worth under the
SCHADS award: loadings, overtime, sleepover allowance, minimum engagement.

A shift with a sleepover becomes separate periods: active work before, the
sleepover itself, any call-outs during it (active work again), and active
work after. Payroll needs these apart; the sleepover is not ordinary hours.

Breaks recorded in the worker app are passed on as recorded. Whether they're
paid is the provider's setting: the app records a "meal/rest" break and
can't tell a paid rest break from an unpaid meal break.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from ..core.timezone import parse_shift_datetime
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

ACTIVE = "active"
SLEEPOVER = "sleepover"


def _dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = parse_shift_datetime(value) if not isinstance(value, datetime) else value
    except Exception:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _minutes(start: datetime, end: datetime) -> float:
    return max(0.0, (end - start).total_seconds() / 60)


def _clip(start: datetime, end: datetime, lo: datetime, hi: datetime) -> Optional[tuple[datetime, datetime]]:
    s, e = max(start, lo), min(end, hi)
    return (s, e) if e > s else None


def paid_time(shift: dict[str, Any], breaks: list[dict] | None = None, segments: list[dict] | None = None) -> dict[str, Any]:
    """When the worker worked, as periods payroll can take.

    Returns start/end (UTC), where they came from ("clock" or "roster"),
    worked minutes, minutes over the roster, the breaks inside the shift,
    and `periods`: [{"kind": "active"|"sleepover", "start", "end", "minutes"}]
    in time order. Raises ValueError when there's no time to pay."""
    clock_in, clock_out = _dt(shift.get("clocked_in_at")), _dt(shift.get("clocked_out_at"))
    sched_start, sched_end = _dt(shift.get("scheduled_start")), _dt(shift.get("scheduled_end"))
    if clock_in and clock_out and clock_out > clock_in:
        start, end, source = clock_in, clock_out, "clock"
    elif sched_start and sched_end and sched_end > sched_start:
        start, end, source = sched_start, sched_end, "roster"
    else:
        raise ValueError("The shift has no clock or rostered times to pay.")

    # Sleepover window and call-outs during it, clipped to the time worked.
    sleep = None
    call_outs: list[tuple[datetime, datetime]] = []
    for seg in segments or []:
        s, e = _dt(seg.get("segment_start")), _dt(seg.get("segment_end"))
        if not s or not e or e <= s:
            continue
        kind = seg.get("segment_type")
        if kind == "sleepover_block" and shift.get("is_sleepover", True):
            sleep = _clip(s, e, start, end)
        elif kind == "call_out":
            clipped = _clip(s, e, start, end)
            if clipped:
                call_outs.append(clipped)

    periods: list[dict[str, Any]] = []

    def add(kind: str, s: datetime, e: datetime) -> None:
        if e <= s:
            return
        if periods and periods[-1]["kind"] == kind and periods[-1]["end"] == s:
            periods[-1]["end"] = e
        else:
            periods.append({"kind": kind, "start": s, "end": e})

    if sleep:
        add(ACTIVE, start, sleep[0])
        cursor = sleep[0]
        for s, e in sorted(c for c in (_clip(a, b, *sleep) for a, b in call_outs) if c):
            if s > cursor:
                add(SLEEPOVER, cursor, s)
            add(ACTIVE, max(s, cursor), e)
            cursor = max(cursor, e)
        add(SLEEPOVER, cursor, sleep[1])
        add(ACTIVE, sleep[1], end)
    else:
        add(ACTIVE, start, end)
    for p in periods:
        p["minutes"] = round(_minutes(p["start"], p["end"]), 1)

    taken = []
    for b in breaks or []:
        s, e = _dt(b.get("break_start_at")), _dt(b.get("break_end_at"))
        clipped = _clip(s, e, start, end) if s and e else None
        if clipped:
            taken.append({"start": clipped[0], "end": clipped[1], "minutes": round(_minutes(*clipped), 1)})
    taken.sort(key=lambda b: b["start"])

    worked = _minutes(start, end)
    scheduled = _minutes(sched_start, sched_end) if sched_start and sched_end and sched_end > sched_start else None
    return {
        "start": start,
        "end": end,
        "source": source,
        "worked_minutes": round(worked, 1),
        "scheduled_minutes": round(scheduled, 1) if scheduled is not None else None,
        "over_roster_minutes": round(max(0.0, worked - scheduled), 1) if scheduled is not None else 0,
        "break_minutes": round(sum(b["minutes"] for b in taken), 1),
        "breaks": taken,
        "periods": periods,
    }


def load_facts(shift_id: str) -> tuple[list[dict], list[dict]]:
    """The shift's recorded breaks (finished ones) and sleepover segments.
    Empty lists when they can't be read, so paid time still works."""
    db = get_supabase_admin()
    breaks: list[dict] = []
    segments: list[dict] = []
    try:
        breaks = (
            db.table("shift_breaks").select("break_start_at, break_end_at")
            .eq("shift_id", shift_id).not_.is_("break_end_at", "null").execute().data
        ) or []
    except Exception as exc:
        logger.info("Breaks not read for shift %s: %s", shift_id, exc)
    try:
        segments = (
            db.table("shift_segments").select("segment_type, segment_start, segment_end")
            .eq("shift_id", shift_id).execute().data
        ) or []
    except Exception as exc:
        logger.info("Sleepover segments not read for shift %s: %s", shift_id, exc)
    return breaks, segments


def for_shift(shift: dict[str, Any]) -> dict[str, Any]:
    breaks, segments = load_facts(str(shift["id"]))
    return paid_time(shift, breaks, segments)


def to_record(pay: dict[str, Any]) -> dict[str, Any]:
    """JSON-safe copy, for the approval's checks_run snapshot."""
    def iso(d: datetime) -> str:
        return d.astimezone(timezone.utc).isoformat()

    return {
        **{k: v for k, v in pay.items() if k not in ("start", "end", "breaks", "periods")},
        "start": iso(pay["start"]),
        "end": iso(pay["end"]),
        "breaks": [{**b, "start": iso(b["start"]), "end": iso(b["end"])} for b in pay["breaks"]],
        "periods": [{**p, "start": iso(p["start"]), "end": iso(p["end"])} for p in pay["periods"]],
    }


def from_record(record: dict[str, Any]) -> dict[str, Any]:
    """Back from the snapshot, with datetimes."""
    def dt(v: str) -> datetime:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))

    return {
        **record,
        "start": dt(record["start"]),
        "end": dt(record["end"]),
        "breaks": [{**b, "start": dt(b["start"]), "end": dt(b["end"])} for b in record.get("breaks") or []],
        "periods": [{**p, "start": dt(p["start"]), "end": dt(p["end"])} for p in record.get("periods") or []],
    }
