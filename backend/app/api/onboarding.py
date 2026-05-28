from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..core.access import get_user_id, get_user_organization_id, is_coordinator_role
from ..core.security import get_current_user
from ..services.supabase_client import get_supabase_admin

router = APIRouter(prefix="/onboarding", tags=["onboarding"])

WORKER_CHECKLIST_DEFAULTS = {
    "verify_email": False,
    "complete_profile": False,
    "upload_profile_photo": False,
    "add_credential_wallet_items": False,
    "review_assigned_clients": False,
    "read_ndis_note_writing_guide": False,
    "acknowledge_note_writing_rules": False,
    "confirm_readiness": False,
}


def _load_user(user_id: str) -> dict:
    result = (
        get_supabase_admin()
        .table("users")
        .select(
            "id, role, email_verified, profile_completed, onboarding_completed, "
            "role_specific_profile_completed, profile_photo_url, onboarding_checklist"
        )
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="User profile not found")
    return result.data


def _merged_checklist(profile: dict) -> dict:
    checklist = {**WORKER_CHECKLIST_DEFAULTS, **(profile.get("onboarding_checklist") or {})}
    checklist["verify_email"] = bool(profile.get("email_verified")) or checklist["verify_email"]
    checklist["complete_profile"] = bool(profile.get("role_specific_profile_completed")) or checklist["complete_profile"]
    checklist["upload_profile_photo"] = bool(profile.get("profile_photo_url")) or checklist["upload_profile_photo"]
    return checklist


@router.get("/me")
async def get_my_onboarding(current_user: dict = Depends(get_current_user)):
    profile = _load_user(get_user_id(current_user))
    checklist = _merged_checklist(profile)
    return {
        "role": profile.get("role"),
        "onboarding_completed": bool(profile.get("onboarding_completed")) or all(checklist.values()),
        "checklist": checklist,
    }


@router.patch("/me")
async def update_my_onboarding(body: dict, current_user: dict = Depends(get_current_user)):
    profile = _load_user(get_user_id(current_user))
    current = _merged_checklist(profile)
    updates = body.get("checklist") if isinstance(body.get("checklist"), dict) else body
    allowed = {k: bool(v) for k, v in (updates or {}).items() if k in WORKER_CHECKLIST_DEFAULTS}
    if not allowed:
        raise HTTPException(status_code=422, detail="No supported onboarding checklist items supplied")
    checklist = {**current, **allowed}
    completed = all(checklist.values())
    payload = {"onboarding_checklist": checklist}
    if completed:
        payload["onboarding_completed"] = True
        payload["onboarding_complete"] = True
    result = get_supabase_admin().table("users").update(payload).eq("id", get_user_id(current_user)).execute()
    return {
        "onboarding_completed": completed,
        "checklist": result.data[0].get("onboarding_checklist") if result.data else checklist,
    }


@router.post("/me/complete")
async def complete_my_onboarding(current_user: dict = Depends(get_current_user)):
    profile = _load_user(get_user_id(current_user))
    checklist = _merged_checklist(profile)
    missing = [key for key, done in checklist.items() if not done]
    if missing:
        raise HTTPException(status_code=422, detail={"message": "Checklist is incomplete", "missing": missing})
    payload = {
        "onboarding_completed": True,
        "onboarding_complete": True,
        "onboarding_checklist": checklist,
    }
    get_supabase_admin().table("users").update(payload).eq("id", get_user_id(current_user)).execute()
    return {"onboarding_completed": True, "checklist": checklist}


@router.get("/team")
async def get_team_onboarding(current_user: dict = Depends(get_current_user)):
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=403, detail="Only support coordinators can view team onboarding.")
    org_id = get_user_organization_id(current_user)
    if not org_id:
        return []
    result = (
        get_supabase_admin()
        .table("users")
        .select("id, full_name, email, role, onboarding_completed, onboarding_checklist, profile_photo_url")
        .eq("organization_id", org_id)
        .execute()
    )
    return result.data or []
