"""Worker notification dispatcher — respects user_notification_preferences (CARECLIQV2-259/261)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from ..core.timezone import APP_TIMEZONE, coerce_timezone, parse_shift_datetime, participant_timezone

from ..core.config import settings
from ..schemas.alert import AlertCreate
from . import alert_service
from .email_service import queue_worker_notification_email
from .push_service import send_push_to_user
from .supabase_client import get_supabase_admin
from . import user_notification_store as notification_store

logger = logging.getLogger(__name__)

# Mirrors coordinator.py's UNASSIGNED_SHIFT_PLACEHOLDER_ID - an unassigned
# shift's worker_id is this placeholder, not null, so a plain "if not
# worker_id" guard doesn't catch it. Duplicated here (not imported) to avoid
# a circular import, since coordinator.py imports from this module.
_UNASSIGNED_SHIFT_PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000"

NOTIFICATION_EVENTS = (
    "shift_reminder",
    "shift_change",
    "shift_cancel",
    "coordinator_message",
    "feedback_received",
    "certification_expiry",
    "task_reminder",
    "safety_alert",
    "invite_request",
    "training_recommended",
    "training_completion_review",
    "medication_alert",
    "incident_notification_alert",
    "worker_cannot_attend",
    "shift_offer",
    "shift_offer_exhausted",
    "shift_auto_cancelled_unassigned",
    "shift_auto_ended_overdue",
    "shift_documentation_overdue",
    "account_deactivated",
    "account_reactivated",
    "incident_pending_reminder",
    "incident_pending_overdue",
    # Sent by services that were raising "Unsupported notification event"
    # before these were listed, so none of them ever reached anyone.
    "medication_dose_reminder",
    "long_shift_checkin",
    "shift_feedback_received",
    "buddy_assigned",
    "availability_update_requested",
    "training_request",
    "training_request_update",
    "ndis_screening_recheck_due",
    "applicant_stage_stuck",
    "onboarding_stage_reminder",
    "onboarding_stage_auto_inactive",
    "offer_letter_expired",
    "hire_invite_expired",
    "hire_invite_pending",
)
NOTIFICATION_CHANNELS = ("push", "email", "sms")
SAFETY_EVENTS = frozenset({"safety_alert"})
# In-shift prompts are useless by email (one per medication dose, say), so
# email starts off for them; anyone can still turn it on.
_CHANNELS_OFF_BY_DEFAULT = frozenset({
    ("medication_dose_reminder", "email"),
    ("long_shift_checkin", "email"),
})
# Severities that still pop up during someone's quiet hours.
_QUIET_HOURS_EXEMPT_SEVERITIES = frozenset({"critical", "emergency"})


def channel_default(event: str, channel: str) -> bool:
    return (event, channel) not in _CHANNELS_OFF_BY_DEFAULT

EVENT_ALERT_TYPES = {
    "shift_reminder": "shift_reminder",
    "shift_change": "shift_change",
    "shift_cancel": "shift_cancel",
    "coordinator_message": "coordinator_message",
    "feedback_received": "feedback",
    "certification_expiry": "credential_expiry",
    "task_reminder": "task_reminder",
    "safety_alert": "safety_alert",
    "invite_request": "invite_request",
    "training_recommended": "training_recommended",
    "training_completion_review": "training_completion_review",
    "medication_alert": "medication_alert",
    "incident_notification_alert": "incident_notification_alert",
    "worker_cannot_attend": "worker_cannot_attend",
    "shift_offer": "shift_offer",
    "shift_offer_exhausted": "shift_offer_exhausted",
    "shift_auto_cancelled_unassigned": "shift_auto_cancelled_unassigned",
    "shift_auto_ended_overdue": "shift_auto_ended_overdue",
    "shift_documentation_overdue": "shift_documentation_overdue",
    "account_deactivated": "account_deactivated",
    "account_reactivated": "account_reactivated",
    "incident_pending_reminder": "incident_pending_reminder",
    "incident_pending_overdue": "incident_pending_overdue",
}


def default_notification_preferences() -> dict[str, dict[str, bool]]:
    return {
        event: {channel: channel_default(event, channel) for channel in NOTIFICATION_CHANNELS}
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
                if bool(event_prefs.get(channel, channel_default(event, channel))):
                    merged[event][channel] = True
    return merged


def clean_quiet_hours(raw: Any) -> dict[str, Any]:
    """Normalise a stored/submitted quiet-hours block; disabled if unusable."""
    raw = raw if isinstance(raw, dict) else {}
    start = str(raw.get("from") or "22:00")[:5]
    end = str(raw.get("to") or "07:00")[:5]
    tz_name = str(raw.get("timezone") or "")[:64]
    valid = True
    try:
        datetime.strptime(start, "%H:%M")
        datetime.strptime(end, "%H:%M")
    except ValueError:
        valid = False
    return {
        "enabled": bool(raw.get("enabled")) and valid,
        "from": start if valid else "22:00",
        "to": end if valid else "07:00",
        "timezone": tz_name,
    }


def is_within_quiet_hours(quiet: dict[str, Any], now: Optional[datetime] = None) -> bool:
    if not quiet.get("enabled"):
        return False
    tz = coerce_timezone(quiet.get("timezone")) or APP_TIMEZONE
    local =(now or datetime.now(timezone.utc)).astimezone(tz).strftime("%H:%M")
    start, end = quiet["from"], quiet["to"]
    if start == end:
        return False
    # 22:00 to 07:00 wraps past midnight.
    return start <= local < end if start < end else local >= start or local < end


def quiet_hours_active(user_id: str, now: Optional[datetime] = None) -> bool:
    """True if any of the user's saved preference rows has quiet hours covering now."""
    try:
        result = (
            get_supabase_admin()
            .table("user_notification_preferences")
            .select("preferences")
            .eq("user_id", user_id)
            .execute()
        )
    except Exception:
        return False
    for row in result.data or []:
        quiet = clean_quiet_hours((row.get("preferences") or {}).get("quiet_hours"))
        if is_within_quiet_hours(quiet, now):
            return True
    return False


