"""Participant complaints, for coordinators and the managing director: list
the register, log a complaint, and record how it was handled."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..core.access import get_user_id, get_user_organization_id, has_org_wide_access
from ..core.security import get_current_user
from ..services import participant_complaint_service as svc

router = APIRouter(prefix="/participant-complaints", tags=["participant-complaints"])


class ComplaintCreate(BaseModel):
    subject: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=5000)
    participant_id: str | None = None
    participant_name: str | None = Field(default=None, max_length=200)
    raised_by: str | None = Field(default=None, max_length=200)
    filed_at: str | None = None


class ComplaintUpdate(BaseModel):
    status: str
    resolution_notes: str | None = Field(default=None, max_length=5000)


def _scope(current_user: dict) -> tuple[str, str]:
    if not has_org_wide_access(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Coordinator or managing director access required.")
    org_id = get_user_organization_id(current_user)
    user_id = get_user_id(current_user)
    if not org_id or not user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required.")
    return org_id, user_id


@router.get("")
async def list_complaints(current_user: dict = Depends(get_current_user)):
    org_id, _ = _scope(current_user)
    return svc.list_complaints(org_id)


@router.post("", status_code=201)
async def create_complaint(body: ComplaintCreate, current_user: dict = Depends(get_current_user)):
    org_id, user_id = _scope(current_user)
    return svc.create_complaint(
        org_id,
        user_id,
        subject=body.subject,
        description=body.description,
        participant_id=body.participant_id,
        participant_name=body.participant_name,
        raised_by=body.raised_by,
        filed_at=body.filed_at,
    )


@router.patch("/{complaint_id}")
async def update_complaint(complaint_id: str, body: ComplaintUpdate, current_user: dict = Depends(get_current_user)):
    org_id, user_id = _scope(current_user)
    return svc.update_complaint(org_id, complaint_id, user_id, status=body.status, resolution_notes=body.resolution_notes)
