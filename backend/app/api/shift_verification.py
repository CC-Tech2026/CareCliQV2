"""Shift verification gate endpoints (Fix #6 — budget deduction review)."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..core.access import get_user_id, get_user_organization_id, is_coordinator_role
from ..core.security import get_current_user
from ..services import shift_verification_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/coordinator", tags=["coordinator"])


def _require_coordinator(user: dict) -> str:
    if not is_coordinator_role(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Support coordinator access required.")
    org_id = get_user_organization_id(user)
    if not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required.")
    return org_id


class VerifyShiftRequest(BaseModel):
    price_item_code: str


@router.get("/shifts/verification-queue")
async def get_verification_queue(current_user: dict = Depends(get_current_user)):
    """Every completed shift in this org awaiting verification, with computed checks."""
    org_id = _require_coordinator(current_user)
    return shift_verification_service.list_pending_verifications(org_id)


@router.get("/shifts/{shift_id}/price-items")
async def get_shift_price_items(shift_id: str, current_user: dict = Depends(get_current_user)):
    """Candidate NDIS price items for this shift's participant's plan."""
    org_id = _require_coordinator(current_user)
    return await shift_verification_service.list_price_item_options(shift_id, org_id)


@router.post("/shifts/{shift_id}/verify")
async def post_verify_shift(
    shift_id: str,
    body: VerifyShiftRequest,
    current_user: dict = Depends(get_current_user),
):
    """Coordinator confirms a completed shift, deducting budget from the
    real price catalogue. Never a silent auto-pass — this is the only
    path that can mark a shift verified or move plan_budgets.used_amount."""
    org_id = _require_coordinator(current_user)
    coordinator_id = str(get_user_id(current_user) or "")
    try:
        return await shift_verification_service.verify_shift(
            shift_id=shift_id,
            coordinator_id=coordinator_id,
            price_item_code=body.price_item_code,
            org_id=org_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
