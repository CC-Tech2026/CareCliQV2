import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..core.access import get_user_id, get_user_organization_id, is_coordinator_role, is_managing_director
from ..core.security import get_current_user
from ..services import audit_service
from ..services.chatbox.graph import ask_quill
from ..services.chatbox.memory import delete_thread, list_threads, load_history

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chatbox", tags=["chatbox"])


def _require_quill_access(current_user: dict) -> None:
    if not (is_coordinator_role(current_user) or is_managing_director(current_user)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Quill is available to support coordinators and managing directors only.",
        )


class ChatRequest(BaseModel):
    message: str
    thread_id: Optional[str] = None


class ChatResponse(BaseModel):
    reply: str
    thread_id: str
    blocks: list[dict] = []


class ThreadSummary(BaseModel):
    thread_id: str
    title: Optional[str] = None
    updated_at: str
    message_count: int


class ThreadMessage(BaseModel):
    role: str
    content: str
    created_at: str


@router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest, current_user: dict = Depends(get_current_user)):
    """Quill chatbox — support_coordinator and managing_director only."""
    _require_quill_access(current_user)

    message = (body.message or "").strip()
    if not message:
        raise HTTPException(status_code=422, detail="message is required")

    thread_id = body.thread_id or str(uuid.uuid4())
    org_id = get_user_organization_id(current_user)
    user_id = get_user_id(current_user)

    blocks: list[dict] = []
    try:
        reply, blocks = await ask_quill(current_user, message, thread_id)
    except Exception as e:
        logger.error(f"Chatbox error: {str(e)}")
        reply = "Sorry, I couldn't get that data right now — please try again in a moment."

    try:
        await audit_service.log_action(
            action_type="chatbox.query",
            entity_type="chatbox_thread",
            entity_id=thread_id,
            user_id=user_id,
            organization_id=org_id,
            details={"message": message},
        )
    except Exception:
        logger.warning("Failed to write chatbox audit log for thread %s", thread_id)

    return ChatResponse(reply=reply, thread_id=thread_id, blocks=blocks)


@router.get("/threads", response_model=list[ThreadSummary])
async def get_threads(current_user: dict = Depends(get_current_user)):
    """List this user's past Quill conversations, most recently updated first."""
    _require_quill_access(current_user)
    return await list_threads(current_user)


@router.get("/threads/{thread_id}/messages", response_model=list[ThreadMessage])
async def get_thread_messages(thread_id: str, current_user: dict = Depends(get_current_user)):
    """Load a past conversation's full message history.

    load_history() scopes to the current user AND their org — a thread_id
    from another user can never be loaded this way, even within the same org.
    """
    _require_quill_access(current_user)
    return await load_history(current_user, thread_id)


@router.delete("/threads/{thread_id}", status_code=204)
async def delete_thread_route(thread_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a past conversation. delete_thread() scopes to the current user
    AND their org, same as loading — never trust thread_id alone."""
    _require_quill_access(current_user)
    await delete_thread(current_user, thread_id)
    try:
        await audit_service.log_action(
            action_type="chatbox.thread_deleted",
            entity_type="chatbox_thread",
            entity_id=thread_id,
            user_id=get_user_id(current_user),
            organization_id=get_user_organization_id(current_user),
        )
    except Exception:
        logger.warning("Failed to write chatbox delete audit log for thread %s", thread_id)
