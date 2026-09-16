"""LangGraph agent for the CareCliQ chatbox ("Quill").

Compiles a small ReAct-style agent per request, scoped to the authenticated
user via build_tools_for_user(). Conversation history is reconstructed from
Supabase on each call via memory.py — see that module for why this approach
was chosen over LangGraph's own checkpoint format.

Provider failover: if the preferred provider's call fails for any reason
(insufficient credits, rate limit, outage, bad key), ask_quill() retries
once against the other provider before giving up — so Anthropic being out
of credits doesn't take the whole chatbox down when OpenAI is configured
and working, and vice versa.
"""

import logging
from datetime import datetime

from langchain_core.messages import ToolMessage

from ...core.timezone import request_timezone
from . import tracing  # noqa: F401 — sets up LangSmith env vars at import time
from .blocks import build_blocks
from .llm import fallback_provider, get_chat_model, preferred_provider
from .memory import load_history, save_turn
from .tools import build_tools_for_user
from langgraph.prebuilt import create_react_agent

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT_TEMPLATE = """You are Quill, the CareCliQ assistant for NDIS support \
coordinators and managing directors. You answer plain-English questions about \
compliance and operational data using the tools available to you — never guess \
or invent numbers.

{current_datetime}
When a question or a tool argument depends on "today", "yesterday", "this \
week", or "this month", compute it from the date above — never from your own \
sense of the current date, which is not reliable and will be wrong.

Rules:
- Always call a tool to get real data before answering any factual question.
- If no tool can answer the question, say so plainly rather than speculating.
- Keep answers concise and in a professional, data-query tone.
- Never reveal data belonging to another organisation.
- Write in plain prose sentences — no bullet lists, no numbered lists. The \
detailed data already appears in a table or card below your reply, so your \
text only needs to summarise it in one or two sentences. You may use \
**double asterisks** around a name or figure to mark it as important.
"""


def _current_datetime_line() -> str:
    """The real clock, in the asker's branch timezone — Quill has no other
    way to know "today"; a language model's own sense of the date is not
    reliable and drifts from the truth. Bound per-request by
    OrgContextMiddleware (core.timezone.request_timezone); falls back to
    the deployment default outside a request (e.g. a background job)."""
    now = datetime.now(request_timezone())
    return f'Current date and time: {now.strftime("%A, %d %B %Y, %H:%M")} ({now.tzname()}).'


def _build_agent(provider: str, tools):
    system_prompt = _SYSTEM_PROMPT_TEMPLATE.format(current_datetime=_current_datetime_line())
    return create_react_agent(
        model=get_chat_model(provider),
        tools=tools,
        prompt=system_prompt,
    )


async def ask_quill(current_user: dict, message: str, thread_id: str) -> tuple[str, list[dict]]:
    """Returns (reply_text, blocks) — blocks are built deterministically from
    each tool call's raw artifact, not parsed from the model's prose.

    Tries the preferred provider first, then the other one if that call
    fails — see module docstring."""
    tools = build_tools_for_user(current_user, thread_id)

    prior_turns = await load_history(current_user, thread_id)
    messages = [{"role": t["role"], "content": t["content"]} for t in prior_turns] + [{"role": "user", "content": message}]

    primary = preferred_provider()
    secondary = fallback_provider(primary)

    providers_to_try = (primary, secondary)
    result = None
    last_exc: Exception | None = None
    for i, provider in enumerate(providers_to_try):
        try:
            agent = _build_agent(provider, tools)
            result = await agent.ainvoke({"messages": messages})
            break
        except Exception as exc:
            last_exc = exc
            is_last = i == len(providers_to_try) - 1
            logger.warning(
                "Chatbox provider %s failed (%s)%s",
                provider, exc, "" if is_last else f" — trying {providers_to_try[i + 1]}",
            )
    if result is None:
        raise last_exc

    reply = result["messages"][-1]
    reply_text = reply.content if hasattr(reply, "content") else str(reply)

    blocks: list[dict] = []
    for m in result["messages"]:
        if isinstance(m, ToolMessage) and m.name:
            blocks.extend(build_blocks(m.name, m.artifact))

    await save_turn(current_user, thread_id, "user", message)
    await save_turn(current_user, thread_id, "assistant", reply_text)

    return reply_text, blocks
