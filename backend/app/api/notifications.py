"""Worker notification inbox API (CARECLIQV2-261/262)."""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from ..core.access import get_user_id, get_user_organization_id, is_support_worker
from ..core.security import get_current_user
from ..services import conversation_service
from ..services.notification_service import notify_conversation_message
from ..services.push_service import register_push_token
from ..services import user_notification_store as notification_store
from ..services.supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/worker/notifications", tags=["worker-notifications"])


def _require_worker(current_user: dict) -> None:
    if not is_support_worker(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Workers only")


class PushTokenBody(BaseModel):
    device_id: str = Field(min_length=8, max_length=128)
    push_token: str = Field(min_length=1)
    platform: str = "web"
    token_type: str = "expo"


class AckBody(BaseModel):
    change_snapshot: Optional[dict[str, Any]] = None


class ConversationMessageBody(BaseModel):
    body: str = Field(default="", max_length=1000)
    attachment_url: Optional[str] = None
    message_type: str = "text"
    requires_action: bool = False


class ReminderSettingsBody(BaseModel):
    silence_optional_reminders: bool = False


class TaskSnoozeBody(BaseModel):
    task_id: str


@router.post("/push-token")
async def register_worker_push_token(
    body: PushTokenBody,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    ok = register_push_token(
        get_user_id(current_user),
        body.device_id,
        body.push_token,
        body.platform,
        body.token_type,
    )
    return {"registered": ok}


@router.get("")
async def list_notifications(
    days: int = Query(default=90, le=365),
    unread_only: bool = Query(default=False),
    banners_only: bool = Query(default=False),
    limit: int = Query(default=100, le=200),
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    user_id = get_user_id(current_user)
    items = notification_store.list_user_notifications(
        user_id,
        days=days,
        unread_only=unread_only,
        banners_only=banners_only,
        limit=limit,
    )
    return {"notifications": items, "count": len(items)}


@router.post("/{notification_id}/read")
async def read_notification(
    notification_id: str,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    ok = notification_store.mark_notification_read(notification_id, get_user_id(current_user))
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


@router.post("/{notification_id}/dismiss")
async def dismiss_notification(
    notification_id: str,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    ok = notification_store.dismiss_notification(notification_id, get_user_id(current_user))
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


@router.post("/{notification_id}/acknowledge")
async def acknowledge_notification(
    notification_id: str,
    body: AckBody,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    user_id = get_user_id(current_user)
    try:
        row = (
            get_supabase_admin()
            .table("user_notifications")
            .select("shift_id")
            .eq("id", notification_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        shift_id = (row.data or {}).get("shift_id") if row else None
    except Exception:
        shift_id = None

    ok = notification_store.acknowledge_notification(
        notification_id,
        user_id,
        shift_id=str(shift_id) if shift_id else None,
        change_snapshot=body.change_snapshot,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


@router.post("/shifts/{shift_id}/viewed")
async def record_shift_viewed(
    shift_id: str,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    notification_store.record_shift_view(shift_id, get_user_id(current_user))
    return {"ok": True}


@router.put("/shifts/{shift_id}/reminder-settings")
async def update_shift_reminder_settings(
    shift_id: str,
    body: ReminderSettingsBody,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    user_id = get_user_id(current_user)
    try:
        get_supabase_admin().table("shift_reminder_settings").upsert(
            {
                "shift_id": shift_id,
                "worker_id": user_id,
                "silence_optional_reminders": body.silence_optional_reminders,
            },
            on_conflict="shift_id",
        ).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not save settings: {exc}") from exc
    return {"ok": True, "silence_optional_reminders": body.silence_optional_reminders}


@router.post("/shifts/{shift_id}/tasks/{task_id}/snooze")
async def snooze_task_reminder(
    shift_id: str,
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Snooze optional task reminder once for 10 minutes (263)."""
    _require_worker(current_user)
    from datetime import datetime, timedelta, timezone

    from ..services import shift_service

    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    shift = shift_service.get_shift_by_id(shift_id)
    if not shift or str(shift.get("worker_id")) != worker_id:
        raise HTTPException(status_code=404, detail="Shift not found")

    tasks = list(shift.get("tasks") or [])
    snoozed_until = None
    updated = False
    for task in tasks:
        if str(task.get("task_id")) == task_id:
            if task.get("snoozed_until"):
                raise HTTPException(status_code=409, detail="Task already snoozed")
            snoozed_until = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
            task["snoozed_until"] = snoozed_until
            updated = True
            break
    if not updated:
        raise HTTPException(status_code=404, detail="Task not found")

    shift_service.update_shift_tasks(shift_id, worker_id, org_id, tasks)
    return {"ok": True, "snoozed_until": snoozed_until}


# ── Conversations (262) ───────────────────────────────────────────────────────

@router.get("/conversations")
async def list_conversations(
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    convs = conversation_service.list_worker_conversations(worker_id, org_id)
    unread = sum(c.get("unread_count", 0) for c in convs)
    return {"conversations": convs, "unread_count": unread}


@router.get("/conversations/{conversation_id}/messages")
async def list_conversation_messages(
    conversation_id: str,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    user_id = get_user_id(current_user)
    msgs = conversation_service.get_conversation_messages(conversation_id, user_id)
    conversation_service.mark_conversation_read(conversation_id, user_id)
    return {"messages": msgs}


@router.post("/conversations/{conversation_id}/messages", status_code=201)
async def send_conversation_message(
    conversation_id: str,
    body: ConversationMessageBody,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    user_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)

    conv = (
        get_supabase_admin()
        .table("conversations")
        .select("*")
        .eq("id", conversation_id)
        .maybe_single()
        .execute()
    )
    if not conv or not conv.data or str(conv.data.get("worker_id")) != user_id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conv.data.get("status") == "read_only":
        raise HTTPException(status_code=409, detail="Conversation is read-only")

    try:
        msg = conversation_service.send_conversation_message(
            conversation_id=conversation_id,
            sender_id=user_id,
            body=body.body,
            attachment_url=body.attachment_url,
            message_type=body.message_type,
            requires_action=body.requires_action,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not msg:
        raise HTTPException(status_code=500, detail="Failed to send message")

    coord_id = conv.data.get("coordinator_id")
    if coord_id:
        await notify_conversation_message(
            recipient_id=str(coord_id),
            org_id=org_id,
            conversation_id=conversation_id,
            shift_id=str(conv.data.get("shift_id") or "") or None,
            message_preview=body.body or "Sent an image",
            sender_name="Worker",
        )
    return msg


@router.post("/conversations/messages/{message_id}/action")
async def action_conversation_message(
    message_id: str,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    ok = conversation_service.action_conversation_message(message_id, get_user_id(current_user))
    if not ok:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"ok": True}
