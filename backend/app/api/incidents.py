from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from ..core.access import is_coordinator_role
from ..core.security import get_current_user
from ..schemas.incident import IncidentCreate, IncidentUpdate
from ..services import audit_service, incident_service, participant_service, session_service
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/incidents", tags=["incidents"])


@router.get("")
async def list_incidents(
    limit: int = 100,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    participant_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    org_id = user.get("organization_id")
    if not org_id:
        return []
    if participant_id:
        participant = await participant_service.get_participant_by_id(participant_id, user)
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found")
    return await incident_service.get_all_incidents(
        limit, status, severity, participant_id, org_id=org_id, current_user=user
    )


@router.get("/stats")
async def get_stats(user: dict = Depends(get_current_user)):
    org_id = user.get("organization_id")
    return await incident_service.get_incident_stats(org_id=org_id, current_user=user)


@router.get("/participant/{participant_id}")
async def get_participant_incidents(participant_id: str, user: dict = Depends(get_current_user)):
    participant = await participant_service.get_participant_by_id(participant_id, user)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")
    return await incident_service.get_incidents_by_participant(participant_id, current_user=user)


@router.get("/{incident_id}")
async def get_incident(incident_id: str, user: dict = Depends(get_current_user)):
    incident = await incident_service.get_incident_by_id(incident_id, current_user=user)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return incident


@router.post("", status_code=201)
async def create_incident(
    body: IncidentCreate,
    user: dict = Depends(get_current_user),
):
    try:
        org_id = user.get("organization_id")
        if not org_id:
            raise HTTPException(status_code=403, detail="Organization membership required")
        if body.participant_id:
            participant = await participant_service.get_participant_by_id(body.participant_id, user)
            if not participant:
                raise HTTPException(status_code=404, detail="Participant not found")
        if body.session_id:
            session = await session_service.get_session_by_id(body.session_id, user)
            if not session:
                raise HTTPException(status_code=404, detail="Session not found")
        result = await incident_service.create_incident(body, org_id=org_id, user_id=user.get("sub"))
        await audit_service.log_action(
            action_type="incident.created",
            entity_type="incident",
            entity_id=result.get("id", ""),
            user_id=user.get("sub"),
            organization_id=org_id,
            after_state={"id": result.get("id"), "title": result.get("title"), "severity": result.get("severity")},
        )
        return result
    except Exception as e:
        logger.error(f"Error creating incident: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/{incident_id}")
async def update_incident(
    incident_id: str,
    body: IncidentUpdate,
    user: dict = Depends(get_current_user),
):
    existing = await incident_service.get_incident_by_id(incident_id, current_user=user)
    if not existing:
        raise HTTPException(status_code=404, detail="Incident not found")
    if not is_coordinator_role(user) and existing.get("user_id") != user.get("sub"):
        raise HTTPException(status_code=403, detail="Access denied")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    updated = await incident_service.update_incident(incident_id, updates, current_user=user)
    if not updated:
        raise HTTPException(status_code=404, detail="Incident not found")
    await audit_service.log_action(
        action_type="incident.updated",
        entity_type="incident",
        entity_id=incident_id,
        user_id=user.get("sub"),
        organization_id=user.get("organization_id"),
        after_state={"id": incident_id, "status": updated.get("status")},
    )
    return updated
