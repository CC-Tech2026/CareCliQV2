"""Xero Payroll (Australia): approved hours go to Xero as DRAFT timesheets.

Uses the organisation's existing Xero connection (xero_service), with three
extra permissions asked for only when a director turns payroll on:
payroll.employees.read, payroll.timesheets, payroll.settings.read.

How Xero takes hours, and what that means here
- One timesheet per employee per pay period, and the dates must be that
  employee's pay calendar period in Xero (weekly, fortnightly, four-weekly).
- Hours are split into pay items ("earnings rates") with a number for each
  day of the period. Xero doesn't apply the SCHADS award: penalty rates come
  from the pay items the provider set up ("Saturday x1.5" and so on).
- So CareCliQ sorts each day's hours by day type, the one thing it can tell
  for certain: weekday, Saturday, Sunday or public holiday, each under the
  pay item the director chose once. A sleepover is one unit of the sleepover
  pay item on the day it starts. A shift that runs past midnight is split
  there, so Friday-night hours after 12am count as Saturday.
- Evening, night and overtime rates are NOT decided here. Timesheets arrive
  as drafts, so the payroll person checks them in Xero before the pay run.
- Sending again rebuilds the draft from every approved shift in that pay
  period, so it can't double up. A timesheet already approved or processed
  in Xero is left alone, and the result says so.

Workers are matched to Xero employees by email, then by a unique active
name (never guessed between two people with the same name); the director
picks the rest. The links live in the Xero connection's settings.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Optional

import httpx
from fastapi import HTTPException

from ..core.access import get_user_id, get_user_organization_id, has_org_wide_access
from . import audit_service, payroll_export_service
from . import xero_service as xs
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

PAYROLL_BASE = "https://api.xero.com/payroll.xro/1.0"
PAYROLL_SCOPES = ("payroll.employees.read", "payroll.timesheets", "payroll.settings.read")
DAY_TYPES = ("weekday", "saturday", "sunday", "public_holiday")
RATE_KEYS = DAY_TYPES + ("sleepover",)
CALENDAR_DAYS = {"WEEKLY": 7, "FORTNIGHTLY": 14, "FOURWEEKLY": 28}
PAGE = 100

DEFAULTS: dict[str, Any] = {
    # Send hours to Xero Payroll at all.
    "enabled": False,
    # Xero EarningsRateID for each day type, and for sleepovers. A weekday
    # left unset uses each employee's own ordinary earnings rate.
    "rates": {key: None for key in RATE_KEYS},
    "rate_names": {key: None for key in RATE_KEYS},
    # Breaks taken in the worker app are unpaid meal breaks (taken off the
    # hours). Off: they're paid rest breaks and the hours stay as worked.
    "breaks_unpaid": False,
    # CareCliQ worker id -> Xero EmployeeID, matched or chosen.
    "links": {},
}

# Pay item names to pick automatically, first match wins.
_AUTO_NAMES = {
    "weekday": ("ordinary hours", "ordinary"),
    "saturday": ("saturday",),
    "sunday": ("sunday",),
    "public_holiday": ("public holiday", "public hol"),
    "sleepover": ("sleepover", "sleep over"),
}


class NotReady(xs.XeroError):
    """Payroll isn't set up enough to send (no permission, a pay item missing)."""


# ---------------------------------------------------------------------------
# Settings, kept inside the Xero connection's settings under "payroll"
# ---------------------------------------------------------------------------

def payroll_settings(row: Optional[dict]) -> dict:
    stored = (xs._settings_of(row).get("payroll") or {}) if row else {}
    merged = {**DEFAULTS, **stored}
    merged["rates"] = {**DEFAULTS["rates"], **(stored.get("rates") or {})}
    merged["rate_names"] = {**DEFAULTS["rate_names"], **(stored.get("rate_names") or {})}
    merged["links"] = dict(stored.get("links") or {})
    return merged


def _save(org_id: str, row: dict, payroll: dict) -> None:
    settings = xs._settings_of(row)
    settings["payroll"] = payroll
    xs._save_connection(org_id, {"settings": settings})
    row["settings"] = settings


