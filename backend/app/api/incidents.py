from fastapi import APIRouter, HTTPException
from typing import Optional
from ..schemas.incident import IncidentCreate, IncidentUpdate
from ..services import incident_service
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/incidents", tags=["incidents"])


@router.get("")
async def list_incidents(
    limit: int = 100,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    participant_id: Optional[str] = None,
):
    return await incident_service.get_all_incidents(limit, status, severity, participant_id)


@router.get("/stats")
async def get_stats():
    return await incident_service.get_incident_stats()


@router.get("/participant/{participant_id}")
async def get_participant_incidents(participant_id: str):
    return await incident_service.get_incidents_by_participant(participant_id)


@router.get("/{incident_id}")
async def get_incident(incident_id: str):
    incident = await incident_service.get_incident_by_id(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return incident


@router.post("", status_code=201)
async def create_incident(body: IncidentCreate):
    try:
        return await incident_service.create_incident(body)
    except Exception as e:
        logger.error(f"Error creating incident: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/{incident_id}")
async def update_incident(incident_id: str, body: IncidentUpdate):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    updated = await incident_service.update_incident(incident_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Incident not found")
    return updated
