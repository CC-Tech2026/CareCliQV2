from fastapi import APIRouter, Depends, HTTPException
from ..core.rbac import require_auth, require_coordinator
from ..schemas.alert import AlertCreate
from ..services import alert_service
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("")
async def list_alerts(limit: int = 50, user: dict = Depends(require_auth)):
    return await alert_service.get_scoped_alerts(user, limit=limit)


@router.get("/unread")
async def unread_alerts(user: dict = Depends(require_auth)):
    return await alert_service.get_scoped_alerts(user, unread_only=True)


@router.post("", status_code=201)
async def create_alert(body: AlertCreate, user: dict = Depends(require_auth)):
    if body.participant_id:
        from ..services import participant_service
        from ..core.rbac import require_participant_access

        participant = await participant_service.get_participant_by_id(body.participant_id)
        await require_participant_access(user, participant)
    return await alert_service.create_alert(body)


@router.patch("/{alert_id}/read")
async def mark_read(alert_id: str, user: dict = Depends(require_auth)):
    alert = await alert_service.get_alert_by_id(alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    if not await alert_service.can_access_alert(user, alert):
        raise HTTPException(status_code=403, detail="Access denied")
    updated = await alert_service.mark_alert_read(alert_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Alert not found")
    return updated


@router.post("/mark-all-read")
async def mark_all_read(user: dict = Depends(require_coordinator)):
    org_id = user.get("organization_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="Access denied")
    await alert_service.mark_all_read_for_org(str(org_id))
    return {"message": "All alerts marked as read"}
