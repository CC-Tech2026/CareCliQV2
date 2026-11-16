"""Webhooks: CareCliQ tells other systems (such as CORA Workforce) when
something changes, by POSTing JSON to an address they give us.

- A managing director adds an endpoint (an https address) and picks events.
  Its signing secret ("whsec_...") is shown once.
- Each delivery is signed: header ``CareCliQ-Signature: t=<unix time>,v1=<hex>``
  where v1 is HMAC-SHA256 of ``"<t>.<raw body>"`` with the secret. Receivers
  should check it and that t is recent. ``CareCliQ-Event`` names the event and
  ``CareCliQ-Delivery`` is unique per attempt set; the body's ``id`` is the
  same for every endpoint the event went to, so it can be used to
  de-duplicate.
- A 2xx answer within 10 seconds counts as delivered. Anything else is tried
  again after 1, 5, 15 and 60 minutes, then 3, 6, 12 and 24 hours, then
  marked failed. Every attempt is kept so the director can see what happened.
- Addresses must be https and must not point into private networks (no
  localhost, 10.x, 169.254.x...), checked when saved and again when sent.
  WEBHOOKS_ALLOW_PRIVATE=true lifts that for local testing only.

Events are emitted with ``emit`` from the services that change things; it
never blocks or fails the change itself.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import ipaddress
import json
import logging
import os
import secrets
import socket
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from ..core.access import get_user_id
from . import audit_service
from .pii_service import decrypt_field, encrypt_field, encryption_key_usable
from .public_api_service import _require_director, _schema_missing
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

EVENTS: dict[str, str] = {
    "worker.created": "A worker joins the organisation.",
    "worker.updated": "A worker's details change.",
    "worker.deactivated": "A worker is deactivated.",
    "credential.created": "A credential is added.",
    "credential.updated": "A credential changes (status, dates, verification).",
    "credential.deleted": "A credential is removed.",
    "training.completed": "A worker completes training, or a completion is reviewed.",
}
RETRY_AFTER = [
    timedelta(minutes=1), timedelta(minutes=5), timedelta(minutes=15), timedelta(hours=1),
    timedelta(hours=3), timedelta(hours=6), timedelta(hours=12), timedelta(hours=24),
]
MAX_ATTEMPTS = len(RETRY_AFTER) + 1
TIMEOUT = 10
MAX_ENDPOINTS = 10


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _allow_private() -> bool:
    return os.environ.get("WEBHOOKS_ALLOW_PRIVATE", "false").lower() == "true"


def _seal(secret: str) -> str:
    return encrypt_field(secret) if encryption_key_usable() else secret


def check_url(url: str) -> str:
    """https only, and not into private networks. Returns the cleaned URL."""
    url = (url or "").strip()
    parsed = urlparse(url)
    allow_private = _allow_private()
    if parsed.scheme != "https" and not (allow_private and parsed.scheme == "http"):
        raise HTTPException(status_code=422, detail="Webhook addresses must start with https://.")
    host = parsed.hostname
    if not host or len(url) > 2000:
        raise HTTPException(status_code=422, detail="That isn't a valid web address.")
    if allow_private:
        return url
    try:
        infos = socket.getaddrinfo(host, parsed.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise HTTPException(status_code=422, detail=f"Couldn't find {host}. Check the address.") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise HTTPException(status_code=422, detail="Webhook addresses can't point to a private network.")
    return url


def sign(secret: str, timestamp: int, body: bytes) -> str:
    digest = hmac.new(secret.encode("utf-8"), f"{timestamp}.".encode("utf-8") + body, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


# ---------------------------------------------------------------------------
# Endpoints (directors, through the website)
# ---------------------------------------------------------------------------

def _public_endpoint(row: dict) -> dict:
    return {
        "id": row["id"],
        "url": row.get("url"),
        "description": row.get("description"),
        "events": row.get("events") or [],
        "active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at"),
        "last_delivery_at": row.get("last_delivery_at"),
        "last_status_code": row.get("last_status_code"),
        "failure_count": row.get("failure_count") or 0,
    }


def _clean_events(events: Optional[list[str]]) -> list[str]:
    chosen = sorted(set(events or []))
    if not chosen or any(e not in EVENTS for e in chosen):
        raise HTTPException(status_code=422, detail="Choose which events to send.")
    return chosen


def list_endpoints(user: dict) -> list[dict]:
    org_id = _require_director(user)
    try:
        rows = (get_supabase_admin().table("webhook_endpoints").select("*").eq("organization_id", org_id).execute()).data or []
    except Exception as exc:
        if _schema_missing(exc):
            return []
        raise
    rows.sort(key=lambda r: str(r.get("created_at") or ""))
    return [_public_endpoint(r) for r in rows]


async def create_endpoint(user: dict, url: str, events: list[str], description: Optional[str] = None) -> dict:
    org_id = _require_director(user)
    db = get_supabase_admin()
    existing = (db.table("webhook_endpoints").select("id").eq("organization_id", org_id).execute()).data or []
    if len(existing) >= MAX_ENDPOINTS:
        raise HTTPException(status_code=409, detail=f"Up to {MAX_ENDPOINTS} webhook addresses per organisation.")
    secret = "whsec_" + secrets.token_urlsafe(32)
    row = {
        "organization_id": org_id,
        "url": check_url(url),
        "description": (description or "").strip()[:200] or None,
        "secret": _seal(secret),
        "events": _clean_events(events),
        "created_by": str(get_user_id(user)),
    }
    saved = (db.table("webhook_endpoints").insert(row).execute()).data or [row]
    await audit_service.log_action(
        action_type="integration.webhook_created",
        entity_type="webhook_endpoint",
        entity_id=str(saved[0].get("id") or ""),
        user_id=str(get_user_id(user)),
        organization_id=org_id,
        details={"url": row["url"], "events": row["events"]},
    )
    return {**_public_endpoint(saved[0]), "secret": secret}


def _own_endpoint(org_id: str, endpoint_id: str) -> dict:
    rows = (
        get_supabase_admin().table("webhook_endpoints").select("*").eq("id", endpoint_id).eq("organization_id", org_id).limit(1).execute()
    ).data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Webhook not found.")
    return rows[0]


def update_endpoint(user: dict, endpoint_id: str, data: dict) -> dict:
    org_id = _require_director(user)
    _own_endpoint(org_id, endpoint_id)
    changes: dict[str, Any] = {"updated_at": _iso(_now())}
    if "url" in data:
        changes["url"] = check_url(data["url"])
    if "events" in data:
        changes["events"] = _clean_events(data["events"])
    if "description" in data:
        changes["description"] = (data["description"] or "").strip()[:200] or None
    if "active" in data:
        changes["is_active"] = bool(data["active"])
        if changes["is_active"]:
            changes["failure_count"] = 0
    saved = (get_supabase_admin().table("webhook_endpoints").update(changes).eq("id", endpoint_id).execute()).data or []
    return _public_endpoint(saved[0] if saved else _own_endpoint(org_id, endpoint_id))


async def delete_endpoint(user: dict, endpoint_id: str) -> dict:
    org_id = _require_director(user)
    row = _own_endpoint(org_id, endpoint_id)
    get_supabase_admin().table("webhook_endpoints").delete().eq("id", endpoint_id).execute()
    await audit_service.log_action(
        action_type="integration.webhook_deleted",
        entity_type="webhook_endpoint",
        entity_id=endpoint_id,
        user_id=str(get_user_id(user)),
        organization_id=org_id,
        details={"url": row.get("url")},
    )
    return {"ok": True}


def recent_deliveries(user: dict, endpoint_id: str, limit: int = 20) -> list[dict]:
    org_id = _require_director(user)
    _own_endpoint(org_id, endpoint_id)
    rows = (
        get_supabase_admin().table("webhook_deliveries").select(
            "id, event_type, event_id, status, attempts, response_status, error, created_at, delivered_at, next_attempt_at"
        ).eq("endpoint_id", endpoint_id).execute()
    ).data or []
    rows.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
    return rows[:limit]


async def send_test(user: dict, endpoint_id: str) -> dict:
    """A "ping" to check the address works; it doesn't count towards failures."""
    org_id = _require_director(user)
    endpoint = _own_endpoint(org_id, endpoint_id)
    event = _event(org_id, "ping", {"message": "Test from CareCliQ. Your webhook is set up."})
    result = await _post(endpoint, event, delivery_id=str(uuid.uuid4()))
    return {"ok": result["ok"], "status": result.get("status"), "message": result.get("message")}


