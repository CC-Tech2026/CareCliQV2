import asyncio
import logging
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..core.access import get_user_id, get_user_organization_id, is_coordinator_role, is_managing_director
from ..core.security import get_current_user
from ..core.config import settings
from ..services import audit_service, quill_credits, stripe_service
from ..services.chatbox.graph import ask_quill
from ..services.chatbox.memory import delete_all_threads, delete_thread, list_threads, load_history
from ..services.ai_usage_guard import limit_ai_requests

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chatbox", tags=["chatbox"])


def _require_quill_access(current_user: dict) -> None:
    if not (is_coordinator_role(current_user) or is_managing_director(current_user)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Quill is available to support coordinators and managing directors only.",
        )


class ChatRequest(BaseModel):
    # A question, not a document: long pastes would run up the model bill.
    message: str = Field(max_length=4000)
    thread_id: Optional[str] = None
    # The answer-length setting in Quill: "brief" (the default) or "detailed".
    answer_style: Optional[Literal["brief", "detailed"]] = None


class ChatResponse(BaseModel):
    reply: str
    thread_id: str
    blocks: list[dict] = []
    # Questions to offer next, picked by code from the tools that answered.
    suggestions: list[str] = []
    # The asker's credit balance after this answer (None if it couldn't be read).
    credits: Optional[dict] = None


class ThreadSummary(BaseModel):
    thread_id: str
    title: Optional[str] = None
    updated_at: str
    message_count: int


class ThreadMessage(BaseModel):
    role: str
    content: str
    created_at: str
    # The answer's tables and charts (empty for questions and older answers).
    blocks: list[dict] = []


@router.post("/chat", response_model=ChatResponse, dependencies=[Depends(limit_ai_requests("quill", 12, 300, "Quill"))])
async def chat(body: ChatRequest, current_user: dict = Depends(get_current_user)):
    """Quill chatbox — support_coordinator and managing_director only."""
    _require_quill_access(current_user)

    message = (body.message or "").strip()
    if not message:
        raise HTTPException(status_code=422, detail="message is required")

    thread_id = body.thread_id or str(uuid.uuid4())
    org_id = get_user_organization_id(current_user)
    user_id = get_user_id(current_user)

    # Raises 402 with the balance when this person has no credits left.
    before = await asyncio.to_thread(quill_credits.ensure_can_ask, user_id, org_id) if org_id and user_id else None

    blocks: list[dict] = []
    suggestions: list[str] = []
    meter: dict = {}
    try:
        reply, blocks, suggestions = await ask_quill(current_user, message, thread_id, body.answer_style, meter=meter)
    except Exception as e:
        logger.error(f"Chatbox error: {str(e)}")
        reply = "Sorry, I couldn't get that data right now. Please try again in a moment."

    credits = None
    if org_id and user_id:
        # Charged even when the answer failed part-way: the model calls
        # that did run still cost CareCliQ money.
        credits = await asyncio.to_thread(
            quill_credits.record_usage,
            user_id=user_id, organization_id=org_id, thread_id=thread_id,
            provider=meter.get("provider"), usages=meter.get("usage") or [], before=before,
        )

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

    return ChatResponse(reply=reply, thread_id=thread_id, blocks=blocks, suggestions=suggestions, credits=credits)


@router.get("/credits")
async def get_credits(current_user: dict = Depends(get_current_user)):
    """This person's Quill credits: monthly allowance, bought credits, renewal date."""
    _require_quill_access(current_user)
    org_id = get_user_organization_id(current_user)
    user_id = get_user_id(current_user)
    if not (org_id and user_id):
        raise HTTPException(status_code=403, detail="No organisation membership found.")
    try:
        st = await asyncio.to_thread(quill_credits.credit_status, user_id, org_id)
    except Exception as exc:
        logger.error("Could not read Quill credits for %s: %s", user_id, exc)
        raise HTTPException(status_code=503, detail="Your Quill credits couldn't be loaded right now.")
    return st.as_dict()


class TopUpRequest(BaseModel):
    # Where to send the person back to (a path in the app, e.g. "/hub").
    return_path: Optional[str] = Field(default=None, max_length=300)


def _safe_return_path(path: Optional[str]) -> str:
    # Only a path inside the app, never another site.
    if not path or not path.startswith("/") or path.startswith("//") or "\\" in path:
        return "/"
    return path.split("#", 1)[0]


@router.post("/credits/top-up", dependencies=[Depends(limit_ai_requests("quill-topup", 5, 30, "Buying credits"))])
async def start_top_up(body: TopUpRequest, current_user: dict = Depends(get_current_user)):
    """Starts a Stripe Checkout for one pack of Quill credits for this person."""
    _require_quill_access(current_user)
    org_id = get_user_organization_id(current_user)
    user_id = get_user_id(current_user)
    if not (org_id and user_id):
        raise HTTPException(status_code=403, detail="No organisation membership found.")
    try:
        st = await asyncio.to_thread(quill_credits.credit_status, user_id, org_id)
    except Exception as exc:
        logger.error("Could not read Quill credits for %s: %s", user_id, exc)
        raise HTTPException(status_code=503, detail="Your Quill credits couldn't be loaded right now.")
    if st.paused_reason:
        raise HTTPException(status_code=409, detail=st.paused_reason)
    if not quill_credits.can_buy_pack(st):
        raise HTTPException(
            status_code=409,
            detail="You've bought the most credit packs allowed this month. Ask your managing director if you need more.",
        )
    credits, price_cents = quill_credits.pack()
    path = _safe_return_path(body.return_path)
    sep = "&" if "?" in path else "?"
    base = settings.frontend_base_url.rstrip("/")
    try:
        url = await asyncio.to_thread(
            stripe_service.create_quill_topup_checkout,
            organization_id=org_id, user_id=user_id, credits=credits, price_cents=price_cents,
            success_url=f"{base}{path}{sep}quill_credits=added",
            cancel_url=f"{base}{path}{sep}quill_credits=cancelled",
        )
    except Exception as exc:
        logger.error("Quill top-up checkout failed for %s: %s", user_id, exc)
        raise HTTPException(status_code=500, detail="Checkout couldn't be started. Please try again.")
    try:
        await audit_service.log_action(
            action_type="chatbox.credits_checkout_started",
            entity_type="quill_credits", entity_id=user_id,
            user_id=user_id, organization_id=org_id,
            details={"credits": credits, "price_cents": price_cents},
        )
    except Exception:
        logger.warning("Failed to write Quill top-up audit log")
    return {"checkout_url": url}


@router.get("/threads", response_model=list[ThreadSummary])
async def get_threads(current_user: dict = Depends(get_current_user)):
    """List this user's past Quill conversations, most recently updated first."""
    _require_quill_access(current_user)
    return await list_threads(current_user)


@router.delete("/threads", status_code=204)
async def clear_all_threads_route(current_user: dict = Depends(get_current_user)):
    """Delete every saved conversation for the current user."""
    _require_quill_access(current_user)
    await delete_all_threads(current_user)
    try:
        await audit_service.log_action(
            action_type="chatbox.history_cleared",
            entity_type="chatbox_thread",
            entity_id="all",
            user_id=get_user_id(current_user),
            organization_id=get_user_organization_id(current_user),
        )
    except Exception:
        logger.warning("Failed to write chatbox clear-history audit log")


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
