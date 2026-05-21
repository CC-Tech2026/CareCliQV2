from fastapi import APIRouter, Depends, HTTPException
from ..core.rbac import require_auth, require_coordinator
from ..schemas.alert import AlertCreate
from ..services import alert_service
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("")
async def list_alerts(limit: int = 50, user: dict = Depends(require_auth)):
    return await alert_service.get_all_alerts(limit)


@router.get("/unread")
async def unread_alerts(user: dict = Depends(require_auth)):
    return await alert_service.get_unread_alerts()


@router.post("", status_code=201)
async def create_alert(body: AlertCreate, user: dict = Depends(require_auth)):
    return await alert_service.create_alert(body)


@router.patch("/{alert_id}/read")
async def mark_read(alert_id: str, user: dict = Depends(require_auth)):
    updated = await alert_service.mark_alert_read(alert_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Alert not found")
    return updated


@router.post("/mark-all-read")
async def mark_all_read(user: dict = Depends(require_coordinator)):
    await alert_service.mark_all_read()
    return {"message": "All alerts marked as read"}