# ---------------------------------------------------------------------------
# Sending
# ---------------------------------------------------------------------------

def _event(org_id: str, event_type: str, data: dict) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "type": event_type,
        "created_at": _iso(_now()),
        "organization_id": org_id,
        "data": data,
    }


async def _post(endpoint: dict, event: dict, *, delivery_id: str) -> dict:
    try:
        check_url(endpoint["url"])
    except HTTPException as exc:
        return {"ok": False, "message": str(exc.detail)}
    body = json.dumps(event, separators=(",", ":"), default=str).encode("utf-8")
    timestamp = int(time.time())
    secret = decrypt_field(endpoint["secret"])
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "CareCliQ-Webhooks/1",
        "CareCliQ-Event": event["type"],
        "CareCliQ-Delivery": delivery_id,
        "CareCliQ-Signature": sign(secret, timestamp, body),
    }
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False) as client:
            resp = await client.post(endpoint["url"], content=body, headers=headers)
    except httpx.HTTPError as exc:
        return {"ok": False, "message": f"Couldn't reach the address: {exc.__class__.__name__}"}
    ok = 200 <= resp.status_code < 300
    return {
        "ok": ok,
        "status": resp.status_code,
        "body": (resp.text or "")[:1000],
        "message": None if ok else f"The address answered {resp.status_code}.",
    }


