"""The CareCliQ API for other systems (for example CORA Workforce).

API keys
- A managing director creates a key in Settings > Integrations > API and
  webhooks. The key ("cc_live_" + 40 random characters) is shown once; we keep
  only its SHA-256 fingerprint and its first characters, so it can be told
  apart in the list and revoked, but never read back.
- A request sends it as ``Authorization: Bearer cc_live_...`` (or
  ``X-API-Key``). The key decides the organisation: there is no way to ask for
  another organisation's data.

What the API returns
- Workers (staff: support workers, coordinators, directors), their
  credentials and their training, in a stable shape (see the _worker,
  _credential and _completion serialisers), the same shape the webhooks send.
- Lists take ``limit`` (up to 500) and ``offset`` and say whether there's more.
- Documents themselves (credential files) aren't exposed; ``has_document``
  says whether one is on file.
"""

from __future__ import annotations

import hashlib
import secrets
import time
from collections import defaultdict, deque
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException, Request

from ..core.access import get_user_id, get_user_organization_id, get_user_role
from . import audit_service
from .supabase_client import get_supabase_admin

KEY_PREFIX = "cc_live_"
SCOPES = {
    "workers:read": "Workers: names, contact details, roles, employee IDs, employment type and status.",
    "credentials:read": "Workers' credentials: type, number, issuer, dates, status and verification.",
    "training:read": "Training modules and each worker's completions.",
}
DEFAULT_SCOPES = sorted(SCOPES)
STAFF_ROLES = ("support_worker", "support_coordinator", "managing_director")
MAX_LIMIT = 500
# Requests per key per minute.
RATE_LIMIT = 300
# How often last_used_at is written (not on every request).
TOUCH_EVERY = timedelta(minutes=5)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _require_director(user: dict) -> str:
    if get_user_role(user) != "managing_director":
        raise HTTPException(status_code=403, detail="Only a managing director can manage API keys and webhooks.")
    org_id = get_user_organization_id(user)
    if not org_id:
        raise HTTPException(status_code=403, detail="No organisation on this account.")
    return str(org_id)


def _schema_missing(exc: Exception) -> bool:
    text = str(exc).lower()
    return ("api_keys" in text or "webhook_" in text) and (
        "does not exist" in text or "could not find" in text or "pgrst205" in text
    )


# ---------------------------------------------------------------------------
# Managing keys (directors, through the website)
# ---------------------------------------------------------------------------

def _public_key(row: dict) -> dict:
    return {
        "id": row["id"],
        "name": row.get("name"),
        "prefix": row.get("key_prefix"),
        "scopes": row.get("scopes") or [],
        "created_at": row.get("created_at"),
        "last_used_at": row.get("last_used_at"),
        "revoked_at": row.get("revoked_at"),
    }


def list_keys(user: dict) -> list[dict]:
    org_id = _require_director(user)
    try:
        rows = (
            get_supabase_admin().table("api_keys").select("*").eq("organization_id", org_id).execute()
        ).data or []
    except Exception as exc:
        if _schema_missing(exc):
            return []
        raise
    rows.sort(key=lambda r: (r.get("revoked_at") is not None, str(r.get("created_at") or "")), reverse=False)
    return [_public_key(r) for r in rows]


async def create_key(user: dict, name: str, scopes: Optional[list[str]] = None) -> dict:
    """Make a key. The full key is in the response this once and never again."""
    org_id = _require_director(user)
    name = (name or "").strip()
    if not name or len(name) > 80:
        raise HTTPException(status_code=422, detail="Give the key a name, such as the system it's for.")
    chosen = sorted(set(scopes or DEFAULT_SCOPES))
    unknown = [s for s in chosen if s not in SCOPES]
    if unknown or not chosen:
        raise HTTPException(status_code=422, detail="Choose what the key can read.")
    raw = KEY_PREFIX + secrets.token_urlsafe(30)
    row = {
        "organization_id": org_id,
        "name": name,
        "key_prefix": raw[: len(KEY_PREFIX) + 8],
        "key_hash": hash_key(raw),
        "scopes": chosen,
        "created_by": str(get_user_id(user)),
    }
    saved = (get_supabase_admin().table("api_keys").insert(row).execute()).data or [row]
    await audit_service.log_action(
        action_type="integration.api_key_created",
        entity_type="api_key",
        entity_id=str(saved[0].get("id") or ""),
        user_id=str(get_user_id(user)),
        organization_id=org_id,
        details={"name": name, "scopes": chosen, "prefix": row["key_prefix"]},
    )
    return {**_public_key(saved[0]), "key": raw}


