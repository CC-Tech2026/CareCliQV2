"""Per-shift digital signatures — CARECLIQV2-270."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException

from .object_storage import upload_evidence_bytes
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

_DATA_URL_RE = re.compile(r"^data:[^;]+;base64,", re.IGNORECASE)


def _is_missing_table(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "shift_signatures" in msg and ("does not exist" in msg or "schema cache" in msg)


def _decode_png(png_data_url: str) -> bytes:
    text = _DATA_URL_RE.sub("", (png_data_url or "").strip())
    try:
        return base64.b64decode(text, validate=False)
    except Exception as exc:
        raise ValueError("Invalid signature image data") from exc


def _content_hash(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def get_shift_signature(shift_id: str) -> Optional[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("shift_signatures")
            .select("*")
            .eq("shift_id", shift_id)
            .maybe_single()
            .execute()
        )
        if not resp or not resp.data:
            return None
        row = dict(resp.data)
        signer_name = None
        try:
            user_resp = (
                get_supabase_admin()
                .table("users")
                .select("full_name")
                .eq("id", row.get("worker_id"))
                .maybe_single()
                .execute()
            )
            if user_resp and user_resp.data:
                signer_name = user_resp.data.get("full_name")
        except Exception:
            pass
        png_url = None
        png_path = row.get("signature_png_path")
        if png_path:
            try:
                from .object_storage import get_evidence_storage_backend

                png_url = get_evidence_storage_backend().signed_url(str(png_path))
            except Exception:
                png_url = None
        return {
            **row,
            "signer_name": signer_name,
            "signature_png_url": png_url,
        }
    except Exception as exc:
        if _is_missing_table(exc):
            return None
        logger.debug("get_shift_signature failed: %s", exc)
        return None


def submit_shift_signature(
    shift_id: str,
    worker_id: str,
    organization_id: str,
    *,
    confirm_tasks_accurate: bool,
    confirm_safety_followed: bool,
    confirm_no_unreported_incidents: bool,
    signature_svg: str,
    signature_png_data_url: str,
    device_id: Optional[str] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> dict[str, Any]:
    if not all([confirm_tasks_accurate, confirm_safety_followed, confirm_no_unreported_incidents]):
        raise ValueError("All confirmation checkboxes must be checked.")
    if not (signature_svg or "").strip():
        raise ValueError("Signature is required.")
    if not (signature_png_data_url or "").strip():
        raise ValueError("Signature image is required.")

    shift_resp = (
        get_supabase_admin()
        .table("shifts")
        .select("id, worker_id, organization_id, status")
        .eq("id", shift_id)
        .maybe_single()
        .execute()
    )
    if not shift_resp or not shift_resp.data:
        raise HTTPException(status_code=404, detail="Shift not found")
    shift = shift_resp.data
    if str(shift.get("worker_id")) != str(worker_id):
        raise HTTPException(status_code=403, detail="Not authorized")
    if str(shift.get("organization_id")) != str(organization_id):
        raise HTTPException(status_code=403, detail="Shift does not belong to your organisation.")

    existing = get_shift_signature(shift_id)
    if existing and str(existing.get("worker_id")) != str(worker_id):
        raise HTTPException(status_code=403, detail="Not authorized")
    if shift.get("status") == "completed" and not existing:
        raise HTTPException(status_code=409, detail="Shift is already completed.")

    png_bytes = _decode_png(signature_png_data_url)
    if len(png_bytes) < 32:
        raise ValueError("Signature image is too small.")

    storage_path = f"{organization_id}/shift-signatures/{shift_id}.png"
    stored = upload_evidence_bytes(storage_path, png_bytes, "image/png")

    signed_at = datetime.now(timezone.utc)
    hash_payload = {
        "shift_id": shift_id,
        "worker_id": worker_id,
        "confirm_tasks_accurate": confirm_tasks_accurate,
        "confirm_safety_followed": confirm_safety_followed,
        "confirm_no_unreported_incidents": confirm_no_unreported_incidents,
        "signature_svg": signature_svg.strip(),
        "signed_at": signed_at.isoformat(),
    }
    content_hash = _content_hash(hash_payload)

    record = {
        "shift_id": shift_id,
        "worker_id": worker_id,
        "organization_id": organization_id,
        "confirm_tasks_accurate": confirm_tasks_accurate,
        "confirm_safety_followed": confirm_safety_followed,
        "confirm_no_unreported_incidents": confirm_no_unreported_incidents,
        "signature_svg": signature_svg.strip(),
        "signature_png_path": storage_path,
        "content_hash": content_hash,
        "device_id": device_id,
        "ip_address": ip_address,
        "user_agent": user_agent,
        "signed_at": signed_at.isoformat(),
    }

    try:
        supabase = get_supabase_admin()
        if existing:
            update_payload = {k: v for k, v in record.items() if k != "shift_id"}
            supabase.table("shift_signatures").update(update_payload).eq("shift_id", shift_id).execute()
        else:
            supabase.table("shift_signatures").insert(record).execute()
    except Exception as exc:
        if _is_missing_table(exc):
            raise HTTPException(
                status_code=503,
                detail="Signature storage is not available. Run migration 058_compliance_privacy_signature.sql",
            ) from exc
        raise

    result = get_shift_signature(shift_id) or record
    if stored.file_url:
        result["signature_png_url"] = stored.file_url
    return result


def require_signature_for_shift(shift_id: str) -> None:
    """Raise if shift has no signature record (used before end_shift)."""
    if not get_shift_signature(shift_id):
        raise ValueError("Digital signature is required before ending the shift.")