async def deliver(delivery: dict, endpoint: Optional[dict] = None) -> bool:
    db = get_supabase_admin()
    if endpoint is None:
        rows = (db.table("webhook_endpoints").select("*").eq("id", delivery["endpoint_id"]).limit(1).execute()).data or []
        endpoint = rows[0] if rows else None
    if not endpoint or not endpoint.get("is_active", True):
        db.table("webhook_deliveries").update({"status": "failed", "error": "The webhook was turned off or removed."}).eq(
            "id", delivery["id"]
        ).execute()
        return False
    result = await _post(endpoint, delivery["payload"], delivery_id=str(delivery["id"]))
    attempts = int(delivery.get("attempts") or 0) + 1
    now = _now()
    update: dict[str, Any] = {
        "attempts": attempts,
        "response_status": result.get("status"),
        "response_body": result.get("body"),
        "error": result.get("message"),
    }
    if result["ok"]:
        update.update({"status": "delivered", "delivered_at": _iso(now)})
    elif attempts >= MAX_ATTEMPTS:
        update["status"] = "failed"
    else:
        update["next_attempt_at"] = _iso(now + RETRY_AFTER[attempts - 1])
    db.table("webhook_deliveries").update(update).eq("id", delivery["id"]).execute()
    db.table("webhook_endpoints").update({
        "last_delivery_at": _iso(now),
        "last_status_code": result.get("status"),
        "failure_count": 0 if result["ok"] else int(endpoint.get("failure_count") or 0) + 1,
    }).eq("id", endpoint["id"]).execute()
    return result["ok"]


_background: set[asyncio.Task] = set()


def _spawn(coro) -> None:
    try:
        task = asyncio.get_running_loop().create_task(coro)
    except RuntimeError:
        coro.close()
        return
    _background.add(task)
    task.add_done_callback(_background.discard)


async def _queue_and_send(org_id: str, event_type: str, data: dict) -> None:
    try:
        db = get_supabase_admin()
        endpoints = (
            db.table("webhook_endpoints").select("*").eq("organization_id", org_id).eq("is_active", True).execute()
        ).data or []
        targets = [e for e in endpoints if event_type in (e.get("events") or [])]
        if not targets:
            return
        event = _event(org_id, event_type, data)
        for endpoint in targets:
            row = {
                "organization_id": org_id,
                "endpoint_id": endpoint["id"],
                "event_type": event_type,
                "event_id": event["id"],
                "payload": event,
                "status": "pending",
                "attempts": 0,
                # Sent straight away below. The retry pass (every minute)
                # leaves it alone until then, or it could send the same
                # delivery a second time while this one is still waiting
                # for an answer. If this attempt never finishes, the retry
                # pass picks it up.
                "next_attempt_at": _iso(_now() + RETRY_AFTER[0]),
            }
            saved = (db.table("webhook_deliveries").insert(row).execute()).data or []
            if saved:
                await deliver(saved[0], endpoint)
    except Exception as exc:
        if not _schema_missing(exc):
            logger.warning("Webhook %s for %s failed to queue: %s", event_type, org_id, exc)


