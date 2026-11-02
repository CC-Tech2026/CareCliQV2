"""Move to CareCliQ: import participants and staff from another system's
CSV export. Managing director only. See data_import_service.py."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from ..core.access import is_managing_director
from ..core.security import get_current_user
from ..services import data_import_service as svc
from ..services.audit_service import log_action
from .security import require_recent_reauth

router = APIRouter(prefix="/data-import", tags=["data-import"])


def _require_md(current_user: dict) -> str:
    if not is_managing_director(current_user):
        raise HTTPException(status_code=403, detail="Only the managing director can import records.")
    org_id = current_user.get("organization_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="Organization membership required.")
    return org_id


class RecordsBody(BaseModel):
    records: list[dict[str, Any]] = Field(default_factory=list)
    source_system: str = "spreadsheet"


@router.post("/parse")
async def parse_file(
    kind: str = Form(...),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Reads an uploaded CSV and suggests which column holds which field.
    Nothing is saved."""
    _require_md(current_user)
    raw = await file.read(svc.MAX_FILE_BYTES + 1)
    try:
        return svc.parse_csv(raw, kind)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/participants/preview")
async def preview_participants(body: RecordsBody, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    try:
        return {"results": svc.preview_participants(org_id, body.records)}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/participants")
async def import_participants(body: RecordsBody, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    user_id = current_user.get("sub")
    try:
        result = svc.import_participants(org_id, user_id, body.records, body.source_system)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    await log_action(
        action_type="data_import.participants", entity_type="organization", entity_id=org_id,
        user_id=user_id, organization_id=org_id,
        after_state={"imported": result["imported"], "skipped": result["skipped"], "source_system": body.source_system},
    )
    return result


@router.post("/staff/preview")
async def preview_staff(body: RecordsBody, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    try:
        return {"results": svc.preview_staff(org_id, body.records)}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/staff")
async def import_staff(body: RecordsBody, request: Request, current_user: dict = Depends(get_current_user)):
    """Emails an invitation to every ready row. Same recent-password check
    as sending a single invitation."""
    org_id = _require_md(current_user)
    require_recent_reauth(request, current_user)
    user_id = current_user.get("sub")
    try:
        result = svc.import_staff(org_id, user_id, body.records)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    await log_action(
        action_type="data_import.staff", entity_type="organization", entity_id=org_id,
        user_id=user_id, organization_id=org_id,
        after_state={"invited": result["imported"], "skipped": result["skipped"], "source_system": body.source_system},
    )
    return result
