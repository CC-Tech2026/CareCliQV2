"""New-hire onboarding: MD/coordinator creates a hire record, attaches offer
letter / service agreement, sends it for signature, and once both sides have
signed, sends the account-activation invite.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from ..core.security import get_current_user
from ..services import employee_onboarding_service as svc
from pydantic import BaseModel

router = APIRouter(prefix="/employee-onboarding", tags=["employee-onboarding"])

HIRE_MANAGER_ROLES = frozenset({"managing_director"})


def _require_hire_manager(user: dict) -> tuple[str, str]:
    if user.get("role") not in HIRE_MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="Only coordinators and managing directors can manage new hires.")
    org_id = user.get("organization_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="Organization membership required.")
    return org_id, user.get("sub")


class HireCreateBody(BaseModel):
    full_name: str
    email: str
    phone: str | None = None
    role: str = "support_worker"


class DocumentCreateBody(BaseModel):
    document_type: str
    title: str
    notes: str | None = None


class SignBody(BaseModel):
    full_name: str


@router.get("/hires")
async def list_hires(current_user: dict = Depends(get_current_user)):
    org_id, _ = _require_hire_manager(current_user)
    return svc.list_hires(org_id)


@router.post("/hires", status_code=201)
async def create_hire(body: HireCreateBody, current_user: dict = Depends(get_current_user)):
    org_id, user_id = _require_hire_manager(current_user)
    return svc.create_hire(org_id, user_id, body.full_name, body.email, body.phone, body.role)


@router.get("/hires/{hire_id}")
async def get_hire(hire_id: str, current_user: dict = Depends(get_current_user)):
    org_id, _ = _require_hire_manager(current_user)
    hire = svc.get_hire(hire_id, org_id)
    hire["documents"] = svc.list_documents(hire_id)
    return hire


@router.post("/hires/{hire_id}/documents", status_code=201)
async def add_document(hire_id: str, body: DocumentCreateBody, current_user: dict = Depends(get_current_user)):
    org_id, _ = _require_hire_manager(current_user)
    return svc.add_document(hire_id, org_id, body.document_type, body.title, body.notes)


@router.post("/documents/{document_id}/upload")
async def upload_document_file(
    document_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    _require_hire_manager(current_user)
    file_bytes = await file.read()
    return await svc.upload_document_file(document_id, file_bytes, file.content_type or "application/octet-stream")


@router.delete("/documents/{document_id}")
async def delete_document(document_id: str, current_user: dict = Depends(get_current_user)):
    _require_hire_manager(current_user)
    svc.delete_document(document_id)
    return {"ok": True}


@router.post("/hires/{hire_id}/send-for-signature")
async def send_for_signature(hire_id: str, current_user: dict = Depends(get_current_user)):
    org_id, user_id = _require_hire_manager(current_user)
    employer_name = current_user.get("full_name") or current_user.get("email") or "Employer"
    return svc.send_for_signature(hire_id, org_id, user_id, employer_name)


# ── Public signing (applicant, no auth) ────────────────────────────────────

@router.get("/sign/{token}")
async def get_hire_for_signing(token: str):
    return svc.get_hire_by_sign_token(token)


@router.post("/sign/{token}")
async def sign_hire(token: str, body: SignBody):
    return svc.sign_as_worker(token, body.full_name)
