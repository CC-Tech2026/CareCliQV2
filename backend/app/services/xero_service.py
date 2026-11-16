"""Xero: approved CareCliQ invoices become Xero sales invoices, and payments
recorded in Xero mark the CareCliQ invoice paid.

How it fits together
- A managing director clicks Connect to Xero (Settings > Integrations). We
  send them to Xero with a one-time ``state``; Xero sends them back to the
  website's /integrations/xero/callback page, which hands us the code. We swap
  it for tokens and remember which Xero organisation was chosen.
- Access tokens last 30 minutes; the refresh token (which Xero replaces on
  every use) keeps the connection going. Tokens are stored encrypted when
  PII_ENCRYPTION_KEY is set, in a table only the API can read.
- When an invoice is approved (finalized, issued or sent) it goes to Xero in
  the background: the payer (plan manager, participant or the NDIA) as the
  contact, one line per support with its NDIS item code, GST-free by default.
  Reopening and re-approving updates the same Xero invoice; cancelling voids it.
- Every 30 minutes (and on "Sync now") we ask Xero about the invoices it has
  that CareCliQ hasn't seen paid, and mark the paid ones paid here, with the
  payment date and reference. Invoices that failed to send are retried then too.

Nothing here ever blocks CareCliQ's own invoicing: if Xero is down or the
connection has lapsed, the invoice is saved as usual and the error is shown on
the invoice and the Integrations page.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
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

logger = logging.getLogger(__name__)

AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize"
TOKEN_URL = "https://identity.xero.com/connect/token"
CONNECTIONS_URL = "https://api.xero.com/connections"
API_BASE = "https://api.xero.com/api.xro/2.0"

DEFAULT_SETTINGS: dict[str, Any] = {
    # The revenue account the lines are posted to ("200 Sales" in a new file).
    "sales_account_code": "200",
    # NDIS supports are GST-free; in Xero AU that's "GST Free Income".
    "tax_type": "EXEMPTOUTPUT",
    # AUTHORISED: ready for payment in Xero. DRAFT: someone approves it there.
    "invoice_status": "AUTHORISED",
    # Send each invoice when it's approved, without pressing anything.
    "auto_send": True,
}
INVOICE_STATUSES_IN_XERO = {"AUTHORISED", "DRAFT"}
# CareCliQ statuses that mean "approved, so it belongs in Xero".
APPROVED_STATUSES = {"finalized", "issued", "sent", "overdue"}
CLOSED_STATUSES = {"cancelled", "void"}
STATE_TTL = timedelta(hours=1)
# Refresh the access token this long before it runs out.
TOKEN_SKEW = timedelta(minutes=2)
# Xero accepts up to this many invoice IDs per lookup.
ID_BATCH = 40
# Invoices retried per organisation per pass, so one bad file can't stall the rest.
RETRY_LIMIT = 25


class XeroError(Exception):
    """Something Xero said no to, in words a director can act on."""


class XeroAuthError(XeroError):
    """The connection has lapsed (revoked in Xero, or unused for 60 days)."""


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def is_configured() -> bool:
    return bool(settings.xero_client_id and settings.xero_client_secret)


def redirect_uri() -> str:
    return settings.xero_redirect_uri or f"{settings.frontend_base_url.rstrip('/')}/integrations/xero/callback"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _parse_ts(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


_XERO_DATE = re.compile(r"/Date\((-?\d+)([+-]\d{4})?\)/")


def parse_xero_date(value: Any) -> Optional[str]:
    """Xero's JSON dates look like "/Date(1700000000000+0000)/" (or plain
    ISO on newer fields). Returns yyyy-mm-dd, or None."""
    if not value:
        return None
    text = str(value)
    match = _XERO_DATE.search(text)
    if match:
        dt = datetime.fromtimestamp(int(match.group(1)) / 1000, tz=timezone.utc)
        return dt.date().isoformat()
    parsed = _parse_ts(text)
    return parsed.date().isoformat() if parsed else None


def _encryption_ready() -> bool:
    return encryption_key_usable()


def _seal(token: str) -> str:
    return encrypt_field(token) if _encryption_ready() else token


def _open(token: str) -> str:
    return decrypt_field(token) if token else token


def _schema_missing(exc: Exception) -> bool:
    text = str(exc).lower()
    return (
        "xero_" in text and ("does not exist" in text or "could not find" in text or "pgrst205" in text)
    ) or ("column" in text and "xero_" in text and "does not exist" in text)


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
            detail="Xero isn't set up on this CareCliQ server yet. Add XERO_CLIENT_ID and XERO_CLIENT_SECRET.",
        )


def _settings_of(row: Optional[dict]) -> dict:
    merged = dict(DEFAULT_SETTINGS)
    merged.update((row or {}).get("settings") or {})
    return merged


def _xero_message(resp: httpx.Response) -> str:
    """The most useful sentence from a Xero error response."""
    try:
        body = resp.json()
    except ValueError:
        return (resp.text or f"Xero error {resp.status_code}").strip()[:300]
    messages: list[str] = []
    for element in body.get("Elements") or []:
        for err in element.get("ValidationErrors") or []:
            if err.get("Message"):
                messages.append(str(err["Message"]))
    if messages:
        return "; ".join(dict.fromkeys(messages))[:300]
    for key in ("Detail", "detail", "Message", "message", "Title", "title", "error_description", "error"):
        if body.get(key):
            return str(body[key])[:300]
    return f"Xero error {resp.status_code}"


# ---------------------------------------------------------------------------
# Connection rows
# ---------------------------------------------------------------------------

def _load_connection(org_id: str) -> Optional[dict]:
    try:
        rows = (
            get_supabase_admin().table("xero_connections").select("*").eq("organization_id", org_id).limit(1).execute()
        ).data or []
    except Exception as exc:
        if _schema_missing(exc):
            return None
        raise
    return rows[0] if rows else None


def _save_connection(org_id: str, data: dict) -> None:
    get_supabase_admin().table("xero_connections").update({**data, "updated_at": _iso(_now())}).eq(
        "organization_id", org_id
    ).execute()


def _note_error(org_id: str, message: Optional[str]) -> None:
    try:
        _save_connection(org_id, {"last_error": message, "last_error_at": _iso(_now()) if message else None})
    except Exception:  # pragma: no cover - best effort
        logger.warning("Couldn't record the Xero error for %s", org_id)


# ---------------------------------------------------------------------------
# OAuth
# ---------------------------------------------------------------------------

def _basic_auth() -> str:
    raw = f"{settings.xero_client_id}:{settings.xero_client_secret}".encode()
    return "Basic " + base64.b64encode(raw).decode()


async def _token_request(data: dict) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            TOKEN_URL,
            data=data,
            headers={"Authorization": _basic_auth(), "Content-Type": "application/x-www-form-urlencoded"},
        )
    if resp.status_code != 200:
        message = _xero_message(resp)
        if resp.status_code in (400, 401) and "invalid_grant" in (resp.text or ""):
            raise XeroAuthError("The Xero connection has expired or was removed in Xero. Reconnect Xero.")
        raise XeroError(f"Xero didn't accept the sign-in: {message}")
    return resp.json()


def _token_fields(tokens: dict) -> dict:
    expires_in = int(tokens.get("expires_in") or 1800)
    return {
        "access_token": _seal(str(tokens["access_token"])),
        "refresh_token": _seal(str(tokens["refresh_token"])),
        "access_token_expires_at": _iso(_now() + timedelta(seconds=expires_in)),
        "scopes": tokens.get("scope"),
    }


def create_connect_url(user: dict) -> dict:
    org_id = _require_director(user)
    _require_configured()
    state = secrets.token_urlsafe(32)
    db = get_supabase_admin()
    # Clear out abandoned attempts, then remember this one.
    db.table("xero_oauth_states").delete().lt("created_at", _iso(_now() - STATE_TTL)).execute()
    db.table("xero_oauth_states").insert(
        {"state": state, "organization_id": org_id, "user_id": str(get_user_id(user))}
    ).execute()
    query = urlencode({
        "response_type": "code",
        "client_id": settings.xero_client_id,
        "redirect_uri": redirect_uri(),
        "scope": settings.xero_scopes,
        "state": state,
    })
    return {"url": f"{AUTHORIZE_URL}?{query}"}


def _choose_tenant(connections: list[dict]) -> dict:
    """The organisation just authorised: Xero lists every file the app can
    reach, newest connection last-updated first is the one just picked."""
    orgs = [c for c in connections if (c.get("tenantType") or "ORGANISATION") == "ORGANISATION"]
    if not orgs:
        raise XeroError("No Xero organisation was chosen. Try connecting again and pick your organisation.")
    return sorted(orgs, key=lambda c: str(c.get("updatedDateUtc") or c.get("createdDateUtc") or ""), reverse=True)[0]


async def complete_connection(user: dict, code: str, state: str) -> dict:
    org_id = _require_director(user)
    _require_configured()
    db = get_supabase_admin()
    rows = (db.table("xero_oauth_states").select("*").eq("state", state).limit(1).execute()).data or []
    row = rows[0] if rows else None
    db.table("xero_oauth_states").delete().eq("state", state).execute()
    if (
        not row
        or str(row.get("organization_id")) != org_id
        or str(row.get("user_id")) != str(get_user_id(user))
        or (_parse_ts(row.get("created_at")) or _now()) < _now() - STATE_TTL
    ):
        raise HTTPException(status_code=400, detail="This Xero sign-in link has expired. Click Connect to Xero again.")
    try:
        tokens = await _token_request({
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri(),
        })
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                CONNECTIONS_URL,
                headers={"Authorization": f"Bearer {tokens['access_token']}", "Accept": "application/json"},
            )
        if resp.status_code != 200:
            raise XeroError(f"Couldn't read your Xero organisations: {_xero_message(resp)}")
        tenant = _choose_tenant(resp.json() or [])
    except XeroError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    existing = _load_connection(org_id)
    payload = {
        "organization_id": org_id,
        "tenant_id": tenant["tenantId"],
        "tenant_name": tenant.get("tenantName"),
        "xero_connection_id": tenant.get("id"),
        **_token_fields(tokens),
        "connected_by": str(get_user_id(user)),
        "connected_at": _iso(_now()),
        "settings": _settings_of(existing),
        "last_error": None,
        "last_error_at": None,
        "updated_at": _iso(_now()),
    }
    db.table("xero_connections").upsert(payload, on_conflict="organization_id").execute()
    await audit_service.log_action(
        action_type="integration.xero_connected",
        entity_type="organization",
        entity_id=org_id,
        user_id=str(get_user_id(user)),
        organization_id=org_id,
        details={"tenant_name": tenant.get("tenantName")},
    )
    return get_status(user)


async def disconnect(user: dict) -> dict:
    org_id = _require_director(user)
    row = _load_connection(org_id)
    if row:
        # Tell Xero too, so the app no longer appears under Connected apps.
        try:
            token = await _access_token(row)
            if row.get("xero_connection_id"):
                async with httpx.AsyncClient(timeout=20) as client:
                    await client.delete(
                        f"{CONNECTIONS_URL}/{row['xero_connection_id']}",
                        headers={"Authorization": f"Bearer {token}"},
                    )
        except Exception as exc:  # the local disconnect still goes ahead
            logger.info("Xero disconnect call failed for %s: %s", org_id, exc)
        get_supabase_admin().table("xero_connections").delete().eq("organization_id", org_id).execute()
        await audit_service.log_action(
            action_type="integration.xero_disconnected",
            entity_type="organization",
            entity_id=org_id,
            user_id=str(get_user_id(user)),
            organization_id=org_id,
            details={"tenant_name": row.get("tenant_name")},
        )
    return get_status(user)


async def _access_token(row: dict) -> str:
    """A current access token, refreshing (and saving the new pair) when due."""
    expires = _parse_ts(row.get("access_token_expires_at"))
    if expires and expires - TOKEN_SKEW > _now():
        return _open(row["access_token"])
    tokens = await _token_request({"grant_type": "refresh_token", "refresh_token": _open(row["refresh_token"])})
    fields = _token_fields(tokens)
    _save_connection(str(row["organization_id"]), fields)
    row.update(fields)
    return str(tokens["access_token"])


# ---------------------------------------------------------------------------
# Calling the Accounting API
# ---------------------------------------------------------------------------

async def _api(
    row: dict,
    method: str,
    path: str,
    *,
    params: Optional[dict] = None,
    json: Optional[dict] = None,
    _retried: bool = False,
) -> dict:
    token = await _access_token(row)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.request(
            method,
            f"{API_BASE}{path}",
            params=params,
            json=json,
            headers={
                "Authorization": f"Bearer {token}",
                "xero-tenant-id": str(row["tenant_id"]),
                "Accept": "application/json",
            },
        )
    if resp.status_code == 401 and not _retried:
        # Revoked early or clock skew: force a refresh once.
        row["access_token_expires_at"] = _iso(_now() - timedelta(minutes=1))
        return await _api(row, method, path, params=params, json=json, _retried=True)
    if resp.status_code == 401:
        raise XeroAuthError("Xero no longer accepts this connection. Reconnect Xero.")
    if resp.status_code == 403:
        raise XeroAuthError(
            "Xero refused access. The person who connected may have lost access to this Xero organisation; reconnect Xero."
        )
    if resp.status_code == 429:
        raise XeroError("Xero is busy (too many requests). We'll try again shortly.")
    if resp.status_code >= 400:
        raise XeroError(_xero_message(resp))
    return resp.json() if resp.content else {}


# ---------------------------------------------------------------------------
# Status and settings
# ---------------------------------------------------------------------------

def _invoice_counts(org_id: str) -> dict:
    try:
        rows = (
            get_supabase_admin()
            .table("invoices")
            .select("status, xero_invoice_id, xero_sync_error")
            .eq("organization_id", org_id)
            .execute()
        ).data or []
    except Exception as exc:
        if _schema_missing(exc):
            return {"in_xero": 0, "waiting": 0, "failed": 0}
        raise
    in_xero = sum(1 for r in rows if r.get("xero_invoice_id"))
    failed = sum(1 for r in rows if r.get("xero_sync_error") and r.get("status") not in CLOSED_STATUSES)
    waiting = sum(
        1 for r in rows if r.get("status") in APPROVED_STATUSES and not r.get("xero_invoice_id") and not r.get("xero_sync_error")
    )
    return {"in_xero": in_xero, "waiting": waiting, "failed": failed}


def _recent_activity(org_id: str, limit: int = 8) -> list[dict]:
    """The latest invoices to go to (or fail to reach) Xero, newest first."""
    try:
        rows = (
            get_supabase_admin()
            .table("invoices")
            .select("id, invoice_number, recipient_name, total_cents, currency, status, xero_invoice_id, "
                    "xero_status, xero_sync_error, xero_synced_at, updated_at")
            .eq("organization_id", org_id)
            .execute()
        ).data or []
    except Exception as exc:
        if _schema_missing(exc):
            return []
        raise
    touched = [r for r in rows if r.get("xero_invoice_id") or r.get("xero_sync_error")]
    touched.sort(key=lambda r: str(r.get("xero_synced_at") or r.get("updated_at") or ""), reverse=True)
    return [
        {
            "id": r["id"],
            "invoice_number": r.get("invoice_number"),
            "payer": r.get("recipient_name"),
            "total_cents": r.get("total_cents") or 0,
            "currency": r.get("currency") or "AUD",
            "status": r.get("status"),
            "xero_status": r.get("xero_status"),
            "error": r.get("xero_sync_error"),
            "at": r.get("xero_synced_at") or r.get("updated_at"),
        }
        for r in touched[:limit]
    ]


def get_status(user: dict) -> dict:
    org_id = _require_director(user)
    row = _load_connection(org_id)
    base = {"available": is_configured(), "connected": bool(row), "redirect_uri": redirect_uri()}
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
        "tenant_name": row.get("tenant_name"),
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
    """Whether Xero is connected, for anyone who handles invoices (the
    invoice's Send to Xero button). Settings stay with directors."""
    from .billing_service import BILLING_ROLES  # local import: billing imports this module

    if get_user_role(user) not in BILLING_ROLES:
        raise HTTPException(status_code=403, detail="Billing access is not available for this role.")
    row = _load_connection(str(get_user_organization_id(user))) if is_configured() else None
    return {"connected": bool(row), "tenant_name": (row or {}).get("tenant_name")}


def update_settings(user: dict, data: dict) -> dict:
    org_id = _require_director(user)
    row = _load_connection(org_id)
    if not row:
        raise HTTPException(status_code=409, detail="Connect Xero first.")
    merged = _settings_of(row)
    if "sales_account_code" in data:
        code = str(data["sales_account_code"] or "").strip()
        if not code or len(code) > 10:
            raise HTTPException(status_code=422, detail="Choose the account the invoices are posted to.")
        merged["sales_account_code"] = code
    if "tax_type" in data:
        tax = str(data["tax_type"] or "").strip()
        if not tax or len(tax) > 50:
            raise HTTPException(status_code=422, detail="Choose the tax rate for the invoice lines.")
        merged["tax_type"] = tax
    if "invoice_status" in data:
        status = str(data["invoice_status"] or "").upper()
        if status not in INVOICE_STATUSES_IN_XERO:
            raise HTTPException(status_code=422, detail="Send invoices to Xero approved or as drafts.")
        merged["invoice_status"] = status
    if "auto_send" in data:
        merged["auto_send"] = bool(data["auto_send"])
    _save_connection(org_id, {"settings": merged})
    return get_status(user)


async def list_options(user: dict) -> dict:
    """The revenue accounts and sales tax rates to choose from."""
    org_id = _require_director(user)
    row = _load_connection(org_id)
    if not row:
        raise HTTPException(status_code=409, detail="Connect Xero first.")
    try:
        accounts = await _api(row, "GET", "/Accounts", params={"where": 'Status=="ACTIVE"'})
        taxes = await _api(row, "GET", "/TaxRates")
    except XeroError as exc:
        _note_error(org_id, str(exc))
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    revenue = [
        {"code": a.get("Code"), "name": a.get("Name")}
        for a in accounts.get("Accounts") or []
        if a.get("Code") and (a.get("Class") == "REVENUE" or a.get("Type") in {"REVENUE", "SALES", "OTHERINCOME"})
    ]
    rates = [
        {"type": t.get("TaxType"), "name": t.get("Name"), "rate": t.get("EffectiveRate")}
        for t in taxes.get("TaxRates") or []
        if t.get("Status") == "ACTIVE" and t.get("CanApplyToRevenue") is not False
    ]
    return {"accounts": revenue, "tax_rates": rates}


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


def _payer_name(invoice: dict, participant: dict) -> str:
    name = str(invoice.get("recipient_name") or "").strip()
    if name:
        return name[:255]
    if str(participant.get("plan_management_type") or "").startswith("ndia"):
        return "NDIA"
    return str(participant.get("full_name") or "Participant").strip()[:255]


def _escape_where(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


_contact_locks: dict[str, asyncio.Lock] = {}


async def _find_contact(row: dict, name: str) -> Optional[str]:
    found = await _api(row, "GET", "/Contacts", params={"where": f'Name=="{_escape_where(name)}"'})
    contacts = found.get("Contacts") or []
    return str(contacts[0]["ContactID"]) if contacts else None


async def _contact_id(row: dict, name: str, email: Optional[str]) -> str:
    """The Xero contact for this payer: remembered, found by name, or created.

    Two invoices for the same payer can be sent at once (approved together),
    so lookups for one payer take turns; and if Xero still says the name is
    taken (added in Xero meanwhile), that existing contact is used.
    """
    org_id = str(row["organization_id"])
    key = f"name:{name.strip().lower()}"
    lock = _contact_locks.setdefault(f"{org_id}|{key}", asyncio.Lock())
    async with lock:
        return await _contact_id_locked(row, org_id, key, name, email)


async def _contact_id_locked(row: dict, org_id: str, key: str, name: str, email: Optional[str]) -> str:
    db = get_supabase_admin()
    known = (
        db.table("xero_contacts").select("xero_contact_id").eq("organization_id", org_id).eq("payer_key", key).limit(1).execute()
    ).data or []
    if known:
        return str(known[0]["xero_contact_id"])
    contact_id = await _find_contact(row, name)
    if not contact_id:
        body: dict[str, Any] = {"Name": name}
        if email:
            body["EmailAddress"] = email
        try:
            created = await _api(row, "POST", "/Contacts", json={"Contacts": [body]})
            contact_id = str((created.get("Contacts") or [{}])[0]["ContactID"])
        except XeroError as exc:
            if "already assigned" not in str(exc).lower():
                raise
            contact_id = await _find_contact(row, name)
            if not contact_id:
                raise
    db.table("xero_contacts").upsert(
        {"organization_id": org_id, "payer_key": key, "xero_contact_id": contact_id, "contact_name": name},
        on_conflict="organization_id,payer_key",
    ).execute()
    return contact_id


def _line_description(item: dict) -> str:
    parts = []
    if item.get("item_code"):
        parts.append(str(item["item_code"]))
    parts.append(str(item.get("description") or "Support").strip())
    start, end = item.get("service_date_from"), item.get("service_date_to")
    if start and end and start != end:
        parts.append(f"({start} to {end})")
    elif item.get("service_date") or start:
        parts.append(f"({item.get('service_date') or start})")
    return " ".join(parts)[:4000]


def build_invoice_payload(
    invoice: dict,
    *,
    contact_id: str,
    participant: dict,
    conn_settings: dict,
    invoice_date: str,
    xero_invoice_id: Optional[str] = None,
) -> dict:
    """The Xero sales invoice for a CareCliQ invoice. Amounts are whole cents
    turned into dollars; the lines carry the NDIS item code and service date."""
    reference_bits = [participant.get("full_name") or ""]
    if participant.get("ndis_number"):
        reference_bits.append(f"NDIS {participant['ndis_number']}")
    body: dict[str, Any] = {
        "Type": "ACCREC",
        "Contact": {"ContactID": contact_id},
        "InvoiceNumber": str(invoice.get("invoice_number") or "")[:255],
        "Reference": ", ".join(b for b in reference_bits if b)[:255] or None,
        "Date": invoice_date,
        "DueDate": str(invoice.get("due_date") or invoice_date)[:10],
        "CurrencyCode": invoice.get("currency") or "AUD",
        "LineAmountTypes": "Exclusive",
        "Status": conn_settings["invoice_status"],
        "LineItems": [
            {
                "Description": _line_description(item),
                "Quantity": float(item.get("quantity") or 1),
                "UnitAmount": round(int(item.get("unit_amount_cents") or 0) / 100, 4),
                "AccountCode": conn_settings["sales_account_code"],
                "TaxType": conn_settings["tax_type"],
            }
            for item in invoice.get("line_items") or []
        ],
    }
    if xero_invoice_id:
        body["InvoiceID"] = xero_invoice_id
    return {k: v for k, v in body.items() if v is not None}


def _mark_invoice(invoice_id: str, data: dict) -> None:
    get_supabase_admin().table("invoices").update(data).eq("id", invoice_id).execute()


async def _find_by_number(row: dict, number: str) -> Optional[dict]:
    if not number:
        return None
    found = await _api(row, "GET", "/Invoices", params={"InvoiceNumbers": number, "Statuses": "DRAFT,SUBMITTED,AUTHORISED,PAID"})
    for inv in found.get("Invoices") or []:
        if inv.get("Type") == "ACCREC":
            return inv
    return None


def _not_the_same_invoice(xero_invoice: dict, invoice: dict, payer: str) -> Optional[str]:
    """A Xero invoice found only by its number is ours only if the payer and
    total match too; otherwise it's someone else's invoice with the same
    number, and adopting it could mark ours paid wrongly. Returns why not."""
    xero_payer = str((xero_invoice.get("Contact") or {}).get("Name") or "").strip().lower()
    if xero_payer != payer.strip().lower():
        return f"it's for {(xero_invoice.get('Contact') or {}).get('Name') or 'another contact'}"
    ours = invoice.get("total_cents")
    if ours is not None and round(float(xero_invoice.get("Total") or 0) * 100) != int(ours):
        return f"its total is ${float(xero_invoice.get('Total') or 0):,.2f}"
    return None


async def push_invoice(org_id: str, invoice_id: str, *, row: Optional[dict] = None) -> dict:
    """Create or update the Xero copy of one approved invoice. Returns
    {"ok": bool, "message": str}; never raises for a Xero problem."""
    row = row or _load_connection(org_id)
    if not row:
        return {"ok": False, "message": "Xero isn't connected."}
    invoice = _load_invoice(org_id, invoice_id)
    if not invoice:
        return {"ok": False, "message": "Invoice not found."}
    status = invoice.get("status")
    if status not in APPROVED_STATUSES:
        return {"ok": False, "message": "Only approved, unpaid invoices go to Xero."}
    try:
        conn_settings = _settings_of(row)
        participant = _participant(org_id, invoice.get("participant_id"))
        xero_id = invoice.get("xero_invoice_id")
        existing: Optional[dict] = None
        if xero_id:
            got = await _api(row, "GET", f"/Invoices/{xero_id}")
            existing = (got.get("Invoices") or [None])[0]
        else:
            # A send that reached Xero but wasn't recorded here: pick it up
            # rather than make a second invoice with the same number.
            existing = await _find_by_number(row, str(invoice.get("invoice_number") or ""))
            if existing:
                clash = _not_the_same_invoice(existing, invoice, _payer_name(invoice, participant))
                if clash:
                    raise XeroError(
                        f"Xero already has an invoice numbered {invoice.get('invoice_number')} that isn't this one "
                        f"({clash}). Rename one of them, then send it again."
                    )
            xero_id = existing.get("InvoiceID") if existing else None
        if existing and existing.get("Status") in {"PAID", "VOIDED", "DELETED"}:
            _mark_invoice(invoice_id, {
                "xero_invoice_id": existing.get("InvoiceID"),
                "xero_status": existing.get("Status"),
                "xero_synced_at": _iso(_now()),
                "xero_sync_error": None,
            })
            return {"ok": True, "message": f"Already {str(existing.get('Status')).lower()} in Xero."}
        if existing and float(existing.get("AmountPaid") or 0) > 0:
            return {"ok": True, "message": "Part paid in Xero, so it was left as it is."}

        contact = await _contact_id(row, _payer_name(invoice, participant), invoice.get("recipient_email"))
        tz = head_office_timezone(org_id)
        issued = invoice.get("issued_at") or invoice.get("finalized_at")
        invoice_date = (shift_local_date(issued, tz) if issued else None) or app_today(tz)
        payload = build_invoice_payload(
            invoice,
            contact_id=contact,
            participant=participant,
            conn_settings=conn_settings,
            invoice_date=invoice_date.isoformat(),
            xero_invoice_id=xero_id,
        )
        saved = await _api(row, "POST", "/Invoices", json={"Invoices": [payload]})
        result = (saved.get("Invoices") or [{}])[0]
        if result.get("HasErrors") or result.get("ValidationErrors"):
            message = "; ".join(e.get("Message", "") for e in result.get("ValidationErrors") or []) or "Xero didn't accept it."
            raise XeroError(message)
        _mark_invoice(invoice_id, {
            "xero_invoice_id": result.get("InvoiceID"),
            "xero_status": result.get("Status"),
            "xero_synced_at": _iso(_now()),
            "xero_sync_error": None,
        })
        _save_connection(org_id, {"last_sync_at": _iso(_now()), "last_error": None, "last_error_at": None})
        return {"ok": True, "message": "Sent to Xero."}
    except XeroError as exc:
        _mark_invoice(invoice_id, {"xero_sync_error": str(exc)[:500]})
        _note_error(org_id, str(exc) if isinstance(exc, XeroAuthError) else None)
        return {"ok": False, "message": str(exc)}


async def void_invoice(org_id: str, invoice_id: str, *, row: Optional[dict] = None) -> dict:
    """A cancelled CareCliQ invoice: void (or delete, if a draft) its Xero copy."""
    row = row or _load_connection(org_id)
    invoice = _load_invoice(org_id, invoice_id) if row else None
    if not row or not invoice or not invoice.get("xero_invoice_id"):
        return {"ok": True, "message": "Nothing in Xero to void."}
    try:
        got = await _api(row, "GET", f"/Invoices/{invoice['xero_invoice_id']}")
        current = (got.get("Invoices") or [{}])[0]
        state = current.get("Status")
        if state in {"VOIDED", "DELETED"}:
            new_state = state
        elif state == "PAID" or float(current.get("AmountPaid") or 0) > 0:
            raise XeroError("It's already been paid in Xero, so it can't be voided there. Refund or credit it in Xero.")
        else:
            new_state = "DELETED" if state in {"DRAFT", "SUBMITTED"} else "VOIDED"
            await _api(row, "POST", f"/Invoices/{invoice['xero_invoice_id']}", json={
                "Invoices": [{"InvoiceID": invoice["xero_invoice_id"], "Status": new_state}],
            })
        _mark_invoice(invoice_id, {"xero_status": new_state, "xero_synced_at": _iso(_now()), "xero_sync_error": None})
        return {"ok": True, "message": f"{new_state.capitalize()} in Xero."}
    except XeroError as exc:
        _mark_invoice(invoice_id, {"xero_sync_error": str(exc)[:500]})
        return {"ok": False, "message": str(exc)}


async def push_invoice_for_user(user: dict, invoice_id: str) -> dict:
    """The "Send to Xero" button on an invoice."""
    from .billing_service import BILLING_ROLES  # local import: billing imports this module

    if get_user_role(user) not in BILLING_ROLES:
        raise HTTPException(status_code=403, detail="Billing access is not available for this role.")
    org_id = str(get_user_organization_id(user))
    if not _load_connection(org_id):
        raise HTTPException(status_code=409, detail="Xero isn't connected. A managing director can connect it in Settings > Integrations.")
    result = await push_invoice(org_id, invoice_id)
    if not result["ok"]:
        raise HTTPException(status_code=502, detail=result["message"])
    return result


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------

def _payment_details(xero_invoice: dict) -> tuple[str, Optional[str]]:
    payments = sorted(
        xero_invoice.get("Payments") or [],
        key=lambda p: parse_xero_date(p.get("Date")) or "",
    )
    last = payments[-1] if payments else {}
    paid_on = (
        parse_xero_date(xero_invoice.get("FullyPaidOnDate"))
        or parse_xero_date(last.get("Date"))
        or app_today().isoformat()
    )
    reference = str(last.get("Reference") or "").strip() or None
    return paid_on, reference


async def check_payments(org_id: str, *, row: Optional[dict] = None) -> dict:
    """Mark CareCliQ invoices paid when Xero has them paid."""
    row = row or _load_connection(org_id)
    if not row:
        return {"paid": 0, "checked": 0}
    open_rows = (
        get_supabase_admin()
        .table("invoices")
        .select("id, status, xero_invoice_id, xero_status, invoice_number")
        .eq("organization_id", org_id)
        .in_("status", sorted(APPROVED_STATUSES))
        .execute()
    ).data or []
    open_rows = [r for r in open_rows if r.get("xero_invoice_id")]
    paid = 0
    by_xero_id = {str(r["xero_invoice_id"]): r for r in open_rows}
    ids = list(by_xero_id)
    for start in range(0, len(ids), ID_BATCH):
        batch = ids[start:start + ID_BATCH]
        found = await _api(row, "GET", "/Invoices", params={"IDs": ",".join(batch)})
        for xero_invoice in found.get("Invoices") or []:
            ours = by_xero_id.get(str(xero_invoice.get("InvoiceID")))
            if not ours:
                continue
            state = xero_invoice.get("Status")
            if state == "PAID":
                paid_on, reference = _payment_details(xero_invoice)
                now = _iso(_now())
                _mark_invoice(str(ours["id"]), {
                    "status": "paid",
                    "paid_at": now,
                    "payment_date": paid_on,
                    "payment_reference": reference or "Paid in Xero",
                    "payment_method": "other",
                    "xero_status": "PAID",
                    "xero_synced_at": now,
                    "xero_sync_error": None,
                    "updated_at": now,
                })
                await audit_service.log_action(
                    action_type="invoice.status_changed",
                    entity_type="invoice",
                    entity_id=str(ours["id"]),
                    organization_id=org_id,
                    before_state={"status": ours.get("status")},
                    after_state={"status": "paid"},
                    details={"source": "xero", "payment_date": paid_on, "reference": reference},
                )
                paid += 1
            elif state and state != ours.get("xero_status"):
                note = None
                if state in {"VOIDED", "DELETED"}:
                    note = f"{state.capitalize()} in Xero but still open here. Cancel it in CareCliQ, or send it again."
                _mark_invoice(str(ours["id"]), {"xero_status": state, "xero_sync_error": note})
    _save_connection(org_id, {"last_payment_check_at": _iso(_now())})
    return {"paid": paid, "checked": len(ids)}


async def _retry_unsent(org_id: str, row: dict) -> dict:
    if not _settings_of(row).get("auto_send"):
        return {"sent": 0, "failed": 0}
    rows = (
        get_supabase_admin()
        .table("invoices")
        .select("id, status, xero_invoice_id")
        .eq("organization_id", org_id)
        .in_("status", sorted(APPROVED_STATUSES))
        .is_("xero_invoice_id", "null")
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
            if "connection" in result["message"].lower() or "reconnect" in result["message"].lower():
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
    except XeroError as exc:
        _note_error(org_id, str(exc))
        raise


async def sync_now(user: dict) -> dict:
    """The "Sync now" button: send what's waiting and check for payments."""
    org_id = _require_director(user)
    if not _load_connection(org_id):
        raise HTTPException(status_code=409, detail="Connect Xero first.")
    try:
        result = await sync_organization(org_id)
    except XeroError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {**result, "status": get_status(user)}


async def run_xero_pass() -> int:
    """Scheduler: every connected organisation, one at a time."""
    if not is_configured():
        return 0
    try:
        rows = (get_supabase_admin().table("xero_connections").select("organization_id").execute()).data or []
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
            logger.warning("Xero sync failed for %s: %s", r.get("organization_id"), exc)
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
            await void_invoice(org_id, invoice_id, row=row)
        elif status in APPROVED_STATUSES and _settings_of(row).get("auto_send"):
            await push_invoice(org_id, invoice_id, row=row)
    except Exception as exc:  # never let Xero break invoicing
        logger.warning("Xero follow-up for invoice %s failed: %s", invoice_id, exc)


def invoice_status_changed(invoice: dict, previous_status: Optional[str]) -> None:
    """Called by billing after an invoice's status changes. Runs in the
    background; does nothing when Xero isn't set up or connected."""
    if not is_configured() or not invoice:
        return
    status = str(invoice.get("status") or "")
    if status == previous_status:
        return
    if status in CLOSED_STATUSES:
        relevant = bool(invoice.get("xero_invoice_id"))
    elif status in APPROVED_STATUSES:
        # Newly approved (or re-approved after reopening), or approved but
        # never sent. Sent -> overdue and the like change nothing in Xero.
        relevant = previous_status not in APPROVED_STATUSES or not invoice.get("xero_invoice_id")
    else:
        relevant = False
    if not relevant:
        return
    org_id = invoice.get("organization_id")
    if org_id and invoice.get("id"):
        _spawn(_after_change(str(org_id), str(invoice["id"]), status))