def has_payroll_access(row: Optional[dict]) -> bool:
    granted = set(str((row or {}).get("scopes") or "").split())
    return all(scope in granted for scope in PAYROLL_SCOPES)


def is_on(row: Optional[dict]) -> bool:
    return bool(row) and has_payroll_access(row) and bool(payroll_settings(row).get("enabled"))


def enabled_for(org_id: str) -> bool:
    """For the Payroll page: does this organisation send hours to Xero?"""
    try:
        return xs.is_configured() and is_on(xs._load_connection(org_id))
    except Exception:
        return False


def _require_director(user: dict) -> tuple[str, dict]:
    org_id = xs._require_director(user)
    row = xs._load_connection(org_id)
    if not row:
        raise HTTPException(status_code=409, detail="Connect Xero first.")
    return org_id, row


def _require_sender(user: dict) -> tuple[str, dict]:
    """Coordinators approve timesheets, so they can send them too."""
    if not has_org_wide_access(user):
        raise HTTPException(status_code=403, detail="Coordinator or managing director access required.")
    org_id = str(get_user_organization_id(user) or "")
    row = xs._load_connection(org_id) if org_id else None
    if not row or not is_on(row):
        raise HTTPException(status_code=409, detail="Xero Payroll isn't turned on. A director can turn it on in Settings > Integrations > Xero.")
    return org_id, row


def _eh_connected(org_id: str) -> bool:
    try:
        from . import employment_hero_service as eh

        return bool(eh._load_connection(org_id))
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Calling the Payroll AU API
# ---------------------------------------------------------------------------

def _message(resp: httpx.Response) -> str:
    try:
        body = resp.json()
    except ValueError:
        return (resp.text or f"Xero error {resp.status_code}").strip()[:300]
    messages = []
    if isinstance(body, dict):
        for sheet in body.get("Timesheets") or []:
            for err in (sheet or {}).get("ValidationErrors") or []:
                if err.get("Message"):
                    messages.append(str(err["Message"]))
    if messages:
        return "; ".join(dict.fromkeys(messages))[:300]
    return xs._xero_message(resp)


async def _papi(row: dict, method: str, path: str, *, params: Optional[dict] = None, json: Any = None,
                _retried: bool = False) -> dict:
    token = await xs._access_token(row)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.request(
            method, f"{PAYROLL_BASE}{path}", params=params, json=json,
            headers={"Authorization": f"Bearer {token}", "xero-tenant-id": str(row["tenant_id"]), "Accept": "application/json"},
        )
    if resp.status_code == 401 and not _retried:
        row["access_token_expires_at"] = xs._iso(xs._now() - timedelta(minutes=1))
        return await _papi(row, method, path, params=params, json=json, _retried=True)
    if resp.status_code == 401:
        raise xs.XeroAuthError("Xero no longer accepts this connection. Reconnect Xero.")
    if resp.status_code == 403:
        raise NotReady(
            "Xero refused payroll access. Allow payroll access again on the Xero page, "
            "and check this Xero organisation has Xero Payroll."
        )
    if resp.status_code == 429:
        raise xs.XeroError("Xero is busy (too many requests). Send again in a minute.")
    if resp.status_code >= 400:
        raise xs.XeroError(_message(resp))
    return resp.json() if resp.content else {}


async def _pages(row: dict, path: str, key: str, params: Optional[dict] = None) -> list[dict]:
    out: list[dict] = []
    page = 1
    while True:
        body = await _papi(row, "GET", path, params={**(params or {}), "page": page})
        items = body.get(key) or []
        out.extend(items)
        if len(items) < PAGE:
            return out
        page += 1


def _employee_view(e: dict) -> dict:
    first = str(e.get("FirstName") or "").strip()
    last = str(e.get("LastName") or "").strip()
    from .employment_hero_service import _norm_name

    return {
        "id": str(e.get("EmployeeID")),
        "name": f"{first} {last}".strip() or "Employee",
        "names": {_norm_name(f"{first} {last}")} - {""},
        "email": str(e.get("Email") or "").strip().lower(),
        "active": str(e.get("Status") or "ACTIVE").upper() == "ACTIVE",
        "calendar_id": e.get("PayrollCalendarID"),
        "ordinary_rate_id": e.get("OrdinaryEarningsRateID"),
    }


