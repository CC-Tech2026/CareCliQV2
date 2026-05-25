from fastapi import APIRouter, HTTPException
from ..schemas.plan import PlanCreate, PlanUpdate
from ..services.supabase_client import get_supabase_admin
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/plans", tags=["plans"])


def _normalize_plan_payload(payload: dict) -> dict:
    """Convert legacy field names to database field names."""
    # Map legacy names to database names
    if "start_date" in payload and "plan_start" not in payload:
        payload["plan_start"] = payload.pop("start_date")
    if "end_date" in payload and "plan_end" not in payload:
        payload["plan_end"] = payload.pop("end_date")
    if "total_budget" in payload and "total_funding" not in payload:
        payload["total_funding"] = payload.pop("total_budget")
    if "participant_id" in payload and "patient_id" not in payload:
        payload["patient_id"] = payload.pop("participant_id")
    
    # Ensure dates are strings
    if "plan_start" in payload and payload["plan_start"]:
        payload["plan_start"] = str(payload["plan_start"])
    if "plan_end" in payload and payload["plan_end"]:
        payload["plan_end"] = str(payload["plan_end"])
    
    return payload


@router.get("/participant/{participant_id}")
async def get_participant_plans(participant_id: str):
    """Get all NDIS plans for a participant."""
    supabase = get_supabase_admin()
    try:
        result = supabase.table("ndis_plans").select("*").eq("patient_id", participant_id).order("created_at", desc=True).execute()
        return result.data or []
    except Exception as e:
        logger.error("Failed to get plans for participant %s: %s", participant_id, e)
        return []


@router.post("", status_code=201)
async def create_plan(body: PlanCreate):
    """Create a new NDIS plan."""
    supabase = get_supabase_admin()
    payload = body.model_dump(exclude_none=True)
    payload = _normalize_plan_payload(payload)
    
    if not payload.get("patient_id"):
        raise HTTPException(status_code=400, detail="patient_id is required")
    
    try:
        result = supabase.table("ndis_plans").insert(payload).execute()
        return result.data[0] if result.data else {}
    except Exception as e:
        logger.error("Failed to create plan: %s", e)
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/{plan_id}")
async def update_plan(plan_id: str, body: PlanUpdate):
    """Update an existing NDIS plan."""
    supabase = get_supabase_admin()
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    payload = _normalize_plan_payload(payload)
    
    try:
        result = supabase.table("ndis_plans").update(payload).eq("id", plan_id).execute()
        return result.data[0] if result.data else {}
    except Exception as e:
        logger.error("Failed to update plan %s: %s", plan_id, e)
        raise HTTPException(status_code=400, detail=str(e))
