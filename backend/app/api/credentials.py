from __future__ import annotations

import mimetypes
import re
from datetime import date, datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from ..core.access import get_user_id, get_user_organization_id, has_org_wide_access, is_coordinator_role
from ..core.security import get_current_user
from ..api.security import require_recent_reauth
from ..services import audit_service
from ..services.supabase_client import get_supabase_admin, signed_storage_url

CREDENTIAL_FILES_BUCKET = "credential-files"

router = APIRouter(prefix="/credentials", tags=["credentials"])

# NDIS Worker Screening check numbers are commonly formatted as WWCXXXXXXXXXXXXX-style
# alphanumeric IDs. There is no public NDIS Commission API to check a screening number
# against — this validates the number is *shaped* like a real one, nothing more. It
# must never be read as confirmation that the NDIS Commission actually cleared the
# worker; that confirmation only happens when a coordinator manually checks the NDIS
# Commission portal directly and records it via last_checked_against_nwsd below.
_SCREENING_NUMBER_RE = re.compile(r"^[A-Za-z0-9-]{6,30}$")


def validate_screening_number_format(value: str) -> bool:
    """True if `value` is shaped like a screening number. Format-only — does not
    verify the number against the NDIS Worker Screening Database."""
    return bool(_SCREENING_NUMBER_RE.match(value.strip()))

ALLOWED_FILE_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
MAX_FILE_BYTES = 10 * 1024 * 1024


class CredentialBody(BaseModel):
    credential_type: str
    title: str
    credential_number: str | None = None
    issuer: str | None = None
    issue_date: str | None = None
    expiry_date: str | None = None
    notes: str | None = None
    screening_number: str | None = None


class CredentialReviewBody(BaseModel):
    status: str
    notes: str | None = None
    last_checked_against_nwsd: str | None = None


def _status_for(expiry_date: str | None, current: str = "pending_review") -> str:
    if current in {"rejected", "pending_review"}:
        return current
    if not expiry_date:
        return current if current in {"valid", "expiring", "expired"} else "valid"
    expiry = date.fromisoformat(str(expiry_date)[:10])
    today = date.today()
    if expiry < today:
        return "expired"
    if (expiry - today).days <= 60:
        return "expiring"
    return "valid"


def _with_signed_file_url(row: dict) -> dict:
    """credential-files is a private bucket — never trust a stored file_url (it may
    be a stale public link from before the bucket was locked down, or simply
    expired); always regenerate a fresh signed URL from file_path on read."""
    row = dict(row)
    row["file_url"] = signed_storage_url(CREDENTIAL_FILES_BUCKET, row.get("file_path"))
    return row


def _query_own(user: dict):
    return get_supabase_admin().table("credentials").select("*").eq("user_id", get_user_id(user))


def _get_credential_for_user(credential_id: str, user: dict) -> dict:
    query = get_supabase_admin().table("credentials").select("*").eq("id", credential_id)
    if not is_coordinator_role(user):
        query = query.eq("user_id", get_user_id(user))
    else:
        query = query.eq("organization_id", get_user_organization_id(user))
    result = query.maybe_single().execute()
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Credential not found")
    return result.data


@router.get("/me")
async def list_my_credentials(current_user: dict = Depends(get_current_user)):
    result = _query_own(current_user).order("expiry_date", desc=False).execute()
    rows = result.data or []
    return [
        {**_with_signed_file_url(row), "status": _status_for(row.get("expiry_date"), row.get("status") or "valid")}
        for row in rows
    ]


def _check_screening_number(body: CredentialBody) -> None:
    if body.credential_type == "ndis_screening" and body.screening_number:
        if not validate_screening_number_format(body.screening_number):
            raise HTTPException(status_code=422, detail="Screening number is not a valid format.")


@router.post("/me", status_code=201)
async def create_my_credential(body: CredentialBody, current_user: dict = Depends(get_current_user)):
    _check_screening_number(body)
    payload = body.model_dump()
    payload.update(
        {
            "user_id": get_user_id(current_user),
            "organization_id": get_user_organization_id(current_user),
            "status": "pending_review",
        }
    )
    result = get_supabase_admin().table("credentials").insert(payload).execute()
    return result.data[0] if result.data else payload


