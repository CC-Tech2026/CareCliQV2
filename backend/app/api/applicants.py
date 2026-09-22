"""Applicants Board API — coordinators can triage Applied/Interview,
managing directors can additionally extend an offer or reject. Enforced
here (not just hidden client-side); see applicant_service.move_applicant_stage.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from ..core.access import has_active_grant
from ..core.security import get_current_user
from ..services import applicant_documents_service as docs_svc
from ..services import applicant_service as svc
from ..services import resume_extraction_service as resume_svc
from ..services.supabase_client import get_supabase_admin

router = APIRouter(prefix="/applicants", tags=["applicants"])

HIRE_MANAGER_ROLES = frozenset({"managing_director"})
BOARD_ROLES = frozenset({"support_coordinator", "managing_director"})


def _require_board_access(user: dict) -> tuple[str, str, bool]:
    role = user.get("role")
    if role not in BOARD_ROLES:
        raise HTTPException(status_code=403, detail="Only coordinators and managing directors can access the Applicants Board.")
    org_id = user.get("organization_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="Organization membership required.")
    is_hire_manager = role in HIRE_MANAGER_ROLES or has_active_grant(user, "applicant_offer_reject", get_supabase_admin())
    return org_id, user.get("sub"), is_hire_manager


class ApplicantCreateBody(BaseModel):
    full_name: str
    email: str
    phone: str | None = None
    role: str = "support_worker"


class ApplicantStageBody(BaseModel):
    stage: str
    rejected_reason: str | None = None


class ApplicantNotesBody(BaseModel):
    notes: str


@router.get("")
async def list_applicants(current_user: dict = Depends(get_current_user)):
    org_id, _, _ = _require_board_access(current_user)
    return svc.list_applicants(org_id)


@router.post("", status_code=201)
async def create_applicant(body: ApplicantCreateBody, current_user: dict = Depends(get_current_user)):
    org_id, user_id, _ = _require_board_access(current_user)
    return svc.create_applicant(org_id, user_id, body.full_name, body.email, body.phone, body.role)


@router.patch("/{applicant_id}/notes")
async def update_applicant_notes(applicant_id: str, body: ApplicantNotesBody, current_user: dict = Depends(get_current_user)):
    org_id, _, _ = _require_board_access(current_user)
    return svc.update_applicant_notes(applicant_id, org_id, body.notes)


@router.patch("/{applicant_id}/stage")
async def move_applicant_stage(applicant_id: str, body: ApplicantStageBody, current_user: dict = Depends(get_current_user)):
    org_id, user_id, is_hire_manager = _require_board_access(current_user)
    return svc.move_applicant_stage(
        applicant_id,
        org_id,
        body.stage,
        actor_user_id=user_id,
        actor_is_hire_manager=is_hire_manager,
        rejected_reason=body.rejected_reason,
    )


# ── Applicant documents (resume/CV, cover letter, ID, other) ──────────────

@router.get("/{applicant_id}/documents")
async def list_applicant_documents(applicant_id: str, current_user: dict = Depends(get_current_user)):
    org_id, _, _ = _require_board_access(current_user)
    return docs_svc.list_applicant_documents(applicant_id, org_id)


@router.post("/{applicant_id}/documents", status_code=status.HTTP_201_CREATED)
async def upload_applicant_document(
    applicant_id: str,
    document_type: str = Form(...),
    title: str = Form(...),
    notes: str | None = Form(None),
    file: UploadFile | None = File(None),
    current_user: dict = Depends(get_current_user),
):
    org_id, user_id, _ = _require_board_access(current_user)
    record = docs_svc.create_document_record(
        applicant_id=applicant_id,
        organization_id=org_id,
        document_type=document_type,
        title=title,
        notes=notes,
        uploaded_by=user_id,
    )
    if file is not None and file.filename:
        content_type = file.content_type or ""
        raw = await file.read()
        record = await docs_svc.upload_document_file(record["id"], org_id, raw, content_type)
        if document_type == "resume":
            await resume_svc.extract_and_save_applicant_profile(applicant_id, org_id, raw, content_type)
    return record


@router.delete("/documents/{document_id}", status_code=204)
async def delete_applicant_document(document_id: str, current_user: dict = Depends(get_current_user)):
    org_id, _, _ = _require_board_access(current_user)
    docs_svc.delete_document(document_id, org_id)
    return None
