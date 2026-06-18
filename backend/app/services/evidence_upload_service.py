"""
CARECLIQV2-230 — Upload task evidence media (photo/voice) to object storage.

Stores files at {org_id}/{session_id}/evidence/{evidence_id}.{ext} and merges
metadata (without base64 payloads) into sessions.task_evidence.
"""

from __future__ import annotations

import base64
import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional

from .shift_service import _session_owned_by_worker
from .object_storage import upload_evidence_bytes
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

MAX_PHOTO_BYTES = 2 * 1024 * 1024
MAX_VOICE_BYTES = 1 * 1024 * 1024

ALLOWED_PHOTO_MIME = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_VOICE_MIME = {"audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav"}

EXT_BY_MIME = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
}

_DATA_URL_RE = re.compile(r"^data:[^;]+;base64,", re.IGNORECASE)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _decode_base64_payload(raw: str) -> bytes:
    text = (raw or "").strip()
    text = _DATA_URL_RE.sub("", text)
    try:
        return base64.b64decode(text, validate=False)
    except Exception as exc:
        raise ValueError("Invalid base64 file data") from exc


def _max_bytes_for_type(evidence_type: str) -> int:
    if evidence_type == "photo":
        return MAX_PHOTO_BYTES
    if evidence_type == "voice":
        return MAX_VOICE_BYTES
    raise ValueError(f"Unsupported evidence type for media upload: {evidence_type}")


def _allowed_mime_for_type(evidence_type: str, mime_type: str) -> bool:
    mime = (mime_type or "").split(";")[0].strip().lower()
    if evidence_type == "photo":
        return mime in ALLOWED_PHOTO_MIME
    if evidence_type == "voice":
        return mime in ALLOWED_VOICE_MIME or mime.startswith("audio/")
    return False


def _is_missing_schema_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "task_evidence" in msg and ("column" in msg or "does not exist" in msg)


def upload_session_evidence_media(
    session_id: str,
    worker_id: str,
    organization_id: str,
    evidence_items: list[dict[str, Any]],
    files: dict[str, str],
) -> Optional[dict[str, Any]]:
    """Decode, validate, store media files, and merge metadata into task_evidence."""
    try:
        resp = (
            get_supabase_admin()
            .table("sessions")
            .select("id, task_evidence, worker_id, support_worker_id, owner_user_id, created_by, organization_id")
            .eq("id", session_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        raise

    rows = resp.data or []
    if not rows:
        return None
    session = rows[0]
    if not _session_owned_by_worker(session, worker_id, organization_id):
        return None

    if not evidence_items:
        return {"success": True, "uploaded_evidence": [], "session_id": session_id}

    org_id = str(session.get("organization_id") or organization_id)

    existing = session.get("task_evidence") or []
    if not isinstance(existing, list):
        existing = []
    by_id: dict[str, dict[str, Any]] = {
        str(item.get("evidence_id")): item
        for item in existing
        if isinstance(item, dict) and item.get("evidence_id")
    }

    uploaded: list[dict[str, Any]] = []

    for item in evidence_items:
        eid = str(item.get("evidence_id") or "")
        etype = str(item.get("type") or "")
        if not eid or etype not in ("photo", "voice"):
            continue

        file_payload = files.get(eid)
        if not file_payload:
            raise ValueError(f"Missing file data for evidence {eid}")

        raw_bytes = _decode_base64_payload(file_payload)
        max_bytes = _max_bytes_for_type(etype)
        if len(raw_bytes) == 0:
            raise ValueError(f"Empty file for evidence {eid}")
        if len(raw_bytes) > max_bytes:
            raise ValueError(f"File for evidence {eid} exceeds {max_bytes // (1024 * 1024)} MB limit")

        mime_type = str(item.get("mime_type") or "").split(";")[0].strip().lower()
        if not mime_type:
            mime_type = "image/jpeg" if etype == "photo" else "audio/webm"
        if not _allowed_mime_for_type(etype, mime_type):
            raise ValueError(f"Unsupported MIME type for {etype}: {mime_type}")

        ext = EXT_BY_MIME.get(mime_type, "jpg" if etype == "photo" else "webm")
        storage_path = f"{org_id}/{session_id}/evidence/{eid}.{ext}"

        stored = upload_evidence_bytes(storage_path, raw_bytes, mime_type)
        file_url = stored.file_url

        record: dict[str, Any] = {
            "evidence_id": eid,
            "task_id": item.get("task_id"),
            "goal_id": item.get("goal_id"),
            "session_id": session_id,
            "type": etype,
            "content": "",
            "duration_seconds": item.get("duration_seconds"),
            "file_size_bytes": len(raw_bytes),
            "mime_type": mime_type,
            "storage_path": storage_path,
            "storage_provider": stored.provider,
            "file_url": file_url,
            "created_at": item.get("created_at") or _now_iso(),
            "synced": True,
        }
        by_id[eid] = record
        uploaded.append({
            "evidence_id": eid,
            "url": file_url,
            "storage_path": storage_path,
            "stored_at": _now_iso(),
        })

    merged = list(by_id.values())
    now = _now_iso()
    try:
        get_supabase_admin().table("sessions").update({
            "task_evidence": merged,
            "updated_at": now,
        }).eq("id", session_id).execute()
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        raise

    return {
        "success": True,
        "session_id": session_id,
        "uploaded_evidence": uploaded,
        "task_evidence": merged,
    }
