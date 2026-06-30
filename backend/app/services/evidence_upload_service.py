"""
CARECLIQV2-230 — Upload task evidence media (photo/voice) to object storage.

Stores files at {org_id}/{session_id}/evidence/{evidence_id}.{ext} and merges
metadata (without base64 payloads) into sessions.task_evidence.

Chain-of-custody implementation (CARECLIQV2-XXX):
  - Compute SHA-256 hash on raw file bytes (immutable)
  - Extract uploaded_by from JWT (never client-supplied)
  - Capture device context: IP address, user agent
  - Insert immutable audit records to task_evidence_metadata
  - Log all uploads to evidence_access_audit_log
"""

from __future__ import annotations

import base64
import hashlib
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from .shift_service import _session_owned_by_worker
from .compliance_evidence_service import (
    compute_retention_until,
    parse_device_type,
    resolve_shift_date,
    resolve_shift_id_for_session,
)
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


def _is_missing_metadata_table_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "task_evidence_metadata" in msg and (
        "does not exist" in msg or "relation" in msg or "schema cache" in msg
    )


def _coerce_uuid(value: Any) -> Optional[str]:
    """task_evidence_metadata.goal_id is uuid — shift tasks use string slugs."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return str(uuid.UUID(text))
    except ValueError:
        return None


def _compute_file_hash(raw_bytes: bytes) -> str:
    """
    Compute SHA-256 hash of raw file bytes.
    
    Hash is computed ONLY on the binary content, with no metadata or filenames included.
    This ensures the hash is verifiable against the stored file content.
    
    Args:
        raw_bytes: Raw file content (decoded from base64)
    
    Returns:
        SHA-256 hash as 64-character hex string
    """
    return hashlib.sha256(raw_bytes).hexdigest()


def _log_evidence_access(
    evidence_id: str,
    session_id: str,
    organization_id: str,
    accessed_by: str,
    action: str,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    file_hash_match: Optional[bool] = None,
    file_hash_stored: Optional[str] = None,
    file_hash_computed: Optional[str] = None,
    purpose: Optional[str] = None,
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
    shift_id: Optional[str] = None,
    notes: Optional[str] = None,
) -> None:
    """
    Log evidence access to immutable audit trail (evidence_access_audit_log).
    
    Non-fatal: failures are logged but never raised (primary operation unaffected).
    This is a SYNCHRONOUS function — it logs to DB and returns, never blocking.
    """
    try:
        row: dict[str, Any] = {
            "evidence_id": evidence_id,
            "session_id": session_id,
            "organization_id": organization_id,
            "accessed_by": accessed_by,
            "action": action,
        }
        if ip_address:
            row["ip_address"] = ip_address
        if user_agent:
            row["user_agent"] = user_agent
        if file_hash_match is not None:
            row["file_hash_match"] = file_hash_match
        if file_hash_stored:
            row["file_hash_stored"] = file_hash_stored
        if file_hash_computed:
            row["file_hash_computed"] = file_hash_computed
        if purpose:
            row["purpose"] = purpose
        if error_code:
            row["error_code"] = error_code
        if error_message:
            row["error_message"] = error_message
        if shift_id:
            row["shift_id"] = shift_id
        if notes:
            row["notes"] = notes
        
        get_supabase_admin().table("evidence_access_audit_log").insert(row).execute()
    except Exception as exc:
        logger.warning(
            "Failed to log evidence access (non-fatal): evidence_id=%s action=%s: %s",
            evidence_id, action, exc
        )



def upload_session_evidence_media(
    session_id: str,
    worker_id: str,
    organization_id: str,
    evidence_items: list[dict[str, Any]],
    files: dict[str, str],
    uploaded_by: str,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """
    Decode, validate, store media files, and record chain-of-custody metadata.
    
    Chain-of-custody implementation:
    1. Compute SHA-256 hash of raw file bytes (server-side, immutable)
    2. Upload file to object storage
    3. Create immutable task_evidence_metadata record (captured: uploaded_by from JWT, server timestamp, file hash, device context)
    4. Log upload to evidence_access_audit_log
    5. Keep sessions.task_evidence in sync for backward compatibility
    
    Args:
        session_id: Session UUID
        worker_id: Worker/participant UUID
        organization_id: Organization UUID
        evidence_items: List of evidence metadata dicts
        files: Dict of evidence_id -> base64-encoded file content
        uploaded_by: User UUID (from JWT, never client-supplied)
        ip_address: Client IP address (for audit trail)
        user_agent: User agent string (for audit trail)
    
    Returns:
        Success response with uploaded evidence details, or None if schema not ready
    """
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
    shift_id = resolve_shift_id_for_session(session_id)
    shift_date = resolve_shift_date(shift_id)
    retention_until = compute_retention_until(shift_date, org_id)
    device_type = parse_device_type(user_agent)

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

        # Decode base64 to raw bytes
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

        # === CHAIN OF CUSTODY: COMPUTE HASH ON RAW BYTES ===
        file_hash = _compute_file_hash(raw_bytes)

        # Upload to object storage
        stored = upload_evidence_bytes(storage_path, raw_bytes, mime_type)
        file_url = stored.file_url

        # === CHAIN OF CUSTODY: CREATE IMMUTABLE METADATA RECORD ===
        server_timestamp = datetime.now(timezone.utc)
        metadata_record: dict[str, Any] = {
            "evidence_id": eid,
            "session_id": session_id,
            "organization_id": org_id,
            "uploaded_by": uploaded_by,  # From JWT, never client-supplied
            "uploaded_at": server_timestamp.isoformat(),  # Server timestamp, immutable
            "file_hash": file_hash,  # SHA-256, computed on raw bytes
            "file_hash_algorithm": "sha256",
            "file_size_bytes": len(raw_bytes),
            "mime_type": mime_type,
            "storage_path": storage_path,
            "storage_provider": stored.provider,
            "file_url": file_url,
            "ip_address": ip_address,  # Device context
            "user_agent": user_agent,  # Device context
            "evidence_type": etype,
            "task_id": item.get("task_id"),
            "goal_id": _coerce_uuid(item.get("goal_id")),
            "duration_seconds": item.get("duration_seconds"),
            "is_finalized": True,
            "device_type": device_type,
            "retention_until": retention_until.isoformat(),
            "shift_id": shift_id,
        }
        
        try:
            get_supabase_admin().table("task_evidence_metadata").insert(metadata_record).execute()
        except Exception as exc:
            if _is_missing_metadata_table_error(exc):
                logger.warning(
                    "task_evidence_metadata unavailable; stored file without chain-of-custody row: %s",
                    exc,
                )
            else:
                logger.error("Failed to create task_evidence_metadata for %s: %s", eid, exc)
                raise

        # === CHAIN OF CUSTODY: LOG UPLOAD TO AUDIT TRAIL ===
        _log_evidence_access(
            evidence_id=eid,
            session_id=session_id,
            organization_id=org_id,
            accessed_by=uploaded_by,
            action="upload",
            ip_address=ip_address,
            user_agent=user_agent,
            file_hash_match=True,
            file_hash_stored=file_hash,
            purpose="evidence_upload",
            shift_id=shift_id,
        )

        # Keep sessions.task_evidence JSONB in sync (backward compatibility)
        backward_compat_record: dict[str, Any] = {
            "evidence_id": eid,
            "task_id": item.get("task_id"),
            "goal_id": _coerce_uuid(item.get("goal_id")),
            "session_id": session_id,
            "type": etype,
            "content": "",
            "duration_seconds": item.get("duration_seconds"),
            "file_size_bytes": len(raw_bytes),
            "mime_type": mime_type,
            "storage_path": storage_path,
            "storage_provider": stored.provider,
            "file_url": file_url,
            "created_at": server_timestamp.isoformat(),
            "synced": True,
        }
        by_id[eid] = backward_compat_record
        uploaded.append({
            "evidence_id": eid,
            "url": file_url,
            "storage_path": storage_path,
            "stored_at": server_timestamp.isoformat(),
            "file_hash": file_hash,  # Include hash in response for verification
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
