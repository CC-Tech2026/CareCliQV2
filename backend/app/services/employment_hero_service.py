"""Employment Hero Payroll (formerly KeyPay): approved timesheets become
Employment Hero timesheets, so wages aren't typed in twice.

Built for providers with no IT help: nothing is typed in or looked up.

How it fits together
- A managing director clicks Connect to Employment Hero (Settings >
  Integrations) and signs in there. Employment Hero sends them back to the
  website's /integrations/employment-hero/callback page with a code; we swap it
  for tokens. If their login sees one payroll business we use it; if it sees
  several, they pick theirs by name.
- When a coordinator approves a timesheet (verifies a shift), the approved
  time goes to Employment Hero in the background as a timesheet for that
  worker: the start time and the minutes approved for pay (the time worked,
  capped at the scheduled time unless extra time was approved). Employment
  Hero's own award settings (SCHADS) work out the rates, so weekend, evening
  and public holiday loadings are what the provider's payroll already does.
  Sleepovers go in under the business's sleepover work type when it has one.
- Workers are matched to Employment Hero employees by email, then by name.
  Only when that can't tell people apart does the director pick the person
  from a list. Each shift is sent once (Employment Hero enforces our external
  id), so retries never double up.
- Reversing an approval removes the timesheet in Employment Hero, unless it
  has already been paid in a pay run (then it's left, and the director is
  told to adjust it there).
- Every 30 minutes (and on "Send now") anything that couldn't be sent is
  tried again, for example after a missing employee is matched.

Only shifts worked on or after the "send from" date go (by default the day
of connecting), so pay that was already entered by hand isn't sent again.
Nothing here ever blocks approving a timesheet.
"""

from __future__ import annotations

import asyncio
import logging
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException

from ..core.access import get_user_id, get_user_organization_id, get_user_role
from ..core.config import settings
from ..core.timezone import app_today, head_office_timezone, parse_shift_datetime, participant_timezone
from . import audit_service
from .pii_service import decrypt_field, encrypt_field, encryption_key_usable
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

STATE_TTL = timedelta(hours=1)
TOKEN_SKEW = timedelta(minutes=2)
# Shifts sent per background pass, and employees read per page.
RETRY_LIMIT = 50
EMPLOYEE_PAGE = 100
# How far back the background pass looks for approved shifts not yet sent.
LOOKBACK = timedelta(days=45)
EXTERNAL_PREFIX = "carecliq-shift-"

DEFAULT_SETTINGS: dict[str, Any] = {
    # Send each timesheet when it's approved, without pressing anything.
    "auto_send": True,
    # Approved in CareCliQ, so approved in Employment Hero and ready for the
    # pay run. Off: they arrive as submitted, for someone to approve there.
    "send_approved": True,
    # Shifts worked from this date (YYYY-MM-DD) go. Set to the day of connecting.
    "send_from": None,
    # Employment Hero work type for sleepovers, found by name on connect.
    "sleepover_work_type_id": None,
    "sleepover_work_type_name": None,
}


class EmploymentHeroError(Exception):
    """Something Employment Hero said no to, in words a director can act on."""


class EmploymentHeroAuthError(EmploymentHeroError):
    """The connection has lapsed (removed in Employment Hero, or unused too long)."""


class EmploymentHeroNotFound(EmploymentHeroError):
    """Employment Hero has no record at that address (deleted there)."""


class NoEmployee(EmploymentHeroError):
    """The worker couldn't be matched to an Employment Hero employee."""


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def is_configured() -> bool:
    return bool(settings.employment_hero_client_id and settings.employment_hero_client_secret)


def redirect_uri() -> str:
    return settings.employment_hero_redirect_uri or (
        f"{settings.frontend_base_url.rstrip('/')}/integrations/employment-hero/callback"
    )