def get_reminder_offsets_minutes(user_id: str) -> tuple[int, int]:
    """Return (first_reminder_minutes, second_reminder_minutes) from prefs or defaults."""
    first = settings.shift_reminder_minutes_first
    second = settings.shift_reminder_minutes_second
    try:
        result = (
            get_supabase_admin()
            .table("user_notification_preferences")
            .select("preferences")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        if rows:
            timing = (rows[0].get("preferences") or {}).get("shift_reminder_timing") or {}
            first = int(timing.get("first_minutes") or first)
            second = int(timing.get("second_minutes") or second)
    except Exception:
        pass
    return max(1, first), max(1, second)


def _held_for_quiet_hours(user_id: str, event: str, severity: str) -> bool:
    """Quiet hours hold back the pop-up only; the inbox item and email still land."""
    if event in SAFETY_EVENTS or severity in _QUIET_HOURS_EXEMPT_SEVERITIES:
        return False
    return quiet_hours_active(user_id)


def _channel_enabled(prefs: dict, event: str, channel: str) -> bool:
    if event in SAFETY_EVENTS and channel == "push":
        return True
    return bool((prefs.get(event) or {}).get(channel, channel_default(event, channel)))


def _lookup_user_role(user_id: str) -> Optional[str]:
    try:
        result = get_supabase_admin().table("users").select("role").eq("id", user_id).limit(1).execute()
        rows = result.data or []
        return rows[0].get("role") if rows else None
    except Exception as exc:
        logger.debug("User role lookup failed for %s: %s", user_id, exc)
        return None


def _link_for_recipient(user_id: str, url: str, base_url: str) -> str:
    """Directors can't open the coordinator roster or Team page; send them to
    their own schedule and staff pages instead. Callers that notify every
    office user build one coordinator link for all of them."""
    roster = f"{base_url}/coordinator/rostering?openShift="
    team = f"{base_url}/team"
    if not (url.startswith(roster) or url == team or url.startswith(team + "?")):
        return url
    if _lookup_user_role(user_id) != "managing_director":
        return url
    if url.startswith(roster):
        return f"{base_url}/md/schedule?shiftId={url[len(roster):]}"
    return f"{base_url}/md/staff{url[len(team):]}"


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


def _participant_first_name(shift: dict[str, Any]) -> str:
    name = (shift.get("participant_name") or "").strip()
    if not name:
        return "your participant"
    return name.split()[0]


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
    shift_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
    alert_type: Optional[str] = None,
    banner_style: Optional[str] = None,
    requires_ack: bool = False,
    payload: Optional[dict[str, Any]] = None,
    push_priority: str = "default",
    send_push: bool = True,
) -> dict[str, Any]:
    """Deliver via in-app inbox, push, and/or email based on saved prefs.

    send_push=False is for callers that already sent their own device push
    (e.g. the long-shift welfare check), so the user isn't alerted twice."""
    if event not in NOTIFICATION_EVENTS:
        raise ValueError(f"Unsupported notification event: {event}")

    prefs = get_effective_preferences(user_id)
    resolved_alert_type = alert_type or EVENT_ALERT_TYPES.get(event, event)
    base_url = settings.frontend_base_url.rstrip('/')
    has_own_link = bool(action_url)
    # Emails need absolute links; some callers pass "/team" and the like.
    if action_url and action_url.startswith("/"):
        action_url = f"{base_url}{action_url}"
    # /notifications works for every role; /worker/profile 403'd office staff.
    action_url = _link_for_recipient(user_id, action_url or f"{base_url}/notifications", base_url)
    results: dict[str, Any] = {
        "user_id": user_id,
        "event": event,
        "reference_key": reference_key,
        "in_app": False,
        "email": False,
        "sms": False,
        "push": False,
    }

    payload = dict(payload or {})
    if participant_id:
        payload.setdefault("participant_id", participant_id)
    if alert_type:
        payload.setdefault("alert_type", alert_type)

    in_app_key = f"{reference_key}:in_app"
    in_app_row: Optional[dict[str, Any]] = None
    if not _was_delivered(user_id, event, in_app_key, "in_app"):
        in_app_row = notification_store.create_user_notification(
            user_id=user_id,
            organization_id=org_id,
            event_type=event,
            title=title,
            body=message,
            severity=severity,
            shift_id=shift_id,
            conversation_id=conversation_id,
            action_url=action_url,
            payload=payload or {},
            banner_style=banner_style,
            requires_ack=requires_ack,
            reference_key=in_app_key,
        )
        await alert_service.create_alert(
            AlertCreate(
                participant_id=participant_id,
                session_id=session_id,
                shift_id=shift_id,
                alert_type=resolved_alert_type,
                severity=severity,
                title=title,
                message=message,
                recipient_user_id=user_id,
            ),
            org_id=org_id,
        )
        _record_delivery(user_id, event, in_app_key, "in_app")
        results["in_app"] = True

    # With no page of its own, the email button and the pop-up open this
    # notification's full view in the inbox, which links on from there.
    delivery_url = action_url
    if not has_own_link and in_app_row and in_app_row.get("id"):
        delivery_url = f"{base_url}/notifications?open={in_app_row['id']}"

    if (
        send_push
        and _channel_enabled(prefs, event, "push")
        and not _was_delivered(user_id, event, reference_key, "push")
        and not _held_for_quiet_hours(user_id, event, severity)
    ):
        pushed = await send_push_to_user(
            user_id,
            title=title,
            body=message,
            data={
                "event": event,
                "action_url": delivery_url,
                "shift_id": shift_id,
                "conversation_id": conversation_id,
                # Browsers tag the OS notification with this so the copy the
                # open tab shows and the pushed copy replace each other.
                "notification_id": (in_app_row or {}).get("id"),
            },
            priority=push_priority if event in SAFETY_EVENTS else "default",
        )
        if pushed:
            _record_delivery(user_id, event, reference_key, "push")
            results["push"] = True

    if _channel_enabled(prefs, event, "email") and not _was_delivered(user_id, event, reference_key, "email"):
        to_email = _lookup_user_email(user_id)
        if to_email:
            queue_worker_notification_email(
                to_email=to_email,
                subject=email_subject or title,
                title=title,
                message=message,
                action_url=delivery_url,
                severity=severity,
                settings_url=f"{base_url}/notifications/settings",
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
    old_values: Optional[dict[str, Any]] = None,
    new_values: Optional[dict[str, Any]] = None,
) -> Optional[dict[str, Any]]:
    worker_id = str(shift.get("worker_id") or "")
    if not worker_id or worker_id == _UNASSIGNED_SHIFT_PLACEHOLDER_ID:
        return None
    participant = _participant_first_name(shift)
    start_label = _format_shift_time(shift.get("scheduled_start"), shift)
    shift_id = str(shift.get("id") or "")

    old_str = ""
    new_str = ""
    if old_values or new_values:
        parts = []
        for key, label in (("scheduled_start", "Start"), ("scheduled_end", "End"), ("location", "Location")):
            if old_values and key in old_values:
                parts.append(f"{label}: {_format_shift_time(old_values[key], shift) if 'start' in key or 'end' in key else old_values[key]}")
        old_str = " · ".join(parts) if parts else ""
        parts_new = []
        for key, label in (("scheduled_start", "Start"), ("scheduled_end", "End"), ("location", "Location")):
            if new_values and key in new_values:
                parts_new.append(f"{label}: {_format_shift_time(new_values[key], shift) if 'start' in key or 'end' in key else new_values[key]}")
        new_str = " · ".join(parts_new) if parts_new else start_label

    message = (
        f"{change_summary} with {participant}. "
        + (f"Was: {old_str}. Now: {new_str}." if old_str else f"New start: {start_label}.")
    )
    return await notify_worker(
        user_id=worker_id,
        org_id=str(shift.get("organization_id") or "") or None,
        event="shift_change",
        title="Shift schedule updated",
        message=message,
        reference_key=f"shift:{shift_id}:change:{shift.get('updated_at') or start_label}",
        severity="high",
        action_url=f"{settings.frontend_base_url.rstrip('/')}/my-shifts/{shift_id}",
        participant_id=str(shift.get("participant_id") or "") or None,
        shift_id=shift_id,
        banner_style="orange",
        requires_ack=True,
        payload={"old": old_values or {}, "new": new_values or {}},
    )


