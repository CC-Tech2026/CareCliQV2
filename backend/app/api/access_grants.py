"""Delegated access grants — MD hands a coordinator temporary access to one
MD-exclusive capability without a role change. See
services/access_grant_service.py for the actual CRUD/audit logic and the
capability catalog; this module is just the HTTP surface (request/response
shaping + the /me split from /md).
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..core.security import get_current_user
from ..services import access_grant_service as svc

router = APIRouter(tags=["access-grants"])


class AccessGrantCreate(BaseModel):
    granted_to_user_id: str
    capability: str
    expires_at: str
    reason: Optional[str] = Field(default=None, max_length=1000)


@router.get("/md/access-grants/capabilities")
async def list_capabilities(current_user: dict = Depends(get_current_user)):
    """The grantable capability catalog, for the MD-side picker UI."""
    return [{"capability": key, "label": label} for key, label in svc.CAPABILITIES.items()]


@router.post("/md/access-grants", status_code=201)
async def create_access_grant(body: AccessGrantCreate, current_user: dict = Depends(get_current_user)):
    return await svc.create_grant(
        current_user,
        granted_to_user_id=body.granted_to_user_id,
        capability=body.capability,
        expires_at=body.expires_at,
        reason=body.reason,
    )


@router.get("/md/access-grants")
async def list_access_grants(current_user: dict = Depends(get_current_user)):
    return await svc.list_org_grants(current_user)


@router.post("/md/access-grants/{grant_id}/revoke")
async def revoke_access_grant(grant_id: str, current_user: dict = Depends(get_current_user)):
    return await svc.revoke_grant(current_user, grant_id)


@router.get("/me/access-grants")
async def list_my_access_grants(current_user: dict = Depends(get_current_user)):
    return await svc.list_my_grants(current_user)