async def revoke_key(user: dict, key_id: str) -> dict:
    org_id = _require_director(user)
    db = get_supabase_admin()
    rows = (db.table("api_keys").select("*").eq("id", key_id).eq("organization_id", org_id).limit(1).execute()).data or []
    if not rows:
        raise HTTPException(status_code=404, detail="API key not found.")
    if not rows[0].get("revoked_at"):
        db.table("api_keys").update({"revoked_at": _iso(_now()), "revoked_by": str(get_user_id(user))}).eq(
            "id", key_id
        ).execute()
        await audit_service.log_action(
            action_type="integration.api_key_revoked",
            entity_type="api_key",
            entity_id=key_id,
            user_id=str(get_user_id(user)),
            organization_id=org_id,
            details={"name": rows[0].get("name"), "prefix": rows[0].get("key_prefix")},
        )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Checking a key on each API request
# ---------------------------------------------------------------------------

_recent_requests: dict[str, deque] = defaultdict(deque)


def _rate_limit(key_id: str) -> None:
    window = _recent_requests[key_id]
    now = time.monotonic()
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= RATE_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"Too many requests: up to {RATE_LIMIT} a minute per key.",
            headers={"Retry-After": "30"},
        )
    window.append(now)


def _raw_key_from(request: Request) -> Optional[str]:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return (request.headers.get("x-api-key") or "").strip() or None


def authenticate(request: Request, scope: Optional[str]) -> dict:
    """The organisation and key behind this request, or 401/403. ``scope``
    None accepts any valid key (for /v1/organisation)."""
    raw = _raw_key_from(request)
    if not raw or not raw.startswith(KEY_PREFIX):
        raise HTTPException(
            status_code=401,
            detail="Send your CareCliQ API key as 'Authorization: Bearer cc_live_...'.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        rows = (
            get_supabase_admin().table("api_keys").select("*").eq("key_hash", hash_key(raw)).limit(1).execute()
        ).data or []
    except Exception as exc:
        if _schema_missing(exc):
            raise HTTPException(status_code=503, detail="The CareCliQ API isn't available yet.") from exc
        raise
    key = rows[0] if rows else None
    if not key or key.get("revoked_at"):
        raise HTTPException(status_code=401, detail="This API key isn't valid or has been revoked.")
    if scope is not None and scope not in (key.get("scopes") or []):
        raise HTTPException(status_code=403, detail=f"This API key can't read that. It needs the '{scope}' permission.")
    _rate_limit(str(key["id"]))
    last = key.get("last_used_at")
    try:
        stale = not last or datetime.fromisoformat(str(last).replace("Z", "+00:00")) < _now() - TOUCH_EVERY
    except ValueError:
        stale = True
    if stale:
        get_supabase_admin().table("api_keys").update({"last_used_at": _iso(_now())}).eq("id", key["id"]).execute()
    return {"organization_id": str(key["organization_id"]), "key_id": str(key["id"]), "scopes": key.get("scopes") or []}


# ---------------------------------------------------------------------------
# The data, in the shapes the API and webhooks share
# ---------------------------------------------------------------------------

def _page(rows: list[dict], limit: int, offset: int) -> dict:
    limit = max(1, min(int(limit or 100), MAX_LIMIT))
    offset = max(0, int(offset or 0))
    chunk = rows[offset: offset + limit]
    more = offset + limit < len(rows)
    return {"data": chunk, "has_more": more, "next_offset": offset + limit if more else None, "total": len(rows)}


def serialize_worker(member: dict, user: dict) -> dict:
    active = bool(member.get("is_active", True)) and bool(user.get("is_active", True)) and not user.get("deactivated_at")
    return {
        "id": user.get("id"),
        "employee_id": member.get("employee_id"),
        "full_name": user.get("full_name"),
        "email": user.get("email"),
        "phone": user.get("phone"),
        "role": member.get("role") or user.get("role"),
        "employment_type": user.get("employment_type"),
        "suburb": user.get("suburb"),
        "active": active,
        "joined_at": member.get("joined_at") or member.get("created_at"),
        "deactivated_at": user.get("deactivated_at"),
    }