async def notify_shift_cancelled(*, shift: dict[str, Any]) -> Optional[dict[str, Any]]:
    worker_id = str(shift.get("worker_id") or "")
    if not worker_id or worker_id == _UNASSIGNED_SHIFT_PLACEHOLDER_ID:
        return None
    participant = _participant_first_name(shift)
    start_label = _format_shift_time(shift.get("scheduled_start"), shift)
    shift_id = str(shift.get("id") or "")
    return await notify_worker(
        user_id=worker_id,
        org_id=str(shift.get("organization_id") or "") or None,
        event="shift_cancel",
        title="Shift cancelled",
        message=f"Shift cancelled: {start_label} with {participant}. Tap for details.",
        reference_key=f"shift:{shift_id}:cancelled",
        severity="high",
        action_url=f"{settings.frontend_base_url.rstrip('/')}/my-shifts/{shift_id}",
        participant_id=str(shift.get("participant_id") or "") or None,
        shift_id=shift_id,
        banner_style="red",
    )


async def notify_worker_cannot_attend(
    *, shift: dict[str, Any], reason: Optional[str] = None
) -> list[dict[str, Any]]:
    """Reverse of notify_shift_cancelled — a worker vacated a shift they were
    assigned to, so every coordinator in the org needs to know it's now
    unassigned. Deep-links straight into the reassignment panel rather than
    the bare roster, since that's the whole point of the notification."""
    org_id = str(shift.get("organization_id") or "")
    if not org_id:
        return []
    participant = _participant_first_name(shift)
    start_label = _format_shift_time(shift.get("scheduled_start"), shift)
    shift_id = str(shift.get("id") or "")
    message = f"A worker can't make their shift: {start_label} with {participant}."
    if reason:
        message += f' Reason given: "{reason}"'
    results = []
    for coord_id in _org_coordinator_user_ids(org_id):
        results.append(await notify_worker(
            user_id=coord_id,
            org_id=org_id,
            event="worker_cannot_attend",
            title="Shift needs reassigning",
            message=message,
            reference_key=f"shift:{shift_id}:cannot_attend",
            severity="high",
            action_url=f"{settings.frontend_base_url.rstrip('/')}/coordinator/rostering?openShift={shift_id}",
            participant_id=str(shift.get("participant_id") or "") or None,
            shift_id=shift_id,
            banner_style="red",
        ))
    return results