def emit(org_id: Optional[str], event_type: str, data: dict) -> None:
    """Tell this organisation's webhooks about a change. Never raises; runs in
    the background so the change itself isn't slowed down."""
    if not org_id or event_type not in EVENTS:
        return
    _spawn(_queue_and_send(str(org_id), event_type, data))


def emit_credential(row: Optional[dict], event_type: str = "credential.updated") -> None:
    """A credential was added or changed: send it in the API's shape."""
    if not row:
        return
    from .public_api_service import serialize_credential

    emit(row.get("organization_id"), event_type, serialize_credential(row))


def emit_credential_deleted(row: Optional[dict]) -> None:
    if not row:
        return
    emit(row.get("organization_id"), "credential.deleted", {
        "id": row.get("id"), "worker_id": row.get("user_id"), "type": row.get("credential_type"),
    })


async def _worker_then_send(org_id: str, user_id: str, event_type: str) -> None:
    from .public_api_service import STAFF_ROLES, serialize_worker

    try:
        db = get_supabase_admin()
        members = (
            db.table("organization_members").select("*").eq("organization_id", org_id).eq("user_id", user_id).limit(1).execute()
        ).data or []
        if not members or members[0].get("role") not in STAFF_ROLES:
            return  # participants and family logins aren't workers
        users = (db.table("users").select(
            "id, full_name, email, phone, role, employment_type, suburb, is_active, deactivated_at"
        ).eq("id", user_id).limit(1).execute()).data or []
        if users:
            await _queue_and_send(org_id, event_type, serialize_worker(members[0], users[0]))
    except Exception as exc:
        if not _schema_missing(exc):
            logger.warning("Webhook %s for worker %s failed: %s", event_type, user_id, exc)


def emit_worker(org_id: Optional[str], user_id: Optional[str], event_type: str) -> None:
    """A worker joined, changed or was deactivated: send them in the API's shape."""
    if org_id and user_id and event_type in EVENTS:
        _spawn(_worker_then_send(str(org_id), str(user_id), event_type))


async def _completion_then_send(org_id: str, completion_id: Optional[str], worker_id: Optional[str], module_id: Optional[str]) -> None:
    from .public_api_service import serialize_completion

    try:
        db = get_supabase_admin()
        query = db.table("worker_training_completions").select("*").eq("organization_id", org_id)
        query = query.eq("id", completion_id) if completion_id else query.eq("worker_id", worker_id).eq("module_id", module_id)
        rows = (query.limit(1).execute()).data or []
        if not rows:
            return
        modules = (db.table("training_modules").select("*").eq("id", rows[0].get("module_id")).limit(1).execute()).data or []
        await _queue_and_send(org_id, "training.completed", serialize_completion(rows[0], modules[0] if modules else None))
    except Exception as exc:
        if not _schema_missing(exc):
            logger.warning("Webhook training.completed for %s failed: %s", org_id, exc)


def emit_training(org_id: Optional[str], *, completion_id: Optional[str] = None,
                  worker_id: Optional[str] = None, module_id: Optional[str] = None) -> None:
    """Training was completed or its completion reviewed."""
    if org_id and (completion_id or (worker_id and module_id)):
        _spawn(_completion_then_send(str(org_id), completion_id, worker_id, module_id))


async def run_webhook_pass(limit: int = 100) -> int:
    """Scheduler: send deliveries whose retry time has come."""
    try:
        due = (
            get_supabase_admin()
            .table("webhook_deliveries")
            .select("*")
            .eq("status", "pending")
            .lte("next_attempt_at", _iso(_now()))
            .limit(limit)
            .execute()
        ).data or []
    except Exception as exc:
        if _schema_missing(exc):
            return 0
        raise
    sent = 0
    for delivery in due:
        try:
            if await deliver(delivery):
                sent += 1
        except Exception as exc:
            logger.warning("Webhook delivery %s failed: %s", delivery.get("id"), exc)
    return sent
