"""Service agreements API — schema and background: migration 217,
service_agreement_service.py."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..core.access import get_user_id, get_user_organization_id, has_org_wide_access
from ..core.security import get_current_user
from ..services import participant_service, service_agreement_service

router = APIRouter(tags=["service-agreements"])


class ServiceAgreementCreate(BaseModel):
    plan_management_type: str
    plan_manager_name: Optional[str] = None
    plan_manager_email: Optional[str] = None
    start_date: str
    end_date: Optional[str] = None
    includes_price_adjustment_clause: bool = False
    gst_treatment_basis: Optional[str] = None
    cancellation_notice_hours: Optional[int] = None
    cancellation_fee_percentage: Optional[float] = None
    status: str = "draft"
    signed_by: Optional[str] = None
    signed_date: Optional[str] = None
    source_document_id: Optional[str] = None


class ServiceAgreementSupportCreate(BaseModel):
    support_item_code: str
    negotiated_rate: Optional[float] = None
    frequency: Optional[str] = None
    total_hours_allocated: Optional[float] = None
    total_funding: Optional[float] = None
    travel_rate_per_hour: Optional[float] = None
    travel_minutes_cap: Optional[int] = None
    location: Optional[str] = None


async def _require_coordinator_participant(participant_id: str, current_user: dict) -> dict:
    if not has_org_wide_access(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only support coordinators can manage service agreements.",
        )
    participant = await participant_service.get_participant_by_id(participant_id, current_user)
    if not participant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participant not found.")
    return participant


@router.get("/participants/{participant_id}/service-agreements")
async def list_participant_service_agreements(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    participant = await _require_coordinator_participant(participant_id, current_user)
    org_id = get_user_organization_id(current_user) or str(participant.get("organization_id") or "")
    return service_agreement_service.list_service_agreements(participant_id, org_id)


@router.post("/participants/{participant_id}/service-agreements", status_code=201)
async def create_participant_service_agreement(
    participant_id: str,
    body: ServiceAgreementCreate,
    current_user: dict = Depends(get_current_user),
):
    participant = await _require_coordinator_participant(participant_id, current_user)
    org_id = get_user_organization_id(current_user) or str(participant.get("organization_id") or "")
    return await service_agreement_service.create_service_agreement(
        participant_id, org_id, get_user_id(current_user), body.model_dump(exclude_none=True)
    )


@router.post("/service-agreements/{service_agreement_id}/supports", status_code=201)
async def add_service_agreement_support(
    service_agreement_id: str,
    body: ServiceAgreementSupportCreate,
    current_user: dict = Depends(get_current_user),
):
    if not has_org_wide_access(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only support coordinators can manage service agreements.",
        )
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=403, detail="User must belong to an organization.")
    return await service_agreement_service.add_service_agreement_support(
        service_agreement_id, org_id, current_user, body.model_dump(exclude_none=True)
    )
