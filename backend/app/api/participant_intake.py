"""Participant Onboarding Board API (MD-only) — Enquiry -> Screening ->
Meet & Greet -> Service Agreement -> Active/Inactive. See
participant_intake_service for the pipeline rules (reason-required
transitions, activation creating a real participant record).
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..core.access import is_managing_director
from ..core.security import get_current_user
from ..services import participant_intake_service as svc

router = APIRouter(prefix="/participant-intakes", tags=["participant-intake"])


def _require_md(current_user: dict) -> str:
    if not is_managing_director(current_user):
        raise HTTPException(status_code=403, detail="Managing Director access required.")
    org_id = current_user.get("organization_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="Organization membership required.")
    return org_id


class IntakeCreateBody(BaseModel):
    full_name: str
    ndis_number: str = ""
    email: str = ""
    phone: str = ""
    source: str = "coordinator_referral"
    service_category: Optional[str] = None
    service_hours_required: Optional[float] = None
    web_intake: dict[str, Any] = {}


@router.get("")
async def list_intakes(current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    return svc.list_intakes(org_id)


@router.post("", status_code=201)
async def create_intake(body: IntakeCreateBody, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    return svc.create_intake(
        organization_id=org_id,
        created_by=current_user.get("sub") or current_user.get("id"),
        full_name=body.full_name,
        ndis_number=body.ndis_number,
        email=body.email,
        phone=body.phone,
        source=body.source,
        service_category=body.service_category,
        service_hours_required=body.service_hours_required,
        web_intake=body.web_intake,
    )


@router.patch("/{intake_id}")
async def update_intake(intake_id: str, body: dict[str, Any], current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    return await svc.update_intake(intake_id, org_id, body, current_user)


@router.post("/{intake_id}/signed-document", status_code=201)
async def upload_signed_document(
    intake_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_md(current_user)
    raw = await file.read()
    return await svc.upload_signed_document(
        intake_id, org_id, file.filename or "service-agreement", raw, file.content_type or "",
    )
