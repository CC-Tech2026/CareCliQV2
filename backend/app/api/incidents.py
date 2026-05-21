from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from ..core.rbac import require_auth, require_incident_access, require_participant_access
from ..services import participant_service
from ..schemas.incident import IncidentCreate, IncidentUpdate
from ..services import audit_service, incident_service
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/incidents", tags=["incidents"])


@router.get("")
async def list_incidents(
    limit: int = 100,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    participant_id: Optional[str] = None,
    user: dict = Depends(require_auth),
):
    return await incident_service.get_scoped_incidents(user, limit, status, severity, participant_id)


@router.get("/stats")
async def get_stats(user: dict = Depends(require_auth)):
    org_id = user.get("organization_id")
    return await incident_service.get_incident_stats(org_id=org_id)


@router.get("/participant/{participant_id}")
async def get_participant_incidents(participant_id: str, user: dict = Depends(require_auth)):
    participant = await participant_service.get_participant_by_id(participant_id)
    await require_participant_access(user, participant)
    return await incident_service.get_incidents_by_participant(participant_id)


@router.get("/{incident_id}")
async def get_incident(incident_id: str, user: dict = Depends(require_auth)):
    incident = await incident_service.get_incident_by_id(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    await require_incident_access(user, incident)
    return incident


@router.post("", status_code=201)
async def create_incident(
    body: IncidentCreate,
    user: dict = Depends(require_auth),
):
    try:
        org_id = user.get("organization_id")
        participant_id = getattr(body, "participant_id", None)
        if participant_id:
            participant = await participant_service.get_participant_by_id(participant_id)
            await require_participant_access(user, participant)
        result = await incident_service.create_incident(body, org_id=org_id)
        await audit_service.log_action(
            action_type="incident.created",
            entity_type="incident",
            entity_id=result.get("id", ""),
            user_id=user.get("sub"),
            organization_id=org_id,
            after_state={"id": result.get("id"), "title": result.get("title"), "severity": result.get("severity")},
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating incident: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/{incident_id}")
async def update_incident(
    incident_id: str,
    body: IncidentUpdate,
    user: dict = Depends(require_auth),
):
    incident = await incident_service.get_incident_by_id(incident_id)
    await require_incident_access(user, incident)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    updated = await incident_service.update_incident(incident_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Incident not found")
    await audit_service.log_action(
        action_type="incident.updated",
        entity_type="incident",
        entity_id=incident_id,
        user_id=(user or {}).get("sub"),
        organization_id=(user or {}).get("organization_id"),
        after_state={"id": incident_id, "status": updated.get("status")},
    )
    return updated
