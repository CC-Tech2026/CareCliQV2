"""Mobile/web push delivery via Expo Push API (CARECLIQV2-261)."""

from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from ..core.config import settings
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
) -> bool:
    if not push_token.strip():
        return False
    platform_norm = platform if platform in ("ios", "android", "web") else "web"
    try:
        get_supabase_admin().table("user_push_tokens").upsert(
            {
                "user_id": user_id,
                "device_id": device_id,
                "push_token": push_token.strip(),
                "platform": platform_norm,
            },
            on_conflict="user_id,device_id",
        ).execute()
        return True
    except Exception as exc:
        if _is_missing_schema_error(exc):
            logger.debug("user_push_tokens table missing — push registration skipped")
            return False
        logger.warning("Push token registration failed for %s: %s", user_id, exc)
        return False


def _lookup_tokens(user_id: str) -> list[str]:
    try:
        result = (
            get_supabase_admin()
            .table("user_push_tokens")
            .select("push_token")
            .eq("user_id", user_id)
            .execute()
        )
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
    """Send push to all registered devices for a user. Returns True if any send attempted."""
    tokens = _lookup_tokens(user_id)
    if not tokens:
        return False

    if not settings.expo_push_enabled:
        logger.info("Expo push disabled — would push to %s device(s) for user %s", len(tokens), user_id)
        return False

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
                return False
            return True
    except Exception as exc:
        logger.warning("Expo push request failed: %s", exc)
        return False
