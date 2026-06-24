"""Real-time coordinator ↔ worker conversations (CARECLIQV2-262)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

MAX_MESSAGE_LENGTH = 1000


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return (
        "does not exist" in err
        or "42703" in err
        or "pgrst" in err
        or "could not find" in err
    )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def get_or_create_shift_conversation(
    *,
    organization_id: str,
    worker_id: str,
    shift_id: str,
    coordinator_id: Optional[str] = None,
    participant_id: Optional[str] = None,
    participant_name: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    try:
        existing = (
            get_supabase_admin()
            .table("conversations")
            .select("*")
            .eq("shift_id", shift_id)
            .eq("worker_id", worker_id)
            .limit(1)
            .execute()
        )
        if existing.data:
            return existing.data[0]

        payload: dict[str, Any] = {
            "organization_id": organization_id,
            "worker_id": worker_id,
            "shift_id": shift_id,
            "status": "active",
        }
        if coordinator_id:
            payload["coordinator_id"] = coordinator_id
        if participant_id:
            payload["participant_id"] = participant_id
        if participant_name:
            payload["participant_name"] = participant_name

        result = get_supabase_admin().table("conversations").insert(payload).execute()
        return (result.data or [None])[0]
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        logger.warning("get_or_create_shift_conversation failed: %s", exc)
        return None


def list_worker_conversations(worker_id: str, organization_id: str, limit: int = 50) -> list[dict[str, Any]]:
    try:
        result = (
            get_supabase_admin()
            .table("conversations")
            .select("*")
            .eq("worker_id", worker_id)
            .eq("organization_id", organization_id)
            .order("last_message_at", desc=True)
            .limit(limit)
            .execute()
        )
        convs = result.data or []
        enriched: list[dict[str, Any]] = []
        for conv in convs:
            enriched.append(_enrich_conversation(conv))
        return enriched
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        logger.warning("list_worker_conversations failed: %s", exc)
        return []


def _enrich_conversation(conv: dict[str, Any]) -> dict[str, Any]:
    conv_id = conv.get("id")
    out = dict(conv)
    if not conv_id:
        return out
    try:
        msgs = (
            get_supabase_admin()
            .table("conversation_messages")
            .select("body, created_at, read_at, sender_id")
            .eq("conversation_id", conv_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        last = (msgs.data or [None])[0]
        if last:
            preview = (last.get("body") or "")[:40]
            out["last_message_preview"] = preview
            out["last_message_at"] = last.get("created_at") or conv.get("last_message_at")
        unread = (
            get_supabase_admin()
            .table("conversation_messages")
            .select("id", count="exact")
            .eq("conversation_id", conv_id)
            .neq("sender_id", conv.get("worker_id"))
            .is_("read_at", "null")
            .execute()
        )
        out["unread_count"] = unread.count or 0
    except Exception:
        out["last_message_preview"] = ""
        out["unread_count"] = 0
    return out


def get_conversation_messages(
    conversation_id: str,
    user_id: str,
    limit: int = 100,
) -> list[dict[str, Any]]:
    try:
        conv = (
            get_supabase_admin()
            .table("conversations")
            .select("id, worker_id, coordinator_id, status")
            .eq("id", conversation_id)
            .maybe_single()
            .execute()
        )
        if not conv or not conv.data:
            return []
        row = conv.data
        if str(row.get("worker_id")) != str(user_id) and str(row.get("coordinator_id")) != str(user_id):
            return []

        result = (
            get_supabase_admin()
            .table("conversation_messages")
            .select("*")
            .eq("conversation_id", conversation_id)
            .order("created_at", desc=False)
            .limit(limit)
            .execute()
        )
        return result.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        logger.warning("get_conversation_messages failed: %s", exc)
        return []


def send_conversation_message(
    *,
    conversation_id: str,
    sender_id: str,
    body: str,
    attachment_url: Optional[str] = None,
    message_type: str = "text",
    requires_action: bool = False,
) -> Optional[dict[str, Any]]:
    text = (body or "").strip()
    if not text and not attachment_url:
        raise ValueError("Message body or attachment is required.")
    if len(text) > MAX_MESSAGE_LENGTH:
        raise ValueError(f"Message exceeds {MAX_MESSAGE_LENGTH} characters.")

    now = _now_iso()
    record: dict[str, Any] = {
        "conversation_id": conversation_id,
        "sender_id": sender_id,
        "body": text,
        "message_type": message_type if message_type in ("text", "image", "action_required") else "text",
        "requires_action": requires_action or message_type == "action_required",
        "delivered_at": now,
    }
    if attachment_url:
        record["attachment_url"] = attachment_url
        if not text:
            record["message_type"] = "image"

    try:
        result = get_supabase_admin().table("conversation_messages").insert(record).execute()
        msg = (result.data or [None])[0]
        get_supabase_admin().table("conversations").update(
            {"last_message_at": now, "updated_at": now}
        ).eq("id", conversation_id).execute()
        return msg
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        raise ValueError(f"Failed to send message: {exc}") from exc


def mark_conversation_read(conversation_id: str, reader_id: str) -> None:
    now = _now_iso()
    try:
        (
            get_supabase_admin()
            .table("conversation_messages")
            .update({"read_at": now})
            .eq("conversation_id", conversation_id)
            .neq("sender_id", reader_id)
            .is_("read_at", "null")
            .execute()
        )
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            logger.debug("mark_conversation_read failed: %s", exc)


def action_conversation_message(message_id: str, user_id: str) -> bool:
    now = _now_iso()
    try:
        get_supabase_admin().table("conversation_messages").update(
            {"actioned_at": now, "read_at": now}
        ).eq("id", message_id).execute()
        return True
    except Exception:
        return False


def set_conversation_read_only_for_shift(shift_id: str) -> None:
    try:
        get_supabase_admin().table("conversations").update(
            {"status": "read_only", "updated_at": _now_iso()}
        ).eq("shift_id", shift_id).eq("status", "active").execute()
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            logger.debug("set_conversation_read_only_for_shift failed: %s", exc)
