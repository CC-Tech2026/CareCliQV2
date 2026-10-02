"""Shift verification gate endpoints (Fix #6 — budget deduction review)."""

from __future__ import annotations

import logging

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from ..core.access import get_user_id, get_user_organization_id, has_org_wide_access
from ..core.security import get_current_user
from ..services import audit_service, shift_verification_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/coordinator", tags=["coordinator"])


def _require_coordinator(user: dict) -> str:
    if not has_org_wide_access(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Support coordinator or managing director access required.")
    org_id = get_user_organization_id(user)
    if not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required.")
    return org_id


class VerifyShiftRequest(BaseModel):
    price_item_code: str
    # A shift worked longer than scheduled is billed at the scheduled time
    # unless the coordinator approves the extra, with a reason.
    approve_extra_time: bool = False
    extra_time_reason: Optional[str] = Field(default=None, max_length=500)


class ReverseVerificationRequest(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


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


@router.get("/participants/{participant_id}/price-items")
async def get_participant_price_items(participant_id: str, current_user: dict = Depends(get_current_user)):
    """Candidate NDIS price items for a participant's plan — used at shift
    creation, before a shift exists, to record an expected item."""
    org_id = _require_coordinator(current_user)
    return await shift_verification_service.list_price_item_options_for_participant(participant_id, org_id)


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
            approve_extra_time=body.approve_extra_time,
            extra_time_reason=body.extra_time_reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/shifts/verified")
async def get_recent_verifications(
    days: int = Query(default=30, ge=1, le=365),
    current_user: dict = Depends(get_current_user),
):
    """Recently verified shifts, with whether each can still be reversed."""
    org_id = _require_coordinator(current_user)
    return shift_verification_service.list_recent_verifications(org_id, days)


@router.post("/shifts/{shift_id}/verification/reverse")
async def post_reverse_verification(
    shift_id: str,
    body: ReverseVerificationRequest,
    current_user: dict = Depends(get_current_user),
):
    """Undo a verification made in error: refunds the plan budget and puts
    the shift back in the queue. Refused once the shift is on an invoice."""
    org_id = _require_coordinator(current_user)
    coordinator_id = str(get_user_id(current_user) or "")
    try:
        result = await shift_verification_service.reverse_verification(
            shift_id=shift_id, coordinator_id=coordinator_id, org_id=org_id, reason=body.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    await audit_service.log_action(
        action_type="shift.verification_reversed",
        entity_type="shift",
        entity_id=shift_id,
        user_id=coordinator_id,
        organization_id=org_id,
        details={"reason": body.reason, "refunded_amount": result.get("refunded_amount")},
    )
    return result
