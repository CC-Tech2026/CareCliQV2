"""Reply to a message straight from its notification.

Picks the thread the message came from, so both sides can keep going:
- about a shift (a shift conversation, or a worker's message to the office
  during a shift): the reply goes into that shift's conversation and the
  other side is notified with a reply option of their own;
- a direct message from a coordinator: the worker's reply goes back to that
  coordinator, and the coordinator's to that worker.
"""

from __future__ import annotations

import logging
from typing import Any, Optional
from uuid import uuid4

from . import conversation_service, shift_service
from . import user_notification_store as store
from .notification_service import (
    _org_coordinator_user_ids,
    _user_display_name,
    notify_conversation_message,
    notify_coordinator_message,
    notify_worker,
)
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

MAX_REPLY_LENGTH = 1000
OFFICE_ROLES = frozenset({"support_coordinator", "managing_director"})


class ReplyNotPossible(ValueError):
    """The notification isn't a message, or there's no one to reply to."""


def _conversation(conversation_id: str, org_id: str) -> Optional[dict[str, Any]]:
    try:
        result = (
            get_supabase_admin()
            .table("conversations")
            .select("*")
            .eq("id", conversation_id)
            .eq("organization_id", org_id)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None
    except Exception as exc:
        logger.warning("Conversation lookup failed for %s: %s", conversation_id, exc)
        return None


def _shift_in_org(shift_id: str, org_id: str) -> Optional[dict[str, Any]]:
    shift = shift_service.get_shift_by_id(shift_id)
    if not shift or str(shift.get("organization_id") or "") != org_id:
        return None
    return shift


def _post(conversation: dict[str, Any], sender_id: str, text: str) -> None:
    if conversation.get("status") == "read_only":
        raise ReplyNotPossible("This conversation has closed. Message the office from the shift instead.")
    sent = conversation_service.send_conversation_message(
        conversation_id=str(conversation["id"]),
        sender_id=sender_id,
        body=text,
    )
    if not sent:
        raise RuntimeError("Reply could not be saved")


async def reply_to_notification(
    *,
    user_id: str,
    role: str,
    org_id: str,
    notification_id: str,
    text: str,
) -> dict[str, str]:
    text = (text or "").strip()[:MAX_REPLY_LENGTH]
    if not text:
        raise ReplyNotPossible("Write a reply first.")
    notification = store.get_user_notification(notification_id, user_id)
    if not notification:
        raise LookupError("Notification not found")

    payload = notification.get("payload") or {}
    shift_id = str(notification.get("shift_id") or "") or None
    conversation_id = str(notification.get("conversation_id") or "") or None
    name = _user_display_name(user_id)

    if role == "support_worker":
        return await _worker_reply(user_id, org_id, notification, payload, shift_id, conversation_id, name, text)
    if role in OFFICE_ROLES:
        return await _office_reply(user_id, org_id, payload, shift_id, conversation_id, name, text)
    raise ReplyNotPossible("Replies aren't available for this account.")


async def _worker_reply(user_id, org_id, notification, payload, shift_id, conversation_id, name, text) -> dict[str, str]:
    if notification.get("event_type") != "coordinator_message":
        raise ReplyNotPossible("This notification isn't a message.")
    sender_name = name or "A worker"

    if conversation_id or shift_id:
        if conversation_id:
            conversation = _conversation(conversation_id, org_id)
        else:
            shift = _shift_in_org(shift_id, org_id)
            conversation = shift and conversation_service.get_or_create_shift_conversation(
                organization_id=org_id,
                worker_id=user_id,
                shift_id=shift_id,
                coordinator_id=payload.get("sender_id"),
                participant_id=str(shift.get("participant_id") or "") or None,
                participant_name=shift.get("participant_name"),
            )
        if not conversation or str(conversation.get("worker_id")) != user_id:
            raise LookupError("Conversation not found")
        _post(conversation, user_id, text)
        coordinator = str(conversation.get("coordinator_id") or "") or None
        for recipient in [coordinator] if coordinator else _org_coordinator_user_ids(org_id):
            await notify_conversation_message(
                recipient_id=recipient,
                org_id=org_id,
                conversation_id=str(conversation["id"]),
                shift_id=str(conversation.get("shift_id") or "") or None,
                message_preview=text,
                sender_name=sender_name,
                sender_id=user_id,
                worker_id=user_id,
                recipient_is_office=True,
            )
        return {"sent_to": "conversation"}

    coordinator = payload.get("sender_id")
    if coordinator:
        await notify_worker(
            user_id=str(coordinator),
            org_id=org_id,
            event="coordinator_message",
            title=f"Reply from {sender_name}",
            message=text,
            reference_key=f"reply:{notification['id']}:{uuid4().hex[:8]}",
            severity="medium",
            payload={"worker_id": user_id, "reply_to": notification["id"]},
        )
        return {"sent_to": "coordinator"}

    # Older messages don't say who sent them, so every coordinator and
    # director gets the reply, each able to answer it. (The old route wrote
    # to alerts columns that don't exist, so these replies never arrived.)
    reference = f"reply:{notification['id']}:{uuid4().hex[:8]}"
    for recipient in _org_coordinator_user_ids(org_id):
        await notify_worker(
            user_id=recipient,
            org_id=org_id,
            event="coordinator_message",
            title=f"Reply from {sender_name}",
            message=text,
            reference_key=reference,
            severity="medium",
            payload={"worker_id": user_id, "reply_to": notification["id"]},
        )
    return {"sent_to": "office"}


async def _office_reply(user_id, org_id, payload, shift_id, conversation_id, name, text) -> dict[str, str]:
    worker_id = payload.get("worker_id")
    conversation = _conversation(conversation_id, org_id) if conversation_id else None
    if conversation:
        worker_id = worker_id or conversation.get("worker_id")
    shift = _shift_in_org(shift_id, org_id) if shift_id and not conversation else None
    if shift and not worker_id:
        # Older on-shift messages didn't record the sender; it's the shift's worker.
        worker_id = shift.get("worker_id")
    if not worker_id:
        raise ReplyNotPossible("There's no one to reply to on this notification.")
    worker_id = str(worker_id)
    sender_name = name or "the office"

    if conversation or shift:
        conversation = conversation or conversation_service.get_or_create_shift_conversation(
            organization_id=org_id,
            worker_id=worker_id,
            shift_id=shift_id,
            coordinator_id=user_id,
            participant_id=str(shift.get("participant_id") or "") or None,
            participant_name=shift.get("participant_name"),
        )
        if not conversation:
            raise RuntimeError("Conversation could not be opened")
        _post(conversation, user_id, text)
        await notify_conversation_message(
            recipient_id=worker_id,
            org_id=org_id,
            conversation_id=str(conversation["id"]),
            shift_id=str(conversation.get("shift_id") or "") or None,
            message_preview=text,
            sender_name=sender_name,
            sender_id=user_id,
        )
        return {"sent_to": "conversation"}

    await notify_coordinator_message(
        user_id=worker_id,
        org_id=org_id,
        title=f"Message from {sender_name}",
        message=text,
        sender_id=user_id,
    )
    return {"sent_to": "worker"}
