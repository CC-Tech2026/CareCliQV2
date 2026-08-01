"""Persisted conversation history for the CareCliQ chatbox ("Quill").

Replaces the in-process MemorySaver (Phase A1/A2), which lost all history on
every backend restart/redeploy. Stores the human-visible turn-by-turn
conversation in Supabase (chatbox_messages — see
backend/supabase/migrations/101_chatbox_messages.sql) and reconstructs it on
each request rather than relying on LangGraph's own checkpoint format —
simpler, and consistent with how the rest of this app persists data via the
Supabase REST client (no direct Postgres connection is configured here).
"""

import logging

from ..supabase_client import get_supabase_admin
from ...core.access import get_user_id, get_user_organization_id

logger = logging.getLogger(__name__)

TABLE = "chatbox_messages"


async def load_history(current_user: dict, thread_id: str) -> list[dict]:
    """Return prior turns for this thread, oldest first, as
    [{"role": "user"|"assistant", "content": str}, ...].

    Scoped to the current user AND their org — a thread_id supplied by the
    client can never pull another user's history, even within the same org.
    """
    user_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    if not user_id or not org_id or not thread_id:
        return []

    try:
        supabase = get_supabase_admin()
        result = (
            supabase.table(TABLE)
            .select("role, content")
            .eq("thread_id", thread_id)
            .eq("user_id", user_id)
            .eq("organization_id", org_id)
            .order("created_at")
            .execute()
        )
        return [{"role": r["role"], "content": r["content"]} for r in (result.data or [])]
    except Exception as exc:
        logger.warning("Failed to load chatbox history for thread %s: %s", thread_id, exc)
        return []


async def list_threads(current_user: dict) -> list[dict]:
    """Return this user's past conversations, most recently updated first, as
    [{"thread_id": str, "title": str, "updated_at": str, "message_count": int}, ...].

    Title is the first user message in the thread (truncated) — there's no
    separate "conversation title" concept, matching how ChatGPT derives a
    thread's title from its first message rather than asking the user to
    name it upfront.
    """
    user_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    if not user_id or not org_id:
        return []

    try:
        supabase = get_supabase_admin()
        result = (
            supabase.table(TABLE)
            .select("thread_id, role, content, created_at")
            .eq("user_id", user_id)
            .eq("organization_id", org_id)
            .order("created_at")
            .execute()
        )
    except Exception as exc:
        logger.warning("Failed to list chatbox threads for user %s: %s", user_id, exc)
        return []

    threads: dict[str, dict] = {}
    for row in result.data or []:
        tid = row["thread_id"]
        thread = threads.setdefault(tid, {
            "thread_id": tid, "title": None, "updated_at": row["created_at"], "message_count": 0,
        })
        thread["message_count"] += 1
        thread["updated_at"] = row["created_at"]  # rows are ascending, so the last write wins
        if thread["title"] is None and row["role"] == "user":
            content = row["content"] or ""
            thread["title"] = content[:60] + ("…" if len(content) > 60 else "")

    return sorted(threads.values(), key=lambda t: t["updated_at"], reverse=True)


async def delete_thread(current_user: dict, thread_id: str) -> None:
    """Delete every message in a thread. Scoped to the current user AND their
    org — a thread_id belonging to someone else can never be deleted this
    way, even within the same org."""
    user_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    if not user_id or not org_id or not thread_id:
        return

    try:
        supabase = get_supabase_admin()
        supabase.table(TABLE).delete().eq("thread_id", thread_id).eq("user_id", user_id).eq(
            "organization_id", org_id
        ).execute()
    except Exception as exc:
        logger.warning("Failed to delete chatbox thread %s: %s", thread_id, exc)


async def save_turn(current_user: dict, thread_id: str, role: str, content: str) -> None:
    """Persist a single turn (one user message or one assistant reply)."""
    user_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    if not user_id or not org_id or not thread_id or not content:
        return

    try:
        supabase = get_supabase_admin()
        supabase.table(TABLE).insert({
            "organization_id": org_id,
            "user_id": user_id,
            "thread_id": thread_id,
            "role": role,
            "content": content,
        }).execute()
    except Exception as exc:
        logger.warning("Failed to save chatbox turn for thread %s: %s", thread_id, exc)