async def employees(row: dict) -> list[dict]:
    return [_employee_view(e) for e in await _pages(row, "/Employees", "Employees") if e.get("EmployeeID")]


async def earnings_rates(row: dict) -> list[dict]:
    body = await _papi(row, "GET", "/PayItems")
    rates = ((body.get("PayItems") or {}).get("EarningsRates")) or []
    out = [
        {"id": r["EarningsRateID"], "name": r.get("Name") or "Pay item", "type": r.get("EarningsType"),
         "rate_type": r.get("RateType"), "units": r.get("TypeOfUnits")}
        for r in rates if r.get("EarningsRateID") and r.get("CurrentRecord", True) is not False
    ]
    return sorted(out, key=lambda r: r["name"].lower())


async def calendars(row: dict) -> dict[str, dict]:
    body = await _papi(row, "GET", "/PayrollCalendars")
    out = {}
    for c in body.get("PayrollCalendars") or []:
        start = xs.parse_xero_date(c.get("StartDate"))
        if c.get("PayrollCalendarID") and start:
            out[str(c["PayrollCalendarID"])] = {"name": c.get("Name"), "type": c.get("CalendarType"), "start": date.fromisoformat(start)}
    return out


# ---------------------------------------------------------------------------
# The pure parts: pay periods and timesheet lines
# ---------------------------------------------------------------------------

def calendar_periods(calendar: dict, start: date, end: date) -> list[tuple[date, date]]:
    """The calendar's pay periods that overlap [start, end]."""
    length = CALENDAR_DAYS.get(str(calendar.get("type") or "").upper())
    if not length:
        raise NotReady(
            f"The Xero pay calendar \"{calendar.get('name') or ''}\" is {str(calendar.get('type') or 'not weekly').lower()}. "
            "CareCliQ sends weekly, fortnightly or four-weekly timesheets."
        )
    anchor: date = calendar["start"]
    k = (start - anchor).days // length
    period_start = anchor + timedelta(days=k * length)
    out = []
    while period_start <= end:
        out.append((period_start, period_start + timedelta(days=length - 1)))
        period_start += timedelta(days=length)
    return out


def day_type(day: date, holidays: set[str]) -> str:
    if day.isoformat() in holidays:
        return "public_holiday"
    return {5: "saturday", 6: "sunday"}.get(day.weekday(), "weekday")


def _local(text: str) -> datetime:
    return datetime.fromisoformat(text[:16])


def hours_by_day(shifts: list[dict], breaks_unpaid: bool) -> tuple[dict[date, float], dict[date, int]]:
    """Active hours per local calendar day (split at midnight), and the
    number of sleepovers starting each day."""
    hours: dict[date, float] = defaultdict(float)
    sleepovers: dict[date, int] = defaultdict(int)
    for s in shifts:
        periods = s.get("periods") or [{"kind": "active", "start": s["start"], "end": s["end"], "break_minutes": s.get("break_minutes") or 0}]
        for p in periods:
            start, end = _local(p["start"]), _local(p["end"])
            if p["kind"] == "sleepover":
                sleepovers[start.date()] += 1
                continue
            cursor = start
            while cursor < end:
                midnight = datetime.combine(cursor.date() + timedelta(days=1), datetime.min.time())
                piece_end = min(end, midnight)
                hours[cursor.date()] += (piece_end - cursor).total_seconds() / 3600
                cursor = piece_end
            if breaks_unpaid and p.get("break_minutes"):
                hours[start.date()] = max(0.0, hours[start.date()] - float(p["break_minutes"]) / 60)
    return hours, sleepovers