async def notify_shift_offer(*, shift: dict[str, Any], worker_id: str, rank: int) -> Optional[dict[str, Any]]:
    """The worker-facing side of a ranked shift offer — lands in both the
    in-app inbox and (via notify_worker's existing alerts write) the
    alerts-backed notification panel, where generateMessageActions renders
    the Accept/Decline buttons for alert_type == 'shift_offer'."""
    participant = _participant_first_name(shift)
    start_label = _format_shift_time(shift.get("scheduled_start"), shift)
    shift_id = str(shift.get("id") or "")
    return await notify_worker(
        user_id=worker_id,
        org_id=str(shift.get("organization_id") or "") or None,
        event="shift_offer",
        title="Shift offer",
        message=f"You've been offered a shift: {start_label} with {participant}. Accept or decline below.",
        # rank in the key so a re-offer to the same worker after a prior
        # decline (further down someone else's queue) is a fresh notification,
        # not deduped as "already delivered" by _was_delivered.
        reference_key=f"shift:{shift_id}:offer:{rank}",
        severity="high",
        action_url=f"{settings.frontend_base_url.rstrip('/')}/my-shifts/{shift_id}",
        participant_id=str(shift.get("participant_id") or "") or None,
        shift_id=shift_id,
        banner_style="orange",
    )


