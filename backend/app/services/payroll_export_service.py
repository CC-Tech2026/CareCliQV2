"""Timesheets for payroll: a pay period's approved shifts, ready for any
payroll system.

CareCliQ doesn't calculate wages. For each approved shift this gives the
time worked (pay_time_service: clock-in to clock-out, never capped at the
roster the way billing is), split into active work and sleepover, with the
breaks taken and any approved travel. The provider's payroll system applies
the award.

Two ways out:
- The "Timesheets for payroll" page lists them by worker, with what's still
  waiting for approval and, when Employment Hero is connected, whether each
  shift reached it.
- A CSV, one row per period of work, for any payroll system or a bookkeeper.

Participants appear as initials only: payroll doesn't need their names.
"""

from __future__ import annotations

import csv
import io
import logging
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Iterable, Optional

from ..core.timezone import parse_shift_datetime, participant_timezone
from . import pay_time_service
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

MAX_DAYS = 62
CHUNK = 200
DB_PAGE = 1000
SHIFT_COLUMNS = (
    "id, organization_id, participant_id, participant_name, worker_id, scheduled_start, scheduled_end, "
    "clocked_in_at, clocked_out_at, status, is_sleepover"
)


class PeriodError(ValueError):
    """The dates asked for don't make a pay period."""


def check_period(start: date, end: date) -> None:
    if end < start:
        raise PeriodError("The period has to end on or after the day it starts.")
    if (end - start).days + 1 > MAX_DAYS:
        raise PeriodError(f"Choose a period of {MAX_DAYS} days or less.")


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------