def build_lines(shifts: list[dict], period: tuple[date, date], rates: dict, ordinary_rate_id: Optional[str],
                holidays: set[str], breaks_unpaid: bool) -> list[dict]:
    """Xero timesheet lines for one employee and pay period: a line per pay
    item, with a number for each day of the period."""
    start, end = period
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    hours, sleepovers = hours_by_day(shifts, breaks_unpaid)
    by_rate: dict[str, list[float]] = {}

    def add(rate_id: str, index: int, units: float) -> None:
        by_rate.setdefault(rate_id, [0.0] * len(days))[index] += units

    for i, day in enumerate(days):
        if hours.get(day):
            kind = day_type(day, holidays)
            rate_id = rates.get(kind) or (ordinary_rate_id if kind == "weekday" else None)
            if not rate_id:
                label = {"weekday": "weekdays", "saturday": "Saturdays", "sunday": "Sundays", "public_holiday": "public holidays"}[kind]
                raise NotReady(f"Choose the Xero pay item for {label} on the Xero page.")
            add(rate_id, i, hours[day])
        if sleepovers.get(day):
            if not rates.get("sleepover"):
                raise NotReady("This person had a sleepover. Choose the Xero pay item for sleepovers on the Xero page.")
            add(rates["sleepover"], i, sleepovers[day])
    return [
        {"EarningsRateID": rate_id, "NumberOfUnits": [round(u, 2) for u in units]}
        for rate_id, units in by_rate.items()
    ]


# ---------------------------------------------------------------------------
# Status, options and settings (directors, on the Xero page)
# ---------------------------------------------------------------------------

def get_status(user: dict) -> dict:
    org_id = xs._require_director(user)
    row = xs._load_connection(org_id)
    payroll = payroll_settings(row)
    return {
        "connected": bool(row),
        "has_access": has_payroll_access(row),
        "enabled": bool(row) and bool(payroll["enabled"]),
        "rates": payroll["rates"],
        "rate_names": payroll["rate_names"],
        "breaks_unpaid": payroll["breaks_unpaid"],
        "linked": len(payroll["links"]),
        "employment_hero_connected": _eh_connected(org_id),
    }


def _workers(org_id: str) -> list[dict]:
    db = get_supabase_admin()
    members = (
        db.table("organization_members").select("user_id, role, is_active").eq("organization_id", org_id).execute()
    ).data or []
    ids = [m["user_id"] for m in members if m.get("is_active", True) is not False and m.get("role") == "support_worker"]
    if not ids:
        return []
    users = (db.table("users").select("id, full_name, email").in_("id", ids[:500]).execute()).data or []
    return sorted(users, key=lambda u: str(u.get("full_name") or ""))


def _auto_rates(rates: list[dict]) -> dict:
    picked = {}
    for key, names in _AUTO_NAMES.items():
        for wanted in names:
            hit = next((r for r in rates if wanted in r["name"].lower()), None)
            if hit:
                picked[key] = hit
                break
    return picked


async def get_options(user: dict) -> dict:
    """Pay items to choose from (with suggestions by name), and each worker
    with the Xero employee they're matched to."""
    org_id, row = _require_director(user)
    if not has_payroll_access(row):
        raise HTTPException(status_code=409, detail="Allow payroll access first.")
    try:
        rates = await earnings_rates(row)
        people = await employees(row)
    except xs.XeroError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    payroll = payroll_settings(row)
    from .employment_hero_service import match_employee

    by_id = {e["id"]: e for e in people}
    workers = []
    for w in _workers(org_id):
        linked = payroll["links"].get(str(w["id"]))
        found = (by_id.get(linked), "chosen") if linked and linked in by_id else match_employee(w, people)
        employee, how = found if found and found[0] else (None, None)
        workers.append({
            "worker_id": w["id"], "name": w.get("full_name"), "email": w.get("email"),
            "employee_id": employee["id"] if employee else None, "employee_name": employee["name"] if employee else None,
            "matched_by": how,
        })
    return {
        "earnings_rates": rates,
        "suggested": {k: v["id"] for k, v in _auto_rates(rates).items()},
        "employees": [{"id": e["id"], "name": e["name"]} for e in sorted(people, key=lambda e: e["name"].lower()) if e["active"]],
        "workers": workers,
    }


