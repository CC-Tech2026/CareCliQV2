"""The managing director's participant profile: one summary to oversee the
participant from, and the director-only actions (care team, services,
documents, audit trail). Coordinators keep working the record through
/participants; these routes are the director's alone."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from ..core.access import get_user_organization_id, is_managing_director
from ..core.security import get_current_user
from ..services import director_participant_service as svc

router = APIRouter(prefix="/director/participants", tags=["director-participants"])


def _require_md(current_user: dict) -> str:
    if not is_managing_director(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managing director access required.")
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required.")
    return str(org_id)


class TeamChange(BaseModel):
    coordinator_id: Optional[str] = None
    main_worker_id: Optional[str] = None
    backup_worker_ids: list[str] = Field(default_factory=list, max_length=10)


class ServicesChange(BaseModel):
    action: str = Field(pattern="^(suspend|resume|end)$")
    reason: Optional[str] = Field(default=None, max_length=2000)
    last_service_date: Optional[str] = None
    cancel_future_shifts: bool = True
    revoke_portal_access: bool = False


class ArchiveDocument(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


@router.get("/{participant_id}/overview")
async def overview(participant_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    return await svc.build_overview(participant_id, org_id, current_user)


@router.put("/{participant_id}/team")
async def change_team(participant_id: str, body: TeamChange, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    return await svc.change_team(
        participant_id, org_id, current_user,
        coordinator_id=body.coordinator_id, main_worker_id=body.main_worker_id,
        backup_worker_ids=body.backup_worker_ids,
    )


@router.post("/{participant_id}/services")
async def change_services(participant_id: str, body: ServicesChange, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    return await svc.change_services(
        participant_id, org_id, current_user,
        action=body.action, reason=body.reason, last_service_date=body.last_service_date,
        cancel_future_shifts=body.cancel_future_shifts, revoke_portal_access=body.revoke_portal_access,
    )


@router.get("/{participant_id}/documents")
async def list_documents(participant_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    await svc.require_participant(participant_id, org_id, current_user)
    return svc.list_documents(participant_id, org_id)


@router.post("/{participant_id}/documents", status_code=201)
async def upload_document(
    participant_id: str,
    file: UploadFile = File(...),
    category: str = Form(...),
    title: Optional[str] = Form(None),
    document_date: Optional[str] = Form(None),
    author: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_md(current_user)
    file_bytes = await file.read()
    return await svc.upload_document(
        participant_id, org_id, current_user,
        file_bytes=file_bytes, filename=file.filename or "document", content_type=file.content_type or "",
        category=category, title=title, document_date=document_date, author=author, notes=notes,
    )


@router.get("/{participant_id}/documents/{source}/{document_id}/link")
async def document_link(participant_id: str, source: str, document_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    if source not in ("participant", "medication"):
        raise HTTPException(status_code=404, detail="Document not found.")
    return await svc.document_link(participant_id, org_id, current_user, source=source, document_id=document_id)


@router.post("/{participant_id}/documents/{document_id}/archive", status_code=204)
async def archive_document(participant_id: str, document_id: str, body: ArchiveDocument, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    await svc.archive_document(participant_id, org_id, current_user, document_id=document_id, reason=body.reason)


@router.get("/{participant_id}/audit-trail")
async def audit_trail(participant_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    return {"entries": await svc.audit_trail(participant_id, org_id, current_user)}
