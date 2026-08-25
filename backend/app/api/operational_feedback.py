"""Staff operational feedback/complaints — any staff member can file a report
about something that isn't working operationally; coordinators and the
managing director triage and resolve it, org-wide. Deliberately separate
from incident reporting (backend/app/api/incidents.py), which is
participant-safety-focused."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..core.access import get_user_id, get_user_organization_id, has_org_wide_access
from ..core.security import get_current_user
from ..services import operational_feedback_service as svc

router = APIRouter(prefix="/operational-feedback", tags=["operational-feedback"])


class FeedbackCreate(BaseModel):
    category: str = "other"
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=5000)


class FeedbackStatusUpdate(BaseModel):
    status: str
    resolution_notes: str | None = None


def _org_id(current_user: dict) -> str:
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required.")
    return org_id


@router.post("")
async def submit_feedback(body: FeedbackCreate, current_user: dict = Depends(get_current_user)):
    org_id = _org_id(current_user)
    user_id = get_user_id(current_user)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User id required.")
    return svc.create_feedback(org_id, user_id, body.category, body.title, body.description)


@router.get("")
async def list_feedback(status_filter: str | None = None, current_user: dict = Depends(get_current_user)):
    org_id = _org_id(current_user)
    if has_org_wide_access(current_user):
        return svc.list_feedback(org_id, status_filter)
    # A support worker / allied health staffer sees only their own submissions.
    user_id = get_user_id(current_user)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User id required.")
    return svc.list_feedback_for_reporter(org_id, user_id)


@router.patch("/{feedback_id}")
async def update_feedback_status(
    feedback_id: str,
    body: FeedbackStatusUpdate,
    current_user: dict = Depends(get_current_user),
):
    if not has_org_wide_access(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Coordinator or managing director access required.")
    org_id = _org_id(current_user)
    resolver_id = get_user_id(current_user)
    if not resolver_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User id required.")
    return svc.update_status(org_id, feedback_id, resolver_id, body.status, body.resolution_notes)
