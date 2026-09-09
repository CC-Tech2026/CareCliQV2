"""Bug reports — any staff member can report something broken in the
product, from wherever they hit it. Deliberately visible only through the
Super Admin portal (backend/app/api/admin.py), not to a provider's own
coordinators/MD — this is feedback about CareCliQ itself, not an
operational issue within the provider's own business (see
operational_feedback.py for that, and read the file-level note there on
why the two stay separate)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..core.access import get_user_id, get_user_organization_id
from ..core.security import get_current_user
from ..services import bug_report_service as svc

router = APIRouter(prefix="/bug-reports", tags=["bug-reports"])


class BugReportAttachment(BaseModel):
    mime_type: str
    data: str = Field(description="Base64-encoded file content, optionally with a data: URL prefix.")


class BugReportCreate(BaseModel):
    description: str = Field(min_length=1, max_length=5000)
    page_url: str | None = Field(default=None, max_length=500)
    attachments: list[BugReportAttachment] = Field(default_factory=list)
    severity: Literal["low", "medium", "urgent"] = "low"


@router.post("")
async def submit_bug_report(body: BugReportCreate, current_user: dict = Depends(get_current_user)):
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required.")
    user_id = get_user_id(current_user)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User id required.")
    try:
        return await svc.create_bug_report(
            org_id,
            user_id,
            body.description,
            body.page_url,
            [a.model_dump() for a in body.attachments],
            body.severity,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
