"""Employee onboarding hires — MD/coordinator creates a new-hire record with
offer letter + service agreement, both sides sign, then an invite is sent.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from .email_service import queue_onboarding_sign_email, queue_signing_verification_email
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()

DOCUMENT_TYPES = {"offer_letter", "service_agreement", "other"}
ALLOWED_FILE_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
}
MAX_FILE_BYTES = 20 * 1024 * 1024
BUCKET = "worker-onboarding-files"
SIGNED_URL_EXPIRY_SECONDS = 7 * 24 * 60 * 60


def _is_missing_schema(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sign_documents(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
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


# ── Hires (coordinator/MD authenticated) ───────────────────────────────────

def list_hires(organization_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("employee_onboarding")
            .select("*")
            .eq("organization_id", organization_id)
            .order("created_at", desc=True)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


def get_hire(hire_id: str, organization_id: str) -> dict[str, Any]:
    resp = (
        get_supabase_admin()
        .table("employee_onboarding")
        .select("*")
        .eq("id", hire_id)
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Onboarding record not found.")
    return resp.data[0]


def create_hire(
    organization_id: str,
    created_by: str,
    full_name: str,
    email: str,
    phone: str | None,
    role: str,
) -> dict[str, Any]:
    if role not in {"support_worker", "support_coordinator"}:
        raise HTTPException(status_code=422, detail="Invalid role.")
    if not full_name.strip() or not email.strip():
        raise HTTPException(status_code=422, detail="Full name and email are required.")
    payload = {
        "id": str(uuid4()),
        "organization_id": organization_id,
        "created_by": created_by,
        "full_name": full_name.strip(),
        "email": email.strip().lower(),
        "phone": (phone or "").strip() or None,
        "role": role,
        "status": "draft",
    }
    result = get_supabase_admin().table("employee_onboarding").insert(payload).execute()
    return result.data[0] if result.data else payload


def list_documents(hire_id: str) -> list[dict[str, Any]]:
    resp = (
        get_supabase_admin()
        .table("employee_onboarding_documents")
        .select("*")
        .eq("onboarding_id", hire_id)
        .order("created_at", desc=True)
        .execute()
    )
    return _sign_documents(resp.data or [])


def add_document(
    hire_id: str,
    organization_id: str,
    document_type: str,
    title: str,
    notes: str | None,
) -> dict[str, Any]:
    get_hire(hire_id, organization_id)
    if document_type not in DOCUMENT_TYPES:
        raise HTTPException(status_code=422, detail="Invalid document type.")
    if not title.strip():
        raise HTTPException(status_code=422, detail="Document title is required.")
    payload = {
        "id": str(uuid4()),
        "onboarding_id": hire_id,
        "document_type": document_type,
        "title": title.strip(),
        "notes": (notes or "").strip() or None,
    }
    result = get_supabase_admin().table("employee_onboarding_documents").insert(payload).execute()
    return result.data[0] if result.data else payload


async def upload_document_file(
    document_id: str,
    file_bytes: bytes,
    content_type: str,
) -> dict[str, Any]:
    if content_type not in ALLOWED_FILE_TYPES:
        raise HTTPException(status_code=422, detail="Document file must be PDF or image (JPEG/PNG).")
    if len(file_bytes) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="Document file must be 20MB or smaller.")

    supabase = get_supabase_admin()
    existing = (
        supabase.table("employee_onboarding_documents")
        .select("id, onboarding_id")
        .eq("id", document_id)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Onboarding document not found.")
    onboarding_id = existing.data[0]["onboarding_id"]

    ext = ALLOWED_FILE_TYPES[content_type]
    path = f"pending/{onboarding_id}/{document_id}-{uuid4().hex}{ext}"
    try:
        supabase.storage.from_(BUCKET).upload(path, file_bytes, {"content-type": content_type, "upsert": "true"})
        signed = supabase.storage.from_(BUCKET).create_signed_url(path, SIGNED_URL_EXPIRY_SECONDS)
        url = signed.get("signedURL") or signed.get("signed_url")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Onboarding document storage is not configured: {exc}")

    result = (
        supabase.table("employee_onboarding_documents")
        .update({"file_path": path, "file_url": url})
        .eq("id", document_id)
        .execute()
    )
    return result.data[0] if result.data else {"file_path": path, "file_url": url}


def delete_document(document_id: str) -> None:
    existing = (
        get_supabase_admin()
        .table("employee_onboarding_documents")
        .select("id, file_path")
        .eq("id", document_id)
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
    supabase.table("employee_onboarding_documents").delete().eq("id", document_id).execute()


def send_for_signature(hire_id: str, organization_id: str, employer_user_id: str, employer_name: str) -> dict[str, Any]:
    hire = get_hire(hire_id, organization_id)
    # "draft" is the first send; "awaiting_signatures"/"expired" are a resend — the MD
    # asking for a fresh link (their own session expired, they lost the email, or the
    # 14-day auto-expiry in offer_letter_reminder_service.py already fired). A resend
    # always issues a brand-new sign_token so the old link stops working, and restarts
    # both the employer_signed_at clock (offer_letter_reminder_service's 14-day expiry)
    # and the day-3 reminder (offer_reminder_sent_at reset to None) — otherwise a resend
    # right before the old 14-day window closed would expire again almost immediately.
    if hire["status"] not in {"draft", "awaiting_signatures", "expired"}:
        raise HTTPException(status_code=409, detail="This hire isn't awaiting a signature.")
    docs = list_documents(hire_id)
    if not docs:
        raise HTTPException(status_code=422, detail="Attach at least one document (e.g. offer letter) before sending for signature.")

    sign_token = secrets.token_hex(24)
    update = {
        "status": "awaiting_signatures",
        "sign_token": sign_token,
        "employer_signed_by": employer_user_id,
        "employer_signed_name": employer_name,
        "employer_signed_at": _now(),
        "offer_reminder_sent_at": None,
        "updated_at": _now(),
    }
    result = (
        get_supabase_admin()
        .table("employee_onboarding")
        .update(update)
        .eq("id", hire_id)
        .execute()
    )
    updated = result.data[0] if result.data else {**hire, **update}

    from ..core.config import settings
    from . import organization_branding_service
    branding = organization_branding_service.get_branding(organization_id)
    sign_url = f"{settings.frontend_base_url.rstrip('/')}/onboarding-sign?token={sign_token}"
    email_delivery = queue_onboarding_sign_email(
        to_email=hire["email"],
        full_name=hire["full_name"],
        sign_url=sign_url,
        organization_name=branding.get("display_name"),
        document_titles=[d["title"] for d in docs],
        logo_url=branding.get("logo_url"),
        brand_accent_color=branding.get("brand_accent_color"),
    )
    updated["email_delivery"] = email_delivery
    return updated


# ── Public signing (no auth — applicant uses sign_token) ───────────────────
#
# Offer letter / service agreement documents carry sensitive content (salary,
# terms, policies). The sign_token alone (a link in an email that could be
# forwarded or intercepted) isn't proof of inbox access, so the actual
# document contents and the ability to sign are gated behind a second,
# in-the-moment 6-digit email code — same pattern already used for
# invitations (invitations.py send-code/verify-code), mirrored here.

_SIGNING_CODE_RESEND_COOLDOWN = timedelta(seconds=30)
_SIGNING_CODE_TTL = timedelta(minutes=10)


def _get_hire_for_signing_raw(token: str) -> dict[str, Any]:
    try:
        resp = (
            get_supabase_admin()
            .table("employee_onboarding")
            .select(
                "id, organization_id, full_name, email, role, status, "
                "employer_signed_name, employer_signed_at, worker_signed_name, worker_signed_at, "
                "signing_code_hash, signing_code_expires_at, signing_code_sent_at, signing_email_verified_at"
            )
            .eq("sign_token", token)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_schema(exc):
            # Migration 136 (signing_code_* columns) hasn't been applied yet —
            # a real candidate must never see this as "your link is invalid."
            raise HTTPException(
                status_code=503,
                detail="Signing isn't available right now. Please try again shortly.",
            ) from exc
        raise
    if not resp.data:
        raise HTTPException(status_code=404, detail="Signing link not found or expired.")
    return resp.data[0]


def get_hire_by_sign_token(token: str) -> dict[str, Any]:
    hire = _get_hire_for_signing_raw(token)
    verified = bool(hire.get("signing_email_verified_at"))

    result = {
        "id": hire["id"],
        "full_name": hire["full_name"],
        "email": hire["email"],
        "role": hire["role"],
        "status": hire["status"],
        "employer_signed_name": hire.get("employer_signed_name"),
        "employer_signed_at": hire.get("employer_signed_at"),
        "worker_signed_name": hire.get("worker_signed_name"),
        "worker_signed_at": hire.get("worker_signed_at"),
        "email_verified": verified,
    }
    # Document contents (including file_url — the actual sensitive files) are
    # withheld entirely until the email code is verified. A signed offer is
    # already past the point of needing to re-verify to view a receipt of
    # what was signed.
    if verified or hire["status"] not in {"awaiting_signatures"}:
        result["documents"] = list_documents(hire["id"])
    else:
        result["documents"] = []
    return result


def send_signing_code(token: str) -> dict[str, Any]:
    hire = _get_hire_for_signing_raw(token)
    if hire["status"] != "awaiting_signatures":
        raise HTTPException(status_code=409, detail="This offer is not awaiting a signature.")

    sent_at = hire.get("signing_code_sent_at")
    if sent_at and _now_utc() - _parse_iso(sent_at) < _SIGNING_CODE_RESEND_COOLDOWN:
        return {"ok": True, "message": "Code already sent — check your inbox, or wait a moment to resend."}

    code = f"{secrets.randbelow(1_000_000):06d}"
    now = _now_utc()
    get_supabase_admin().table("employee_onboarding").update({
        "signing_code_hash": _hash_code(code),
        "signing_code_expires_at": (now + _SIGNING_CODE_TTL).isoformat(),
        "signing_code_sent_at": now.isoformat(),
        "signing_email_verified_at": None,
    }).eq("id", hire["id"]).execute()

    organization_name = None
    try:
        from . import organization_branding_service
        branding = organization_branding_service.get_branding(hire["organization_id"])
        organization_name = branding.get("display_name")
    except Exception:
        pass

    email_delivery = queue_signing_verification_email(
        to_email=hire["email"],
        code=code,
        organization_name=organization_name,
    )
    return {"ok": True, "email_delivery": email_delivery}


def verify_signing_code(token: str, code: str) -> dict[str, Any]:
    hire = _get_hire_for_signing_raw(token)
    code_hash = hire.get("signing_code_hash")
    expires_at = hire.get("signing_code_expires_at")
    if not code_hash or not expires_at:
        raise HTTPException(status_code=400, detail="No verification code was sent. Request a new code.")
    if _parse_iso(expires_at) < _now_utc():
        raise HTTPException(status_code=400, detail="This code has expired. Request a new one.")
    if _hash_code((code or "").strip()) != code_hash:
        raise HTTPException(status_code=400, detail="Incorrect code. Check your email and try again.")

    get_supabase_admin().table("employee_onboarding").update({
        "signing_email_verified_at": _now_utc().isoformat(),
    }).eq("id", hire["id"]).execute()
    return {"ok": True}


def _document_version_hash(hire_id: str) -> str:
    """Fingerprints exactly which stored documents (by id + storage path, not
    just title) are attached at the moment of signing — confirms what was
    actually accepted, distinct from the acceptance timestamp itself."""
    docs = (
        get_supabase_admin()
        .table("employee_onboarding_documents")
        .select("id, file_path")
        .eq("onboarding_id", hire_id)
        .order("id")
        .execute()
    )
    fingerprint = "|".join(f"{d['id']}:{d.get('file_path') or ''}" for d in (docs.data or []))
    return hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()


def sign_as_worker(
    token: str,
    full_name: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> dict[str, Any]:
    resp = (
        get_supabase_admin()
        .table("employee_onboarding")
        .select("id, status, signing_email_verified_at")
        .eq("sign_token", token)
        .limit(1)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Signing link not found or expired.")
    hire = resp.data[0]
    if hire["status"] not in {"awaiting_signatures"}:
        raise HTTPException(status_code=409, detail="This offer is not awaiting a signature.")
    if not hire.get("signing_email_verified_at"):
        raise HTTPException(status_code=403, detail="Please verify your email before signing.")
    if not full_name.strip():
        raise HTTPException(status_code=422, detail="Please type your full name to sign.")

    update = {
        "status": "signed",
        "worker_signed_name": full_name.strip(),
        "worker_signed_at": _now(),
        "worker_signed_ip": ip_address,
        "worker_signed_user_agent": user_agent,
        "worker_signed_document_version_hash": _document_version_hash(hire["id"]),
        "updated_at": _now(),
    }
    result = (
        get_supabase_admin()
        .table("employee_onboarding")
        .update(update)
        .eq("id", hire["id"])
        .execute()
    )

    # If this hire originated from the Applicants Board, the signature itself
    # is what moves the card to Hired — not a separate coordinator action.
    # No-ops silently if it didn't (an MD-created hire has no applicant row).
    try:
        from . import applicant_service
        applicant_service.mark_applicant_hired_by_onboarding_id(hire["id"])
    except Exception:
        logger.warning("Could not mark applicant hired for onboarding %s", hire["id"])

    return result.data[0] if result.data else {**hire, **update}


# ── Document handoff on invite acceptance ──────────────────────────────────

def migrate_documents_to_worker(onboarding_id: str, worker_id: str, organization_id: str) -> None:
    """Copy pending onboarding documents onto the newly-created worker's profile."""
    supabase = get_supabase_admin()
    try:
        docs = (
            supabase.table("employee_onboarding_documents")
            .select("*")
            .eq("onboarding_id", onboarding_id)
            .execute()
        )
    except Exception as exc:
        if _is_missing_schema(exc):
            return
        raise
    for doc in docs.data or []:
        supabase.table("worker_onboarding_documents").insert({
            "id": str(uuid4()),
            "worker_id": worker_id,
            "organization_id": organization_id,
            "document_type": doc["document_type"],
            "title": doc["title"],
            "notes": doc.get("notes"),
            "file_path": doc.get("file_path"),
            "file_url": doc.get("file_url"),
        }).execute()
    supabase.table("employee_onboarding").update({
        "status": "completed",
        "updated_at": _now(),
    }).eq("id", onboarding_id).execute()
