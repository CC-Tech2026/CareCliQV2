from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..core.rbac import require_auth, require_coordinator, require_participant_access
from ..services import funding_service, participant_service
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/budget", tags=["budget"])


class BudgetUpdateRequest(BaseModel):
    plan_id: str
    category: str
    allocated_amount: float


@router.post("/update")
async def update_budget(body: BudgetUpdateRequest, user: dict = Depends(require_coordinator)):
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
async def get_budget(patient_id: str, user: dict = Depends(require_auth)):
    """Get budget summary for a participant (delegates to funding service)."""
    try:
        participant = await participant_service.get_participant_by_id(patient_id)
        await require_participant_access(user, participant)
        summary = await funding_service.get_budget_summary(patient_id)
        return summary
    except Exception as e:
        logger.error(f"Budget fetch error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{patient_id}/usage")
async def get_budget_usage(patient_id: str, limit: int = 50, user: dict = Depends(require_auth)):
    """Get budget usage history for a participant."""
    try:
        participant = await participant_service.get_participant_by_id(patient_id)
        await require_participant_access(user, participant)
        usage = await funding_service.get_budget_usage_history(patient_id, limit)
        return {"participant_id": patient_id, "usage": usage}
    except Exception as e:
        logger.error(f"Budget usage fetch error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
