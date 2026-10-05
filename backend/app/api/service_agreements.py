"""Service agreements API — schema and background: migration 217,
service_agreement_service.py."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field

from ..core.access import get_user_id, get_user_organization_id, has_org_wide_access, is_managing_director
from ..core.security import get_current_user
from ..services import participant_intake_service, participant_service, service_agreement_service
from ..services import service_agreement_document_service as documents
from ..services import service_agreement_esign_service as esign

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
    return service_agreement_service.list_service_agreements_for_profile(participant_id, org_id)


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


# ── Build, sign and download ────────────────────────────────────────────────


class SupportLine(BaseModel):
    support_item_code: str = Field(min_length=1, max_length=40)
    quantity: float = Field(gt=0, le=100_000)
    rate: Optional[float] = Field(default=None, ge=0, le=100_000)
    location: Optional[str] = None
    frequency: Optional[str] = None


class AgreementDraft(BaseModel):
    plan_management_type: str
    plan_manager_name: Optional[str] = Field(default=None, max_length=200)
    plan_manager_email: Optional[str] = Field(default=None, max_length=200)
    start_date: str
    end_date: str
    includes_price_adjustment_clause: bool = True
    gst_treatment_basis: Optional[str] = Field(default=None, max_length=500)
    cancellation_notice_hours: Optional[int] = Field(default=None, ge=0, le=24 * 30)
    cancellation_fee_percentage: Optional[float] = Field(default=None, ge=0, le=100)
    supports: list[SupportLine] = Field(min_length=1, max_length=60)


class SignBody(BaseModel):
    provider_name: str = Field(min_length=1, max_length=200)
    provider_signature_png: str
    participant_name: str = Field(min_length=1, max_length=200)
    participant_signature_png: str


def _org_access(current_user: dict) -> str:
    if not has_org_wide_access(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only support coordinators can manage service agreements.")
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=403, detail="User must belong to an organization.")
    return org_id


_HIDDEN = ("provider_signature_png", "participant_signature_png", "sign_token_hash", "signing_code_hash")


def _clean(agreement: dict) -> dict:
    """Signature images and e-sign hashes stay on the server."""
    for key in _HIDDEN:
        agreement.pop(key, None)
    return agreement


def _require_intake(intake_id: str, current_user: dict) -> str:
    """Onboarding is the managing director's: only they manage an
    agreement that still belongs to an intake."""
    if not is_managing_director(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managing Director access required.")
    org_id = _org_access(current_user)
    participant_intake_service.get_intake(intake_id, org_id)  # 404 when not this org's
    return org_id


async def _agreement_access(agreement_id: str, current_user: dict) -> str:
    """Org match plus access to the agreement's participant (a coordinator
    only sees their own participants), or for an agreement still on an
    onboarding intake, the managing director."""
    org_id = _org_access(current_user)
    agreement = documents.get_agreement(org_id, agreement_id)
    if agreement.get("participant_id"):
        await _require_coordinator_participant(str(agreement["participant_id"]), current_user)
    else:
        _require_intake(str(agreement["intake_id"]), current_user)
    return org_id


@router.get("/participant-intakes/{intake_id}/service-agreements")
async def list_intake_service_agreements(intake_id: str, current_user: dict = Depends(get_current_user)):
    """The agreements built during this onboarding, before the participant
    exists. Activation moves them onto the participant."""
    org_id = _require_intake(intake_id, current_user)
    return service_agreement_service.list_service_agreements_for_profile(None, org_id, intake_id=intake_id)


@router.post("/participant-intakes/{intake_id}/service-agreements/drafts", status_code=201)
async def create_intake_agreement_draft(intake_id: str, body: AgreementDraft, current_user: dict = Depends(get_current_user)):
    org_id = _require_intake(intake_id, current_user)
    return _clean(await documents.create_draft(
        None, org_id, get_user_id(current_user), body.model_dump(mode="json"), intake_id=intake_id,
    ))


@router.post("/participants/{participant_id}/service-agreements/drafts", status_code=201)
async def create_agreement_draft(participant_id: str, body: AgreementDraft, current_user: dict = Depends(get_current_user)):
    participant = await _require_coordinator_participant(participant_id, current_user)
    org_id = get_user_organization_id(current_user) or str(participant.get("organization_id") or "")
    return _clean(await documents.create_draft(participant_id, org_id, get_user_id(current_user), body.model_dump(mode="json")))


@router.put("/service-agreements/{agreement_id}")
async def update_agreement_draft(agreement_id: str, body: AgreementDraft, current_user: dict = Depends(get_current_user)):
    org_id = await _agreement_access(agreement_id, current_user)
    return _clean(await documents.update_draft(org_id, agreement_id, get_user_id(current_user), body.model_dump(mode="json")))


@router.delete("/service-agreements/{agreement_id}", status_code=204)
async def delete_agreement_draft(agreement_id: str, current_user: dict = Depends(get_current_user)):
    org_id = await _agreement_access(agreement_id, current_user)
    await documents.delete_draft(org_id, agreement_id, get_user_id(current_user))
    return Response(status_code=204)


@router.post("/service-agreements/{agreement_id}/send")
async def send_agreement(agreement_id: str, current_user: dict = Depends(get_current_user)):
    org_id = await _agreement_access(agreement_id, current_user)
    return _clean(await documents.send_for_signature(org_id, agreement_id, get_user_id(current_user)))


@router.post("/service-agreements/{agreement_id}/sign")
async def sign_agreement(agreement_id: str, body: SignBody, current_user: dict = Depends(get_current_user)):
    org_id = await _agreement_access(agreement_id, current_user)
    return _clean(await documents.sign(
        org_id, agreement_id, get_user_id(current_user),
        provider_name=body.provider_name, provider_signature_png=body.provider_signature_png,
        participant_name=body.participant_name, participant_signature_png=body.participant_signature_png,
    ))


class EsignBody(BaseModel):
    provider_name: str = Field(min_length=1, max_length=200)
    provider_signature_png: str
    signer_name: str = Field(min_length=1, max_length=200)
    signer_email: str = Field(min_length=3, max_length=254)
    relationship: str = "participant"


@router.post("/service-agreements/{agreement_id}/esign")
async def send_agreement_for_esign(agreement_id: str, body: EsignBody, current_user: dict = Depends(get_current_user)):
    """Provider signs, then the participant (or nominee) is emailed a link."""
    org_id = await _agreement_access(agreement_id, current_user)
    return await esign.send_for_esign(
        org_id, agreement_id, get_user_id(current_user),
        provider_name=body.provider_name, provider_signature_png=body.provider_signature_png,
        signer_name=body.signer_name, signer_email=body.signer_email, relationship=body.relationship,
    )


@router.delete("/service-agreements/{agreement_id}/esign", status_code=204)
async def cancel_agreement_esign(agreement_id: str, current_user: dict = Depends(get_current_user)):
    org_id = await _agreement_access(agreement_id, current_user)
    await esign.cancel_esign(org_id, agreement_id, get_user_id(current_user))
    return Response(status_code=204)


@router.get("/service-agreements/{agreement_id}/document")
async def agreement_document(agreement_id: str, current_user: dict = Depends(get_current_user)):
    org_id = await _agreement_access(agreement_id, current_user)
    filename, pdf = documents.agreement_document(org_id, agreement_id)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"', "Cache-Control": "no-store"},
    )