def _base() -> str:
    return settings.employment_hero_base_url.rstrip("/")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _parse_ts(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _seal(token: str) -> str:
    return encrypt_field(token) if encryption_key_usable() else token


def _open(token: str) -> str:
    return decrypt_field(token) if token else token


def _schema_missing(exc: Exception) -> bool:
    text = str(exc).lower()
    return "employment_hero_" in text and ("does not exist" in text or "could not find" in text or "pgrst205" in text)


def _get(obj: Any, *names: str) -> Any:
    """A field from Employment Hero JSON, whichever casing it arrives in."""
    if not isinstance(obj, dict):
        return None
    for name in names:
        for key in (name, name[:1].upper() + name[1:], name[:1].lower() + name[1:]):
            if key in obj and obj[key] is not None:
                return obj[key]
    return None


def _norm_name(value: Any) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9' -]", "", str(value or "").lower())).strip()


def _require_director(user: dict) -> str:
    if get_user_role(user) != "managing_director":
        raise HTTPException(status_code=403, detail="Only a managing director can manage integrations.")
    org_id = get_user_organization_id(user)
    if not org_id:
        raise HTTPException(status_code=403, detail="No organisation on this account.")
    return str(org_id)


def _require_configured() -> None:
    if not is_configured():
        raise HTTPException(status_code=503, detail="Employment Hero isn't switched on for CareCliQ yet.")


def _settings_of(row: Optional[dict]) -> dict:
    merged = dict(DEFAULT_SETTINGS)
    merged.update((row or {}).get("settings") or {})
    return merged


def _message(resp: httpx.Response) -> str:
    """The most useful sentence from an Employment Hero error response."""
    try:
        body = resp.json()
    except ValueError:
        return (resp.text or f"Employment Hero error {resp.status_code}").strip()[:300]
    if isinstance(body, str):
        return body[:300]
    if isinstance(body, dict):
        parts: list[str] = []
        state = _get(body, "modelState")
        if isinstance(state, dict):
            for errors in state.values():
                for err in errors if isinstance(errors, list) else [errors]:
                    if err:
                        parts.append(str(err))
        if parts:
            return "; ".join(dict.fromkeys(parts))[:300]
        for key in ("message", "error_description", "error"):
            if _get(body, key):
                return str(_get(body, key))[:300]
    return f"Employment Hero error {resp.status_code}"


# ---------------------------------------------------------------------------
# Connection rows
# ---------------------------------------------------------------------------

def _load_connection(org_id: str) -> Optional[dict]:
    try:
        rows = (
            get_supabase_admin().table("employment_hero_connections").select("*")
            .eq("organization_id", org_id).limit(1).execute()
        ).data or []
    except Exception as exc:
        if _schema_missing(exc):
            return None
        raise
    return rows[0] if rows else None


def _save_connection(org_id: str, data: dict) -> None:
    get_supabase_admin().table("employment_hero_connections").update(
        {**data, "updated_at": _iso(_now())}
    ).eq("organization_id", org_id).execute()


def _note_error(org_id: str, message: Optional[str]) -> None:
    try:
        _save_connection(org_id, {"last_error": message, "last_error_at": _iso(_now()) if message else None})
    except Exception:  # pragma: no cover - best effort
        logger.warning("Couldn't record the Employment Hero error for %s", org_id)


# ---------------------------------------------------------------------------
# OAuth
# ---------------------------------------------------------------------------

async def _token_request(data: dict) -> dict:
    body = {
        "client_id": settings.employment_hero_client_id,
        "client_secret": settings.employment_hero_client_secret,
        **data,
    }
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            f"{_base()}/oauth/token", data=body, headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
    if resp.status_code != 200:
        if resp.status_code in (400, 401) and "invalid_grant" in (resp.text or ""):
            raise EmploymentHeroAuthError(
                "The Employment Hero connection has expired or was removed there. Reconnect Employment Hero."
            )
        raise EmploymentHeroError(f"Employment Hero didn't accept the sign-in: {_message(resp)}")
    return resp.json()


def _token_fields(tokens: dict, previous_refresh: Optional[str] = None) -> dict:
    expires_in = int(tokens.get("expires_in") or 3600)
    refresh = tokens.get("refresh_token") or previous_refresh
    if not refresh:
        raise EmploymentHeroError("Employment Hero didn't send a refresh token. Try connecting again.")
    return {
        "access_token": _seal(str(tokens["access_token"])),
        "refresh_token": _seal(str(refresh)),
        "access_token_expires_at": _iso(_now() + timedelta(seconds=expires_in)),
    }


def create_connect_url(user: dict) -> dict:
    org_id = _require_director(user)
    _require_configured()
    state = secrets.token_urlsafe(32)
    db = get_supabase_admin()
    db.table("employment_hero_oauth_states").delete().lt("created_at", _iso(_now() - STATE_TTL)).execute()
    db.table("employment_hero_oauth_states").insert(
        {"state": state, "organization_id": org_id, "user_id": str(get_user_id(user))}
    ).execute()
    query = urlencode({
        "client_id": settings.employment_hero_client_id,
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "state": state,
    })
    return {"url": f"{_base()}/oauth/authorise?{query}"}


def _business_list(raw: Any) -> list[dict]:
    items = raw if isinstance(raw, list) else (_get(raw, "items") or [])
    out = []
    for b in items:
        bid = _get(b, "id")
        if bid is None:
            continue
        out.append({"id": int(bid), "name": str(_get(b, "name") or f"Business {bid}")})
    out.sort(key=lambda b: b["name"].lower())
    return out


async def complete_connection(user: dict, code: str, state: str) -> dict:
    org_id = _require_director(user)
    _require_configured()
    db = get_supabase_admin()
    rows = (db.table("employment_hero_oauth_states").select("*").eq("state", state).limit(1).execute()).data or []
    row = rows[0] if rows else None
    db.table("employment_hero_oauth_states").delete().eq("state", state).execute()
    if (
        not row
        or str(row.get("organization_id")) != org_id
        or str(row.get("user_id")) != str(get_user_id(user))
        or (_parse_ts(row.get("created_at")) or _now()) < _now() - STATE_TTL
    ):
        raise HTTPException(
            status_code=400, detail="This Employment Hero sign-in link has expired. Click Connect to Employment Hero again."
        )
    try:
        tokens = await _token_request({"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri()})
        fields = _token_fields(tokens)
    except EmploymentHeroError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    existing = _load_connection(org_id)
    payload = {
        "organization_id": org_id,
        **fields,
        "connected_by": str(get_user_id(user)),
        # Reconnecting keeps the original date (and so what's already been sent).
        "connected_at": (existing or {}).get("connected_at") or _iso(_now()),
        "settings": _settings_of(existing) if existing else {
            **DEFAULT_SETTINGS, "send_from": _local_today(org_id).isoformat(),
        },
        "last_error": None,
        "last_error_at": None,
        "updated_at": _iso(_now()),
    }
    db.table("employment_hero_connections").upsert(payload, on_conflict="organization_id").execute()
    saved = _load_connection(org_id) or payload
    try:
        businesses = _business_list(await _api(saved, "GET", "/business", business_scoped=False))
    except EmploymentHeroError as exc:
        raise HTTPException(status_code=502, detail=f"Connected, but couldn't read your payroll businesses: {exc}") from exc
    if not businesses:
        db.table("employment_hero_connections").delete().eq("organization_id", org_id).execute()
        raise HTTPException(
            status_code=400,
            detail="This Employment Hero login can't see a payroll business. Sign in as a payroll administrator.",
        )
    updates: dict[str, Any] = {"businesses": businesses}
    keep = next((b for b in businesses if b["id"] == (existing or {}).get("business_id")), None)
    chosen = keep or (businesses[0] if len(businesses) == 1 else None)
    if chosen:
        updates.update({"business_id": chosen["id"], "business_name": chosen["name"]})
    _save_connection(org_id, updates)
    saved.update(updates)
    if chosen and not keep:
        await _after_business_chosen(saved)
    await audit_service.log_action(
        action_type="integration.employment_hero_connected",
        entity_type="organization",
        entity_id=org_id,
        user_id=str(get_user_id(user)),
        organization_id=org_id,
        details={"business_name": (chosen or {}).get("name"), "businesses": len(businesses)},
    )
    return get_status(user)


async def choose_business(user: dict, business_id: int) -> dict:
    """When the login sees several payroll businesses: which one is this organisation."""
    org_id = _require_director(user)
    row = _load_connection(org_id)
    if not row:
        raise HTTPException(status_code=404, detail="Employment Hero isn't connected.")
    chosen = next((b for b in row.get("businesses") or [] if int(b.get("id")) == int(business_id)), None)
    if not chosen:
        raise HTTPException(status_code=422, detail="Choose one of the businesses listed.")
    if row.get("business_id") != chosen["id"]:
        _save_connection(org_id, {"business_id": chosen["id"], "business_name": chosen["name"]})
        # A different business has different employees and work types.
        get_supabase_admin().table("employment_hero_employees").delete().eq("organization_id", org_id).execute()
        row.update({"business_id": chosen["id"], "business_name": chosen["name"]})
        await _after_business_chosen(row)
    return get_status(user)


async def _after_business_chosen(row: dict) -> None:
    """Best effort: the sleepover work type, found by name, so sleepovers are
    paid as sleepovers without anyone setting it up."""
    org_id = str(row["organization_id"])
    conn_settings = _settings_of(row)
    try:
        work_types = await _work_types(row)
    except EmploymentHeroError as exc:
        logger.info("Employment Hero work types lookup failed for %s: %s", org_id, exc)
        return
    sleepover = next((w for w in work_types if "sleepover" in w["name"].lower()), None)
    conn_settings["sleepover_work_type_id"] = sleepover["id"] if sleepover else None
    conn_settings["sleepover_work_type_name"] = sleepover["name"] if sleepover else None
    _save_connection(org_id, {"settings": conn_settings})
    row["settings"] = conn_settings


async def disconnect(user: dict) -> dict:
    org_id = _require_director(user)
    row = _load_connection(org_id)
    if row:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    f"{_base()}/oauth/token/revoke",
                    data={
                        "token": _open(row["refresh_token"]),
                        "client_id": settings.employment_hero_client_id,
                        "client_secret": settings.employment_hero_client_secret,
                    },
                )
        except Exception:
            logger.info("Couldn't revoke the Employment Hero token for %s (forgetting it anyway)", org_id)
        db = get_supabase_admin()
        db.table("employment_hero_connections").delete().eq("organization_id", org_id).execute()
        db.table("employment_hero_employees").delete().eq("organization_id", org_id).execute()
        await audit_service.log_action(
            action_type="integration.employment_hero_disconnected",
            entity_type="organization",
            entity_id=org_id,
            user_id=str(get_user_id(user)),
            organization_id=org_id,
            details={"business_name": row.get("business_name")},
        )
    return get_status(user)


_refresh_locks: dict[str, asyncio.Lock] = {}


async def _access_token(row: dict) -> str:
    """A current access token, refreshing (and saving the new pair) when due.
    Refreshes for one organisation take turns, so two at once don't race."""
    org_id = str(row["organization_id"])
    expires = _parse_ts(row.get("access_token_expires_at"))
    if expires and expires - TOKEN_SKEW > _now():
        return _open(row["access_token"])
    lock = _refresh_locks.setdefault(org_id, asyncio.Lock())
    async with lock:
        expires = _parse_ts(row.get("access_token_expires_at"))
        if expires and expires - TOKEN_SKEW > _now():
            return _open(row["access_token"])
        current_refresh = _open(row["refresh_token"])
        tokens = await _token_request({"grant_type": "refresh_token", "refresh_token": current_refresh})
        fields = _token_fields(tokens, previous_refresh=current_refresh)
        _save_connection(org_id, fields)
        row.update(fields)
        return str(tokens["access_token"])


# ---------------------------------------------------------------------------
# Calling the Employment Hero Payroll API
# ---------------------------------------------------------------------------

async def _api(
    row: dict,
    method: str,
    path: str,
    *,
    params: Optional[dict] = None,
    json: Optional[Any] = None,
    business_scoped: bool = True,
    _retried: bool = False,
) -> Any:
    if business_scoped:
        if not row.get("business_id"):
            raise EmploymentHeroError("Choose which Employment Hero business is yours.")
        url = f"{_base()}/api/v2/business/{row['business_id']}{path}"
    else:
        url = f"{_base()}/api/v2{path}"
    token = await _access_token(row)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.request(
            method, url, params=params, json=json,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
    if resp.status_code == 401 and not _retried:
        row["access_token_expires_at"] = _iso(_now() - timedelta(minutes=1))
        return await _api(row, method, path, params=params, json=json, business_scoped=business_scoped, _retried=True)
    if resp.status_code == 401:
        raise EmploymentHeroAuthError("Employment Hero no longer accepts this connection. Reconnect Employment Hero.")
    if resp.status_code == 403:
        raise EmploymentHeroAuthError(
            "Employment Hero refused access. The person who connected needs payroll administrator access; reconnect."
        )
    if resp.status_code == 404:
        raise EmploymentHeroNotFound("Employment Hero couldn't find it.")
    if resp.status_code == 429:
        raise EmploymentHeroError("Employment Hero is busy (too many requests). We'll try again shortly.")
    if resp.status_code >= 400:
        raise EmploymentHeroError(_message(resp))
    return resp.json() if resp.content else {}


async def _work_types(row: dict) -> list[dict]:
    raw = await _api(row, "GET", "/worktype")
    out = [
        {"id": int(_get(w, "id")), "name": str(_get(w, "name") or "")}
        for w in (raw if isinstance(raw, list) else [])
        if _get(w, "id") is not None
    ]
    out.sort(key=lambda w: w["name"].lower())
    return out


def _employee_view(e: dict) -> dict:
    first = str(_get(e, "firstName") or "").strip()
    preferred = str(_get(e, "preferredName") or "").strip()
    surname = str(_get(e, "surname") or "").strip()
    return {
        "id": int(_get(e, "id")),
        "name": " ".join(p for p in (preferred or first, surname) if p) or f"Employee {_get(e, 'id')}",
        "names": {_norm_name(f"{first} {surname}"), _norm_name(f"{preferred} {surname}")} - {""},
        "email": str(_get(e, "emailAddress") or "").strip().lower(),
        "active": str(_get(e, "status") or "Active").lower() != "terminated" and not _get(e, "endDate"),
    }


async def _employees(row: dict) -> list[dict]:
    """Everyone in the payroll business, a page at a time."""
    out: list[dict] = []
    skip = 0
    while True:
        raw = await _api(row, "GET", "/employee/unstructured", params={"$top": EMPLOYEE_PAGE, "$skip": skip})
        page = raw if isinstance(raw, list) else []
        out.extend(_employee_view(e) for e in page if _get(e, "id") is not None)
        if len(page) < EMPLOYEE_PAGE:
            return out
        skip += EMPLOYEE_PAGE


# ---------------------------------------------------------------------------
# Matching workers to employees
# ---------------------------------------------------------------------------

def _link(org_id: str, worker_id: str) -> Optional[dict]:
    rows = (
        get_supabase_admin().table("employment_hero_employees").select("*")
        .eq("organization_id", org_id).eq("worker_id", worker_id).limit(1).execute()
    ).data or []
    return rows[0] if rows else None


def _worker(worker_id: str) -> dict:
    rows = (
        get_supabase_admin().table("users").select("id, full_name, email").eq("id", worker_id).limit(1).execute()
    ).data or []
    return rows[0] if rows else {"id": worker_id}


def match_employee(worker: dict, employees: list[dict]) -> Optional[tuple[dict, str]]:
    """The one employee this worker is: same email, or failing that the only
    active employee with the same name. None when it can't be told apart."""
    active = [e for e in employees if e["active"]] or employees
    email = str(worker.get("email") or "").strip().lower()
    if email:
        same = [e for e in active if e["email"] == email]
        if len(same) == 1:
            return same[0], "email"
    name = _norm_name(worker.get("full_name"))
    if name:
        same = [e for e in active if name in e["names"]]
        if len(same) == 1:
            return same[0], "name"
    return None


async def _employee_for(row: dict, org_id: str, worker_id: str, cache: dict) -> int:
    link = _link(org_id, worker_id)
    if link:
        return int(link["employee_id"])
    if "employees" not in cache:
        cache["employees"] = await _employees(row)
    worker = _worker(worker_id)
    found = match_employee(worker, cache["employees"])
    if not found:
        raise NoEmployee(
            f"{worker.get('full_name') or 'This worker'} isn't matched to an Employment Hero employee. Choose who they are."
        )
    employee, how = found
    get_supabase_admin().table("employment_hero_employees").upsert({
        "organization_id": org_id, "worker_id": worker_id, "employee_id": employee["id"],
        "employee_name": employee["name"], "matched_by": how, "updated_at": _iso(_now()),
    }, on_conflict="organization_id,worker_id").execute()
    return employee["id"]


# ---------------------------------------------------------------------------
# Timesheets
# ---------------------------------------------------------------------------

def _local_today(org_id: str) -> date:
    try:
        return app_today(head_office_timezone(org_id))
    except Exception:
        return app_today()


def _timesheet_row(org_id: str, shift_id: str) -> Optional[dict]:
    rows = (
        get_supabase_admin().table("employment_hero_timesheets").select("*")
        .eq("organization_id", org_id).eq("shift_id", shift_id).limit(1).execute()
    ).data or []
    return rows[0] if rows else None


def _save_timesheet(org_id: str, shift_id: str, data: dict) -> None:
    get_supabase_admin().table("employment_hero_timesheets").upsert(
        {"organization_id": org_id, "shift_id": shift_id, **data, "updated_at": _iso(_now())},
        on_conflict="organization_id,shift_id",
    ).execute()


def _active_verification(shift_id: str) -> Optional[dict]:
    rows = (
        get_supabase_admin().table("shift_verifications").select("id, shift_id, checks_run, reversed_at")
        .eq("shift_id", shift_id).is_("reversed_at", "null").limit(1).execute()
    ).data or []
    return rows[0] if rows else None


def _shift(shift_id: str) -> Optional[dict]:
    rows = (
        get_supabase_admin().table("shifts").select(
            "id, organization_id, participant_id, participant_name, worker_id, scheduled_start, scheduled_end, "
            "clocked_in_at, clocked_out_at, duration_minutes, status, is_sleepover, shift_type"
        ).eq("id", shift_id).limit(1).execute()
    ).data or []
    return rows[0] if rows else None


def paid_window(shift: dict, verification: Optional[dict]) -> tuple[datetime, datetime]:
    """When the approved time starts and ends (UTC). It starts when the worker
    clocked in and runs for the minutes approved for pay: the time worked,
    capped at the scheduled time unless the coordinator approved extra."""
    from .shift_verification_service import billable_minutes

    start_raw = shift.get("clocked_in_at") or shift.get("scheduled_start")
    if not start_raw:
        raise EmploymentHeroError("The shift has no start time.")
    start = parse_shift_datetime(start_raw).astimezone(timezone.utc)
    billing = ((verification or {}).get("checks_run") or {}).get("billing") or {}
    minutes = billing.get("billable_minutes")
    if minutes is None:
        minutes = billable_minutes(shift).get("billable_minutes")
    if not minutes or float(minutes) <= 0:
        raise EmploymentHeroError("The shift has no approved time to pay.")
    return start, start + timedelta(minutes=round(float(minutes)))


def _participant_label(name: Any) -> str:
    parts = str(name or "").split()
    if not parts:
        return ""
    return parts[0] if len(parts) == 1 else f"{parts[0]} {parts[-1][0]}."


def build_timesheet(shift: dict, employee_id: int, start: datetime, end: datetime, conn_settings: dict, tz) -> dict:
    """The Employment Hero timesheet line. Times are the shift's local times,
    which is how Employment Hero reads them."""
    who = _participant_label(shift.get("participant_name"))
    line: dict[str, Any] = {
        "employeeId": employee_id,
        "startTime": start.astimezone(tz).replace(tzinfo=None).isoformat(timespec="seconds"),
        "endTime": end.astimezone(tz).replace(tzinfo=None).isoformat(timespec="seconds"),
        "comments": f"CareCliQ shift{' with ' + who if who else ''}"[:250],
        "externalId": f"{EXTERNAL_PREFIX}{shift['id']}",
        "status": "Approved" if conn_settings.get("send_approved", True) else "Submitted",
    }
    if shift.get("is_sleepover") and conn_settings.get("sleepover_work_type_id"):
        line["workTypeId"] = int(conn_settings["sleepover_work_type_id"])
    return line


async def _find_existing(row: dict, external_id: str) -> Optional[int]:
    """A timesheet we already sent (the earlier attempt's answer was lost)."""
    try:
        raw = await _api(row, "GET", "/timesheet", params={"$filter": f"ExternalId eq '{external_id}'"})
    except EmploymentHeroError:
        return None
    for line in raw if isinstance(raw, list) else []:
        if str(_get(line, "externalId") or "") == external_id and _get(line, "id") is not None:
            return int(_get(line, "id"))
    return None


def _shift_date(shift: dict, tz) -> Optional[date]:
    raw = shift.get("scheduled_start") or shift.get("clocked_in_at")
    if not raw:
        return None
    try:
        return parse_shift_datetime(raw).astimezone(tz).date()
    except Exception:
        return None


async def push_shift(org_id: str, shift_id: str, *, row: Optional[dict] = None, cache: Optional[dict] = None,
                     force: bool = False) -> dict:
    """Send one approved shift. Safe to call again: a shift already in
    Employment Hero is left as it is."""
    row = row or _load_connection(org_id)
    if not row or not row.get("business_id"):
        return {"status": "skipped", "reason": "not_connected"}
    cache = cache if cache is not None else {}
    existing = _timesheet_row(org_id, shift_id)
    if existing and existing.get("status") in ("sent", "paid"):
        return {"status": existing["status"]}
    shift = _shift(shift_id)
    verification = _active_verification(shift_id)
    if not shift or str(shift.get("organization_id")) != org_id or not verification:
        return {"status": "skipped", "reason": "not_approved"}
    conn_settings = _settings_of(row)
    tz = participant_timezone(shift, organization_id=org_id)
    send_from = conn_settings.get("send_from")
    worked_on = _shift_date(shift, tz)
    if not force and send_from and worked_on and worked_on.isoformat() < str(send_from):
        return {"status": "skipped", "reason": "before_send_from"}
    worker_id = str(shift.get("worker_id") or "")
    attempts = int((existing or {}).get("attempts") or 0) + 1
    try:
        if not worker_id:
            raise EmploymentHeroError("The shift has no worker.")
        start, end = paid_window(shift, verification)
        employee_id = await _employee_for(row, org_id, worker_id, cache)
        line = build_timesheet(shift, employee_id, start, end, conn_settings, tz)
        try:
            created = await _api(row, "POST", "/timesheet", params={"enforceUniqueExternalId": "true"}, json=line)
            timesheet_id = _get(created, "id")
        except EmploymentHeroError as exc:
            if "external" not in str(exc).lower():
                raise
            timesheet_id = await _find_existing(row, line["externalId"])
            if timesheet_id is None:
                raise
        _save_timesheet(org_id, shift_id, {
            "worker_id": worker_id, "timesheet_id": int(timesheet_id) if timesheet_id is not None else None,
            "status": "sent", "start_time": _iso(start), "end_time": _iso(end), "error": None,
            "attempts": attempts, "sent_at": _iso(_now()),
        })
        return {"status": "sent", "timesheet_id": timesheet_id}
    except EmploymentHeroAuthError as exc:
        _note_error(org_id, str(exc))
        _save_timesheet(org_id, shift_id, {"worker_id": worker_id or None, "status": "failed", "error": str(exc),
                                           "attempts": attempts})
        raise
    except EmploymentHeroError as exc:
        _save_timesheet(org_id, shift_id, {"worker_id": worker_id or None, "status": "failed", "error": str(exc),
                                           "attempts": attempts})
        return {"status": "failed", "error": str(exc)}


async def remove_shift(org_id: str, shift_id: str, *, row: Optional[dict] = None) -> dict:
    """The approval was reversed: take the timesheet out of Employment Hero,
    unless it's been paid already."""
    existing = _timesheet_row(org_id, shift_id)
    if not existing or existing.get("status") in ("removed",):
        return {"status": "nothing"}
    row = row or _load_connection(org_id)
    timesheet_id = existing.get("timesheet_id")
    if existing.get("status") != "sent" or not timesheet_id or not row:
        _save_timesheet(org_id, shift_id, {"status": "removed", "error": None})
        return {"status": "removed"}
    try:
        line = await _api(row, "GET", f"/timesheet/{int(timesheet_id)}")
        if str(_get(line, "status") or "").lower() == "processed":
            message = "Already paid in an Employment Hero pay run. Adjust it in Employment Hero."
            _save_timesheet(org_id, shift_id, {"status": "paid", "error": message})
            return {"status": "paid", "error": message}
        await _api(row, "DELETE", f"/timesheet/{int(timesheet_id)}")
    except EmploymentHeroNotFound:
        pass
    except EmploymentHeroError as exc:
        _save_timesheet(org_id, shift_id, {"error": f"Couldn't remove it from Employment Hero: {exc}"})
        return {"status": "failed", "error": str(exc)}
    _save_timesheet(org_id, shift_id, {"status": "removed", "timesheet_id": None, "error": None})
    return {"status": "removed"}


def _due_shift_ids(org_id: str, conn_settings: dict, limit: int) -> list[str]:
    """Approved shifts not yet in Employment Hero (never tried, or failed).
    Only approvals from the last LOOKBACK days (and not before "send from")
    are looked at, read a page at a time past the database's 1,000-row cap."""
    from .public_api_service import _all_rows

    db = get_supabase_admin()
    since = _now() - LOOKBACK
    send_from = conn_settings.get("send_from")
    if send_from:
        try:
            # A day early: "send from" is a local date, verified_at is UTC.
            since = max(since, datetime.fromisoformat(str(send_from)).replace(tzinfo=timezone.utc) - timedelta(days=1))
        except ValueError:
            pass
    approved = _all_rows(
        lambda: db.table("shift_verifications").select("id, shift_id, verified_at")
        .eq("organization_id", org_id).is_("reversed_at", "null").gte("verified_at", _iso(since))
    )
    done = {
        str(r["shift_id"]) for r in _all_rows(
            lambda: db.table("employment_hero_timesheets").select("shift_id, status")
            .eq("organization_id", org_id).in_("status", ["sent", "paid"]).gte("updated_at", _iso(since - timedelta(days=1))),
            order="shift_id",
        )
    }
    # Most recently approved first; push_shift skips those before "send from".
    approved.sort(key=lambda r: str(r.get("verified_at") or ""), reverse=True)
    return [str(r["shift_id"]) for r in approved if str(r["shift_id"]) not in done][:limit]


async def sync_organization(org_id: str, *, row: Optional[dict] = None) -> dict:
    row = row or _load_connection(org_id)
    if not row or not row.get("business_id"):
        return {"sent": 0, "failed": 0}
    cache: dict = {}
    sent = failed = 0
    try:
        for shift_id in _due_shift_ids(org_id, _settings_of(row), RETRY_LIMIT):
            result = await push_shift(org_id, shift_id, row=row, cache=cache)
            sent += result["status"] == "sent"
            failed += result["status"] == "failed"
    except EmploymentHeroAuthError:
        return {"sent": sent, "failed": failed + 1}
    _save_connection(org_id, {"last_sync_at": _iso(_now()), **({"last_error": None, "last_error_at": None} if not failed else {})})
    return {"sent": sent, "failed": failed}


async def sync_now(user: dict) -> dict:
    org_id = _require_director(user)
    row = _load_connection(org_id)
    if not row:
        raise HTTPException(status_code=404, detail="Employment Hero isn't connected.")
    result = await sync_organization(org_id, row=row)
    return {**get_status(user), "result": result}


async def send_shift_for_user(user: dict, shift_id: str) -> dict:
    """"Send now" on one shift, including one worked before the send-from date."""
    org_id = _require_director(user)
    row = _load_connection(org_id)
    if not row:
        raise HTTPException(status_code=404, detail="Employment Hero isn't connected.")
    try:
        return await push_shift(org_id, shift_id, row=row, force=True)
    except EmploymentHeroError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


async def run_employment_hero_pass() -> int:
    """Scheduler: every connected organisation's waiting timesheets."""
    try:
        rows = (
            get_supabase_admin().table("employment_hero_connections").select("*").execute()
        ).data or []
    except Exception as exc:
        if _schema_missing(exc):
            return 0
        raise
    sent = 0
    for row in rows:
        org_id = str(row["organization_id"])
        # Employment Hero's refresh token lasts 28 days. Refreshing whenever
        # the 24-hour access token is due keeps a quiet organisation (a
        # Christmas break, auto-send off) connected without anyone signing in
        # again.
        try:
            await _access_token(row)
        except EmploymentHeroAuthError as exc:
            _note_error(org_id, str(exc))
            continue
        except Exception as exc:
            logger.info("Employment Hero sign-in refresh failed for %s: %s", org_id, exc)
            continue
        if not _settings_of(row).get("auto_send", True):
            continue
        try:
            sent += (await sync_organization(str(row["organization_id"]), row=row))["sent"]
        except Exception as exc:
            logger.warning("Employment Hero sync failed for %s: %s", org_id, exc)
    return sent


# ---------------------------------------------------------------------------
# Status, settings and choosing employees (directors, through the website)
# ---------------------------------------------------------------------------

def _counts(org_id: str) -> dict:
    rows = (
        get_supabase_admin().table("employment_hero_timesheets").select("status")
        .eq("organization_id", org_id).execute()
    ).data or []
    counts = {"sent": 0, "failed": 0, "paid": 0}
    for r in rows:
        if r.get("status") in counts:
            counts[r["status"]] += 1
    return counts


def _needs_attention(org_id: str, limit: int = 20) -> list[dict]:
    db = get_supabase_admin()
    rows = (
        db.table("employment_hero_timesheets").select("shift_id, worker_id, status, error, updated_at, start_time")
        .eq("organization_id", org_id).in_("status", ["failed", "paid"]).execute()
    ).data or []
    rows = [r for r in rows if r.get("error")]
    rows.sort(key=lambda r: str(r.get("updated_at") or ""), reverse=True)
    rows = rows[:limit]
    ids = sorted({str(r["worker_id"]) for r in rows if r.get("worker_id")})
    names = {}
    if ids:
        names = {
            str(u["id"]): u.get("full_name")
            for u in (db.table("users").select("id, full_name").in_("id", ids).execute()).data or []
        }
    linked = set()
    if ids:
        linked = {
            str(r["worker_id"]) for r in (
                db.table("employment_hero_employees").select("worker_id").eq("organization_id", org_id)
                .in_("worker_id", ids).execute()
            ).data or []
        }
    return [
        {
            "shift_id": r["shift_id"],
            "worker_id": r.get("worker_id"),
            "worker_name": names.get(str(r.get("worker_id"))),
            "start_time": r.get("start_time"),
            "status": r["status"],
            "message": r.get("error"),
            "needs_employee": bool(r.get("worker_id")) and str(r["worker_id"]) not in linked and r["status"] == "failed",
        }
        for r in rows
    ]


def get_status(user: dict) -> dict:
    org_id = _require_director(user)
    row = _load_connection(org_id)
    base = {"available": is_configured(), "connected": bool(row), "redirect_uri": redirect_uri()}
    if not row:
        return {**base, "settings": dict(DEFAULT_SETTINGS)}
    return {
        **base,
        "business_id": row.get("business_id"),
        "business_name": row.get("business_name"),
        "businesses": row.get("businesses") or [],
        "needs_business": not row.get("business_id"),
        "connected_at": row.get("connected_at"),
        "last_sync_at": row.get("last_sync_at"),
        "last_error": row.get("last_error"),
        "settings": _settings_of(row),
        "counts": _counts(org_id),
        "attention": _needs_attention(org_id),
    }


def update_settings(user: dict, data: dict) -> dict:
    org_id = _require_director(user)
    row = _load_connection(org_id)
    if not row:
        raise HTTPException(status_code=404, detail="Employment Hero isn't connected.")
    conn_settings = _settings_of(row)
    for key in ("auto_send", "send_approved"):
        if key in data and data[key] is not None:
            conn_settings[key] = bool(data[key])
    if data.get("send_from"):
        try:
            conn_settings["send_from"] = date.fromisoformat(str(data["send_from"])[:10]).isoformat()
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Choose a date.") from exc
    if "sleepover_work_type_id" in data:
        conn_settings["sleepover_work_type_id"] = data["sleepover_work_type_id"]
        conn_settings["sleepover_work_type_name"] = data.get("sleepover_work_type_name")
    _save_connection(org_id, {"settings": conn_settings})
    return get_status(user)


async def list_options(user: dict) -> dict:
    """Work types (for sleepovers) and employees (to choose who a worker is)."""
    org_id = _require_director(user)
    row = _load_connection(org_id)
    if not row or not row.get("business_id"):
        raise HTTPException(status_code=404, detail="Employment Hero isn't connected.")
    try:
        work_types = await _work_types(row)
        employees = await _employees(row)
    except EmploymentHeroError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {
        "work_types": work_types,
        "employees": [{"id": e["id"], "name": e["name"]} for e in sorted(employees, key=lambda e: e["name"].lower()) if e["active"]],
    }


async def choose_employee(user: dict, worker_id: str, employee_id: int, employee_name: Optional[str] = None) -> dict:
    """The director says who this worker is in Employment Hero; their waiting
    timesheets go straight away."""
    org_id = _require_director(user)
    row = _load_connection(org_id)
    if not row:
        raise HTTPException(status_code=404, detail="Employment Hero isn't connected.")
    member = (
        get_supabase_admin().table("organization_members").select("user_id")
        .eq("organization_id", org_id).eq("user_id", worker_id).limit(1).execute()
    ).data or []
    if not member:
        raise HTTPException(status_code=404, detail="Worker not found.")
    get_supabase_admin().table("employment_hero_employees").upsert({
        "organization_id": org_id, "worker_id": worker_id, "employee_id": int(employee_id),
        "employee_name": employee_name, "matched_by": "chosen", "updated_at": _iso(_now()),
    }, on_conflict="organization_id,worker_id").execute()
    waiting = (
        get_supabase_admin().table("employment_hero_timesheets").select("shift_id")
        .eq("organization_id", org_id).eq("worker_id", worker_id).eq("status", "failed").execute()
    ).data or []
    for r in waiting:
        await push_shift(org_id, str(r["shift_id"]), row=row)
    return get_status(user)


# ---------------------------------------------------------------------------
# Hooks from approving timesheets (shift_verification_service)
# ---------------------------------------------------------------------------

_background: set[asyncio.Task] = set()


def _spawn(coro) -> None:
    try:
        task = asyncio.get_running_loop().create_task(coro)
    except RuntimeError:
        coro.close()
        return
    _background.add(task)
    task.add_done_callback(_background.discard)


async def _after_approval(org_id: str, shift_id: str) -> None:
    try:
        row = _load_connection(org_id)
        if row and _settings_of(row).get("auto_send", True):
            await push_shift(org_id, shift_id, row=row)
    except Exception as exc:
        logger.warning("Employment Hero send failed for shift %s: %s", shift_id, exc)


async def _after_reversal(org_id: str, shift_id: str) -> None:
    try:
        if _load_connection(org_id):
            await remove_shift(org_id, shift_id)
    except Exception as exc:
        logger.warning("Employment Hero removal failed for shift %s: %s", shift_id, exc)


def timesheet_approved(org_id: Optional[str], shift_id: Optional[str]) -> None:
    """A coordinator approved this shift's timesheet. Never raises."""
    if org_id and shift_id:
        _spawn(_after_approval(str(org_id), str(shift_id)))


def timesheet_unapproved(org_id: Optional[str], shift_id: Optional[str]) -> None:
    """The approval was reversed. Never raises."""
    if org_id and shift_id:
        _spawn(_after_reversal(str(org_id), str(shift_id)))
