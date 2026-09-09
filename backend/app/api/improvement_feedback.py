"""Improvements & Feedback — a managing director can send CareCliQ a
feature request, an improvement idea, or general product feedback.
Deliberately MD-only (not coordinators/workers) and visible only through
the Super Admin portal (backend/app/api/admin.py), same audience boundary
as bug_reports (see bug_reports.py) — this is feedback about CareCliQ
itself, not an operational issue within the provider's own business (see
operational_feedback.py for that)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..core.access import get_user_id, get_user_organization_id, is_managing_director
from ..core.security import get_current_user
from ..services import improvement_feedback_service as svc

router = APIRouter(prefix="/improvement-feedback", tags=["improvement-feedback"])


class ImprovementFeedbackCreate(BaseModel):
    description: str = Field(min_length=1, max_length=5000)


@router.post("")
async def submit_improvement_feedback(
    body: ImprovementFeedbackCreate, current_user: dict = Depends(get_current_user)
):
    if not is_managing_director(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managing director access required.")
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required.")
    user_id = get_user_id(current_user)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User id required.")
    return await svc.create_improvement_feedback(org_id, user_id, body.description)
