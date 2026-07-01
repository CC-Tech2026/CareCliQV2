"""Billing period API — plan management type lock audit (CARECLIQV2-326)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from ..core.access import get_user_organization_id, is_coordinator_role
from ..core.security import get_current_user
from ..schemas.billing_period import BillingPeriodCurrentOut, BillingPeriodListOut, BillingPeriodOut
from ..services import billing_period_service, participant_service

router = APIRouter(prefix="/participants", tags=["billing-periods"])


async def _require_coordinator_participant(participant_id: str, current_user: dict) -> dict:
    if not is_coordinator_role(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only support coordinators can view billing period history.",
        )
    participant = await participant_service.get_participant_by_id(participant_id, current_user)
    if not participant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participant not found.")
    return participant


@router.get("/{participant_id}/billing-periods", response_model=BillingPeriodListOut)
async def list_participant_billing_periods(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    participant = await _require_coordinator_participant(participant_id, current_user)
    org_id = get_user_organization_id(current_user) or str(participant.get("organization_id") or "")
    rows = billing_period_service.list_billing_periods(participant_id, org_id)
    return BillingPeriodListOut(items=[BillingPeriodOut(**row) for row in rows])


@router.get("/{participant_id}/billing-periods/current", response_model=BillingPeriodCurrentOut)
async def get_current_billing_period(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    participant = await _require_coordinator_participant(participant_id, current_user)
    org_id = get_user_organization_id(current_user) or str(participant.get("organization_id") or "")
    view = billing_period_service.get_current_billing_period_view(
        participant_id,
        org_id,
        participant=participant,
    )
    open_period = view.get("open_period")
    return BillingPeriodCurrentOut(
        current_plan_management_type=view.get("current_plan_management_type"),
        open_period=BillingPeriodOut(**open_period) if open_period else None,
        type_differs_from_lock=bool(view.get("type_differs_from_lock")),
        message=view.get("message"),
    )
