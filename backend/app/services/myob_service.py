"""MYOB Business (AccountRight): approved CareCliQ invoices become MYOB
service sales invoices, and invoices paid in MYOB are marked paid here.

It works the same way as Xero (xero_service.py), and an organisation uses one
or the other, never both, so an invoice can't be recorded twice.

How it fits together
- A managing director clicks Connect to MYOB (Settings > Integrations). We
  send them to MYOB with a one-time ``state``; they sign in, pick the company
  file and agree, and MYOB sends them back to the website's
  /integrations/myob/callback page with a code and the file's ``businessId``.
  We swap the code for tokens and remember the file.
- Access tokens last 20 minutes; the refresh token keeps the connection going.
  Tokens are stored encrypted when PII_ENCRYPTION_KEY is set, in a table only
  the API can read. The person connecting must be an administrator of the file.
- When an invoice is approved it goes to MYOB in the background: the payer
  (plan manager, participant or the NDIA) as the customer, one line per
  support with its NDIS item code, GST-free by default. MYOB invoice numbers
  are at most 13 characters, so a longer CareCliQ number is left for MYOB to
  number and CareCliQ's number goes in the customer PO field. Reopening and
  re-approving updates the same MYOB invoice; cancelling deletes it there
  (MYOB has no "void"), unless it's been paid.
- Every 30 minutes (and on "Sync now") we ask MYOB about the invoices CareCliQ
  hasn't seen paid, and mark the closed (fully paid) ones paid here. Invoices
  that failed to send are retried then too.

Nothing here ever blocks CareCliQ's own invoicing.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException

from ..core.config import settings
from ..core.access import get_user_id, get_user_organization_id, get_user_role
from .supabase_client import get_supabase_admin
from ..core.timezone import head_office_timezone, shift_local_date, app_today
from . import audit_service
from .pii_service import decrypt_field, encrypt_field, encryption_key_usable
from .xero_service import _line_description, _parse_ts, _payer_name

logger = logging.getLogger(__name__)

AUTHORIZE_URL = "https://secure.myob.com/oauth2/account/authorize"
TOKEN_URL = "https://secure.myob.com/oauth2/v1/authorize"

DEFAULT_SETTINGS: dict[str, Any] = {
    # The income account the lines are posted to, chosen from the file.
    "income_account_uid": None,
    "income_account_name": None,
    # NDIS supports are GST-free: MYOB's "FRE" code, picked on connect.
    "tax_code_uid": None,
    "tax_code_name": None,
    # Send each invoice when it's approved, without pressing anything.
    "auto_send": True,
}
APPROVED_STATUSES = {"finalized", "issued", "sent", "overdue"}
CLOSED_STATUSES = {"cancelled", "void"}
STATE_TTL = timedelta(hours=1)
TOKEN_SKEW = timedelta(minutes=2)
# MYOB's own limits on these fields.
MYOB_NUMBER_MAX = 13
PO_NUMBER_MAX = 20
CUSTOMER_NAME_MAX = 50
# UIDs per lookup (an OData "or" list), and invoices retried per pass.
ID_BATCH = 20
RETRY_LIMIT = 25
GST_FREE_CODE = "FRE"


class MyobError(Exception):
    """Something MYOB said no to, in words a director can act on."""


class MyobAuthError(MyobError):
    """The connection has lapsed (removed in MYOB, or unused too long)."""


class MyobNotFound(MyobError):
    """MYOB has no record at that address (deleted there)."""


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def is_configured() -> bool:
    return bool(settings.myob_client_id and settings.myob_client_secret)


def redirect_uri() -> str:
    return settings.myob_redirect_uri or f"{settings.frontend_base_url.rstrip('/')}/integrations/myob/callback"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _seal(token: str) -> str:
    return encrypt_field(token) if encryption_key_usable() else token


def _open(token: str) -> str:
    return decrypt_field(token) if token else token


def _schema_missing(exc: Exception) -> bool:
    text = str(exc).lower()
    return "myob_" in text and ("does not exist" in text or "could not find" in text or "pgrst205" in text)


def _odata(value: str) -> str:
    """A string inside an OData filter: single quotes are doubled."""
    return value.replace("'", "''")


def _require_director(user: dict) -> str:
    if get_user_role(user) != "managing_director":
        raise HTTPException(status_code=403, detail="Only a managing director can manage integrations.")
    org_id = get_user_organization_id(user)
    if not org_id:
        raise HTTPException(status_code=403, detail="No organisation on this account.")
    return str(org_id)


def _require_configured() -> None:
    if not is_configured():
        raise HTTPException(
            status_code=503,
            detail="MYOB isn't set up on this CareCliQ server yet. Add MYOB_CLIENT_ID and MYOB_CLIENT_SECRET.",
        )


def _settings_of(row: Optional[dict]) -> dict:
    merged = dict(DEFAULT_SETTINGS)
    merged.update((row or {}).get("settings") or {})
    return merged


def _myob_message(resp: httpx.Response) -> str:
    """The most useful sentence from a MYOB error response."""
    try:
        body = resp.json()
    except ValueError:
        return (resp.text or f"MYOB error {resp.status_code}").strip()[:300]
    messages: list[str] = []
    if isinstance(body, dict):
        for err in body.get("Errors") or []:
            text = str(err.get("Message") or err.get("Name") or "").strip()
            extra = str(err.get("AdditionalDetails") or "").strip()
            if text:
                messages.append(f"{text} ({extra})" if extra and extra not in text else text)
        if messages:
            return "; ".join(dict.fromkeys(messages))[:300]
        for key in ("Message", "message", "error_description", "error", "Information"):
            if body.get(key):
                return str(body[key])[:300]
    return f"MYOB error {resp.status_code}"


def _xero_connected(org_id: str) -> bool:
    """MYOB and Xero don't run side by side (each invoice would be booked twice)."""
    try:
        rows = (
            get_supabase_admin().table("xero_connections").select("organization_id").eq("organization_id", org_id).limit(1).execute()
        ).data or []
    except Exception:
        return False
    return bool(rows)


