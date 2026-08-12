"""Medication document chain of custody (Medication Management v2, step 1).

The original uploaded file is the source of truth. Upload happens synchronously, first, and the
row is inserted immediately with extraction_status='pending' — extraction runs after and only
ever updates extracted_data/extraction_status on that same row. If extraction fails, the
document is already safely stored; nothing about that failure removes or blocks it.
"""

from __future__ import annotations

import logging
import mimetypes
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from . import medication_extraction_service
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

BUCKET = "medication-documents"
ALLOWED_FILE_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
MAX_FILE_BYTES = 15 * 1024 * 1024
DOCUMENT_TYPES = {"prescription", "medication_management_plan", "gp_letter", "pharmacy_authority", "other"}


def _is_missing_schema(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg


async def upload_document(
    participant_id: str,
    organization_id: str,
    uploaded_by: str,
    *,
    file_bytes: bytes,
    filename: str,
    content_type: str,
    document_type: str = "other",
    medication_id: str | None = None,
) -> dict[str, Any]:
    """Store the file first, insert the row, then run extraction. Extraction failure is
    logged and reflected in extraction_status — it never undoes the storage/insert above."""
    resolved_type = content_type or mimetypes.guess_type(filename)[0] or ""
    if resolved_type not in ALLOWED_FILE_TYPES:
        raise HTTPException(status_code=422, detail="Document must be a PDF, JPEG, PNG, or WEBP file.")
    if len(file_bytes) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="Document must be 15MB or smaller.")
    if document_type not in DOCUMENT_TYPES:
        document_type = "other"

    ext = ALLOWED_FILE_TYPES[resolved_type]
    document_id = str(uuid4())
    path = f"{organization_id}/{participant_id}/{document_id}{ext}"

    supabase = get_supabase_admin()
    try:
        supabase.storage.from_(BUCKET).upload(path, file_bytes, {"content-type": resolved_type, "upsert": "true"})
        url = supabase.storage.from_(BUCKET).get_public_url(path)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Document storage is not configured: {exc}") from exc

    record = {
        "id": document_id,
        "participant_id": participant_id,
        "organization_id": organization_id,
        "medication_id": medication_id,
        "file_path": path,
        "file_url": url,
        "file_name": filename,
        "file_type": resolved_type,
        "file_size": len(file_bytes),
        "document_type": document_type,
        "extraction_status": "pending",
        "uploaded_by": uploaded_by,
    }
    try:
        result = get_supabase_admin().table("medication_documents").insert(record).execute()
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Medication document service unavailable.") from exc
        raise
    document = result.data[0] if result.data else record

    # The file is safely stored and the row exists at this point regardless of what happens below.
    extracted_fields: dict[str, Any] | None = None
    try:
        extracted_fields = await medication_extraction_service.extract_medication_fields(file_bytes, resolved_type)
        get_supabase_admin().table("medication_documents").update({
            "extracted_data": extracted_fields,
            "extraction_status": "complete",
        }).eq("id", document_id).execute()
        document["extracted_data"] = extracted_fields
        document["extraction_status"] = "complete"
    except Exception as exc:
        logger.warning("Medication document extraction failed for %s: %s", document_id, exc)
        try:
            get_supabase_admin().table("medication_documents").update({
                "extraction_status": "failed",
            }).eq("id", document_id).execute()
            document["extraction_status"] = "failed"
        except Exception:
            pass

    return {"document": document, "extracted_fields": extracted_fields}


def link_document_to_medication(document_id: str, medication_id: str, organization_id: str) -> dict[str, Any]:
    result = (
        get_supabase_admin()
        .table("medication_documents")
        .update({"medication_id": medication_id})
        .eq("id", document_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Document not found.")
    return result.data[0]


def list_documents_for_medication(medication_id: str, organization_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("medication_documents")
            .select("*")
            .eq("medication_id", medication_id)
            .eq("organization_id", organization_id)
            .order("effective_from", desc=True)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


def list_documents_for_participant(participant_id: str, organization_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("medication_documents")
            .select("*")
            .eq("participant_id", participant_id)
            .eq("organization_id", organization_id)
            .order("uploaded_at", desc=True)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


def supersede_document(old_document_id: str, new_document_id: str, organization_id: str) -> dict[str, Any]:
    """Mark old_document_id as superseded by new_document_id. The old row is never deleted or
    edited beyond this supersession marker — it stays queryable as "what was current" up to
    the moment it was superseded."""
    now = datetime.now(timezone.utc).isoformat()
    result = (
        get_supabase_admin()
        .table("medication_documents")
        .update({"superseded_by_document_id": new_document_id, "superseded_at": now})
        .eq("id", old_document_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Document not found.")
    return result.data[0]


def get_document_as_of(medication_id: str, as_of: str, organization_id: str) -> dict[str, Any] | None:
    """The document that was the current authorization for this medication at a given
    point in time — the query an auditor asking "what was on file on this date" needs."""
    try:
        resp = (
            get_supabase_admin()
            .table("medication_documents")
            .select("*")
            .eq("medication_id", medication_id)
            .eq("organization_id", organization_id)
            .lte("effective_from", as_of)
            .order("effective_from", desc=True)
            .execute()
        )
    except Exception as exc:
        if _is_missing_schema(exc):
            return None
        raise
    for row in resp.data or []:
        superseded_at = row.get("superseded_at")
        if not superseded_at or superseded_at > as_of:
            return row
    return None
