from __future__ import annotations

import asyncio
import logging
import mimetypes
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field

from ..api.security import require_recent_reauth
from ..core.access import get_user_id, get_user_organization_id
from ..core.security import get_current_user
from ..services.password_policy import validate_password_policy
from ..services.notification_service import (
    NOTIFICATION_CHANNELS,
    NOTIFICATION_EVENTS,
    default_notification_preferences,
)
from ..services.supabase_client import get_supabase, get_supabase_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/users", tags=["users"])

ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png"}
MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024

PREFERRED_CONTACT_METHODS = ("phone_call", "sms", "in_app_message")


def _default_notification_preferences() -> dict:
    return default_notification_preferences()


def _select_profile(user_id: str) -> dict:
    result = (
        get_supabase_admin()
        .table("users")
        .select(
            "id, email, full_name, role, account_type, organization_id, phone, address, suburb, "
            "emergency_contact, discipline, ahpra_registration_number, professional_indemnity_confirmed, "
            "business_name, email_verified, profile_completed, onboarding_completed, "
            "role_specific_profile_completed, profile_photo_url, profile_photo_path, onboarding_checklist, "
            "preferred_contact_method, pending_email"
        )
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="User profile not found")
    return result.data


def _membership_for_user(user_id: str, org_id: str | None) -> dict:
    if not org_id:
        return {}
    try:
        result = (
            get_supabase_admin()
            .table("organization_members")
            .select("employee_id, role, joined_at")
            .eq("user_id", user_id)
            .eq("organization_id", org_id)
            .maybe_single()
            .execute()
        )
        return result.data if result and result.data else {}
    except Exception as exc:
        logger.debug("Membership lookup failed for %s: %s", user_id, exc)
        return {}


def _build_account_profile(user_id: str, current_user: dict) -> dict:
    profile = _select_profile(user_id)
    org_id = profile.get("organization_id") or current_user.get("organization_id")
    membership = _membership_for_user(user_id, org_id)
    return {
        **profile,
        "employee_id": membership.get("employee_id"),
        "membership_role": membership.get("role") or profile.get("role"),
        "joined_at": membership.get("joined_at"),
    }


class ContactUpdateRequest(BaseModel):
    email: str | None = None
    phone: str | None = None
    preferred_contact_method: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str


class NotificationPreferencesRequest(BaseModel):
    device_id: str = Field(min_length=8, max_length=128)
    preferences: dict


@router.get("/me")
async def get_my_profile(current_user: dict = Depends(get_current_user)):
    return _build_account_profile(get_user_id(current_user), current_user)


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
        "preferred_contact_method",
    }
    payload = {k: v for k, v in (body or {}).items() if k in allowed}
    if payload.get("preferred_contact_method") not in (None, *PREFERRED_CONTACT_METHODS):
        raise HTTPException(status_code=422, detail="Invalid preferred contact method.")
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
    return result.data[0] if result.data else _build_account_profile(user_id, current_user)


@router.patch("/me/contact")
async def update_my_contact(
    body: ContactUpdateRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    require_recent_reauth(request, current_user)
    user_id = get_user_id(current_user)
    profile = _select_profile(user_id)
    payload: dict = {}

    if body.phone is not None:
        phone = body.phone.strip()
        if not phone:
            raise HTTPException(status_code=422, detail="Mobile number is required.")
        payload["phone"] = phone

    if body.preferred_contact_method is not None:
        if body.preferred_contact_method not in PREFERRED_CONTACT_METHODS:
            raise HTTPException(status_code=422, detail="Invalid preferred contact method.")
        payload["preferred_contact_method"] = body.preferred_contact_method

    if body.email is not None:
        email = body.email.strip().lower()
        if not email or "@" not in email:
            raise HTTPException(status_code=422, detail="Enter a valid email address.")
        if email != (profile.get("email") or "").lower():
            admin = get_supabase_admin()
            try:
                await asyncio.to_thread(
                    lambda: admin.auth.admin.update_user_by_id(
                        user_id,
                        {"email": email, "email_confirm": True},
                    )
                )
            except Exception as exc:
                logger.warning("Email update failed for %s: %s", user_id, exc)
                raise HTTPException(
                    status_code=502,
                    detail="Could not start email verification. Try again shortly.",
                )
            payload["pending_email"] = email

    if not payload:
        raise HTTPException(status_code=422, detail="No contact fields supplied.")

    result = get_supabase_admin().table("users").update(payload).eq("id", user_id).execute()
    updated = result.data[0] if result.data else _build_account_profile(user_id, current_user)
    message = "Contact details updated."
    if payload.get("pending_email"):
        message = "Verification link sent to your new email address. The change takes effect after verification."
    return {"profile": updated, "message": message}


@router.post("/me/change-password")
async def change_my_password(
    body: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user),
):
    if body.new_password != body.confirm_password:
        raise HTTPException(status_code=422, detail="Passwords do not match.")
    policy_error = validate_password_policy(body.new_password)
    if policy_error:
        raise HTTPException(status_code=422, detail=policy_error)

    email = current_user.get("email")
    user_id = get_user_id(current_user)
    if not email:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        result = await asyncio.to_thread(
            get_supabase().auth.sign_in_with_password,
            {"email": email, "password": body.current_password},
        )
        if not result.user:
            raise HTTPException(status_code=401, detail="Current password is incorrect")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    try:
        await asyncio.to_thread(
            lambda: get_supabase_admin().auth.admin.update_user_by_id(
                user_id,
                {"password": body.new_password},
            )
        )
    except Exception as exc:
        logger.warning("Password update failed for %s: %s", user_id, exc)
        raise HTTPException(status_code=502, detail="Could not update password.")

    return {"message": "Password updated successfully."}


