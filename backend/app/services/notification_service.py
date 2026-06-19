"""Worker notification dispatcher — respects user_notification_preferences (CARECLIQV2-259)."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from ..core.config import settings
from ..schemas.alert import AlertCreate
from . import alert_service
from .email_service import queue_worker_notification_email
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

NOTIFICATION_EVENTS = (
    "shift_reminder",
    "shift_change",
    "coordinator_message",
    "feedback_received",
    "certification_expiry",
)
NOTIFICATION_CHANNELS = ("push", "email", "sms")

EVENT_ALERT_TYPES = {
    "shift_reminder": "shift_reminder",
    "shift_change": "shift_change",
    "coordinator_message": "coordinator_message",
    "feedback_received": "feedback",
    "certification_expiry": "credential_expiry",
}


def default_notification_preferences() -> dict[str, dict[str, bool]]:
    return {
        event: {channel: True for channel in NOTIFICATION_CHANNELS}
        for event in NOTIFICATION_EVENTS
    }


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return (
        "does not exist" in err
        or "42703" in err
        or "pgrst" in err
        or "could not find" in err
    )


def get_effective_preferences(user_id: str) -> dict[str, dict[str, bool]]:
    """Merge notification prefs across all registered devices (OR per channel)."""
    defaults = default_notification_preferences()
    try:
        result = (
            get_supabase_admin()
            .table("user_notification_preferences")
            .select("preferences")
            .eq("user_id", user_id)
            .execute()
        )
        rows = result.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return defaults
        logger.debug("Notification prefs lookup failed for %s: %s", user_id, exc)
        return defaults

    if not rows:
        return defaults

    merged = {event: {channel: False for channel in NOTIFICATION_CHANNELS} for event in NOTIFICATION_EVENTS}
    for row in rows:
        stored = row.get("preferences") or {}
        for event in NOTIFICATION_EVENTS:
            event_prefs = stored.get(event) or {}
            for channel in NOTIFICATION_CHANNELS:
                if bool(event_prefs.get(channel, True)):
                    merged[event][channel] = True
    return merged


def _channel_enabled(prefs: dict, event: str, channel: str) -> bool:
    return bool((prefs.get(event) or {}).get(channel, True))


def _lookup_user_email(user_id: str) -> Optional[str]:
    try:
        result = (
            get_supabase_admin()
            .table("users")
            .select("email, pending_email")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        row = result.data if result else None
        if not row:
            return None
        return (row.get("email") or row.get("pending_email") or "").strip() or None
    except Exception as exc:
        logger.debug("User email lookup failed for %s: %s", user_id, exc)
        return None


def _was_delivered(user_id: str, event: str, reference_key: str, channel: str) -> bool:
    try:
        result = (
            get_supabase_admin()
            .table("notification_deliveries")
            .select("id")
            .eq("user_id", user_id)
            .eq("event", event)
            .eq("reference_key", reference_key)
            .eq("channel", channel)
            .limit(1)
            .execute()
        )
        return bool(result.data)
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return False
        logger.debug("Delivery dedup check failed: %s", exc)
        return False


def _record_delivery(user_id: str, event: str, reference_key: str, channel: str) -> None:
    try:
        get_supabase_admin().table("notification_deliveries").insert(
            {
                "user_id": user_id,
                "event": event,
                "reference_key": reference_key,
                "channel": channel,
            }
        ).execute()
    except Exception as exc:
        err = str(exc).lower()
        if "duplicate" in err or "23505" in err or "unique" in err:
            return
        if _is_missing_schema_error(exc):
            return
        logger.debug("Delivery record failed: %s", exc)


async def notify_worker(
    *,
    user_id: str,
    org_id: Optional[str],
    event: str,
    title: str,
    message: str,
    reference_key: str,
    severity: str = "medium",
    email_subject: Optional[str] = None,
    action_url: Optional[str] = None,
    participant_id: Optional[str] = None,
    session_id: Optional[str] = None,
    alert_type: Optional[str] = None,
) -> dict[str, Any]:
    """Deliver a worker notification via in-app alert and/or email based on saved prefs."""
    if event not in NOTIFICATION_EVENTS:
        raise ValueError(f"Unsupported notification event: {event}")

    prefs = get_effective_preferences(user_id)
    resolved_alert_type = alert_type or EVENT_ALERT_TYPES.get(event, event)
    action_url = action_url or f"{settings.frontend_base_url.rstrip('/')}/worker/profile"
    results: dict[str, Any] = {
        "user_id": user_id,
        "event": event,
        "reference_key": reference_key,
        "in_app": False,
        "email": False,
        "sms": False,
        "push": False,
    }

    if _channel_enabled(prefs, event, "push") and not _was_delivered(user_id, event, reference_key, "in_app"):
        await alert_service.create_alert(
            AlertCreate(
                participant_id=participant_id,
                session_id=session_id,
                alert_type=resolved_alert_type,
                severity=severity,
                title=title,
                message=message,
                recipient_user_id=user_id,
            ),
            org_id=org_id,
        )
        _record_delivery(user_id, event, reference_key, "in_app")
        results["in_app"] = True

    if _channel_enabled(prefs, event, "email") and not _was_delivered(user_id, event, reference_key, "email"):
        to_email = _lookup_user_email(user_id)
        if to_email:
            queue_worker_notification_email(
                to_email=to_email,
                subject=email_subject or title,
                title=title,
                message=message,
                action_url=action_url,
            )
            _record_delivery(user_id, event, reference_key, "email")
            results["email"] = True
        else:
            logger.info("Skipping email notification — no address for user %s", user_id)

    if _channel_enabled(prefs, event, "sms"):
        logger.info(
            "SMS notifications are not configured; skipped event=%s user=%s",
            event,
            user_id,
        )

    return results


async def notify_shift_change(
    *,
    shift: dict[str, Any],
    change_summary: str,
) -> Optional[dict[str, Any]]:
    worker_id = str(shift.get("worker_id") or "")
    if not worker_id:
        return None
    participant = shift.get("participant_name") or "your participant"
    start_label = _format_shift_time(shift.get("scheduled_start"))
    return await notify_worker(
        user_id=worker_id,
        org_id=str(shift.get("organization_id") or "") or None,
        event="shift_change",
        title="Shift schedule updated",
        message=f"{change_summary} Participant: {participant}. New start: {start_label}.",
        reference_key=f"shift:{shift.get('id')}:change:{shift.get('updated_at') or start_label}",
        severity="high",
        action_url=f"{settings.frontend_base_url.rstrip('/')}/my-shift/{shift.get('id')}",
        participant_id=str(shift.get("participant_id") or "") or None,
        email_subject=f"Shift updated — {participant}",
    )


async def notify_shift_reminder(*, shift: dict[str, Any]) -> Optional[dict[str, Any]]:
    worker_id = str(shift.get("worker_id") or "")
    if not worker_id:
        return None
    participant = shift.get("participant_name") or "your participant"
    start_label = _format_shift_time(shift.get("scheduled_start"))
    shift_id = str(shift.get("id") or "")
    return await notify_worker(
        user_id=worker_id,
        org_id=str(shift.get("organization_id") or "") or None,
        event="shift_reminder",
        title="Upcoming shift reminder",
        message=f"You have a shift with {participant} starting at {start_label}.",
        reference_key=f"shift:{shift_id}:reminder",
        severity="medium",
        action_url=f"{settings.frontend_base_url.rstrip('/')}/my-shift/{shift_id}",
        participant_id=str(shift.get("participant_id") or "") or None,
        email_subject=f"Shift reminder — {participant}",
    )


async def notify_feedback_received(
    *,
    worker_id: str,
    org_id: Optional[str],
    session_id: str,
    review_note: Optional[str],
    participant_id: Optional[str] = None,
) -> dict[str, Any]:
    note = (review_note or "").strip() or "Your coordinator flagged a session for review."
    return await notify_worker(
        user_id=worker_id,
        org_id=org_id,
        event="feedback_received",
        title="Session feedback from coordinator",
        message=note,
        reference_key=f"session:{session_id}:feedback",
        severity="medium",
        session_id=session_id,
        participant_id=participant_id,
        action_url=f"{settings.frontend_base_url.rstrip('/')}/sessions/{session_id}",
        email_subject="Session feedback — action required",
    )


async def notify_certification_expiry(
    *,
    user_id: str,
    org_id: Optional[str],
    credential_title: str,
    expiry_date: str,
    status: str,
    credential_id: str,
    custom_message: Optional[str] = None,
) -> dict[str, Any]:
    status_label = "expired" if status == "expired" else "expiring soon"
    message = custom_message or (
        f"Your credential \"{credential_title}\" is {status_label} "
        f"(expiry {expiry_date}). Please update it to remain compliant."
    )
    return await notify_worker(
        user_id=user_id,
        org_id=org_id,
        event="certification_expiry",
        title=f"Credential {status_label}",
        message=message,
        reference_key=f"credential:{credential_id}:{status}:{expiry_date}",
        severity="high" if status == "expired" else "medium",
        action_url=f"{settings.frontend_base_url.rstrip('/')}/my-compliance",
        email_subject=f"Credential {status_label} — {credential_title}",
    )


async def notify_coordinator_message(
    *,
    user_id: str,
    org_id: Optional[str],
    title: str,
    message: str,
    reference_key: Optional[str] = None,
) -> dict[str, Any]:
    key = reference_key or f"message:{user_id}:{int(datetime.now(timezone.utc).timestamp())}"
    return await notify_worker(
        user_id=user_id,
        org_id=org_id,
        event="coordinator_message",
        title=title,
        message=message,
        reference_key=key,
        severity="medium",
        email_subject=title,
    )


def _format_shift_time(value: Any) -> str:
    if not value:
        return "TBC"
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc).strftime("%a %d %b %Y, %H:%M UTC")
    except ValueError:
        return str(value)[:16]
