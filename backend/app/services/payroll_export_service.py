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
import re
import zipfile
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Iterable, Optional
from xml.sax.saxutils import escape as xml_escape

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


def _xero_payroll_on(org_id: str) -> bool:
    """Whether approved hours go to Xero Payroll (local import: that module uses this one)."""
    try:
        from .xero_payroll_service import enabled_for

        return enabled_for(org_id)
    except Exception:
        return False


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
    # Approved travel goes in the pay: kilometres as a vehicle allowance,
    # fares as a reimbursement (travel_pay_service).
    from . import travel_pay_service

    travel_by = travel_pay_service.by_shift(_by_ids(
        "shift_travel_expenses", travel_pay_service.COLUMNS, "shift_id", approved_ids, organization_id=org_id))

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
            "travel_km_cents": travel["km_cents"] if travel else 0,
            "travel_fares_cents": travel["fares_cents"] if travel else 0,
            "travel_cents": (travel["km_cents"] + travel["fares_cents"]) if travel else 0,
            # Claim ids by kind, and how many are approved but not paid yet.
            "travel_claims": {"km": travel["km_ids"], "fares": travel["fares_ids"]} if travel else {"km": [], "fares": []},
            "travel_unpaid": travel["unpaid"] if travel else 0,
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
        "connected": {"employment_hero": connected, "xero_payroll": _xero_payroll_on(org_id)},
        "totals": {
            "shifts": len(shifts),
            "hours": round(worked / 60, 2),
            "workers": len({s["worker_id"] for s in shifts}),
            "waiting": len(waiting),
            "sent": sum(1 for s in shifts if (s["payroll"] or {}).get("status") in ("sent", "paid")),
            "attention": sum(1 for s in shifts if (s["payroll"] or {}).get("status") == "failed"),
            "travel_km": round(sum(float(s["travel_km"] or 0) for s in shifts), 1),
            "travel_km_cents": sum(s["travel_km_cents"] for s in shifts),
            "travel_fares_cents": sum(s["travel_fares_cents"] for s in shifts),
            "travel_unpaid": sum(s["travel_unpaid"] for s in shifts),
        },
        "shifts": shifts,
        "waiting": waiting,
    }


# ---------------------------------------------------------------------------
# Spreadsheets: one set of columns, written as CSV or as an Excel file
# ---------------------------------------------------------------------------

# (heading, kind, Excel column width). Kinds: text, date, time, datetime,
# hours (2 decimals), number, money.
COLUMNS: list[tuple[str, str, float]] = [
    ("Worker", "text", 22), ("Worker email", "text", 30), ("Payroll employee ID", "text", 12),
    ("Start date", "date", 12), ("Start time", "time", 10), ("End date", "date", 12), ("End time", "time", 10),
    ("Hours", "hours", 8), ("Type", "text", 12), ("Breaks (minutes)", "number", 10),
    ("Rostered hours", "hours", 10), ("Hours over roster", "hours", 10), ("Participant", "text", 14),
    ("Kilometres", "number", 11), ("Kilometre allowance ($)", "money", 13),
    ("Fares and other travel ($)", "money", 13), ("Times from", "text", 15),
    ("Approved by", "text", 20), ("Approved at", "datetime", 17), ("CareCliQ shift ID", "text", 38),
]
CSV_COLUMNS = [c[0] for c in COLUMNS]


def _local(local_iso: Optional[str]) -> Optional[datetime]:
    """"2026-10-30T22:04" (local, no zone) -> a datetime; None if missing."""
    if not local_iso:
        return None
    return datetime.fromisoformat(local_iso[:16])


def rows(data: dict[str, Any]) -> list[list[Any]]:
    """One row per period of work: a shift with a sleepover is several rows
    (active work, sleepover, ...), so payroll can pay each its own way.
    Shift-level figures (roster, travel) are on the shift's first row only,
    so adding a column up doesn't count them twice. Values are typed (dates,
    times, numbers); None is an empty cell."""
    out: list[list[Any]] = []
    for s in data["shifts"]:
        periods = s["periods"] or [{"kind": "active", "start": s["start"], "end": s["end"],
                                    "minutes": s["worked_minutes"], "break_minutes": s["break_minutes"]}]
        for index, p in enumerate(periods):
            first = index == 0
            start, end = _local(p["start"]), _local(p["end"])
            out.append([
                s["worker_name"],
                s.get("worker_email") or None,
                str(s["payroll_employee_id"]) if s.get("payroll_employee_id") else None,
                start.date(), start.time(), end.date(), end.time(),
                float(p["minutes"] or 0) / 60,
                "Sleepover" if p["kind"] == "sleepover" else "Active work",
                float(p.get("break_minutes") or 0),
                float(s["scheduled_minutes"]) / 60 if first and s.get("scheduled_minutes") is not None else None,
                float(s["over_roster_minutes"]) / 60 if first and s.get("over_roster_minutes") else None,
                s["participant"] or None,
                float(s["travel_km"]) if first and s.get("travel_km") else None,
                s["travel_km_cents"] / 100 if first and s.get("travel_km_cents") else None,
                s["travel_fares_cents"] / 100 if first and s.get("travel_fares_cents") else None,
                ("Clock times" if s.get("source") == "clock" else "Rostered times") if first else None,
                s.get("approved_by") or None,
                _local(s.get("approved_at_local")),
                s["shift_id"],
            ])
    return out