async def notify_shift_offer_exhausted(
    *, shift: dict[str, Any], reason: Optional[str] = None
) -> list[dict[str, Any]]:
    """Every candidate in the offer queue declined or timed out — coordinators
    need to assign manually now."""
    org_id = str(shift.get("organization_id") or "")
    if not org_id:
        return []
    participant = _participant_first_name(shift)
    start_label = _format_shift_time(shift.get("scheduled_start"), shift)
    shift_id = str(shift.get("id") or "")
    message = f"Every suggested worker declined or didn't respond: {start_label} with {participant}. Please assign manually."
    if reason:
        message += f' Last decline reason: "{reason}"'
    results = []
    for coord_id in _org_coordinator_user_ids(org_id):
        results.append(await notify_worker(
            user_id=coord_id,
            org_id=org_id,
            event="shift_offer_exhausted",
            title="No one accepted the shift offer",
            message=message,
            reference_key=f"shift:{shift_id}:offer_exhausted",
            severity="high",
            action_url=f"{settings.frontend_base_url.rstrip('/')}/coordinator/rostering?openShift={shift_id}",
            participant_id=str(shift.get("participant_id") or "") or None,
            shift_id=shift_id,
            banner_style="red",
        ))
    return results


async def notify_shift_reminder(
    *,
    shift: dict[str, Any],
    minutes_before: int = 60,
) -> Optional[dict[str, Any]]:
    worker_id = str(shift.get("worker_id") or "")
    if not worker_id or worker_id == _UNASSIGNED_SHIFT_PLACEHOLDER_ID:
        return None

    if minutes_before <= 35 and shift.get("clocked_in_at"):
        return None

    shift_id = str(shift.get("id") or "")
    if minutes_before <= 35 and notification_store.shift_was_viewed(shift_id, worker_id):
        return None

    participant = _participant_first_name(shift)
    start_label = _format_shift_time(shift.get("scheduled_start"), shift)
    return await notify_worker(
        user_id=worker_id,
        org_id=str(shift.get("organization_id") or "") or None,
        event="shift_reminder",
        title="Upcoming shift reminder",
        message=f"Your shift with {participant} starts at {start_label}. Tap to view details.",
        reference_key=f"shift:{shift_id}:reminder:{minutes_before}m",
        severity="medium",
        action_url=f"{settings.frontend_base_url.rstrip('/')}/my-shifts/{shift_id}",
        participant_id=str(shift.get("participant_id") or "") or None,
        shift_id=shift_id,
        email_subject=f"Shift reminder: {participant}",
    )


