"""Device push delivery: the mobile app via Expo Push API (CARECLIQV2-261)
and browsers via Web Push (web_push_service.py)."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from ..core.config import settings
from . import web_push_service
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return (
        "does not exist" in err
        or "42703" in err
        or "pgrst" in err
        or "could not find" in err
    )


def register_push_token(
    user_id: str,
    device_id: str,
    push_token: str,
    platform: str = "web",
    token_type: str = "expo",
) -> bool:
    if not push_token.strip():
        return False
    platform_norm = platform if platform in ("ios", "android", "web") else "web"
    token_type_norm = token_type if token_type in ("expo", "fcm", "webpush") else "expo"
    record: dict[str, str] = {
        "user_id": user_id,
        "device_id": device_id,
        "push_token": push_token.strip(),
        "platform": platform_norm,
        "token_type": token_type_norm,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        get_supabase_admin().table("user_push_tokens").upsert(
            record,
            on_conflict="user_id,device_id",
        ).execute()
        return True
    except Exception as exc:
        if _is_missing_schema_error(exc):
            logger.debug("user_push_tokens table missing — push registration skipped")
            return False
        if "23514" in str(exc) and token_type_norm == "webpush":
            logger.warning("user_push_tokens doesn't accept webpush yet — apply migration 245")
            return False
        logger.warning("Push token registration failed for %s: %s", user_id, exc)
        return False


def remove_push_token(user_id: str, device_id: str) -> None:
    try:
        (
            get_supabase_admin()
            .table("user_push_tokens")
            .delete()
            .eq("user_id", user_id)
            .eq("device_id", device_id)
            .execute()
        )
    except Exception as exc:
        logger.debug("Push token removal failed for %s: %s", user_id, exc)


def release_device_from_other_users(user_id: str, device_id: str) -> None:
    """A browser belongs to whoever turned on notifications in it last, so a
    shared office PC doesn't keep popping up the previous person's alerts."""
    try:
        (
            get_supabase_admin()
            .table("user_push_tokens")
            .delete()
            .eq("device_id", device_id)
            .neq("user_id", user_id)
            .execute()
        )
    except Exception as exc:
        logger.debug("Releasing device %s failed: %s", device_id, exc)


def list_push_devices(user_id: str) -> list[dict[str, Any]]:
    try:
        result = (
            get_supabase_admin()
            .table("user_push_tokens")
            .select("device_id, platform, token_type, push_token, updated_at, created_at")
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            logger.debug("Push device lookup failed: %s", exc)
        return []
    devices = []
    for row in result.data or []:
        token_type = row.get("token_type") or "expo"
        label = None
        if token_type == "webpush":
            label = (web_push_service.parse_subscription(row.get("push_token")) or {}).get("label")
        devices.append({
            "device_id": row.get("device_id"),
            "platform": row.get("platform"),
            "token_type": token_type,
            "label": label,
            "registered_at": row.get("updated_at") or row.get("created_at"),
        })
    return devices


def _lookup_tokens(user_id: str, token_type: str = "expo") -> list[str]:
    try:
        query = (
            get_supabase_admin()
            .table("user_push_tokens")
            .select("push_token")
            .eq("user_id", user_id)
        )
        if token_type:
            query = query.eq("token_type", token_type)
        result = query.execute()
        return [
            str(row["push_token"]).strip()
            for row in (result.data or [])
            if row.get("push_token")
        ]
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        logger.debug("Push token lookup failed: %s", exc)
        return []


async def send_push_to_user(
    user_id: str,
    *,
    title: str,
    body: str,
    data: Optional[dict[str, Any]] = None,
    priority: str = "default",
) -> bool:
    """Push to every device the user has registered: the mobile app (Expo)
    and any browser that turned notifications on. True if any device got it."""
    _, app_delivered = await _send_expo(user_id, title=title, body=body, data=data, priority=priority)
    _, web_delivered = await web_push_service.send_web_push_to_user(
        user_id, title=title, body=body, data=data, urgent=priority == "high"
    )
    return bool(app_delivered or web_delivered)


async def send_test_push(user_id: str) -> dict[str, Any]:
    """Sends a test to the app and to browsers separately and reports what
    reached where, so a user can check which of their devices will pop up."""
    title = "Test notification"
    body = "If you can see this, CareCliQ notifications reach this device."
    # A fresh tag each time, so a second test pops up rather than silently
    # replacing the first one if it's still on screen.
    data = {"event": "test", "action_url": "/", "tag": f"test:{int(time.time())}"}

    app_devices, app_delivered = await _send_expo(user_id, title=title, body=body, data=data, priority="default")
    web_devices, web_delivered = await web_push_service.send_web_push_to_user(
        user_id, title=title, body=body, data=data
    )
    return {
        "app": {"devices": app_devices, "delivered": app_delivered, "enabled": settings.expo_push_enabled},
        "browser": {"devices": web_devices, "delivered": web_delivered, "enabled": web_push_service.is_configured()},
    }


async def _send_expo(
    user_id: str,
    *,
    title: str,
    body: str,
    data: Optional[dict[str, Any]],
    priority: str,
) -> tuple[int, int]:
    """Returns (devices, delivered)."""
    tokens = _lookup_tokens(user_id)
    if not tokens:
        return 0, 0

    if not settings.expo_push_enabled:
        logger.info("Expo push disabled — would push to %s device(s) for user %s", len(tokens), user_id)
        return len(tokens), 0

    messages = []
    for token in tokens:
        msg: dict[str, Any] = {
            "to": token,
            "title": title[:200],
            "body": body[:500],
            "sound": "default",
        }
        if data:
            msg["data"] = data
        if priority == "high":
            msg["priority"] = "high"
            msg["channelId"] = "safety-alerts"
        messages.append(msg)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                EXPO_PUSH_URL,
                json=messages,
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    **(
                        {"Authorization": f"Bearer {settings.expo_access_token}"}
                        if settings.expo_access_token
                        else {}
                    ),
                },
            )
            if resp.status_code >= 400:
                logger.warning("Expo push failed (%s): %s", resp.status_code, resp.text[:300])
                return len(tokens), 0
            tickets = resp.json().get("data") or []
    except Exception as exc:
        logger.warning("Expo push request failed: %s", exc)
        return len(tokens), 0

    # Expo answers 200 for the whole batch and reports each device in its own
    # ticket, in message order. A 200 alone doesn't mean anything popped up.
    delivered = 0
    for token, ticket in zip(tokens, tickets):
        if ticket.get("status") == "ok":
            delivered += 1
            continue
        error = (ticket.get("details") or {}).get("error")
        if error == "DeviceNotRegistered":
            _remove_token_value(user_id, token)
        else:
            logger.warning("Expo push ticket error for user %s: %s", user_id, ticket.get("message") or error)
    return len(tokens), delivered


def _remove_token_value(user_id: str, token: str) -> None:
    try:
        (
            get_supabase_admin()
            .table("user_push_tokens")
            .delete()
            .eq("user_id", user_id)
            .eq("push_token", token)
            .execute()
        )
    except Exception:
        pass
