"""Organisation branding API — managing directors set a display name and
logo used on onboarding-facing emails and the first-login welcome screen.
Reading branding is open to any authenticated org member (a new worker needs
it on their welcome screen); writing is managing-director only."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..core.security import get_current_user
from ..services import organization_branding_service as svc

router = APIRouter(prefix="/organization/branding", tags=["organization-branding"])


class BrandingUpdateBody(BaseModel):
    display_name: str | None = None
    brand_accent_color: str | None = None


def _org_id(current_user: dict) -> str:
    org_id = current_user.get("organization_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="Organization membership required.")
    return org_id


def _require_md(current_user: dict) -> str:
    if current_user.get("role") != "managing_director":
        raise HTTPException(status_code=403, detail="Only a managing director can update organisation branding.")
    return _org_id(current_user)


@router.get("")
async def get_branding(current_user: dict = Depends(get_current_user)):
    return svc.get_branding(_org_id(current_user))


@router.patch("")
async def update_branding(body: BrandingUpdateBody, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    return svc.update_branding(
        org_id,
        display_name=body.display_name,
        brand_accent_color=body.brand_accent_color,
    )


@router.post("/logo")
async def upload_logo(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    raw = await file.read()
    return svc.upload_logo(org_id, raw, file.content_type or "")


@router.delete("/logo")
async def remove_logo(current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    return svc.remove_logo(org_id)
