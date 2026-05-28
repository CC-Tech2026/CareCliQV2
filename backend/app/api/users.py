from __future__ import annotations

import mimetypes
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from ..core.access import get_user_id, get_user_organization_id
from ..core.security import get_current_user
from ..services.supabase_client import get_supabase_admin

router = APIRouter(prefix="/users", tags=["users"])

ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024


def _select_profile(user_id: str) -> dict:
    result = (
        get_supabase_admin()
        .table("users")
        .select(
            "id, email, full_name, role, account_type, organization_id, phone, address, suburb, "
            "emergency_contact, discipline, ahpra_registration_number, professional_indemnity_confirmed, "
            "business_name, email_verified, profile_completed, onboarding_completed, "
            "role_specific_profile_completed, profile_photo_url, profile_photo_path, onboarding_checklist"
        )
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="User profile not found")
    return result.data


@router.get("/me")
async def get_my_profile(current_user: dict = Depends(get_current_user)):
    return _select_profile(get_user_id(current_user))


@router.patch("/me")
async def update_my_profile(body: dict, current_user: dict = Depends(get_current_user)):
    user_id = get_user_id(current_user)
    allowed = {
        "full_name",
        "phone",
        "address",
        "suburb",
        "emergency_contact",
        "discipline",
        "ahpra_registration_number",
        "professional_indemnity_confirmed",
        "business_name",
    }
    payload = {k: v for k, v in (body or {}).items() if k in allowed}
    role = current_user.get("role")
    required_common = bool(payload.get("full_name")) and bool(payload.get("phone"))
    role_complete = False
    if role == "support_worker":
        role_complete = required_common
    elif role == "allied_health":
        role_complete = required_common and bool(payload.get("discipline"))
    elif role == "support_coordinator":
        role_complete = required_common or bool(payload.get("full_name"))
    if role_complete:
        payload.update(
            {
                "profile_completed": True,
                "role_specific_profile_completed": True,
            }
        )
    if not payload:
        raise HTTPException(status_code=422, detail="No supported profile fields supplied")
    result = get_supabase_admin().table("users").update(payload).eq("id", user_id).execute()
    return result.data[0] if result.data else _select_profile(user_id)


@router.post("/me/photo")
async def upload_my_profile_photo(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    content_type = file.content_type or mimetypes.guess_type(file.filename or "")[0] or ""
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=422, detail="Profile photo must be jpg, png, or webp.")
    raw = await file.read()
    if len(raw) > MAX_PROFILE_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Profile photo must be 5MB or smaller.")

    user_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user) or "personal"
    ext = ALLOWED_IMAGE_TYPES[content_type]
    path = f"{org_id}/{user_id}/avatar-{uuid4().hex}{ext}"
    supabase = get_supabase_admin()
    try:
        supabase.storage.from_("profile-photos").upload(
            path,
            raw,
            {"content-type": content_type, "upsert": "true"},
        )
        public_url = supabase.storage.from_("profile-photos").get_public_url(path)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Profile photo storage is not configured: {exc}",
        )

    result = (
        supabase.table("users")
        .update({"profile_photo_path": path, "profile_photo_url": public_url})
        .eq("id", user_id)
        .execute()
    )
    profile = result.data[0] if result.data else _select_profile(user_id)
    return {"profile_photo_path": path, "profile_photo_url": profile.get("profile_photo_url") or public_url}


@router.delete("/me/photo", status_code=204)
async def delete_my_profile_photo(current_user: dict = Depends(get_current_user)):
    user_id = get_user_id(current_user)
    profile = _select_profile(user_id)
    path = profile.get("profile_photo_path")
    supabase = get_supabase_admin()
    if path:
        try:
            supabase.storage.from_("profile-photos").remove([path])
        except Exception:
            pass
    supabase.table("users").update({"profile_photo_path": None, "profile_photo_url": None}).eq("id", user_id).execute()
    return None
