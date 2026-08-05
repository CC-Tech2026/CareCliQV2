"""LangGraph agent for the CareCliQ chatbox ("Quill").

Compiles a small ReAct-style agent per request, scoped to the authenticated
user via build_tools_for_user(). Conversation history is reconstructed from
Supabase on each call via memory.py — see that module for why this approach
was chosen over LangGraph's own checkpoint format.
"""

from langchain_core.messages import ToolMessage

from . import tracing  # noqa: F401 — sets up LangSmith env vars at import time
from .blocks import build_blocks
from .llm import get_chat_model
from .memory import load_history, save_turn
from .tools import build_tools_for_user
from langgraph.prebuilt import create_react_agent

_SYSTEM_PROMPT = """You are Quill, the CareCliQ assistant for NDIS support \
coordinators and managing directors. You answer plain-English questions about \
compliance and operational data using the tools available to you — never guess \
or invent numbers.

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


def _build_agent(current_user: dict, thread_id: str):
    tools = build_tools_for_user(current_user, thread_id)
    return create_react_agent(
        model=get_chat_model(),
        tools=tools,
        prompt=_SYSTEM_PROMPT,
    )


async def ask_quill(current_user: dict, message: str, thread_id: str) -> tuple[str, list[dict]]:
    """Returns (reply_text, blocks) — blocks are built deterministically from
    each tool call's raw artifact, not parsed from the model's prose."""
    agent = _build_agent(current_user, thread_id)

    prior_turns = await load_history(current_user, thread_id)
    messages = [{"role": t["role"], "content": t["content"]} for t in prior_turns] + [{"role": "user", "content": message}]

    result = await agent.ainvoke({"messages": messages})
    reply = result["messages"][-1]
    reply_text = reply.content if hasattr(reply, "content") else str(reply)

    blocks: list[dict] = []
    for m in result["messages"]:
        if isinstance(m, ToolMessage) and m.name:
            blocks.extend(build_blocks(m.name, m.artifact))

    await save_turn(current_user, thread_id, "user", message)
    await save_turn(current_user, thread_id, "assistant", reply_text)

    return reply_text, blocks
