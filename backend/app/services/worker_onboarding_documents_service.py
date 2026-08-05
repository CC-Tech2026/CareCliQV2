"""Worker onboarding documents (offer letter, service agreement, other) — coordinator worker profile."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

DOCUMENT_TYPES = {"offer_letter", "service_agreement", "other"}

ALLOWED_FILE_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
}
MAX_FILE_BYTES = 20 * 1024 * 1024
BUCKET = "worker-onboarding-files"
SIGNED_URL_EXPIRY_SECONDS = 7 * 24 * 60 * 60  # 7 days


def _is_missing_schema(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg


def list_worker_documents(worker_id: str, organization_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("worker_onboarding_documents")
            .select("*")
            .eq("worker_id", worker_id)
            .eq("organization_id", organization_id)
            .order("created_at", desc=True)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise

    supabase = get_supabase_admin()
    for row in rows:
        path = row.get("file_path")
        if not path:
            continue
        try:
            signed = supabase.storage.from_(BUCKET).create_signed_url(path, SIGNED_URL_EXPIRY_SECONDS)
            row["file_url"] = signed.get("signedURL") or signed.get("signed_url") or row.get("file_url")
        except Exception:
            logger.warning("Could not refresh signed URL for onboarding document %s", row.get("id"))
    return rows


def create_document_record(
    worker_id: str,
    organization_id: str,
    document_type: str,
    title: str,
    notes: str | None,
    uploaded_by: str,
) -> dict[str, Any]:
    if document_type not in DOCUMENT_TYPES:
        raise HTTPException(status_code=422, detail="Invalid document type.")
    if not title.strip():
        raise HTTPException(status_code=422, detail="Document title is required.")
    payload = {
        "id": str(uuid4()),
        "worker_id": worker_id,
        "organization_id": organization_id,
        "document_type": document_type,
        "title": title.strip(),
        "notes": (notes or "").strip() or None,
        "uploaded_by": uploaded_by,
    }
    result = get_supabase_admin().table("worker_onboarding_documents").insert(payload).execute()
    return result.data[0] if result.data else payload


async def upload_document_file(
    document_id: str,
    organization_id: str,
    file_bytes: bytes,
    content_type: str,
) -> dict[str, Any]:
    if content_type not in ALLOWED_FILE_TYPES:
        raise HTTPException(status_code=422, detail="Document file must be PDF or image (JPEG/PNG).")
    if len(file_bytes) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="Document file must be 20MB or smaller.")

    supabase = get_supabase_admin()
    existing = (
        supabase.table("worker_onboarding_documents")
        .select("id, worker_id")
        .eq("id", document_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Onboarding document not found.")
    worker_id = existing.data[0]["worker_id"]

    ext = ALLOWED_FILE_TYPES[content_type]
    path = f"{organization_id}/{worker_id}/{document_id}-{uuid4().hex}{ext}"
    try:
        supabase.storage.from_(BUCKET).upload(path, file_bytes, {"content-type": content_type, "upsert": "true"})
        signed = supabase.storage.from_(BUCKET).create_signed_url(path, SIGNED_URL_EXPIRY_SECONDS)
        url = signed.get("signedURL") or signed.get("signed_url")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Onboarding document storage is not configured: {exc}")

    result = (
        supabase.table("worker_onboarding_documents")
        .update({"file_path": path, "file_url": url, "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", document_id)
        .execute()
    )
    return result.data[0] if result.data else {"file_path": path, "file_url": url}


def delete_document(document_id: str, organization_id: str) -> None:
    existing = (
        get_supabase_admin()
        .table("worker_onboarding_documents")
        .select("id, file_path")
        .eq("id", document_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Onboarding document not found.")
    row = existing.data[0]
    supabase = get_supabase_admin()
    if row.get("file_path"):
        try:
            supabase.storage.from_(BUCKET).remove([row["file_path"]])
        except Exception:
            logger.warning("Could not remove onboarding document file %s", row.get("file_path"))
    supabase.table("worker_onboarding_documents").delete().eq("id", document_id).execute()