def _all(make_query, order: str = "id") -> list[dict]:
    """Every row, a page at a time: Supabase stops at 1,000 without saying so."""
    rows: list[dict] = []
    offset = 0
    while True:
        page = make_query().order(order).range(offset, offset + DB_PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < DB_PAGE:
            return rows
        offset += DB_PAGE


def _chunks(ids: list[str]) -> Iterable[list[str]]:
    for i in range(0, len(ids), CHUNK):
        yield ids[i:i + CHUNK]


def _by_ids(table: str, columns: str, key: str, ids: list[str], **eq: Any) -> list[dict]:
    """Rows whose `key` is one of `ids`, read in chunks (long URLs fail).
    Empty when the table can't be read, so one missing feature doesn't
    stop the page."""
    db = get_supabase_admin()
    out: list[dict] = []
    try:
        for chunk in _chunks(sorted(set(ids))):
            query = db.table(table).select(columns).in_(key, chunk)
            for k, v in eq.items():
                query = query.eq(k, v)
            out.extend(query.execute().data or [])
    except Exception as exc:
        logger.info("Payroll timesheets: %s not read: %s", table, exc)
        return []
    return out


def _local_date(shift: dict, tz) -> Optional[date]:
    raw = shift.get("scheduled_start") or shift.get("clocked_in_at")
    if not raw:
        return None
    try:
        return parse_shift_datetime(raw).astimezone(tz).date()
    except Exception:
        return None


def _finished(shift: dict) -> bool:
    status = str(shift.get("status") or "").lower()
    if "cancel" in status:
        return False
    return bool(shift.get("clocked_out_at")) or status == "completed"


def _initials(name: Any) -> str:
    parts = str(name or "").split()
    if not parts:
        return ""
    return parts[0] if len(parts) == 1 else f"{parts[0]} {parts[-1][0]}."


def _shifts_in_period(org_id: str, start: date, end: date) -> list[tuple[dict, Any, date]]:
    """Shifts whose local date is in the period, with their zone and date.
    Read with a day either side in UTC, then filtered by local date."""
    lo = datetime.combine(start - timedelta(days=1), time.min, tzinfo=timezone.utc).isoformat()
    hi = datetime.combine(end + timedelta(days=2), time.min, tzinfo=timezone.utc).isoformat()
    db = get_supabase_admin()
    rows = _all(
        lambda: db.table("shifts").select(SHIFT_COLUMNS).eq("organization_id", org_id)
        .gte("scheduled_start", lo).lt("scheduled_start", hi)
    )
    out = []
    for shift in rows:
        tz = participant_timezone(shift, organization_id=org_id)
        day = _local_date(shift, tz)
        if day and start <= day <= end:
            out.append((shift, tz, day))
    return out


def _payroll_status(org_id: str, shift_ids: list[str]) -> tuple[bool, dict[str, dict]]:
    """Whether Employment Hero is connected, and each shift's state there."""
    db = get_supabase_admin()
    try:
        connected = bool(
            db.table("employment_hero_connections").select("organization_id")
            .eq("organization_id", org_id).limit(1).execute().data
        )
    except Exception:
        return False, {}
    if not connected:
        return False, {}
    rows = _by_ids("employment_hero_timesheets", "shift_id, status, error", "shift_id", shift_ids, organization_id=org_id)
    return True, {str(r["shift_id"]): r for r in rows}


# ---------------------------------------------------------------------------
# The period
# ---------------------------------------------------------------------------

def _local_iso(d: datetime, tz) -> str:
    return d.astimezone(tz).replace(tzinfo=None).isoformat(timespec="minutes")


def _local_or_none(raw: Any, tz) -> Optional[str]:
    if not raw:
        return None
    try:
        return _local_iso(parse_shift_datetime(raw), tz)
    except Exception:
        return None


def period(org_id: str, start: date, end: date) -> dict[str, Any]:
    """Every approved shift worked in the period, and the finished shifts
    still waiting for approval."""
    check_period(start, end)
    in_period = _shifts_in_period(org_id, start, end)
    shift_ids = [str(s["id"]) for s, _tz, _d in in_period]

    approvals = {
        str(v["shift_id"]): v
        for v in _by_ids("shift_verifications", "shift_id, verified_by, verified_at, checks_run, reversed_at",
                         "shift_id", shift_ids, organization_id=org_id)
        if not v.get("reversed_at")
    }
    approved_ids = [i for i in shift_ids if i in approvals]
    breaks_by: dict[str, list] = defaultdict(list)
    for b in _by_ids("shift_breaks", "shift_id, break_start_at, break_end_at", "shift_id", approved_ids):
        if b.get("break_end_at"):
            breaks_by[str(b["shift_id"])].append(b)
    segments_by: dict[str, list] = defaultdict(list)
    for seg in _by_ids("shift_segments", "shift_id, segment_type, segment_start, segment_end", "shift_id", approved_ids):
        segments_by[str(seg["shift_id"])].append(seg)
    travel_by: dict[str, dict] = defaultdict(lambda: {"km": 0.0, "cents": 0})
    for t in _by_ids("shift_travel_expenses", "shift_id, status, claimed_km, calculated_km, amount_cents",
                     "shift_id", approved_ids, organization_id=org_id):
        if t.get("status") in ("approved", "paid"):
            km = t.get("claimed_km") if t.get("claimed_km") is not None else t.get("calculated_km")
            travel_by[str(t["shift_id"])]["km"] += float(km or 0)
            travel_by[str(t["shift_id"])]["cents"] += int(t.get("amount_cents") or 0)

    people_ids = {str(s.get("worker_id")) for s, _t, _d in in_period if s.get("worker_id")}
    people_ids |= {str(v.get("verified_by")) for v in approvals.values() if v.get("verified_by")}
    people = {str(u["id"]): u for u in _by_ids("users", "id, full_name, email", "id", list(people_ids))}
    links = {
        str(r["worker_id"]): r.get("employee_id")
        for r in _by_ids("employment_hero_employees", "worker_id, employee_id", "worker_id",
                         list(people_ids), organization_id=org_id)
    }
    connected, sent = _payroll_status(org_id, approved_ids)

    shifts: list[dict] = []
    waiting: list[dict] = []
    for shift, tz, day in sorted(in_period, key=lambda x: (x[2], str(x[0].get("scheduled_start") or ""))):
        sid = str(shift["id"])
        worker = people.get(str(shift.get("worker_id") or ""), {})
        if sid not in approvals:
            if _finished(shift):
                waiting.append({
                    "shift_id": sid, "date": day.isoformat(), "worker_id": shift.get("worker_id"),
                    "worker_name": worker.get("full_name"), "participant": _initials(shift.get("participant_name")),
                })
            continue
        approval = approvals[sid]
        record = (approval.get("checks_run") or {}).get("pay")
        try:
            pay = pay_time_service.from_record(record) if record else pay_time_service.paid_time(
                shift, breaks_by.get(sid, []), segments_by.get(sid, []))
        except (ValueError, KeyError) as exc:
            waiting.append({
                "shift_id": sid, "date": day.isoformat(), "worker_id": shift.get("worker_id"),
                "worker_name": worker.get("full_name"), "participant": _initials(shift.get("participant_name")),
                "problem": str(exc) or "No time to pay.",
            })
            continue
        approver = people.get(str(approval.get("verified_by") or ""), {})
        state = sent.get(sid)
        payroll = None
        if connected:
            payroll = {"status": (state or {}).get("status") or "waiting", "error": (state or {}).get("error")}
        travel = travel_by.get(sid) if sid in travel_by else None
        shifts.append({
            "shift_id": sid,
            "date": day.isoformat(),
            "worker_id": shift.get("worker_id"),
            "worker_name": worker.get("full_name") or "Unknown worker",
            "worker_email": worker.get("email"),
            "payroll_employee_id": links.get(str(shift.get("worker_id") or "")),
            "participant": _initials(shift.get("participant_name")),
            "start": _local_iso(pay["start"], tz),
            "end": _local_iso(pay["end"], tz),
            "source": pay.get("source"),
            "worked_minutes": pay.get("worked_minutes"),
            "scheduled_minutes": pay.get("scheduled_minutes"),
            "over_roster_minutes": pay.get("over_roster_minutes") or 0,
            "break_minutes": pay.get("break_minutes") or 0,
            "sleepover": any(p["kind"] == "sleepover" for p in pay.get("periods") or []),
            "periods": [
                {
                    "kind": p["kind"], "start": _local_iso(p["start"], tz), "end": _local_iso(p["end"], tz),
                    "minutes": p.get("minutes"),
                    "break_minutes": round(sum(
                        (min(b["end"], p["end"]) - max(b["start"], p["start"])).total_seconds() / 60
                        for b in pay.get("breaks") or []
                        if p["kind"] != "sleepover" and b["end"] > p["start"] and b["start"] < p["end"]
                    ), 1),
                }
                for p in pay.get("periods") or []
            ],
            "travel_km": round(travel["km"], 1) if travel else 0,
            "travel_cents": travel["cents"] if travel else 0,
            "approved_at": approval.get("verified_at"),
            # The approval time in the same local time as the shift, for the CSV.
            "approved_at_local": _local_or_none(approval.get("verified_at"), tz),
            "approved_by": approver.get("full_name"),
            "payroll": payroll,
        })

    worked = sum(float(s["worked_minutes"] or 0) for s in shifts)
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "connected": {"employment_hero": connected},
        "totals": {
            "shifts": len(shifts),
            "hours": round(worked / 60, 2),
            "workers": len({s["worker_id"] for s in shifts}),
            "waiting": len(waiting),
            "sent": sum(1 for s in shifts if (s["payroll"] or {}).get("status") in ("sent", "paid")),
            "attention": sum(1 for s in shifts if (s["payroll"] or {}).get("status") == "failed"),
        },
        "shifts": shifts,
        "waiting": waiting,
    }


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------

