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
        for field in (
            "translated_content",
            "detected_language",
            "translation_status",
            "translation_metadata",
            "attachment_id",
        ):
            if data.get(field) is not None:
                record[field] = data[field]

        response = supabase.table("session_messages").insert(record).execute()
        return response.data[0] if response.data else None
    except Exception as e:
        logger.error(f"create_session_message failed: {e}")
        raise


async def update_session_message(session_id: str, message_id: str, data: dict) -> dict | None:
    """Patch translation/attachment metadata for a persisted session message."""
    allowed = {
        "translated_content",
        "detected_language",
        "translation_status",
        "translation_metadata",
        "attachment_id",
        "media_url",
    }
    record = {k: v for k, v in data.items() if k in allowed}
    if not record:
        return None
    try:
        supabase = get_supabase_admin()
        response = (
            supabase.table("session_messages")
            .update(record)
            .eq("id", message_id)
            .eq("session_id", session_id)
            .execute()
        )
        if response.data:
            return response.data[0]
        lookup = (
            supabase.table("session_messages")
            .select("*")
            .eq("id", message_id)
            .eq("session_id", session_id)
            .limit(1)
            .execute()
        )
        return lookup.data[0] if lookup.data else None
    except Exception as e:
        logger.error(f"update_session_message failed: {e}")
        raise