@router.patch("/me/{credential_id}")
async def update_my_credential(
    credential_id: str,
    body: CredentialBody,
    current_user: dict = Depends(get_current_user),
):
    existing = _get_credential_for_user(credential_id, current_user)
    if existing.get("verified_at") and not is_coordinator_role(current_user):
        raise HTTPException(status_code=403, detail="Reviewed credentials cannot be edited by workers.")
    _check_screening_number(body)
    payload = body.model_dump(exclude_unset=True)
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = (
        get_supabase_admin()
        .table("credentials")
        .update(payload)
        .eq("id", credential_id)
        .eq("user_id", get_user_id(current_user))
        .execute()
    )
    updated = result.data[0] if result.data else _get_credential_for_user(credential_id, current_user)
    await audit_service.log_action(
        action_type="credential.updated",
        entity_type="credential",
        entity_id=credential_id,
        user_id=get_user_id(current_user),
        organization_id=get_user_organization_id(current_user),
        before_state={k: existing.get(k) for k in payload},
        after_state={k: updated.get(k) for k in payload},
    )
    return _with_signed_file_url(updated)


@router.delete("/me/{credential_id}", status_code=204)
async def delete_my_credential(credential_id: str, current_user: dict = Depends(get_current_user)):
    existing = _get_credential_for_user(credential_id, current_user)
    if existing.get("verified_at"):
        raise HTTPException(status_code=403, detail="Reviewed credentials cannot be deleted.")
    get_supabase_admin().table("credentials").delete().eq("id", credential_id).eq("user_id", get_user_id(current_user)).execute()
    return None


@router.post("/me/{credential_id}/upload")
async def upload_my_credential_file(
    credential_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    _get_credential_for_user(credential_id, current_user)
    content_type = file.content_type or mimetypes.guess_type(file.filename or "")[0] or ""
    if content_type not in ALLOWED_FILE_TYPES:
        raise HTTPException(status_code=422, detail="Credential file must be PDF or image.")
    raw = await file.read()
    if len(raw) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="Credential file must be 10MB or smaller.")
    ext = ALLOWED_FILE_TYPES[content_type]
    path = f"{get_user_organization_id(current_user) or 'personal'}/{get_user_id(current_user)}/{credential_id}-{uuid4().hex}{ext}"
    supabase = get_supabase_admin()
    try:
        supabase.storage.from_(CREDENTIAL_FILES_BUCKET).upload(path, raw, {"content-type": content_type, "upsert": "true"})
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Credential storage is not configured: {exc}")
    result = (
        supabase.table("credentials")
        # file_url is intentionally not stored — credential-files is a private bucket,
        # so the URL must be a freshly-signed one generated at read time (see
        # _with_signed_file_url), never a persisted link that can outlive its signature
        # or predate the bucket being locked down.
        .update({"file_path": path, "file_url": None, "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", credential_id)
        .eq("user_id", get_user_id(current_user))
        .execute()
    )
    updated = result.data[0] if result.data else {"file_path": path}
    return _with_signed_file_url(updated)


@router.get("/team")
async def list_team_credentials(current_user: dict = Depends(get_current_user)):
    if not has_org_wide_access(current_user):
        raise HTTPException(status_code=403, detail="Coordinator or managing director access required.")
    org_id = get_user_organization_id(current_user)
    result = get_supabase_admin().table("credentials").select("*").eq("organization_id", org_id).execute()
    return [
        {**_with_signed_file_url(row), "status": _status_for(row.get("expiry_date"), row.get("status") or "valid")}
        for row in (result.data or [])
    ]


@router.patch("/{credential_id}/review")
async def review_credential(
    credential_id: str,
    body: CredentialReviewBody,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=403, detail="Only support coordinators can review credentials.")
    require_recent_reauth(request, current_user)
    if body.status not in {"valid", "rejected", "pending_review"}:
        raise HTTPException(status_code=422, detail="Invalid review status.")
    existing = _get_credential_for_user(credential_id, current_user)
    payload = {
        "status": _status_for(existing.get("expiry_date"), body.status),
        "verified_by": get_user_id(current_user) if body.status == "valid" else None,
        "verified_at": datetime.now(timezone.utc).isoformat() if body.status == "valid" else None,
        "notes": body.notes,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    # Approving the CareCliQ record and confirming clearance on the NDIS Commission
    # portal directly are two separate facts — only touch last_checked_against_nwsd
    # when the reviewer actually supplies it, never implicitly from a status change.
    if body.last_checked_against_nwsd is not None:
        payload["last_checked_against_nwsd"] = body.last_checked_against_nwsd
    result = get_supabase_admin().table("credentials").update(payload).eq("id", credential_id).execute()
    updated = result.data[0] if result.data else {**existing, **payload}
    await audit_service.log_action(
        action_type="credential.reviewed",
        entity_type="credential",
        entity_id=credential_id,
        user_id=get_user_id(current_user),
        organization_id=get_user_organization_id(current_user),
        before_state={k: existing.get(k) for k in payload},
        after_state={k: updated.get(k) for k in payload},
    )
    return _with_signed_file_url(updated)