async def notify_conversation_message(
    *,
    recipient_id: str,
    org_id: str,
    conversation_id: str,
    shift_id: Optional[str],
    message_preview: str,
    sender_name: str = "Coordinator",
    sender_id: Optional[str] = None,
    worker_id: Optional[str] = None,
    recipient_is_office: bool = False,
) -> dict[str, Any]:
    """The whole message goes in, so it can be read (and answered) from the
    notification; it used to be cut at 60 characters."""
    text = message_preview if len(message_preview) <= 500 else message_preview[:499] + "…"
    base_url = settings.frontend_base_url.rstrip("/")
    if recipient_is_office:
        # The worker messages page is worker-only; office staff open the shift.
        action_url = f"{base_url}/coordinator/rostering?openShift={shift_id}" if shift_id else None
    else:
        action_url = f"{base_url}/worker/messages?conversation={conversation_id}"
    payload = {key: value for key, value in (("sender_id", sender_id), ("worker_id", worker_id)) if value}
    return await notify_worker(
        user_id=recipient_id,
        org_id=org_id,
        event="coordinator_message",
        title=f"Message from {sender_name}",
        message=text,
        reference_key=f"conversation:{conversation_id}:{int(datetime.now(timezone.utc).timestamp())}",
        severity="medium",
        action_url=action_url,
        conversation_id=conversation_id,
        shift_id=shift_id,
        payload=payload,
    )


async def notify_task_alert(
    *,
    user_id: str,
    org_id: str,
    shift_id: str,
    title: str,
    message: str,
    reference_key: str,
    banner_style: Optional[str] = None,
    task_id: Optional[str] = None,
    notify_coordinator: bool = False,
) -> dict[str, Any]:
    result = await notify_worker(
        user_id=user_id,
        org_id=org_id,
        event="task_reminder",
        title=title,
        message=message,
        reference_key=reference_key,
        severity="high" if banner_style == "red" else "medium",
        shift_id=shift_id,
        action_url=f"{settings.frontend_base_url.rstrip('/')}/my-shifts/{shift_id}",
        banner_style=banner_style,
        payload={"task_id": task_id} if task_id else {},
    )
    if notify_coordinator:
        for coord_id in _org_coordinator_user_ids(org_id):
            await notify_worker(
                user_id=coord_id,
                org_id=org_id,
                event="coordinator_message",
                title=title,
                message=message,
                reference_key=f"{reference_key}:coord:{coord_id}",
                severity="high",
                shift_id=shift_id,
            )
    return result


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
        email_subject="Session feedback: action required",
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
        email_subject=f"Credential {status_label}: {credential_title}",
    )


async def notify_coordinator_message(
    *,
    user_id: str,
    org_id: Optional[str],
    title: str,
    message: str,
    reference_key: Optional[str] = None,
    sender_id: Optional[str] = None,
) -> dict[str, Any]:
    """A direct message to one person. sender_id lets them reply to the sender."""
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
        payload={"sender_id": sender_id} if sender_id else None,
    )


async def notify_password_reset_requested(
    *,
    org_id: str,
    worker_id: str,
    worker_name: str,
) -> None:
    """A support worker can't change their own password (org policy) — this
    tells every coordinator/MD in the org that one has asked for a reset link,
    so an admin can act via the existing send-password-reset action."""
    title = "Password reset requested"
    message = f"{worker_name or 'A staff member'} requested a password reset. Send them a reset link from their staff profile."
    action_url = f"{settings.frontend_base_url.rstrip('/')}/team?worker_id={worker_id}"
    for coordinator_id in _org_coordinator_user_ids(org_id):
        await notify_worker(
            user_id=coordinator_id,
            org_id=org_id,
            event="coordinator_message",
            title=title,
            message=message,
            reference_key=f"password_reset_request:{worker_id}:{int(datetime.now(timezone.utc).timestamp())}",
            severity="medium",
            action_url=action_url,
            email_subject=title,
        )


def _org_coordinator_user_ids(org_id: str) -> list[str]:
    try:
        result = (
            get_supabase_admin()
            .table("users")
            .select("id")
            .eq("organization_id", org_id)
            .in_("role", ["support_coordinator", "managing_director", "admin"])
            .execute()
        )
        return [str(row["id"]) for row in (result.data or []) if row.get("id")]
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        logger.debug("Coordinator lookup failed: %s", exc)
        return []