# -- CSV ---------------------------------------------------------------------

def _safe(value: Any) -> Any:
    """Spreadsheets run a cell starting with = + - @ as a formula."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def _csv_cell(value: Any, kind: str) -> str:
    if value is None:
        return ""
    if kind == "date":
        return value.strftime("%d/%m/%Y")
    if kind == "time":
        return value.strftime("%H:%M")
    if kind == "datetime":
        return value.strftime("%d/%m/%Y %H:%M")
    if kind in ("hours", "money"):
        return f"{value:.2f}"
    if kind == "number":
        return f"{value:g}"
    return _safe(str(value))


def to_csv(data: dict[str, Any]) -> str:
    """For payroll software that imports CSV: day-first dates, local times."""
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(CSV_COLUMNS)
    for row in rows(data):
        writer.writerow([_csv_cell(v, kind) for v, (_h, kind, _w) in zip(row, COLUMNS)])
    return out.getvalue()


# -- Excel (.xlsx) -----------------------------------------------------------
# Written directly (an .xlsx is a zip of a few XML files), so there's no extra
# library. Columns are wide enough for their dates (no ######), dates and
# times are real Excel dates shown day first, and the heading row stays put.

_XLSX_STYLES = {"text": 0, "date": 2, "time": 3, "datetime": 4, "hours": 5, "money": 5, "number": 0}
_EXCEL_EPOCH = datetime(1899, 12, 30)
_BAD_XML = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _col(index: int) -> str:
    name = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        name = chr(65 + rem) + name
    return name


def _xlsx_cell(ref: str, value: Any, kind: str) -> str:
    if value is None:
        return ""
    style = _XLSX_STYLES[kind]
    if kind == "date":
        serial = (datetime.combine(value, time.min) - _EXCEL_EPOCH).days
        return f'<c r="{ref}" s="{style}"><v>{serial}</v></c>'
    if kind == "time":
        return f'<c r="{ref}" s="{style}"><v>{(value.hour * 60 + value.minute) / 1440!r}</v></c>'
    if kind == "datetime":
        serial = (value - _EXCEL_EPOCH).total_seconds() / 86400
        return f'<c r="{ref}" s="{style}"><v>{serial!r}</v></c>'
    if kind in ("hours", "money", "number"):
        return f'<c r="{ref}" s="{style}"><v>{float(value)!r}</v></c>'
    text = xml_escape(_BAD_XML.sub("", str(value)))
    # Inline text is never run as a formula, so nothing needs defusing here.
    return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{text}</t></is></c>'


_CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    '</Types>'
)
_ROOT_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    '</Relationships>'
)
_WORKBOOK_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    '</Relationships>'
)
_STYLES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    '<numFmts count="4"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="hh:mm"/>'
    '<numFmt numFmtId="166" formatCode="dd/mm/yyyy hh:mm"/><numFmt numFmtId="167" formatCode="0.00"/></numFmts>'
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    '<cellXfs count="6">'
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    '<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    '</cellXfs></styleSheet>'
)


def to_xlsx(data: dict[str, Any], sheet_name: str = "Hours") -> bytes:
    """For people opening the hours in Excel or Google Sheets."""
    head = "".join(
        f'<c r="{_col(i)}1" t="inlineStr" s="1"><is><t>{xml_escape(h)}</t></is></c>' for i, (h, _k, _w) in enumerate(COLUMNS)
    )
    lines = [f'<row r="1">{head}</row>']
    for r, row in enumerate(rows(data), start=2):
        cells = "".join(_xlsx_cell(f"{_col(i)}{r}", v, kind) for i, (v, (_h, kind, _w)) in enumerate(zip(row, COLUMNS)))
        lines.append(f'<row r="{r}">{cells}</row>')
    widths = "".join(f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>' for i, (_h, _k, w) in enumerate(COLUMNS))
    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
        '</sheetView></sheetViews>'
        f'<cols>{widths}</cols><sheetData>{"".join(lines)}</sheetData></worksheet>'
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets><sheet name="{xml_escape(sheet_name)}" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", _CONTENT_TYPES)
        z.writestr("_rels/.rels", _ROOT_RELS)
        z.writestr("xl/_rels/workbook.xml.rels", _WORKBOOK_RELS)
        z.writestr("xl/workbook.xml", workbook)
        z.writestr("xl/styles.xml", _STYLES)
        z.writestr("xl/worksheets/sheet1.xml", sheet)
    return buffer.getvalue()
