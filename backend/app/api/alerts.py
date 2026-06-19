from fastapi import APIRouter, Depends, HTTPException
from ..schemas.alert import AlertCreate
from ..services import alert_service
from ..core.access import get_user_id, get_user_organization_id, has_org_wide_access
from ..core.security import get_current_user
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("")
async def list_alerts(limit: int = 50, current_user: dict = Depends(get_current_user)):
    org_id = get_user_organization_id(current_user)
    user_id = get_user_id(current_user)
    org_wide = has_org_wide_access(current_user)
    return await alert_service.get_all_alerts(
        org_id=org_id,
        limit=limit,
        user_id=user_id,
        org_wide=org_wide,
    )


@router.get("/unread")
async def unread_alerts(current_user: dict = Depends(get_current_user)):
    org_id = get_user_organization_id(current_user)
    user_id = get_user_id(current_user)
    org_wide = has_org_wide_access(current_user)
    return await alert_service.get_unread_alerts(
        org_id=org_id,
        user_id=user_id,
        org_wide=org_wide,
    )


@router.post("", status_code=201)
async def create_alert(body: AlertCreate, current_user: dict = Depends(get_current_user)):
    org_id = get_user_organization_id(current_user)
    return await alert_service.create_alert(body, org_id=org_id)


@router.patch("/{alert_id}/read")
async def mark_read(alert_id: str, current_user: dict = Depends(get_current_user)):
    org_id = get_user_organization_id(current_user)
    updated = await alert_service.mark_alert_read(alert_id, org_id=org_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Alert not found")
    return updated


@router.post("/mark-all-read")
async def mark_all_read(current_user: dict = Depends(get_current_user)):
    org_id = get_user_organization_id(current_user)
    await alert_service.mark_all_read(org_id=org_id)
    return {"message": "All alerts marked as read"}
