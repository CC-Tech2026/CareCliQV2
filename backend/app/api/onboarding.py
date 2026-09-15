from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.access import get_user_id, get_user_organization_id, has_org_wide_access, is_coordinator_role
from ..core.security import get_current_user
from ..services import induction_service, worker_buddy_service, worker_financial_service, worker_pipeline_service, worker_training_service
from ..services.supabase_client import get_supabase_admin, signed_storage_url

PROFILE_PHOTOS_BUCKET = "profile-photos"

router = APIRouter(prefix="/onboarding", tags=["onboarding"])

WORKER_CHECKLIST_DEFAULTS = {
    "verify_email": False,
    "complete_profile": False,
    "upload_profile_photo": False,
    "add_credential_wallet_items": False,
    "complete_mandatory_training": False,
    "complete_induction": False,
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
            "id, role, organization_id, email_verified, profile_completed, onboarding_completed, "
            "role_specific_profile_completed, profile_photo_url, onboarding_checklist, welcome_seen_at, "
            "onboarding_completed_seen_at"
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
    org_id = profile.get("organization_id")
    if org_id:
        try:
            overdue = worker_training_service.is_training_overdue(profile["id"], org_id)
            checklist["complete_mandatory_training"] = (not overdue) or checklist["complete_mandatory_training"]
        except Exception:
            pass
        try:
            incomplete = induction_service.is_induction_incomplete(profile["id"], org_id)
            checklist["complete_induction"] = (not incomplete) or checklist["complete_induction"]
        except Exception:
            pass
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


class FinancialDetailsBody(BaseModel):
    bank_account_name: str | None = None
    bank_bsb: str | None = None
    bank_account_number: str | None = None
    super_fund_name: str | None = None
    super_member_number: str | None = None
    tax_file_number: str | None = None


@router.get("/me/financial-details")
async def get_my_financial_details(current_user: dict = Depends(get_current_user)):
    details = worker_financial_service.get_financial_details(get_user_id(current_user))
    return details or {}


@router.put("/me/financial-details")
async def update_my_financial_details(body: FinancialDetailsBody, current_user: dict = Depends(get_current_user)):
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=403, detail="Organization membership required.")
    return worker_financial_service.upsert_financial_details(
        get_user_id(current_user), org_id, body.model_dump(),
    )


@router.get("/me/welcome")
async def get_my_welcome_status(current_user: dict = Depends(get_current_user)):
    profile = _load_user(get_user_id(current_user))
    return {"welcome_seen_at": profile.get("welcome_seen_at")}


@router.post("/me/welcome-seen")
async def mark_my_welcome_seen(current_user: dict = Depends(get_current_user)):
    result = get_supabase_admin().table("users").update(
        {"welcome_seen_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", get_user_id(current_user)).execute()
    return {"welcome_seen_at": result.data[0].get("welcome_seen_at") if result.data else None}


@router.get("/me/induction")
async def get_my_induction(current_user: dict = Depends(get_current_user)):
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=403, detail="Organization membership required.")
    return induction_service.get_my_induction_progress(get_user_id(current_user), org_id)


@router.post("/me/induction/{item_id}/complete")
async def complete_my_induction_item(item_id: str, current_user: dict = Depends(get_current_user)):
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=403, detail="Organization membership required.")
    return induction_service.complete_induction_item(get_user_id(current_user), item_id, org_id)


@router.get("/me/pipeline")
async def get_my_pipeline(current_user: dict = Depends(get_current_user)):
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=403, detail="Organization membership required.")
    pipeline = worker_pipeline_service.get_pipeline_for_worker(get_user_id(current_user), org_id)
    if pipeline is None:
        raise HTTPException(status_code=404, detail="Worker profile not found")
    return pipeline


@router.get("/me/buddy")
async def get_my_buddy(current_user: dict = Depends(get_current_user)):
    buddy = worker_buddy_service.get_buddy(get_user_id(current_user))
    return buddy or {}


@router.get("/me/completion-status")
async def get_my_completion_status(current_user: dict = Depends(get_current_user)):
    worker_id = get_user_id(current_user)
    profile = _load_user(worker_id)
    onboarding_completed = bool(profile.get("onboarding_completed"))
    org_id = profile.get("organization_id")
    if not onboarding_completed and org_id:
        # A worker who onboarded entirely through the mobile app has no
        # equivalent of the web-only full checklist that normally sets this
        # flag — without this, this endpoint (which the mobile app polls to
        # decide whether to show the "you made it" screen) would report
        # onboarding_completed: false forever even once fully credentialed
        # and trained. get_pipeline_for_worker computes and persists the
        # same objective readiness check the MD's pipeline board uses.
        pipeline = worker_pipeline_service.get_pipeline_for_worker(worker_id, org_id)
        if pipeline and pipeline.get("current_stage") == "active":
            onboarding_completed = True
    stats = {"credentials_verified": 0, "training_completed": 0}
    try:
        cred_resp = (
            get_supabase_admin()
            .table("credentials")
            .select("id", count="exact")
            .eq("user_id", worker_id)
            .eq("status", "valid")
            .execute()
        )
        stats["credentials_verified"] = cred_resp.count or 0
    except Exception:
        pass
    try:
        training_resp = (
            get_supabase_admin()
            .table("worker_training_completions")
            .select("id", count="exact")
            .eq("worker_id", worker_id)
            .eq("status", "confirmed")
            .execute()
        )
        stats["training_completed"] = training_resp.count or 0
    except Exception:
        pass
    return {
        "onboarding_completed": onboarding_completed,
        "onboarding_completed_seen_at": profile.get("onboarding_completed_seen_at"),
        "stats": stats,
    }


@router.post("/me/completion-seen")
async def mark_my_completion_seen(current_user: dict = Depends(get_current_user)):
    result = get_supabase_admin().table("users").update(
        {"onboarding_completed_seen_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", get_user_id(current_user)).execute()
    return {"onboarding_completed_seen_at": result.data[0].get("onboarding_completed_seen_at") if result.data else None}


@router.get("/team")
async def get_team_onboarding(current_user: dict = Depends(get_current_user)):
    if not has_org_wide_access(current_user):
        raise HTTPException(status_code=403, detail="Coordinator or managing director access required.")
    org_id = get_user_organization_id(current_user)
    if not org_id:
        return []
    result = (
        get_supabase_admin()
        .table("users")
        .select("id, full_name, email, role, onboarding_completed, onboarding_checklist, profile_photo_path")
        .eq("organization_id", org_id)
        .execute()
    )
    rows = []
    for row in (result.data or []):
        row = dict(row)
        row["profile_photo_url"] = signed_storage_url(PROFILE_PHOTOS_BUCKET, row.pop("profile_photo_path", None))
        rows.append(row)
    return rows