async def _notify_office_staff(
    *,
    org_id: str,
    title: str,
    message: str,
    reference_key: str,
    severity: str = "medium",
    participant_id: Optional[str] = None,
    session_id: Optional[str] = None,
    event: str = "coordinator_message",
    push_priority: str = "default",
    action_url: Optional[str] = None,
    shift_id: Optional[str] = None,
    payload: Optional[dict[str, Any]] = None,
) -> None:
    for coordinator_id in _org_coordinator_user_ids(org_id):
        await notify_worker(
            user_id=coordinator_id,
            org_id=org_id,
            event=event if event in NOTIFICATION_EVENTS else "coordinator_message",
            title=title,
            message=message,
            reference_key=reference_key,
            severity=severity,
            participant_id=participant_id,
            session_id=session_id,
            # No default page: training requests and the like were linking to
            # Incidents. Callers with a page pass it; the app works out the rest.
            action_url=action_url,
            shift_id=shift_id,
            email_subject=title,
            push_priority=push_priority,
            payload=payload,
        )


async def notify_incident_reported(
    *,
    org_id: str,
    incident_id: str,
    title: str,
    message: str,
    severity: str = "medium",
    participant_id: Optional[str] = None,
    session_id: Optional[str] = None,
    escalate: bool = False,
    reference_number: Optional[str] = None,
    is_emergency: bool = False,
) -> None:
    ref_line = f" Reference: {reference_number}." if reference_number else ""
    body = f"{message}{ref_line}"
    is_critical = is_emergency or escalate or severity in ("high", "critical", "emergency")
    event = "safety_alert" if is_emergency else "coordinator_message"
    push_priority = "high" if is_emergency else "default"

    await _notify_office_staff(
        org_id=org_id,
        title=title,
        message=body,
        reference_key=f"incident:{incident_id}",
        severity="critical" if is_critical else severity,
        participant_id=participant_id,
        session_id=session_id,
        event=event,
        push_priority=push_priority,
        action_url=f"{settings.frontend_base_url.rstrip('/')}/incidents/{incident_id}",
    )

    if is_emergency and participant_id:
        from .safety_protocol_service import get_on_call_phones

        phones = get_on_call_phones(participant_id, org_id)
        if phones:
            logger.info(
                "Emergency incident %s — on-call contacts: %s",
                incident_id,
                ", ".join(phones),
            )


async def notify_incident_status_changed(
    *,
    worker_id: str,
    org_id: str,
    incident_id: str,
    reference_number: Optional[str],
    status_label: str,
) -> None:
    ref = reference_number or incident_id[:8]
    await notify_worker(
        user_id=worker_id,
        org_id=org_id,
        event="coordinator_message",
        title=f"Incident update: {ref}",
        message=f"Your incident report is now: {status_label}.",
        reference_key=f"incident-status:{incident_id}:{status_label}",
        severity="medium",
        action_url=f"{settings.frontend_base_url.rstrip('/')}/incidents/{incident_id}",
        email_subject=f"Incident {ref}: status update",
    )


async def notify_office_worker_message(
    *,
    org_id: str,
    shift_id: str,
    worker_id: str,
    message: str,
    priority: str = "normal",
) -> None:
    severity = "critical" if priority == "emergency" else ("high" if priority == "urgent" else "medium")
    preview = message[:280] + ("…" if len(message) > 280 else "")
    sender = _user_display_name(worker_id) or "A worker"
    await _notify_office_staff(
        org_id=org_id,
        title=f"Message from {sender} on shift",
        message=preview,
        reference_key=f"shift-message:{shift_id}:{worker_id}:{int(datetime.now(timezone.utc).timestamp())}",
        severity=severity,
        # The shift is where the conversation is, not the incident register.
        action_url=f"{settings.frontend_base_url.rstrip('/')}/coordinator/rostering?openShift={shift_id}",
        shift_id=shift_id,
        payload={"worker_id": worker_id},
    )


def _user_display_name(user_id: str) -> Optional[str]:
    try:
        result = (
            get_supabase_admin()
            .table("users")
            .select("full_name")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        name = (rows[0].get("full_name") or "").strip() if rows else ""
        return name or None
    except Exception:
        return None


def _format_shift_time(value: Any, shift: Optional[dict[str, Any]] = None) -> str:
    """Wall-clock time in the participant's branch zone, with the zone
    abbreviation so a Melbourne shift reads 'AEST' to an Adelaide reader."""
    if not value:
        return "TBC"
    try:
        dt = parse_shift_datetime(str(value))
        local = dt.astimezone(participant_timezone(shift or {}))
        return local.strftime("%a %d %b %Y, %H:%M %Z")
    except ValueError:
        return str(value)[:16]
