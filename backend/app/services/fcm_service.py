"""Firebase Cloud Messaging delivery for compliance and safety alerts."""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from ..core.config import settings
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

_firebase_app: Any = None


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return (
        "does not exist" in err
        or "42703" in err
        or "pgrst" in err
        or "could not find" in err
    )


def _get_firebase_app() -> Any:
    global _firebase_app
    if _firebase_app is not None:
        return _firebase_app
    if not settings.firebase_enabled:
        return None
    try:
        import firebase_admin
        from firebase_admin import credentials
    except ImportError:
        logger.warning("firebase-admin not installed — FCM disabled")
        return None

    if firebase_admin._apps:
        _firebase_app = firebase_admin.get_app()
        return _firebase_app

    cred = None
    if settings.firebase_credentials_json:
        try:
            cred_info = json.loads(settings.firebase_credentials_json)
            cred = credentials.Certificate(cred_info)
        except json.JSONDecodeError as exc:
            logger.warning("Invalid FIREBASE_CREDENTIALS_JSON: %s", exc)
            return None
    elif settings.firebase_credentials_path:
        cred = credentials.Certificate(settings.firebase_credentials_path)
    else:
        try:
            cred = credentials.ApplicationDefault()
        except Exception as exc:
            logger.warning("Firebase credentials not configured: %s", exc)
            return None

    _firebase_app = firebase_admin.initialize_app(cred)
    return _firebase_app


def _lookup_fcm_tokens(user_id: str) -> list[str]:
    try:
        result = (
            get_supabase_admin()
            .table("user_push_tokens")
            .select("push_token")
            .eq("user_id", user_id)
            .eq("token_type", "fcm")
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
        logger.debug("FCM token lookup failed: %s", exc)
        return []


async def send_fcm_to_user(
    user_id: str,
    *,
    title: str,
    body: str,
    data: Optional[dict[str, Any]] = None,
    android_channel_id: str = "safety-alerts",
) -> bool:
    """Send FCM data+notification message to all registered FCM tokens for a user."""
    if not settings.firebase_enabled:
        logger.info("FCM disabled — would push to user %s", user_id)
        return False

    app = _get_firebase_app()
    if not app:
        return False

    tokens = _lookup_fcm_tokens(user_id)
    if not tokens:
        return False

    try:
        from firebase_admin import messaging
    except ImportError:
        return False

    payload_data = {str(k): str(v) for k, v in (data or {}).items() if v is not None}
    sent_any = False

    for token in tokens:
        message = messaging.Message(
            token=token,
            notification=messaging.Notification(
                title=title[:200],
                body=body[:500],
            ),
            data=payload_data,
            android=messaging.AndroidConfig(
                priority="high",
                notification=messaging.AndroidNotification(
                    channel_id=android_channel_id,
                    sound="default",
                ),
            ),
            apns=messaging.APNSConfig(
                headers={"apns-priority": "10"},
                payload=messaging.APNSPayload(
                    aps=messaging.Aps(sound="default", content_available=True),
                ),
            ),
        )
        try:
            messaging.send(message, app=app)
            sent_any = True
        except Exception as exc:
            err = str(exc).lower()
            if "not-registered" in err or "registration-token-not-registered" in err:
                logger.debug("Removing stale FCM token for user %s", user_id)
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
            else:
                logger.warning("FCM send failed for user %s: %s", user_id, exc)

    return sent_any
