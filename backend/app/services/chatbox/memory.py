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
    [{"role": "user"|"assistant", "content": str, "created_at": str}, ...].

    Scoped to the current user AND their org — a thread_id supplied by the
    client can never pull another user's history, even within the same org.
    """
    user_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    if not user_id or not org_id or not thread_id:
        return []

    def query(columns: str):
        return (
            get_supabase_admin().table(TABLE)
            .select(columns)
            .eq("thread_id", thread_id)
            .eq("user_id", user_id)
            .eq("organization_id", org_id)
            .order("created_at")
            .execute()
        )

    try:
        try:
            result = query("role, content, created_at, blocks")
        except Exception as exc:
            if not _is_missing_blocks_column(exc):
                raise
            result = query("role, content, created_at")
        return [
            {
                "role": r["role"],
                "content": r["content"],
                "created_at": r["created_at"],
                "blocks": r.get("blocks") or [],
            }
            for r in (result.data or [])
        ]
    except Exception as exc:
        logger.warning("Failed to load chatbox history for thread %s: %s", thread_id, exc)
        return []


def _is_missing_blocks_column(exc: Exception) -> bool:
    """Migration 269 adds chatbox_messages.blocks; before it runs, a query
    naming the column fails. Detected so history still loads and saves."""
    text = str(exc).lower()
    return "blocks" in text and ("column" in text or "schema cache" in text or "42703" in text or "pgrst204" in text)


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


async def delete_all_threads(current_user: dict) -> None:
    """Delete every saved conversation for this user. Scoped to the current
    user AND their org, same boundary as delete_thread()."""
    user_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    if not user_id or not org_id:
        return

    try:
        supabase = get_supabase_admin()
        supabase.table(TABLE).delete().eq("user_id", user_id).eq("organization_id", org_id).execute()
    except Exception as exc:
        logger.warning("Failed to clear chatbox history for user %s: %s", user_id, exc)


async def save_turn(
    current_user: dict, thread_id: str, role: str, content: str, blocks: list[dict] | None = None,
) -> None:
    """Persist a single turn (one user message or one assistant reply), with
    the answer's tables and charts when there are any."""
    user_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    if not user_id or not org_id or not thread_id or not content:
        return

    row = {
        "organization_id": org_id,
        "user_id": user_id,
        "thread_id": thread_id,
        "role": role,
        "content": content,
    }
    try:
        supabase = get_supabase_admin()
        if blocks:
            try:
                supabase.table(TABLE).insert({**row, "blocks": blocks}).execute()
                return
            except Exception as exc:
                if not _is_missing_blocks_column(exc):
                    raise
        supabase.table(TABLE).insert(row).execute()
    except Exception as exc:
        logger.warning("Failed to save chatbox turn for thread %s: %s", thread_id, exc)