CSV_COLUMNS = [
    "Worker", "Worker email", "Payroll employee ID", "Start date", "Start time", "End date", "End time", "Hours", "Type",
    "Breaks (minutes)", "Rostered hours", "Hours over roster", "Participant", "Kilometres",
    "Travel reimbursement ($)", "Times from", "Approved by", "Approved at", "CareCliQ shift ID",
]


def _safe(value: Any) -> Any:
    """Spreadsheets run a cell starting with = + - @ as a formula."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def au_date(local_iso: str) -> str:
    """"2026-10-19..." -> "19/10/2026": the day-first dates Australian
    payroll software and Excel expect."""
    y, m, d = local_iso[:10].split("-")
    return f"{d}/{m}/{y}"


def au_datetime(local_iso: Optional[str]) -> str:
    """"2026-10-30T22:04" -> "30/10/2026 22:04"."""
    return f"{au_date(local_iso)} {local_iso[11:16]}" if local_iso else ""


def _hours(minutes: Any) -> str:
    return f"{float(minutes or 0) / 60:.2f}"


def to_csv(data: dict[str, Any]) -> str:
    """One row per period of work: a shift with a sleepover is several rows
    (active work, sleepover, ...), so payroll can pay each its own way.
    Shift-level figures (roster, travel) are on the shift's first row only,
    so adding a column up doesn't count them twice."""
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(CSV_COLUMNS)
    for s in data["shifts"]:
        periods = s["periods"] or [{"kind": "active", "start": s["start"], "end": s["end"],
                                    "minutes": s["worked_minutes"], "break_minutes": s["break_minutes"]}]
        for index, p in enumerate(periods):
            first = index == 0
            writer.writerow([_safe(v) for v in [
                s["worker_name"],
                s.get("worker_email") or "",
                s.get("payroll_employee_id") or "",
                au_date(p["start"]),
                p["start"][11:16],
                au_date(p["end"]),
                p["end"][11:16],
                _hours(p["minutes"]),
                "Sleepover" if p["kind"] == "sleepover" else "Active work",
                f"{float(p.get('break_minutes') or 0):g}",
                _hours(s["scheduled_minutes"]) if first and s.get("scheduled_minutes") is not None else "",
                _hours(s["over_roster_minutes"]) if first and s.get("over_roster_minutes") else "",
                s["participant"],
                f"{s['travel_km']:g}" if first and s.get("travel_km") else "",
                f"{s['travel_cents'] / 100:.2f}" if first and s.get("travel_cents") else "",
                ("Clock times" if s.get("source") == "clock" else "Rostered times") if first else "",
                s.get("approved_by") or "",
                au_datetime(s.get("approved_at_local")),
                s["shift_id"],
            ]])
    return out.getvalue()