def update_settings(user: dict, data: dict) -> dict:
    org_id, row = _require_director(user)
    payroll = payroll_settings(row)
    if "enabled" in data:
        on = bool(data["enabled"])
        if on and not has_payroll_access(row):
            raise HTTPException(status_code=409, detail="Allow payroll access first.")
        if on and _eh_connected(org_id):
            raise HTTPException(status_code=409, detail="Employment Hero is connected. Hours go to one payroll system: disconnect Employment Hero first.")
        payroll["enabled"] = on
    for key in RATE_KEYS:
        if key in (data.get("rates") or {}):
            value = str((data["rates"] or {}).get(key) or "").strip()
            payroll["rates"][key] = value[:64] or None
            payroll["rate_names"][key] = (str((data.get("rate_names") or {}).get(key) or "").strip()[:120] or None) if value else None
    if "breaks_unpaid" in data:
        payroll["breaks_unpaid"] = bool(data["breaks_unpaid"])
    _save(org_id, row, payroll)
    return get_status(user)


def link_employee(user: dict, worker_id: str, employee_id: Optional[str]) -> dict:
    """The director says who this worker is in Xero (or clears it)."""
    org_id, row = _require_director(user)
    member = (
        get_supabase_admin().table("organization_members").select("user_id")
        .eq("organization_id", org_id).eq("user_id", worker_id).limit(1).execute()
    ).data or []
    if not member:
        raise HTTPException(status_code=404, detail="Worker not found.")
    payroll = payroll_settings(row)
    if employee_id:
        payroll["links"][str(worker_id)] = str(employee_id)
    else:
        payroll["links"].pop(str(worker_id), None)
    _save(org_id, row, payroll)
    return get_status(user)


# ---------------------------------------------------------------------------
# Sending a pay period
# ---------------------------------------------------------------------------

def _xero_date(d: date) -> str:
    return f"{d.isoformat()}T00:00:00"


async def _existing_timesheets(row: dict, start: date, end: date) -> dict[tuple[str, date], dict]:
    """Timesheets in Xero that start within [start - 28 days, end], by
    (employee, start date)."""
    since = start - timedelta(days=28)
    where = f"StartDate>=DateTime({since.year},{since.month},{since.day})"
    out = {}
    for t in await _pages(row, "/Timesheets", "Timesheets", {"where": where}):
        sd = xs.parse_xero_date(t.get("StartDate"))
        if t.get("EmployeeID") and sd:
            out[(str(t["EmployeeID"]), date.fromisoformat(sd))] = t
    return out


