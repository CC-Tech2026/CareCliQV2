from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..services import funding_service
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/budget", tags=["budget"])


class BudgetUpdateRequest(BaseModel):
    plan_id: str
    category: str
    allocated_amount: float


@router.post("/update")
async def update_budget(body: BudgetUpdateRequest):
    """Update allocated amount for a plan budget category."""
    try:
        result = await funding_service.upsert_plan_budget(
            body.plan_id, body.category, body.allocated_amount
        )
        return result
    except Exception as e:
        logger.error(f"Budget update error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{patient_id}")
async def get_budget(patient_id: str):
    """Get budget summary for a participant (delegates to funding service)."""
    try:
        summary = await funding_service.get_budget_summary(patient_id)
        return summary
    except Exception as e:
        logger.error(f"Budget fetch error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{patient_id}/usage")
async def get_budget_usage(patient_id: str, limit: int = 50):
    """Get budget usage history for a participant."""
    try:
        usage = await funding_service.get_budget_usage_history(patient_id, limit)
        return {"participant_id": patient_id, "usage": usage}
    except Exception as e:
        logger.error(f"Budget usage fetch error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
