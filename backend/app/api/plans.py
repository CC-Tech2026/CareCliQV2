from fastapi import APIRouter, HTTPException
from ..schemas.plan import PlanCreate, PlanUpdate
from ..services.supabase_client import get_supabase_admin
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/plans", tags=["plans"])


@router.get("/participant/{participant_id}")
async def get_participant_plans(participant_id: str):
    supabase = get_supabase_admin()
    result = supabase.table("plans").select("*").eq("participant_id", participant_id).order("created_at", desc=True).execute()
    return result.data or []


@router.post("", status_code=201)
async def create_plan(body: PlanCreate):
    supabase = get_supabase_admin()
    payload = body.model_dump(exclude_none=True)
    if "start_date" in payload:
        payload["start_date"] = str(payload["start_date"])
    if "end_date" in payload:
        payload["end_date"] = str(payload["end_date"])
    result = supabase.table("plans").insert(payload).execute()
    return result.data[0] if result.data else {}


@router.patch("/{plan_id}")
async def update_plan(plan_id: str, body: PlanUpdate):
    supabase = get_supabase_admin()
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    result = supabase.table("plans").update(payload).eq("id", plan_id).execute()
    return result.data[0] if result.data else {}