# ---------------------------------------------------------------------------
# Connection rows
# ---------------------------------------------------------------------------

def _load_connection(org_id: str) -> Optional[dict]:
    try:
        rows = (
            get_supabase_admin().table("myob_connections").select("*").eq("organization_id", org_id).limit(1).execute()
        ).data or []
    except Exception as exc:
        if _schema_missing(exc):
            return None
        raise
    return rows[0] if rows else None


def is_connected(org_id: str) -> bool:
    """For xero_service: refuse to connect Xero while MYOB is connected."""
    try:
        return bool(_load_connection(org_id))
    except Exception:
        return False


def _save_connection(org_id: str, data: dict) -> None:
    get_supabase_admin().table("myob_connections").update({**data, "updated_at": _iso(_now())}).eq(
        "organization_id", org_id
    ).execute()


def _note_error(org_id: str, message: Optional[str]) -> None:
    try:
        _save_connection(org_id, {"last_error": message, "last_error_at": _iso(_now()) if message else None})
    except Exception:  # pragma: no cover - best effort
        logger.warning("Couldn't record the MYOB error for %s", org_id)


# ---------------------------------------------------------------------------
# OAuth
# ---------------------------------------------------------------------------

async def _token_request(data: dict) -> dict:
    """MYOB takes the client ID and secret in the form body, not a header."""
    body = {"client_id": settings.myob_client_id, "client_secret": settings.myob_client_secret, **data}
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(TOKEN_URL, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
    if resp.status_code != 200:
        if resp.status_code in (400, 401) and "invalid_grant" in (resp.text or ""):
            raise MyobAuthError("The MYOB connection has expired or was removed in MYOB. Reconnect MYOB.")
        raise MyobError(f"MYOB didn't accept the sign-in: {_myob_message(resp)}")
    return resp.json()


def _token_fields(tokens: dict, previous_refresh: Optional[str] = None) -> dict:
    expires_in = int(tokens.get("expires_in") or 1200)
    refresh = tokens.get("refresh_token") or previous_refresh
    if not refresh:
        raise MyobError("MYOB didn't send a refresh token. Try connecting again.")
    return {
        "access_token": _seal(str(tokens["access_token"])),
        "refresh_token": _seal(str(refresh)),
        "access_token_expires_at": _iso(_now() + timedelta(seconds=expires_in)),
        "scopes": tokens.get("scope"),
    }


def create_connect_url(user: dict) -> dict:
    org_id = _require_director(user)
    _require_configured()
    if _xero_connected(org_id):
        raise HTTPException(
            status_code=409,
            detail="Xero is connected. Disconnect Xero first: invoices go to one accounting system.",
        )
    state = secrets.token_urlsafe(32)
    db = get_supabase_admin()
    db.table("myob_oauth_states").delete().lt("created_at", _iso(_now() - STATE_TTL)).execute()
    db.table("myob_oauth_states").insert(
        {"state": state, "organization_id": org_id, "user_id": str(get_user_id(user))}
    ).execute()
    query = urlencode({
        "client_id": settings.myob_client_id,
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": settings.myob_scopes,
        "state": state,
        # Needed for MYOB to send back which company file (businessId) was picked.
        "prompt": "consent",
    })
    return {"url": f"{AUTHORIZE_URL}?{query}"}


async def complete_connection(user: dict, code: str, state: str, business_id: str) -> dict:
    org_id = _require_director(user)
    _require_configured()
    db = get_supabase_admin()
    rows = (db.table("myob_oauth_states").select("*").eq("state", state).limit(1).execute()).data or []
    row = rows[0] if rows else None
    db.table("myob_oauth_states").delete().eq("state", state).execute()
    if (
        not row
        or str(row.get("organization_id")) != org_id
        or str(row.get("user_id")) != str(get_user_id(user))
        or (_parse_ts(row.get("created_at")) or _now()) < _now() - STATE_TTL
    ):
        raise HTTPException(status_code=400, detail="This MYOB sign-in link has expired. Click Connect to MYOB again.")
    business_id = (business_id or "").strip()
    if not business_id:
        raise HTTPException(status_code=400, detail="MYOB didn't say which company file was chosen. Try connecting again.")
    if _xero_connected(org_id):
        raise HTTPException(status_code=409, detail="Xero is connected. Disconnect Xero first, then connect MYOB.")
    try:
        tokens = await _token_request({
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri(),
            "scope": settings.myob_scopes,
        })
        fields = _token_fields(tokens)
    except MyobError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    existing = _load_connection(org_id)
    payload = {
        "organization_id": org_id,
        "business_id": business_id,
        "business_name": (existing or {}).get("business_name") if (existing or {}).get("business_id") == business_id else None,
        **fields,
        "connected_by": str(get_user_id(user)),
        "connected_at": _iso(_now()),
        # A different company file means different accounts and tax codes.
        "settings": _settings_of(existing) if (existing or {}).get("business_id") == business_id else dict(DEFAULT_SETTINGS),
        "last_error": None,
        "last_error_at": None,
        "updated_at": _iso(_now()),
    }
    db.table("myob_connections").upsert(payload, on_conflict="organization_id").execute()
    saved = _load_connection(org_id) or payload
    await _fill_in_file_details(saved)
    await audit_service.log_action(
        action_type="integration.myob_connected",
        entity_type="organization",
        entity_id=org_id,
        user_id=str(get_user_id(user)),
        organization_id=org_id,
        details={"business_name": saved.get("business_name"), "business_id": business_id},
    )
    return get_status(user)


async def _fill_in_file_details(row: dict) -> None:
    """Best effort after connecting: the company file's name, and a first
    choice of income account and the GST-free tax code, so invoices can go
    straight away. The director can change both."""
    org_id = str(row["organization_id"])
    updates: dict[str, Any] = {}
    try:
        info = await _api(row, "GET", "/Company")
        name = info.get("CompanyName") or info.get("Name")
        if name:
            updates["business_name"] = str(name)[:200]
    except MyobError as exc:
        logger.info("MYOB company name lookup failed for %s: %s", org_id, exc)
    conn_settings = _settings_of(row)
    if not conn_settings.get("income_account_uid") or not conn_settings.get("tax_code_uid"):
        try:
            options = await _options_for(row)
            if not conn_settings.get("income_account_uid") and options["accounts"]:
                first = options["accounts"][0]
                conn_settings["income_account_uid"] = first["uid"]
                conn_settings["income_account_name"] = first["label"]
            free = next((t for t in options["tax_codes"] if t["code"] == GST_FREE_CODE), None)
            if not conn_settings.get("tax_code_uid") and free:
                conn_settings["tax_code_uid"] = free["uid"]
                conn_settings["tax_code_name"] = free["label"]
            updates["settings"] = conn_settings
        except MyobError as exc:
            logger.info("MYOB account lookup failed for %s: %s", org_id, exc)
    if updates:
        _save_connection(org_id, updates)
        row.update(updates)


async def disconnect(user: dict) -> dict:
    org_id = _require_director(user)
    row = _load_connection(org_id)
    if row:
        # MYOB has no endpoint to revoke a connection; forgetting the tokens
        # here ends it. The director can remove CareCliQ in MYOB too.
        get_supabase_admin().table("myob_connections").delete().eq("organization_id", org_id).execute()
        await audit_service.log_action(
            action_type="integration.myob_disconnected",
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
# Calling the MYOB Business API
# ---------------------------------------------------------------------------

def _file_url(row: dict, path: str) -> str:
    return f"{settings.myob_api_base.rstrip('/')}/{row['business_id']}{path}"


def _uid_from_location(location: Optional[str]) -> Optional[str]:
    if not location:
        return None
    return location.rstrip("/").rsplit("/", 1)[-1] or None


async def _api(
    row: dict,
    method: str,
    path: str,
    *,
    params: Optional[dict] = None,
    json: Optional[dict] = None,
    _retried: bool = False,
) -> dict:
    """One call to the company file. A create (201 with no body) returns
    {"UID": <new uid>} from its Location header."""
    token = await _access_token(row)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.request(
            method,
            _file_url(row, path),
            params=params,
            json=json,
            headers={
                "Authorization": f"Bearer {token}",
                "x-myobapi-key": settings.myob_client_id,
                "x-myobapi-version": "v2",
                "Accept": "application/json",
            },
        )
    if resp.status_code == 401 and not _retried:
        row["access_token_expires_at"] = _iso(_now() - timedelta(minutes=1))
        return await _api(row, method, path, params=params, json=json, _retried=True)
    if resp.status_code == 401:
        raise MyobAuthError("MYOB no longer accepts this connection. Reconnect MYOB.")
    if resp.status_code == 403:
        raise MyobAuthError(
            "MYOB refused access. The person who connected must be an administrator of the company file; reconnect MYOB."
        )
    if resp.status_code == 404:
        raise MyobNotFound("MYOB couldn't find it.")
    if resp.status_code == 429:
        raise MyobError("MYOB is busy (too many requests). We'll try again shortly.")
    if resp.status_code >= 400:
        raise MyobError(_myob_message(resp))
    body: Any = resp.json() if resp.content else {}
    if not isinstance(body, dict):
        body = {"Items": body}
    uid = _uid_from_location(resp.headers.get("location"))
    if uid and not body.get("UID"):
        body["UID"] = uid
    return body


# ---------------------------------------------------------------------------
# Status and settings
# ---------------------------------------------------------------------------

def _invoice_counts(org_id: str) -> dict:
    try:
        rows = (
            get_supabase_admin()
            .table("invoices")
            .select("status, myob_invoice_uid, myob_sync_error")
            .eq("organization_id", org_id)
            .execute()
        ).data or []
    except Exception as exc:
        if _schema_missing(exc):
            return {"in_myob": 0, "waiting": 0, "failed": 0}
        raise
    in_myob = sum(1 for r in rows if r.get("myob_invoice_uid"))
    failed = sum(1 for r in rows if r.get("myob_sync_error") and r.get("status") not in CLOSED_STATUSES)
    waiting = sum(
        1 for r in rows
        if r.get("status") in APPROVED_STATUSES and not r.get("myob_invoice_uid") and not r.get("myob_sync_error")
    )
    return {"in_myob": in_myob, "waiting": waiting, "failed": failed}


def _recent_activity(org_id: str, limit: int = 8) -> list[dict]:
    try:
        rows = (
            get_supabase_admin()
            .table("invoices")
            .select("id, invoice_number, recipient_name, total_cents, currency, status, myob_invoice_uid, "
                    "myob_invoice_number, myob_status, myob_sync_error, myob_synced_at, updated_at")
            .eq("organization_id", org_id)
            .execute()
        ).data or []
    except Exception as exc:
        if _schema_missing(exc):
            return []
        raise
    touched = [r for r in rows if r.get("myob_invoice_uid") or r.get("myob_sync_error")]
    touched.sort(key=lambda r: str(r.get("myob_synced_at") or r.get("updated_at") or ""), reverse=True)
    return [
        {
            "id": r["id"],
            "invoice_number": r.get("invoice_number"),
            "myob_number": r.get("myob_invoice_number"),
            "payer": r.get("recipient_name"),
            "total_cents": r.get("total_cents") or 0,
            "currency": r.get("currency") or "AUD",
            "status": r.get("status"),
            "myob_status": r.get("myob_status"),
            "error": r.get("myob_sync_error"),
            "at": r.get("myob_synced_at") or r.get("updated_at"),
        }
        for r in touched[:limit]
    ]


def get_status(user: dict) -> dict:
    org_id = _require_director(user)
    row = _load_connection(org_id)
    base = {
        "available": is_configured(),
        "connected": bool(row),
        "redirect_uri": redirect_uri(),
        # Connecting MYOB is blocked while Xero is connected.
        "blocked_by_xero": (not row) and _xero_connected(org_id),
    }
    if not row:
        return {**base, "settings": dict(DEFAULT_SETTINGS)}
    connected_by_name = None
    if row.get("connected_by"):
        try:
            people = (
                get_supabase_admin().table("users").select("full_name").eq("id", row["connected_by"]).limit(1).execute()
            ).data or []
            connected_by_name = (people[0] if people else {}).get("full_name")
        except Exception:
            connected_by_name = None
    return {
        **base,
        "business_name": row.get("business_name"),
        "connected_at": row.get("connected_at"),
        "connected_by_name": connected_by_name,
        "settings": _settings_of(row),
        "last_sync_at": row.get("last_sync_at"),
        "last_payment_check_at": row.get("last_payment_check_at"),
        "last_error": row.get("last_error"),
        "last_error_at": row.get("last_error_at"),
        "counts": _invoice_counts(org_id),
        "recent": _recent_activity(org_id),
    }


def get_summary(user: dict) -> dict:
    """Whether MYOB is connected, for anyone who handles invoices."""
    from .billing_service import BILLING_ROLES  # local import: billing imports this module

    if get_user_role(user) not in BILLING_ROLES:
        raise HTTPException(status_code=403, detail="Billing access is not available for this role.")
    row = _load_connection(str(get_user_organization_id(user))) if is_configured() else None
    return {"connected": bool(row), "business_name": (row or {}).get("business_name")}


async def _options_for(row: dict) -> dict:
    accounts = await _api(row, "GET", "/GeneralLedger/Account", params={
        "$filter": "Type eq 'Income' or Type eq 'OtherIncome'",
        "$top": "1000",
    })
    taxes = await _api(row, "GET", "/GeneralLedger/TaxCode", params={"$top": "1000"})
    income = [
        {
            "uid": a.get("UID"),
            "label": f"{a.get('DisplayID')} {a.get('Name')}".strip() if a.get("DisplayID") else str(a.get("Name") or ""),
        }
        for a in accounts.get("Items") or []
        if a.get("UID") and not a.get("IsHeader") and a.get("IsActive", True) is not False
    ]
    income.sort(key=lambda a: a["label"])
    codes = [
        {
            "uid": t.get("UID"),
            "code": t.get("Code"),
            "label": f"{t.get('Code')} {t.get('Description') or ''}".strip(),
            "rate": t.get("Rate"),
        }
        for t in taxes.get("Items") or []
        if t.get("UID") and t.get("Code")
    ]
    codes.sort(key=lambda t: (t["code"] != GST_FREE_CODE, t["label"]))
    return {"accounts": income, "tax_codes": codes}


async def list_options(user: dict) -> dict:
    """The income accounts and tax codes in the company file to choose from."""
    org_id = _require_director(user)
    row = _load_connection(org_id)
    if not row:
        raise HTTPException(status_code=409, detail="Connect MYOB first.")
    try:
        return await _options_for(row)
    except MyobError as exc:
        _note_error(org_id, str(exc))
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def update_settings(user: dict, data: dict) -> dict:
    org_id = _require_director(user)
    row = _load_connection(org_id)
    if not row:
        raise HTTPException(status_code=409, detail="Connect MYOB first.")
    merged = _settings_of(row)
    for uid_key, name_key, message in (
        ("income_account_uid", "income_account_name", "Choose the income account the invoices are posted to."),
        ("tax_code_uid", "tax_code_name", "Choose the tax code for the invoice lines."),
    ):
        if uid_key in data:
            uid = str(data[uid_key] or "").strip()
            if not uid or len(uid) > 64:
                raise HTTPException(status_code=422, detail=message)
            merged[uid_key] = uid
            merged[name_key] = str(data.get(name_key) or "").strip()[:200] or None
    if "auto_send" in data:
        merged["auto_send"] = bool(data["auto_send"])
    _save_connection(org_id, {"settings": merged})
    return get_status(user)


# ---------------------------------------------------------------------------
# Invoices
# ---------------------------------------------------------------------------

def _load_invoice(org_id: str, invoice_id: str) -> Optional[dict]:
    rows = (
        get_supabase_admin()
        .table("invoices")
        .select("*")
        .eq("id", invoice_id)
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    ).data or []
    return rows[0] if rows else None


def _participant(org_id: str, participant_id: Any) -> dict:
    if not participant_id:
        return {}
    try:
        rows = (
            get_supabase_admin()
            .table("participants")
            .select("full_name, ndis_number, plan_management_type")
            .eq("id", participant_id)
            .eq("organization_id", org_id)
            .limit(1)
            .execute()
        ).data or []
    except Exception:
        return {}
    return rows[0] if rows else {}


def _mark_invoice(invoice_id: str, data: dict) -> None:
    get_supabase_admin().table("invoices").update(data).eq("id", invoice_id).execute()


_contact_locks: dict[str, asyncio.Lock] = {}


async def _find_customer(row: dict, name: str) -> Optional[str]:
    found = await _api(row, "GET", "/Contact/Customer", params={
        "$filter": f"CompanyName eq '{_odata(name)}'",
        "$top": "5",
    })
    items = [c for c in found.get("Items") or [] if c.get("UID")]
    active = [c for c in items if c.get("IsActive", True) is not False]
    pick = (active or items or [None])[0]
    return str(pick["UID"]) if pick else None


async def _customer_uid(row: dict, name: str, email: Optional[str], tax_code_uid: str) -> str:
    """The MYOB customer card for this payer: remembered, found by name, or
    created. Lookups for one payer take turns, so two invoices approved
    together don't create the card twice."""
    org_id = str(row["organization_id"])
    card_name = name.strip()[:CUSTOMER_NAME_MAX]
    key = f"name:{card_name.lower()}"
    lock = _contact_locks.setdefault(f"{org_id}|{key}", asyncio.Lock())
    async with lock:
        db = get_supabase_admin()
        known = (
            db.table("myob_contacts").select("myob_customer_uid").eq("organization_id", org_id).eq("payer_key", key).limit(1).execute()
        ).data or []
        if known:
            return str(known[0]["myob_customer_uid"])
        uid = await _find_customer(row, card_name)
        if not uid:
            body: dict[str, Any] = {
                "IsIndividual": False,
                "CompanyName": card_name,
                "IsActive": True,
                "SellingDetails": {
                    "TaxCode": {"UID": tax_code_uid},
                    "FreightTaxCode": {"UID": tax_code_uid},
                },
            }
            if email:
                body["Addresses"] = [{"Location": 1, "Email": str(email)[:255]}]
            created = await _api(row, "POST", "/Contact/Customer", json=body)
            uid = created.get("UID") or await _find_customer(row, card_name)
            if not uid:
                raise MyobError(f"MYOB didn't return the new customer card for {card_name}.")
        db.table("myob_contacts").upsert(
            {"organization_id": org_id, "payer_key": key, "myob_customer_uid": str(uid), "contact_name": card_name},
            on_conflict="organization_id,payer_key",
        ).execute()
        return str(uid)


def _line_total_cents(item: dict) -> int:
    if item.get("line_total_cents") is not None:
        return int(item["line_total_cents"])
    return round(float(item.get("quantity") or 1) * int(item.get("unit_amount_cents") or 0))


def _myob_line_description(item: dict) -> str:
    """MYOB service lines carry an amount, not a quantity and price, so the
    quantity and price go in the description."""
    quantity = float(item.get("quantity") or 1)
    unit = int(item.get("unit_amount_cents") or 0) / 100
    qty = f"{quantity:g}"
    return f"{_line_description(item)} {qty} x ${unit:,.2f}"[:1000]


def build_invoice_payload(
    invoice: dict,
    *,
    customer_uid: str,
    participant: dict,
    conn_settings: dict,
    invoice_date: date,
    existing: Optional[dict] = None,
) -> dict:
    """The MYOB service sales invoice for a CareCliQ invoice."""
    number = str(invoice.get("invoice_number") or "")
    reference_bits = [participant.get("full_name") or ""]
    if participant.get("ndis_number"):
        reference_bits.append(f"NDIS {participant['ndis_number']}")
    reference = ", ".join(b for b in reference_bits if b)
    body: dict[str, Any] = {
        "Date": f"{invoice_date.isoformat()}T00:00:00",
        "Customer": {"UID": customer_uid},
        "CustomerPurchaseOrderNumber": number[:PO_NUMBER_MAX] or None,
        "IsTaxInclusive": False,
        "JournalMemo": f"CareCliQ {number}: {reference}".strip(" :")[:255],
        "Comment": reference[:255] or None,
        "Lines": [
            {
                "Type": "Transaction",
                "Description": _myob_line_description(item),
                "Total": round(_line_total_cents(item) / 100, 2),
                "Account": {"UID": conn_settings["income_account_uid"]},
                "TaxCode": {"UID": conn_settings["tax_code_uid"]},
            }
            for item in invoice.get("line_items") or []
        ],
    }
    # MYOB invoice numbers are at most 13 characters; longer ones are left to
    # MYOB to number (CareCliQ's number is in the PO field and the memo).
    if existing and existing.get("Number"):
        body["Number"] = existing["Number"]
    elif number and len(number) <= MYOB_NUMBER_MAX:
        body["Number"] = number
    due = str(invoice.get("due_date") or "")[:10]
    if due:
        try:
            days = (date.fromisoformat(due) - invoice_date).days
            if days >= 0:
                body["Terms"] = {"PaymentIsDue": "InAGivenNumberOfDays", "BalanceDueDate": days}
        except ValueError:
            pass
    if existing:
        body["UID"] = existing.get("UID")
        body["RowVersion"] = existing.get("RowVersion")
    return {k: v for k, v in body.items() if v is not None}


def _not_the_same_invoice(myob_invoice: dict, invoice: dict, payer: str) -> Optional[str]:
    """A MYOB invoice found only by CareCliQ's number is ours only if the
    customer and total match too. Returns why not."""
    customer = str((myob_invoice.get("Customer") or {}).get("Name") or "").strip().lower()
    if customer != payer.strip()[:CUSTOMER_NAME_MAX].lower():
        return f"it's for {(myob_invoice.get('Customer') or {}).get('Name') or 'another customer'}"
    ours = invoice.get("total_cents")
    theirs = myob_invoice.get("TotalAmount")
    if ours is not None and theirs is not None and round(float(theirs) * 100) != int(ours):
        return f"its total is ${float(theirs):,.2f}"
    return None


async def _find_unrecorded(row: dict, number: str) -> Optional[dict]:
    """A send that reached MYOB but wasn't recorded here (found by the PO field)."""
    if not number:
        return None
    found = await _api(row, "GET", "/Sale/Invoice", params={
        "$filter": f"CustomerPurchaseOrderNumber eq '{_odata(number[:PO_NUMBER_MAX])}'",
        "$top": "5",
    })
    for inv in found.get("Items") or []:
        if str(inv.get("InvoiceType") or "Service") == "Service":
            return inv
    return None


def _is_paid(myob_invoice: dict) -> bool:
    return str(myob_invoice.get("Status") or "") == "Closed"


def _part_paid(myob_invoice: dict) -> bool:
    total = float(myob_invoice.get("TotalAmount") or 0)
    balance = myob_invoice.get("BalanceDueAmount")
    return balance is not None and 0 < round(total - float(balance), 2) < total


async def push_invoice(org_id: str, invoice_id: str, *, row: Optional[dict] = None) -> dict:
    """Create or update the MYOB copy of one approved invoice. Returns
    {"ok": bool, "message": str}; never raises for a MYOB problem."""
    row = row or _load_connection(org_id)
    if not row:
        return {"ok": False, "message": "MYOB isn't connected."}
    invoice = _load_invoice(org_id, invoice_id)
    if not invoice:
        return {"ok": False, "message": "Invoice not found."}
    if invoice.get("status") not in APPROVED_STATUSES:
        return {"ok": False, "message": "Only approved, unpaid invoices go to MYOB."}
    try:
        conn_settings = _settings_of(row)
        if not conn_settings.get("income_account_uid") or not conn_settings.get("tax_code_uid"):
            raise MyobError(
                "Choose the income account and tax code for MYOB first (Settings > Integrations > MYOB)."
            )
        participant = _participant(org_id, invoice.get("participant_id"))
        payer = _payer_name(invoice, participant)
        existing: Optional[dict] = None
        uid = invoice.get("myob_invoice_uid")
        if uid:
            try:
                existing = await _api(row, "GET", f"/Sale/Invoice/Service/{uid}")
            except MyobNotFound:
                existing = None  # deleted in MYOB: send it again as new
        else:
            existing = await _find_unrecorded(row, str(invoice.get("invoice_number") or ""))
            if existing:
                clash = _not_the_same_invoice(existing, invoice, payer)
                if clash:
                    raise MyobError(
                        f"MYOB already has an invoice with PO {invoice.get('invoice_number')} that isn't this one "
                        f"({clash}). Change one of them, then send it again."
                    )
                # The summary list lacks RowVersion and lines: read the full one.
                existing = await _api(row, "GET", f"/Sale/Invoice/Service/{existing['UID']}")
        if existing and _is_paid(existing):
            _mark_invoice(invoice_id, {
                "myob_invoice_uid": existing.get("UID"),
                "myob_invoice_number": existing.get("Number"),
                "myob_status": "Closed",
                "myob_synced_at": _iso(_now()),
                "myob_sync_error": None,
            })
            return {"ok": True, "message": "Already paid in MYOB."}
        if existing and _part_paid(existing):
            return {"ok": True, "message": "Part paid in MYOB, so it was left as it is."}

        customer = await _customer_uid(row, payer, invoice.get("recipient_email"), conn_settings["tax_code_uid"])
        tz = head_office_timezone(org_id)
        issued = invoice.get("issued_at") or invoice.get("finalized_at")
        invoice_date = (shift_local_date(issued, tz) if issued else None) or app_today(tz)
        payload = build_invoice_payload(
            invoice,
            customer_uid=customer,
            participant=participant,
            conn_settings=conn_settings,
            invoice_date=invoice_date,
            existing=existing,
        )
        if existing:
            await _api(row, "PUT", f"/Sale/Invoice/Service/{existing['UID']}", json=payload)
            new_uid = str(existing["UID"])
        else:
            created = await _api(row, "POST", "/Sale/Invoice/Service", json=payload)
            new_uid = created.get("UID")
            if not new_uid:
                raise MyobError("MYOB didn't say where the new invoice is. Check MYOB before sending again.")
        number = (existing or {}).get("Number") or payload.get("Number")
        if not number:
            try:
                number = (await _api(row, "GET", f"/Sale/Invoice/Service/{new_uid}")).get("Number")
            except MyobError:
                number = None
        _mark_invoice(invoice_id, {
            "myob_invoice_uid": new_uid,
            "myob_invoice_number": number,
            "myob_status": "Open",
            "myob_synced_at": _iso(_now()),
            "myob_sync_error": None,
        })
        _save_connection(org_id, {"last_sync_at": _iso(_now()), "last_error": None, "last_error_at": None})
        return {"ok": True, "message": f"Sent to MYOB{f' as {number}' if number and number != invoice.get('invoice_number') else ''}."}
    except MyobError as exc:
        _mark_invoice(invoice_id, {"myob_sync_error": str(exc)[:500]})
        _note_error(org_id, str(exc) if isinstance(exc, MyobAuthError) else None)
        return {"ok": False, "message": str(exc)}


async def remove_invoice(org_id: str, invoice_id: str, *, row: Optional[dict] = None) -> dict:
    """A cancelled CareCliQ invoice: delete its MYOB copy (MYOB has no void),
    unless something has been paid on it there."""
    row = row or _load_connection(org_id)
    invoice = _load_invoice(org_id, invoice_id) if row else None
    if not row or not invoice or not invoice.get("myob_invoice_uid"):
        return {"ok": True, "message": "Nothing in MYOB to remove."}
    uid = invoice["myob_invoice_uid"]
    try:
        try:
            current = await _api(row, "GET", f"/Sale/Invoice/Service/{uid}")
        except MyobNotFound:
            current = None
        if current is not None:
            if _is_paid(current) or _part_paid(current):
                raise MyobError("It's been paid in MYOB, so it wasn't deleted there. Reverse or credit it in MYOB.")
            try:
                await _api(row, "DELETE", f"/Sale/Invoice/Service/{uid}")
            except MyobNotFound:
                pass
            except MyobError as exc:
                raise MyobError(
                    f"MYOB wouldn't delete it ({exc}). If your file only allows reversing transactions, reverse it in MYOB."
                ) from exc
        _mark_invoice(invoice_id, {"myob_status": "Deleted", "myob_synced_at": _iso(_now()), "myob_sync_error": None})
        return {"ok": True, "message": "Deleted in MYOB."}
    except MyobError as exc:
        _mark_invoice(invoice_id, {"myob_sync_error": str(exc)[:500]})
        return {"ok": False, "message": str(exc)}


async def push_invoice_for_user(user: dict, invoice_id: str) -> dict:
    """The "Send to MYOB" button on an invoice."""
    from .billing_service import BILLING_ROLES  # local import: billing imports this module

    if get_user_role(user) not in BILLING_ROLES:
        raise HTTPException(status_code=403, detail="Billing access is not available for this role.")
    org_id = str(get_user_organization_id(user))
    if not _load_connection(org_id):
        raise HTTPException(status_code=409, detail="MYOB isn't connected. A managing director can connect it in Settings > Integrations.")
    result = await push_invoice(org_id, invoice_id)
    if not result["ok"]:
        raise HTTPException(status_code=502, detail=result["message"])
    return result


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------

def _myob_day(value: Any) -> Optional[str]:
    parsed = _parse_ts(value)
    return parsed.date().isoformat() if parsed else None


async def _payment_details(row: dict, myob_invoice: dict) -> tuple[str, Optional[str]]:
    """When and with what reference the invoice was paid in MYOB. Best effort:
    falls back to today and no reference."""
    customer = (myob_invoice.get("Customer") or {}).get("UID")
    uid = str(myob_invoice.get("UID") or "")
    if customer and uid:
        try:
            found = await _api(row, "GET", "/Sale/CustomerPayment", params={
                "$filter": f"Customer/UID eq guid'{customer}'",
                "$orderby": "Date desc",
                "$top": "50",
            })
            for payment in found.get("Items") or []:
                if any(str((i or {}).get("UID")) == uid for i in payment.get("Invoices") or []):
                    reference = str(payment.get("Memo") or payment.get("ReceiptNumber") or "").strip() or None
                    return _myob_day(payment.get("Date")) or app_today().isoformat(), reference
        except MyobError as exc:
            logger.info("MYOB payment lookup failed: %s", exc)
    return app_today().isoformat(), None


async def check_payments(org_id: str, *, row: Optional[dict] = None) -> dict:
    """Mark CareCliQ invoices paid when MYOB has them closed (fully paid)."""
    row = row or _load_connection(org_id)
    if not row:
        return {"paid": 0, "checked": 0}
    open_rows = (
        get_supabase_admin()
        .table("invoices")
        .select("id, status, myob_invoice_uid, myob_status, invoice_number")
        .eq("organization_id", org_id)
        .in_("status", sorted(APPROVED_STATUSES))
        .execute()
    ).data or []
    open_rows = [r for r in open_rows if r.get("myob_invoice_uid")]
    by_uid = {str(r["myob_invoice_uid"]).lower(): r for r in open_rows}
    uids = list(by_uid)
    seen: set[str] = set()
    paid = 0
    for start in range(0, len(uids), ID_BATCH):
        batch = uids[start:start + ID_BATCH]
        found = await _api(row, "GET", "/Sale/Invoice", params={
            "$filter": " or ".join(f"UID eq guid'{u}'" for u in batch),
            "$top": str(ID_BATCH),
        })
        for myob_invoice in found.get("Items") or []:
            key = str(myob_invoice.get("UID") or "").lower()
            ours = by_uid.get(key)
            if not ours:
                continue
            seen.add(key)
            if _is_paid(myob_invoice):
                paid_on, reference = await _payment_details(row, myob_invoice)
                now = _iso(_now())
                _mark_invoice(str(ours["id"]), {
                    "status": "paid",
                    "paid_at": now,
                    "payment_date": paid_on,
                    "payment_reference": reference or "Paid in MYOB",
                    "payment_method": "other",
                    "myob_status": "Closed",
                    "myob_synced_at": now,
                    "myob_sync_error": None,
                    "updated_at": now,
                })
                await audit_service.log_action(
                    action_type="invoice.status_changed",
                    entity_type="invoice",
                    entity_id=str(ours["id"]),
                    organization_id=org_id,
                    before_state={"status": ours.get("status")},
                    after_state={"status": "paid"},
                    details={"source": "myob", "payment_date": paid_on, "reference": reference},
                )
                paid += 1
            elif ours.get("myob_status") != "Open":
                _mark_invoice(str(ours["id"]), {"myob_status": "Open"})
    # Asked for but not returned: deleted in MYOB.
    for key in set(uids) - seen:
        ours = by_uid[key]
        if ours.get("myob_status") != "Deleted":
            _mark_invoice(str(ours["id"]), {
                "myob_status": "Deleted",
                "myob_sync_error": "Deleted in MYOB but still open here. Cancel it in CareCliQ, or send it again.",
            })
    _save_connection(org_id, {"last_payment_check_at": _iso(_now())})
    return {"paid": paid, "checked": len(uids)}


async def _retry_unsent(org_id: str, row: dict) -> dict:
    if not _settings_of(row).get("auto_send"):
        return {"sent": 0, "failed": 0}
    rows = (
        get_supabase_admin()
        .table("invoices")
        .select("id, status, myob_invoice_uid")
        .eq("organization_id", org_id)
        .in_("status", sorted(APPROVED_STATUSES))
        .is_("myob_invoice_uid", "null")
        .limit(RETRY_LIMIT)
        .execute()
    ).data or []
    sent = failed = 0
    for invoice in rows:
        result = await push_invoice(org_id, str(invoice["id"]), row=row)
        if result["ok"]:
            sent += 1
        else:
            failed += 1
            message = result["message"].lower()
            if "reconnect" in message or "choose the income account" in message:
                break
    return {"sent": sent, "failed": failed}


async def sync_organization(org_id: str) -> dict:
    row = _load_connection(org_id)
    if not row:
        return {"sent": 0, "failed": 0, "paid": 0}
    try:
        pushed = await _retry_unsent(org_id, row)
        payments = await check_payments(org_id, row=row)
        _note_error(org_id, None)
        return {**pushed, "paid": payments["paid"]}
    except MyobError as exc:
        _note_error(org_id, str(exc))
        raise


async def sync_now(user: dict) -> dict:
    """The "Sync now" button: send what's waiting and check for payments."""
    org_id = _require_director(user)
    if not _load_connection(org_id):
        raise HTTPException(status_code=409, detail="Connect MYOB first.")
    try:
        result = await sync_organization(org_id)
    except MyobError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {**result, "status": get_status(user)}


async def run_myob_pass() -> int:
    """Scheduler: every connected organisation, one at a time. Also keeps the
    refresh token in use, so the connection doesn't lapse."""
    if not is_configured():
        return 0
    try:
        rows = (get_supabase_admin().table("myob_connections").select("organization_id").execute()).data or []
    except Exception as exc:
        if _schema_missing(exc):
            return 0
        raise
    paid = 0
    for r in rows:
        try:
            result = await sync_organization(str(r["organization_id"]))
            paid += int(result.get("paid") or 0)
        except Exception as exc:
            logger.warning("MYOB sync failed for %s: %s", r.get("organization_id"), exc)
    return paid


# ---------------------------------------------------------------------------
# Hook from billing: an invoice changed status
# ---------------------------------------------------------------------------

_background: set[asyncio.Task] = set()


def _spawn(coro) -> None:
    try:
        task = asyncio.get_running_loop().create_task(coro)
    except RuntimeError:  # no loop (scripts, some tests): skip quietly
        coro.close()
        return
    _background.add(task)
    task.add_done_callback(_background.discard)


async def _after_change(org_id: str, invoice_id: str, status: str) -> None:
    try:
        row = _load_connection(org_id)
        if not row:
            return
        if status in CLOSED_STATUSES:
            await remove_invoice(org_id, invoice_id, row=row)
        elif status in APPROVED_STATUSES and _settings_of(row).get("auto_send"):
            await push_invoice(org_id, invoice_id, row=row)
    except Exception as exc:  # never let MYOB break invoicing
        logger.warning("MYOB follow-up for invoice %s failed: %s", invoice_id, exc)


def invoice_status_changed(invoice: dict, previous_status: Optional[str]) -> None:
    """Called by billing after an invoice's status changes. Runs in the
    background; does nothing when MYOB isn't set up or connected."""
    if not is_configured() or not invoice:
        return
    status = str(invoice.get("status") or "")
    if status == previous_status:
        return
    if status in CLOSED_STATUSES:
        relevant = bool(invoice.get("myob_invoice_uid"))
    elif status in APPROVED_STATUSES:
        relevant = previous_status not in APPROVED_STATUSES or not invoice.get("myob_invoice_uid")
    else:
        relevant = False
    if not relevant:
        return
    org_id = invoice.get("organization_id")
    if org_id and invoice.get("id"):
        _spawn(_after_change(str(org_id), str(invoice["id"]), status))