def serialize_credential(row: dict) -> dict:
    expiry = row.get("expiry_date")
    try:
        expired = bool(expiry) and date.fromisoformat(str(expiry)[:10]) < date.today()
    except ValueError:
        expired = False
    return {
        "id": row.get("id"),
        "worker_id": row.get("user_id"),
        "type": row.get("credential_type"),
        "title": row.get("title"),
        "number": row.get("credential_number"),
        "screening_number": row.get("screening_number"),
        "issuer": row.get("issuer"),
        "issue_date": row.get("issue_date"),
        "expiry_date": expiry,
        "expired": expired,
        "status": row.get("status"),
        "verified": bool(row.get("verified_at")),
        "verified_at": row.get("verified_at"),
        "has_document": bool(row.get("file_path") or row.get("file_url")),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def serialize_module(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "title": row.get("title"),
        "code": row.get("module_code"),
        "category": row.get("category"),
        "requirement": row.get("requirement_type"),
        "provider": row.get("provider"),
        "requires_certification": bool(row.get("requires_certification")),
        "linked_credential_type": row.get("linked_credential_type"),
        "estimated_minutes": row.get("estimated_minutes"),
        "active": bool(row.get("is_active", True)),
    }


def serialize_completion(row: dict, module: Optional[dict]) -> dict:
    return {
        "id": row.get("id"),
        "worker_id": row.get("worker_id"),
        "module": serialize_module(module) if module else {"id": row.get("module_id")},
        "status": row.get("status"),
        "completed_at": row.get("completed_at"),
        "reviewed_at": row.get("reviewed_at"),
        "acknowledged": bool(row.get("acknowledged")),
        "created_at": row.get("created_at"),
    }


def _staff(org_id: str) -> list[tuple[dict, dict]]:
    db = get_supabase_admin()
    members = (
        db.table("organization_members").select("*").eq("organization_id", org_id).in_("role", list(STAFF_ROLES)).execute()
    ).data or []
    ids = [m["user_id"] for m in members if m.get("user_id")]
    users: dict[str, dict] = {}
    for start in range(0, len(ids), 200):
        batch = ids[start:start + 200]
        for u in (db.table("users").select(
            "id, full_name, email, phone, role, employment_type, suburb, is_active, deactivated_at"
        ).in_("id", batch).execute()).data or []:
            users[str(u["id"])] = u
    return [(m, users[str(m["user_id"])]) for m in members if str(m.get("user_id")) in users]


def list_workers(org_id: str, *, status: str = "active", role: Optional[str] = None, limit: int = 100, offset: int = 0) -> dict:
    workers = [serialize_worker(m, u) for m, u in _staff(org_id)]
    if role:
        workers = [w for w in workers if w["role"] == role]
    if status == "active":
        workers = [w for w in workers if w["active"]]
    elif status == "inactive":
        workers = [w for w in workers if not w["active"]]
    workers.sort(key=lambda w: (str(w.get("full_name") or "").lower(), str(w["id"])))
    return _page(workers, limit, offset)


def get_worker(org_id: str, worker_id: str) -> dict:
    for member, user in _staff(org_id):
        if str(user["id"]) == worker_id:
            return serialize_worker(member, user)
    raise HTTPException(status_code=404, detail="Worker not found.")


def list_credentials(
    org_id: str,
    *,
    worker_id: Optional[str] = None,
    status: Optional[str] = None,
    type_: Optional[str] = None,
    expiring_before: Optional[date] = None,
    updated_since: Optional[datetime] = None,
    limit: int = 100,
    offset: int = 0,
) -> dict:
    query = get_supabase_admin().table("credentials").select("*").eq("organization_id", org_id)
    if worker_id:
        query = query.eq("user_id", worker_id)
    if status:
        query = query.eq("status", status)
    if type_:
        query = query.eq("credential_type", type_)
    rows = (query.execute()).data or []
    if expiring_before:
        rows = [r for r in rows if r.get("expiry_date") and str(r["expiry_date"])[:10] <= expiring_before.isoformat()]
    if updated_since:
        cutoff = updated_since.astimezone(timezone.utc).isoformat()
        rows = [r for r in rows if str(r.get("updated_at") or r.get("created_at") or "") >= cutoff]
    data = [serialize_credential(r) for r in rows]
    data.sort(key=lambda c: (str(c.get("updated_at") or c.get("created_at") or ""), str(c["id"])))
    return _page(data, limit, offset)


def _modules(org_id: str) -> dict[str, dict]:
    rows = (get_supabase_admin().table("training_modules").select("*").eq("organization_id", org_id).execute()).data or []
    return {str(r["id"]): r for r in rows}


def list_training_modules(org_id: str, *, limit: int = 100, offset: int = 0) -> dict:
    data = [serialize_module(m) for m in _modules(org_id).values()]
    data.sort(key=lambda m: (str(m.get("title") or "").lower(), str(m["id"])))
    return _page(data, limit, offset)


def list_training_completions(
    org_id: str,
    *,
    worker_id: Optional[str] = None,
    status: Optional[str] = None,
    completed_since: Optional[datetime] = None,
    limit: int = 100,
    offset: int = 0,
) -> dict:
    query = get_supabase_admin().table("worker_training_completions").select("*").eq("organization_id", org_id)
    if worker_id:
        query = query.eq("worker_id", worker_id)
    if status:
        query = query.eq("status", status)
    rows = (query.execute()).data or []
    if completed_since:
        cutoff = completed_since.astimezone(timezone.utc).isoformat()
        rows = [r for r in rows if str(r.get("completed_at") or r.get("created_at") or "") >= cutoff]
    modules = _modules(org_id)
    data = [serialize_completion(r, modules.get(str(r.get("module_id")))) for r in rows]
    data.sort(key=lambda c: (str(c.get("completed_at") or c.get("created_at") or ""), str(c["id"])))
    return _page(data, limit, offset)


def organisation(org_id: str, key: dict) -> dict:
    """Who the key belongs to: a quick way for another system to test it."""
    name = None
    try:
        rows = (
            get_supabase_admin().table("organizations").select("organization_id, name").eq("organization_id", org_id).limit(1).execute()
        ).data or []
        name = (rows[0] if rows else {}).get("name")
    except Exception:
        name = None
    return {"organization_id": org_id, "name": name, "scopes": key.get("scopes") or []}
