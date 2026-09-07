from __future__ import annotations

import mimetypes

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from pydantic import BaseModel

from ..core.access import get_user_id, get_user_organization_id, is_managing_director
from ..core.security import get_current_user
from ..services import vault_service

router = APIRouter(prefix="/md-vault", tags=["md-vault"])


def _require_md(user: dict) -> str:
    if not is_managing_director(user):
        raise HTTPException(status_code=403, detail="Managing director access required.")
    org_id = get_user_organization_id(user)
    if not org_id:
        raise HTTPException(status_code=403, detail="Organisation membership required.")
    return org_id


def _client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


@router.get("/stats")
async def get_vault_stats(current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    return vault_service.list_vault_stats(org_id)


@router.get("/folders")
async def get_vault_folders(current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    return {"folders": vault_service.list_folders(org_id)}


@router.get("/folders/{category}/meta")
async def get_folder_meta(category: str, current_user: dict = Depends(get_current_user)):
    """One folder's count/label/updated_at — for a viewer opening a single
    folder, so it doesn't pay the cost of computing all 17+ categories
    (list_folders) just to read the one it's actually looking at."""
    org_id = _require_md(current_user)
    meta = vault_service.get_folder_meta(org_id, category)
    if meta is None:
        raise HTTPException(status_code=404, detail="Unknown vault category.")
    return meta


@router.get("/customizable-fields")
async def get_customizable_fields(current_user: dict = Depends(get_current_user)):
    _require_md(current_user)
    return {"fields": vault_service.CUSTOMIZABLE_FIELDS}


class FolderOrderRequest(BaseModel):
    order: list[str]


@router.put("/folders/order")
async def put_folder_order(body: FolderOrderRequest, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    vault_service.set_folder_order(org_id, body.order)
    return {"saved": True}


class CustomFolderRequest(BaseModel):
    label: str
    description: str | None = None
    group: str = "record"


@router.post("/custom-folders", status_code=201)
async def post_custom_folder(body: CustomFolderRequest, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    user_id = get_user_id(current_user)
    return vault_service.create_custom_folder(org_id, body.label, body.description, user_id, body.group)


@router.post("/custom-folders/{folder_id}/documents", status_code=201)
async def post_custom_folder_document(
    folder_id: str,
    title: str = Form(...),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_md(current_user)
    user_id = get_user_id(current_user)
    if not file.filename:
        raise HTTPException(status_code=422, detail="A file is required.")
    content_type = file.content_type or ""
    raw = await file.read()
    return await vault_service.upload_custom_folder_document(org_id, folder_id, title, user_id, raw, content_type)


@router.delete("/custom-folders/{folder_id}/documents/{document_id}", status_code=204)
async def delete_custom_folder_document(
    folder_id: str,
    document_id: str,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_md(current_user)
    vault_service.delete_custom_folder_document(org_id, folder_id, document_id)
    return None


@router.get("/folders/{category}/documents")
async def get_folder_documents(
    category: str,
    search: str | None = None,
    person: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_md(current_user)
    docs = vault_service.list_folder_documents(
        org_id, category, search=search, person=person, date_from=date_from, date_to=date_to
    )
    return {"documents": docs}


@router.get("/folders/{category}/documents/{document_id}/file")
async def get_folder_document_file(
    category: str,
    document_id: str,
    exclude: list[str] = Query(default=[]),
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_md(current_user)
    filename, data = vault_service.render_document_file(org_id, category, document_id, set(exclude) or None)
    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return Response(
        content=data,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(data)),
        },
    )


class SearchRequest(BaseModel):
    query: str


@router.post("/search")
async def post_vault_search(body: SearchRequest, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    answer, documents = vault_service.search_documents(org_id, body.query)
    return {"answer": answer, "documents": documents}


class DocRef(BaseModel):
    category: str
    id: str


class PackPlanRequest(BaseModel):
    documents: list[DocRef]


@router.post("/pack/plan")
async def post_pack_plan(body: PackPlanRequest, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    refs = [{"category": d.category, "id": d.id} for d in body.documents]
    return {"plan": vault_service.resolve_pack_plan(org_id, refs)}


class ShareEventRequest(BaseModel):
    method: str
    folder_keys: list[str] = []
    documents: list[DocRef] = []
    recipient_hint: str | None = None


@router.post("/share-events")
async def post_share_event(
    body: ShareEventRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_md(current_user)
    user_id = get_user_id(current_user)
    vault_service.log_share_event(
        org_id,
        user_id,
        method=body.method,
        folder_keys=body.folder_keys,
        document_refs=[{"category": d.category, "id": d.id} for d in body.documents],
        recipient_hint=body.recipient_hint,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    return {"logged": True}


@router.post("/governance-documents", status_code=201)
async def post_governance_document(
    folder_key: str = Form(...),
    title: str = Form(...),
    description: str | None = Form(None),
    file: UploadFile = File(...),
    supersedes_document_id: str | None = Form(None),
    version_label: str | None = Form(None),
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_md(current_user)
    user_id = get_user_id(current_user)
    if not file.filename:
        raise HTTPException(status_code=422, detail="A file is required.")
    content_type = file.content_type or ""
    raw = await file.read()
    return await vault_service.upload_governance_document(
        org_id, folder_key, title, description, user_id, raw, content_type,
        supersedes_document_id=supersedes_document_id or None,
        version_label=version_label or None,
    )


@router.get("/governance-documents/{document_id}/versions")
async def get_governance_document_versions(document_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    return {"versions": vault_service.list_governance_document_versions(org_id, document_id)}


@router.delete("/governance-documents/{document_id}", status_code=204)
async def delete_governance_document(document_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    vault_service.delete_governance_document(org_id, document_id)
    return None


class AuditPackGenerateRequest(BaseModel):
    label: str | None = None


@router.post("/audit-packs/generate", status_code=201)
async def post_generate_audit_pack(
    body: AuditPackGenerateRequest,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_md(current_user)
    user_id = get_user_id(current_user)
    return vault_service.generate_audit_pack(org_id, user_id, label=body.label)


@router.get("/audit-packs")
async def get_audit_packs(current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    return {"packs": vault_service.list_audit_pack_exports(org_id)}
