from __future__ import annotations

import mimetypes
from datetime import date, datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from ..core.access import get_user_id, get_user_organization_id, is_coordinator_role
from ..core.security import get_current_user
from ..api.security import require_recent_reauth
from ..services.supabase_client import get_supabase_admin

router = APIRouter(prefix="/credentials", tags=["credentials"])

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


class CredentialReviewBody(BaseModel):
    status: str
    notes: str | None = None


def _status_for(expiry_date: str | None, current: str = "pending_review") -> str:
    if current in {"rejected", "pending_review"}:
        return current
    if not expiry_date:
        return current if current in {"valid", "expiring", "expired"} else "valid"
    expiry = date.fromisoformat(str(expiry_date)[:10])
    today = date.today()
    if expiry < today:
        return "expired"
    if (expiry - today).days <= 30:
        return "expiring"
    return "valid"


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
    return [{**row, "status": _status_for(row.get("expiry_date"), row.get("status") or "valid")} for row in rows]


@router.post("/me", status_code=201)
async def create_my_credential(body: CredentialBody, current_user: dict = Depends(get_current_user)):
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
    return result.data[0] if result.data else _get_credential_for_user(credential_id, current_user)


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
        supabase.storage.from_("credential-files").upload(path, raw, {"content-type": content_type, "upsert": "true"})
        url = supabase.storage.from_("credential-files").get_public_url(path)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Credential storage is not configured: {exc}")
    result = (
        supabase.table("credentials")
        .update({"file_path": path, "file_url": url, "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", credential_id)
        .eq("user_id", get_user_id(current_user))
        .execute()
    )
    return result.data[0] if result.data else {"file_path": path, "file_url": url}


@router.get("/team")
async def list_team_credentials(current_user: dict = Depends(get_current_user)):
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=403, detail="Only support coordinators can view team credentials.")
    org_id = get_user_organization_id(current_user)
    result = get_supabase_admin().table("credentials").select("*").eq("organization_id", org_id).execute()
    return [
        {**row, "status": _status_for(row.get("expiry_date"), row.get("status") or "valid")}
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
    result = get_supabase_admin().table("credentials").update(payload).eq("id", credential_id).execute()
    return result.data[0] if result.data else {**existing, **payload}
