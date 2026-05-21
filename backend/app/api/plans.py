from fastapi import APIRouter, Depends, HTTPException
from ..core.rbac import require_auth, require_coordinator, require_participant_access
from ..schemas.plan import PlanCreate, PlanUpdate
from ..services import participant_service
from ..services.supabase_client import get_supabase_admin
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/plans", tags=["plans"])


async def _require_plan_participant_access(plan: dict, user: dict) -> None:
    participant_id = plan.get("participant_id") or plan.get("patient_id")
    if not participant_id:
        raise HTTPException(status_code=403, detail="Plan is not linked to an accessible participant")

    participant = await participant_service.get_participant_by_id(str(participant_id))
    await require_participant_access(user, participant)


@router.get("/participant/{participant_id}")
async def get_participant_plans(participant_id: str, user: dict = Depends(require_auth)):
    participant = await participant_service.get_participant_by_id(participant_id)
    await require_participant_access(user, participant)

    supabase = get_supabase_admin()
    result = supabase.table("plans").select("*").eq("participant_id", participant_id).order("created_at", desc=True).execute()
    return result.data or []


@router.post("", status_code=201)
async def create_plan(body: PlanCreate, user: dict = Depends(require_coordinator)):
    participant = await participant_service.get_participant_by_id(body.participant_id)
    await require_participant_access(user, participant)

    supabase = get_supabase_admin()
    payload = body.model_dump(exclude_none=True)
    if "start_date" in payload:
        payload["start_date"] = str(payload["start_date"])
    if "end_date" in payload:
        payload["end_date"] = str(payload["end_date"])
    result = supabase.table("plans").insert(payload).execute()
    return result.data[0] if result.data else {}


@router.patch("/{plan_id}")
async def update_plan(plan_id: str, body: PlanUpdate, user: dict = Depends(require_coordinator)):
    supabase = get_supabase_admin()
    existing = supabase.table("plans").select("*").eq("id", plan_id).single().execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Plan not found")
    await _require_plan_participant_access(existing.data, user)

    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    if "start_date" in payload:
        payload["start_date"] = str(payload["start_date"])
    if "end_date" in payload:
        payload["end_date"] = str(payload["end_date"])
    result = supabase.table("plans").update(payload).eq("id", plan_id).execute()
    return result.data[0] if result.data else {}