async def send_period(user: dict, start: date, end: date) -> dict:
    """Send every worker's approved hours in [start, end] to Xero Payroll as
    draft timesheets, one per employee per Xero pay period touched."""
    org_id, row = _require_sender(user)
    payroll_export_service.check_period(start, end)
    payroll = payroll_settings(row)
    data = payroll_export_service.period(org_id, start, end)
    by_worker: dict[str, list[dict]] = defaultdict(list)
    for s in data["shifts"]:
        if s.get("worker_id"):
            by_worker[str(s["worker_id"])].append(s)
    results: list[dict] = []
    if not by_worker:
        return {"sent": 0, "failed": 0, "results": [], "waiting": len(data["waiting"])}

    try:
        people = await employees(row)
        cals = await calendars(row)
    except xs.XeroError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    from .employment_hero_service import match_employee
    from .schads_engine import _get_public_holidays

    holidays = _get_public_holidays(get_supabase_admin())
    by_id = {e["id"]: e for e in people}
    plans: list[tuple[str, dict, tuple[date, date]]] = []
    links_changed = False
    for worker_id, shifts in by_worker.items():
        name = shifts[0].get("worker_name") or "This worker"
        linked = payroll["links"].get(worker_id)
        employee = by_id.get(linked) if linked else None
        if not employee:
            found = match_employee({"full_name": name, "email": shifts[0].get("worker_email")}, people)
            employee = found[0] if found else None
            if employee:
                payroll["links"][worker_id] = employee["id"]
                links_changed = True
        if not employee:
            results.append({"worker_id": worker_id, "worker_name": name, "status": "failed",
                            "message": f"{name} isn't matched to a Xero employee. Choose who they are on the Xero page."})
            continue
        calendar = cals.get(str(employee.get("calendar_id") or ""))
        if not calendar:
            results.append({"worker_id": worker_id, "worker_name": name, "status": "failed",
                            "message": f"{employee['name']} has no pay calendar in Xero. Set one on their Xero employee record."})
            continue
        try:
            for period in calendar_periods(calendar, start, end):
                plans.append((worker_id, employee, period))
        except NotReady as exc:
            results.append({"worker_id": worker_id, "worker_name": name, "status": "failed", "message": str(exc)})
    if links_changed:
        _save(org_id, row, payroll)
    if not plans:
        return _summary(results, data)

    first = min(p[2][0] for p in plans)
    last = max(p[2][1] for p in plans)
    try:
        existing = await _existing_timesheets(row, first, last)
    except xs.XeroError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    # Every approved shift in each Xero pay period, not just the days on
    # screen, so a rebuilt draft never drops days.
    full_periods: dict[tuple[date, date], dict[str, list[dict]]] = {}
    for _w, _e, period in plans:
        if period not in full_periods:
            covered = payroll_export_service.period(org_id, *period) if period != (start, end) else data
            grouped: dict[str, list[dict]] = defaultdict(list)
            for s in covered["shifts"]:
                if s.get("worker_id"):
                    grouped[str(s["worker_id"])].append(s)
            full_periods[period] = grouped

    for worker_id, employee, period in plans:
        shifts = full_periods[period].get(worker_id) or []
        name = (shifts or by_worker[worker_id])[0].get("worker_name") or employee["name"]
        label = f"{period[0].strftime('%d/%m')} to {period[1].strftime('%d/%m')}"
        if not shifts:
            continue
        current = existing.get((employee["id"], period[0]))
        if current and str(current.get("Status") or "").upper() not in ("DRAFT", ""):
            results.append({"worker_id": worker_id, "worker_name": name, "status": "skipped", "period": label,
                            "message": f"Already {str(current['Status']).lower()} in Xero for {label}. Change it in Xero if needed."})
            continue
        try:
            lines = build_lines(shifts, period, payroll["rates"], employee.get("ordinary_rate_id"), holidays, payroll["breaks_unpaid"])
            sheet = {"EmployeeID": employee["id"], "StartDate": _xero_date(period[0]), "EndDate": _xero_date(period[1]),
                     "Status": "DRAFT", "TimesheetLines": lines}
            if current:
                sheet["TimesheetID"] = current["TimesheetID"]
                await _papi(row, "POST", f"/Timesheets/{current['TimesheetID']}", json=[sheet])
            else:
                await _papi(row, "POST", "/Timesheets", json=[sheet])
            hours = round(sum(sum(l["NumberOfUnits"]) for l in lines if l["EarningsRateID"] != payroll["rates"].get("sleepover")), 2)
            results.append({"worker_id": worker_id, "worker_name": name, "status": "updated" if current else "sent",
                            "period": label, "hours": hours})
        except xs.XeroAuthError:
            raise
        except xs.XeroError as exc:
            results.append({"worker_id": worker_id, "worker_name": name, "status": "failed", "period": label, "message": str(exc)})

    summary = _summary(results, data)
    try:
        await audit_service.log_action(
            action_type="payroll.sent_to_xero", entity_type="organization", entity_id=org_id,
            user_id=str(get_user_id(user)), organization_id=org_id,
            details={"start": start.isoformat(), "end": end.isoformat(), "sent": summary["sent"], "failed": summary["failed"]},
        )
    except Exception:
        pass
    return summary


def _summary(results: list[dict], data: dict) -> dict:
    return {
        "sent": sum(1 for r in results if r["status"] in ("sent", "updated")),
        "failed": sum(1 for r in results if r["status"] == "failed"),
        "skipped": sum(1 for r in results if r["status"] == "skipped"),
        "results": results,
        "waiting": len(data.get("waiting") or []),
    }
