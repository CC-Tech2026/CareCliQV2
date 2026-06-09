from fastapi import APIRouter, Depends, HTTPException
from ..schemas.plan import PlanCreate, PlanUpdate
from ..services.supabase_client import get_supabase_admin
from ..services import participant_service
from ..core.access import get_user_organization_id
from ..core.security import get_current_user
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/plans", tags=["plans"])


@router.get("/participant/{participant_id}")
async def get_participant_plans(participant_id: str, current_user: dict = Depends(get_current_user)):
    # Verify the participant belongs to the caller's org (raises 404 on cross-org)
    participant = await participant_service.get_participant_by_id(participant_id, current_user)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")
    supabase = get_supabase_admin()
    result = supabase.table("plans").select("*").eq("participant_id", participant_id).order("created_at", desc=True).execute()
    return result.data or []


@router.post("", status_code=201)
async def create_plan(body: PlanCreate, current_user: dict = Depends(get_current_user)):
    # Verify participant belongs to caller's org before creating a plan for them
    participant = await participant_service.get_participant_by_id(body.participant_id, current_user)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")
    supabase = get_supabase_admin()
    payload = body.model_dump(exclude_none=True)
    if "start_date" in payload:
        payload["start_date"] = str(payload["start_date"])
    if "end_date" in payload:
        payload["end_date"] = str(payload["end_date"])
    result = supabase.table("plans").insert(payload).execute()
    return result.data[0] if result.data else {}


@router.patch("/{plan_id}")
async def update_plan(plan_id: str, body: PlanUpdate, current_user: dict = Depends(get_current_user)):
    org_id = get_user_organization_id(current_user)
    supabase = get_supabase_admin()
    # Fetch the plan first and verify org ownership via its participant
    existing = supabase.table("plans").select("participant_id").eq("id", plan_id).maybe_single().execute()
    if not existing or not existing.data:
        raise HTTPException(status_code=404, detail="Plan not found")
    participant = await participant_service.get_participant_by_id(existing.data["participant_id"], current_user)
    if not participant:
        raise HTTPException(status_code=404, detail="Plan not found")
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    if "start_date" in payload:
        payload["start_date"] = str(payload["start_date"])
    if "end_date" in payload:
        payload["end_date"] = str(payload["end_date"])
    result = supabase.table("plans").update(payload).eq("id", plan_id).execute()
    return result.data[0] if result.data else {}