@router.get("/me/notification-preferences")
async def get_notification_preferences(
    device_id: str = Query(..., min_length=8, max_length=128),
    current_user: dict = Depends(get_current_user),
):
    user_id = get_user_id(current_user)
    defaults = _default_notification_preferences()
    try:
        result = (
            get_supabase_admin()
            .table("user_notification_preferences")
            .select("preferences")
            .eq("user_id", user_id)
            .eq("device_id", device_id)
            .maybe_single()
            .execute()
        )
        stored = result.data.get("preferences") if result and result.data else {}
        merged = defaults
        for event in NOTIFICATION_EVENTS:
            merged[event] = {**defaults[event], **(stored.get(event) or {})}
        return {"device_id": device_id, "preferences": merged}
    except Exception as exc:
        logger.debug("Notification prefs read failed for %s: %s", user_id, exc)
        return {"device_id": device_id, "preferences": defaults}


@router.put("/me/notification-preferences")
async def save_notification_preferences(
    body: NotificationPreferencesRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = get_user_id(current_user)
    cleaned: dict = {}
    for event in NOTIFICATION_EVENTS:
        event_prefs = body.preferences.get(event) or {}
        cleaned[event] = {
            channel: bool(event_prefs.get(channel, True))
            for channel in NOTIFICATION_CHANNELS
        }

    admin = get_supabase_admin()
    try:
        admin.table("user_notification_preferences").upsert(
            {
                "user_id": user_id,
                "device_id": body.device_id,
                "preferences": cleaned,
            },
            on_conflict="user_id,device_id",
        ).execute()
    except Exception as exc:
        logger.warning("Notification prefs save failed for %s: %s", user_id, exc)
        raise HTTPException(status_code=502, detail="Could not save notification preferences.")

    return {"device_id": body.device_id, "preferences": cleaned}


@router.post("/me/photo")
async def upload_my_profile_photo(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    content_type = file.content_type or mimetypes.guess_type(file.filename or "")[0] or ""
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=422, detail="Profile photo must be JPEG or PNG.")
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


class AccessibilityPreferencesBody(BaseModel):
    device_id: str = Field(min_length=8, max_length=128)
    font_size: str | None = None
    theme_mode: str | None = None
    high_contrast: bool | None = None
    dyslexia_font: bool | None = None


class LanguagePreferenceBody(BaseModel):
    preferred_language: str = Field(min_length=2, max_length=10)


@router.get("/me/accessibility")
async def get_my_accessibility_preferences(
    device_id: str = Query(..., min_length=8, max_length=128),
    current_user: dict = Depends(get_current_user),
):
    from ..services import accessibility_service

    user_id = get_user_id(current_user)
    prefs = accessibility_service.get_accessibility_preferences(user_id, device_id)
    language = accessibility_service.get_preferred_language(user_id)
    return {"preferences": prefs, "preferred_language": language}


@router.put("/me/accessibility")
async def save_my_accessibility_preferences(
    body: AccessibilityPreferencesBody,
    current_user: dict = Depends(get_current_user),
):
    from ..services import accessibility_service

    user_id = get_user_id(current_user)
    prefs = accessibility_service.save_accessibility_preferences(
        user_id,
        body.device_id,
        font_size=body.font_size,
        theme_mode=body.theme_mode,
        high_contrast=body.high_contrast,
        dyslexia_font=body.dyslexia_font,
    )
    return {"preferences": prefs}


@router.patch("/me/language")
async def update_my_language(
    body: LanguagePreferenceBody,
    current_user: dict = Depends(get_current_user),
):
    from ..services import accessibility_service

    user_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    result = await accessibility_service.set_preferred_language(
        user_id,
        org_id,
        body.preferred_language,
    )
    return result
