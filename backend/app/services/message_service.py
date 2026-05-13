from .supabase_client import get_supabase_admin
import logging

logger = logging.getLogger(__name__)


async def get_session_messages(session_id: str) -> list[dict]:
    """Return all messages for a session ordered by creation time."""
    try:
        supabase = get_supabase_admin()
        response = (
            supabase.table("session_messages")
            .select("*")
            .eq("session_id", session_id)
            .order("created_at", desc=False)
            .execute()
        )
        return response.data or []
    except Exception as e:
        logger.warning(f"get_session_messages failed (table may not exist yet): {e}")
        return []


async def create_session_message(session_id: str, data: dict) -> dict | None:
    """Persist a single chat message for a session."""
    try:
        supabase = get_supabase_admin()
        record: dict = {
            "session_id": session_id,
            "message_type": data.get("message_type", "text"),
            "content": data.get("content", ""),
            "sender_role": data.get("sender_role", "worker"),
        }
        if data.get("media_url"):
            record["media_url"] = data["media_url"]
        if data.get("created_at"):
            record["created_at"] = data["created_at"]

        response = supabase.table("session_messages").insert(record).execute()
        return response.data[0] if response.data else None
    except Exception as e:
        logger.error(f"create_session_message failed: {e}")
        raise
