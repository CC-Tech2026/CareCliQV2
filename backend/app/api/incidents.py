from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from typing import Optional
from ..core.access import is_coordinator_role, is_support_worker
from ..core.security import get_current_user
from .security import require_recent_reauth
from ..core.config import settings
from ..schemas.incident import (
    IncidentCreate, IncidentUpdate, WorkerIncidentCreate, IncidentCorrectionCreate,
    ReportableOverrideBody, SubjectOfAllegationCreate, AssignInvestigatorBody,
    InterviewCreate, worker_status_label,
)
from ..services import audit_service, incident_service, participant_service, session_service, shift_service
from ..services.embedding_pipeline import run_incident_embedding_pipeline
from ..services.incident_pattern_service import get_incident_pattern_analysis
from ..services.notification_service import notify_incident_reported, notify_incident_status_changed
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/incidents", tags=["incidents"])


@router.get("")
async def list_incidents(
    limit: int = 100,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    participant_id: Optional[str] = None,
    shift_id: Optional[str] = None,
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
        limit, status, severity, participant_id, shift_id,
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


@router.get("/{incident_id}/similar-patterns")
async def get_similar_incident_patterns(
    incident_id: str,
    user: dict = Depends(get_current_user),
):
    """CARECLIQV2-32 — RAG-powered similar past incidents with GPT-4o analysis."""
    org_id = user.get("organization_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="Organization membership required")

    incident = await incident_service.get_incident_by_id(incident_id, current_user=user)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    return await get_incident_pattern_analysis(incident, org_id)


@router.get("/{incident_id}")
async def get_incident(incident_id: str, user: dict = Depends(get_current_user)):
    incident = await incident_service.get_incident_by_id(incident_id, current_user=user)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return incident


@router.get("/{incident_id}/audit-trail")
async def get_incident_audit_trail(incident_id: str, user: dict = Depends(get_current_user)):
    incident = await incident_service.get_incident_by_id(incident_id, current_user=user)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return await audit_service.get_entity_audit_trail(
        "incident", incident_id, organization_id=user.get("organization_id"),
    )


@router.post("/worker-report", status_code=201)
async def create_worker_incident_report(
    body: WorkerIncidentCreate,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    """Worker incident report from shift (CARECLIQV2-265)."""
    if not is_support_worker(user):
        raise HTTPException(status_code=403, detail="Support worker access required")
    org_id = user.get("organization_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="Organization membership required")

    worker_id = user.get("sub")
    if body.shift_id:
        shift = shift_service.get_shift_by_id(str(body.shift_id))
        if not shift:
            raise HTTPException(status_code=404, detail="Shift not found")
        if str(shift.get("worker_id") or "") != str(worker_id):
            raise HTTPException(status_code=403, detail="You do not have access to this shift")
        if str(shift.get("organization_id") or "") != str(org_id):
            raise HTTPException(status_code=403, detail="Shift does not belong to your organisation")
        shift_participant_id = shift.get("participant_id")
        if not shift_participant_id:
            raise HTTPException(status_code=400, detail="Shift has no participant")
        if body.participant_id and str(body.participant_id) != str(shift_participant_id):
            raise HTTPException(status_code=400, detail="participant_id does not match shift")
        body = body.model_copy(update={"participant_id": str(shift_participant_id)})
    elif body.participant_id:
        participant = await participant_service.get_participant_by_id(body.participant_id, user)
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found")

    if body.behaviour_subtype and body.worker_report_type != "participant_behaviour":
        raise HTTPException(status_code=422, detail="behaviour_subtype only applies to participant_behaviour")
    try:
        result = await incident_service.create_worker_incident(
            body, org_id=org_id, user_id=user.get("sub"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    incident_id = result.get("id", "")
    ref = result.get("reference_number")
    is_emergency = body.severity == "emergency"

    background_tasks.add_task(
        notify_incident_reported,
        org_id=org_id,
        incident_id=incident_id,
        title=f"Incident reported: {result.get('title') or 'Worker report'}",
        message=(body.description or "")[:500],
        severity=result.get("severity") or "medium",
        participant_id=str(body.participant_id) if body.participant_id else None,
        session_id=str(body.session_id) if body.session_id else None,
        escalate=is_emergency,
        reference_number=ref,
        is_emergency=is_emergency,
    )

    if ref and user.get("sub"):
        from ..services.email_service import queue_worker_notification_email
        from ..services.notification_service import _lookup_user_email

        email = _lookup_user_email(str(user.get("sub")))
        if email:
            action_url = f"{settings.frontend_base_url.rstrip('/')}/incidents/{incident_id}"
            background_tasks.add_task(
                queue_worker_notification_email,
                to_email=email,
                subject=f"Incident reported — {ref}",
                title=f"Incident reference {ref}",
                message=body.description[:800],
                action_url=action_url,
            )

    return result


@router.post("/{incident_id}/corrections", status_code=201)
async def add_incident_correction(
    incident_id: str,
    body: IncidentCorrectionCreate,
    user: dict = Depends(get_current_user),
):
    """Append a correction note to an immutable worker incident report."""
    org_id = user.get("organization_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="Organization membership required")
    if not is_support_worker(user):
        raise HTTPException(status_code=403, detail="Support worker access required")
    try:
        return await incident_service.add_incident_correction(
            incident_id,
            worker_id=user.get("sub"),
            org_id=org_id,
            note=body.note,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/{incident_id}/corrections")
async def list_incident_corrections(incident_id: str, user: dict = Depends(get_current_user)):
    incident = await incident_service.get_incident_by_id(incident_id, current_user=user)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return await incident_service.list_incident_corrections(incident_id)


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
        if incident_id and incident_text:
            background_tasks.add_task(
                run_incident_embedding_pipeline,
                incident_id=incident_id,
                session_id=str(body.session_id) if body.session_id else None,
                organization_id=org_id,
                text=incident_text,
                participant_id=str(body.participant_id) if body.participant_id else None,
                worker_id=user.get("sub"),
            )

        severity = str(result.get("severity") or body.severity or "medium")
        if body.escalate or severity in ("high", "critical"):
            severity = "critical" if body.escalate else severity

        background_tasks.add_task(
            notify_incident_reported,
            org_id=org_id,
            incident_id=incident_id,
            title=f"Incident reported: {result.get('title') or body.title}",
            message=(body.description or "")[:500],
            severity=severity,
            participant_id=str(body.participant_id) if body.participant_id else None,
            session_id=str(body.session_id) if body.session_id else None,
            escalate=bool(body.escalate),
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
    if is_support_worker(user):
        raise HTTPException(
            status_code=403,
            detail="Incident reports cannot be edited. Add a correction note instead.",
        )
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
    if updates.get("status") and existing.get("status") != updated.get("status"):
        reporter_id = existing.get("user_id")
        if reporter_id:
            await notify_incident_status_changed(
                worker_id=str(reporter_id),
                org_id=str(user.get("organization_id") or ""),
                incident_id=incident_id,
                reference_number=updated.get("reference_number"),
                status_label=worker_status_label(str(updated.get("status") or "")),
            )
    await audit_service.log_action(
        action_type="incident.updated",
        entity_type="incident",
        entity_id=incident_id,
        user_id=user.get("sub"),
        organization_id=user.get("organization_id"),
        before_state={k: existing.get(k) for k in updates},
        after_state={k: updated.get(k) for k in updates},
    )
    return updated


@router.post("/{incident_id}/override-reportable")
async def override_incident_reportable(
    incident_id: str,
    body: ReportableOverrideBody,
    user: dict = Depends(get_current_user),
):
    """Coordinator correction to the auto-classified reportability. One-time only — the
    reason is retained permanently on the record per NDIS Commission record-keeping guidance."""
    if not is_coordinator_role(user):
        raise HTTPException(status_code=403, detail="Support coordinator access required.")
    existing = await incident_service.get_incident_by_id(incident_id, current_user=user)
    if not existing:
        raise HTTPException(status_code=404, detail="Incident not found")
    try:
        updated = await incident_service.set_reportable_override(
            incident_id, body.is_reportable, body.reason, user.get("sub"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await audit_service.log_action(
        action_type="incident.reportable_overridden",
        entity_type="incident",
        entity_id=incident_id,
        user_id=user.get("sub"),
        organization_id=user.get("organization_id"),
        after_state={"is_reportable": body.is_reportable, "reason": body.reason},
    )
    return updated


@router.post("/{incident_id}/subject-of-allegation", status_code=201)
async def add_subject_of_allegation(
    incident_id: str,
    body: SubjectOfAllegationCreate,
    user: dict = Depends(get_current_user),
):
    """Kept in a separate table from any personnel-file view, per the Commission's explicit
    separation requirement — coordinator/managing-director only."""
    if not is_coordinator_role(user):
        raise HTTPException(status_code=403, detail="Support coordinator access required.")
    existing = await incident_service.get_incident_by_id(incident_id, current_user=user)
    if not existing:
        raise HTTPException(status_code=404, detail="Incident not found")
    org_id = user.get("organization_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="No organization on account.")
    try:
        return await incident_service.create_subject_of_allegation(
            incident_id,
            str(org_id),
            user.get("sub"),
            subject_type=body.subject_type,
            subject_user_id=body.subject_user_id,
            subject_name=body.subject_name,
            subject_role=body.subject_role,
            notes=body.notes,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{incident_id}/subject-of-allegation")
async def get_subject_of_allegation(
    incident_id: str,
    user: dict = Depends(get_current_user),
):
    if not is_coordinator_role(user):
        raise HTTPException(status_code=403, detail="Support coordinator access required.")
    org_id = user.get("organization_id")
    if not org_id:
        return {"records": []}
    return {"records": await incident_service.list_subject_of_allegation(incident_id, str(org_id))}


@router.post("/{incident_id}/assign-investigator")
async def assign_incident_investigator(
    incident_id: str,
    body: AssignInvestigatorBody,
    user: dict = Depends(get_current_user),
):
    """Assigns an investigator, refusing the assignment when the candidate has a
    conflict of interest (reporter, record creator, or a subject of allegation)."""
    if not is_coordinator_role(user):
        raise HTTPException(status_code=403, detail="Support coordinator access required.")
    org_id = user.get("organization_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="No organization on account.")
    existing = await incident_service.get_incident_by_id(incident_id, current_user=user)
    if not existing:
        raise HTTPException(status_code=404, detail="Incident not found")
    try:
        updated = await incident_service.assign_investigator(
            incident_id, str(org_id), body.investigator_user_id, user.get("sub"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await audit_service.log_action(
        action_type="incident.investigator_assigned",
        entity_type="incident",
        entity_id=incident_id,
        user_id=user.get("sub"),
        organization_id=org_id,
        after_state={"investigator_user_id": body.investigator_user_id},
    )
    return updated


@router.post("/{incident_id}/interviews", status_code=201)
async def add_incident_interview(
    incident_id: str,
    body: InterviewCreate,
    user: dict = Depends(get_current_user),
):
    if not is_coordinator_role(user):
        raise HTTPException(status_code=403, detail="Support coordinator access required.")
    existing = await incident_service.get_incident_by_id(incident_id, current_user=user)
    if not existing:
        raise HTTPException(status_code=404, detail="Incident not found")
    org_id = user.get("organization_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="No organization on account.")
    try:
        return await incident_service.create_interview(
            incident_id,
            str(org_id),
            user.get("sub"),
            interviewee_name=body.interviewee_name,
            interviewee_type=body.interviewee_type,
            interviewee_user_id=body.interviewee_user_id,
            interviewed_at=body.interviewed_at.isoformat() if body.interviewed_at else None,
            notes=body.notes,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{incident_id}/interviews")
async def get_incident_interviews(
    incident_id: str,
    user: dict = Depends(get_current_user),
):
    if not is_coordinator_role(user):
        raise HTTPException(status_code=403, detail="Support coordinator access required.")
    org_id = user.get("organization_id")
    if not org_id:
        return {"records": []}
    return {"records": await incident_service.list_interviews(incident_id, str(org_id))}
