from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from typing import Optional
from ..core.access import is_coordinator_role, is_support_worker
from ..core.security import get_current_user
from .security import require_recent_reauth
from ..schemas.incident import IncidentCreate, IncidentUpdate
from ..services import audit_service, incident_service, participant_service, session_service
from ..services.embedding_pipeline import run_incident_embedding_pipeline
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

    # Support workers only see incidents they created — not all incidents for
    # their allocated participants. Coordinators and allied health see the full
    # org scope (allied health are further filtered by participant allocation in
    # the service layer).
    reporter_id = user.get("sub") if is_support_worker(user) else None

    return await incident_service.get_all_incidents(
        limit, status, severity, participant_id,
        org_id=org_id,
        reporter_id=reporter_id,
        current_user=user,
    )


@router.get("/stats")
async def get_stats(user: dict = Depends(get_current_user)):
    org_id = user.get("organization_id")
    # Support workers only count their own incidents in stats as well
    reporter_id = user.get("sub") if is_support_worker(user) else None
    return await incident_service.get_incident_stats(
        org_id=org_id,
        reporter_id=reporter_id,
        current_user=user,
    )


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
    background_tasks: BackgroundTasks,
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

        # Enqueue incident text embedding (CARECLIQV2-30).
        # Embed title + description + worker_actions so the incident is
        # discoverable via semantic search from the RAG context retriever.
        incident_id = result.get("id", "")
        incident_text = " ".join(
            filter(
                None,
                [
                    result.get("title", ""),
                    result.get("description", "") or body.description,
                    result.get("worker_actions", "") or getattr(body, "worker_actions", None),
                ],
            )
        ).strip()
        if incident_id and incident_text and body.session_id:
            background_tasks.add_task(
                run_incident_embedding_pipeline,
                incident_id=incident_id,
                session_id=body.session_id,
                organization_id=org_id,
                text=incident_text,
                participant_id=str(body.participant_id) if body.participant_id else None,
                worker_id=user.get("sub"),
            )

        return result
    except ValueError as e:
        if "Compliance blocked" in str(e):
            raise HTTPException(status_code=422, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating incident: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/{incident_id}")
async def update_incident(
    request: Request,
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
    if updates.get("status") in {"closed", "resolved", "reported"} or updates.get("ndis_reported_at"):
        require_recent_reauth(request, user)
    try:
        updated = await incident_service.update_incident(incident_id, updates, current_user=user)
    except ValueError as e:
        if "Compliance blocked" in str(e):
            raise HTTPException(status_code=422, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
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
