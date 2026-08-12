"""Persistent user notification inbox (CARECLIQV2-261)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return (
        "does not exist" in err
        or "42703" in err
        or "pgrst" in err
        or "could not find" in err
    )


def create_user_notification(
    *,
    user_id: str,
    organization_id: Optional[str],
    event_type: str,
    title: str,
    body: str,
    severity: str = "medium",
    shift_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
    action_url: Optional[str] = None,
    payload: Optional[dict[str, Any]] = None,
    banner_style: Optional[str] = None,
    requires_ack: bool = False,
    reference_key: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    record: dict[str, Any] = {
        "user_id": user_id,
        "organization_id": organization_id,
        "event_type": event_type,
        "title": title,
        "body": body,
        "severity": severity,
        "payload": payload or {},
        "requires_ack": requires_ack,
    }
    if shift_id:
        record["shift_id"] = shift_id
    if conversation_id:
        record["conversation_id"] = conversation_id
    if action_url:
        record["action_url"] = action_url
    if banner_style:
        record["banner_style"] = banner_style
    if reference_key:
        record["reference_key"] = reference_key

    try:
        result = get_supabase_admin().table("user_notifications").insert(record).execute()
        rows = result.data or []
        return rows[0] if rows else None
    except Exception as exc:
        err = str(exc).lower()
        if "duplicate" in err or "23505" in err or "unique" in err:
            return None
        if _is_missing_schema_error(exc):
            return None
        logger.warning("create_user_notification failed: %s", exc)
        return None


def list_user_notifications(
    user_id: str,
    *,
    days: int = 90,
    unread_only: bool = False,
    banners_only: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    since = (datetime.now(timezone.utc) - timedelta(days=max(1, days))).isoformat()
    page_size = max(1, limit)
    range_end = offset + page_size - 1
    try:
        query = (
            get_supabase_admin()
            .table("user_notifications")
            .select("*")
            .eq("user_id", user_id)
            .gte("created_at", since)
            .order("created_at", desc=True)
            .range(offset, range_end)
        )
        if unread_only:
            query = query.is_("read_at", "null").is_("dismissed_at", "null")
        if banners_only:
            query = query.is_("dismissed_at", "null").not_.is_("banner_style", "null")
        result = query.execute()
        return result.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        logger.warning("list_user_notifications failed: %s", exc)
        return []


def mark_notification_read(notification_id: str, user_id: str) -> bool:
    try:
        get_supabase_admin().table("user_notifications").update(
            {"read_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", notification_id).eq("user_id", user_id).execute()
        return True
    except Exception:
        return False


def dismiss_notification(notification_id: str, user_id: str) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    try:
        get_supabase_admin().table("user_notifications").update(
            {"dismissed_at": now, "read_at": now}
        ).eq("id", notification_id).eq("user_id", user_id).execute()
        return True
    except Exception:
        return False


def dismiss_notifications_by_reference(user_id: str, reference_key: str) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    try:
        get_supabase_admin().table("user_notifications").update(
            {"dismissed_at": now, "read_at": now}
        ).eq("user_id", user_id).eq("reference_key", reference_key).is_("dismissed_at", "null").execute()
        return True
    except Exception:
        return False


def acknowledge_notification(
    notification_id: str,
    user_id: str,
    *,
    shift_id: Optional[str] = None,
    change_snapshot: Optional[dict[str, Any]] = None,
) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    try:
        get_supabase_admin().table("user_notifications").update(
            {"acknowledged_at": now, "read_at": now, "dismissed_at": now}
        ).eq("id", notification_id).eq("user_id", user_id).execute()
        if shift_id:
            get_supabase_admin().table("shift_change_acknowledgements").insert(
                {
                    "shift_id": shift_id,
                    "worker_id": user_id,
                    "notification_id": notification_id,
                    "change_snapshot": change_snapshot or {},
                    "acknowledged_at": now,
                }
            ).execute()
        return True
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return False
        logger.warning("acknowledge_notification failed: %s", exc)
        return False


def record_shift_view(shift_id: str, worker_id: str) -> None:
    try:
        get_supabase_admin().table("shift_view_events").upsert(
            {
                "shift_id": shift_id,
                "worker_id": worker_id,
                "first_viewed_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="shift_id,worker_id",
        ).execute()
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            logger.debug("record_shift_view failed: %s", exc)


def shift_was_viewed(shift_id: str, worker_id: str) -> bool:
    try:
        result = (
            get_supabase_admin()
            .table("shift_view_events")
            .select("id")
            .eq("shift_id", shift_id)
            .eq("worker_id", worker_id)
            .limit(1)
            .execute()
        )
        return bool(result.data)
    except Exception:
        return False
