"""FastAPI router for participant (patient) endpoints."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from ..core.security import get_optional_user
from ..schemas.participant import (
    GoalsUpdateBody,
    NDISPlanCreate,
    ParticipantCreate,
    ParticipantUpdate,
    PatientGoalCreate,
    PatientGoalUpdate,
    PractitionerAllocationCreate,
)
from ..services import audit_service, funding_service, participant_service, goals_service, allocation_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/participants", tags=["participants"])


def _slim(record: Optional[dict]) -> Optional[dict]:
    """Return a lightweight snapshot (no large JSONB blobs) for audit logs."""
    if not record:
        return None
    keep = ("id", "full_name", "ndis_number", "plan_status", "organization_id")
    return {k: record[k] for k in keep if k in record}


# ---------------------------------------------------------------------------
# Participant CRUD
# ---------------------------------------------------------------------------

@router.get("")
async def list_participants(user: Optional[dict] = Depends(get_optional_user)):
    org_id = (user or {}).get("organization_id")
    return await participant_service.get_all_participants(org_id=org_id)


@router.post("", status_code=201)
async def create_participant(
    body: ParticipantCreate,
    user: Optional[dict] = Depends(get_optional_user),
):
    try:
        org_id = (user or {}).get("organization_id")
        result = await participant_service.create_participant(body, org_id=org_id)
        await audit_service.log_action(
            action_type="participant.created",
            entity_type="participant",
            entity_id=result.get("id", ""),
            user_id=(user or {}).get("sub"),
            organization_id=org_id,
            after_state=_slim(result),
        )
        return result
    except Exception as exc:
        logger.error("create_participant failed: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/dashboard-stats")
async def dashboard_stats():
    return await participant_service.get_dashboard_stats()


@router.get("/{participant_id}")
async def get_participant(participant_id: str):
    participant = await participant_service.get_participant_by_id(participant_id)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")
    return participant


@router.put("/{participant_id}")
async def replace_participant(
    participant_id: str,
    body: ParticipantUpdate,
    user: Optional[dict] = Depends(get_optional_user),
):
    """Full replacement of participant data (all writable fields)."""
    before = await participant_service.get_participant_by_id(participant_id)
    updated = await participant_service.update_participant(participant_id, body)
    if not updated:
        raise HTTPException(status_code=404, detail="Participant not found")
    await audit_service.log_action(
        action_type="participant.replaced",
        entity_type="participant",
        entity_id=participant_id,
        user_id=(user or {}).get("sub"),
        organization_id=(user or {}).get("organization_id"),
        before_state=_slim(before),
        after_state=_slim(updated),
    )
    return updated


@router.patch("/{participant_id}")
async def update_participant(
    participant_id: str,
    body: ParticipantUpdate,
    user: Optional[dict] = Depends(get_optional_user),
):
    """Partial update — only supplied fields are written."""
    before = await participant_service.get_participant_by_id(participant_id)
    updated = await participant_service.update_participant(participant_id, body)
    if not updated:
        raise HTTPException(status_code=404, detail="Participant not found")
    await audit_service.log_action(
        action_type="participant.updated",
        entity_type="participant",
        entity_id=participant_id,
        user_id=(user or {}).get("sub"),
        organization_id=(user or {}).get("organization_id"),
        before_state=_slim(before),
        after_state=_slim(updated),
    )
    return updated


@router.delete("/{participant_id}", status_code=204)
async def delete_participant(
    participant_id: str,
    user: Optional[dict] = Depends(get_optional_user),
):
    before = await participant_service.get_participant_by_id(participant_id)
    await participant_service.delete_participant(participant_id)
    await audit_service.log_action(
        action_type="participant.deleted",
        entity_type="participant",
        entity_id=participant_id,
        user_id=(user or {}).get("sub"),
        organization_id=(user or {}).get("organization_id"),
        before_state=_slim(before),
    )


# ---------------------------------------------------------------------------
# NDIS Goals
# ---------------------------------------------------------------------------

@router.get("/{participant_id}/goals")
async def get_participant_goals(participant_id: str):
    return await goals_service.get_goals_for_participant(participant_id)


@router.post("/{participant_id}/goals", status_code=201)
async def create_participant_goal(participant_id: str, body: PatientGoalCreate):
    try:
        return await goals_service.create_goal(participant_id, body)
    except Exception as exc:
        logger.error("create_participant_goal failed: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/{participant_id}/goals/{goal_id}")
async def update_participant_goal(participant_id: str, goal_id: str, body: PatientGoalUpdate):
    updated = await goals_service.update_goal(goal_id, body)
    if not updated:
        raise HTTPException(status_code=404, detail="Goal not found")
    return updated


@router.delete("/{participant_id}/goals/{goal_id}", status_code=204)
async def delete_participant_goal(participant_id: str, goal_id: str):
    await goals_service.delete_goal(goal_id)


@router.patch("/{participant_id}/goals-legacy")
async def update_goals_legacy(participant_id: str, body: GoalsUpdateBody):
    """Update the legacy JSONB goals array on the patients row."""
    updated = await participant_service.update_participant_goals(participant_id, body.goals)
    if not updated:
        raise HTTPException(status_code=404, detail="Participant not found")
    return updated


# ---------------------------------------------------------------------------
# NDIS Plan
# ---------------------------------------------------------------------------

@router.post("/{participant_id}/plan", status_code=201)
async def create_ndis_plan(participant_id: str, body: NDISPlanCreate):
    try:
        return await funding_service.create_ndis_plan(participant_id, body)
    except Exception as exc:
        logger.error("create_ndis_plan failed: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{participant_id}/plan")
async def get_ndis_plan(participant_id: str):
    return await funding_service.get_ndis_plan(participant_id)


@router.get("/{participant_id}/budget-summary")
async def budget_summary(participant_id: str):
    return await funding_service.get_budget_summary(participant_id)


# ---------------------------------------------------------------------------
# Practitioner allocations
# ---------------------------------------------------------------------------

@router.get("/{participant_id}/allocations")
async def get_allocations(participant_id: str):
    return await allocation_service.get_allocations_for_participant(participant_id)


@router.post("/{participant_id}/allocations", status_code=201)
async def create_allocation(participant_id: str, body: PractitionerAllocationCreate):
    try:
        return await allocation_service.create_allocation(participant_id, body)
    except Exception as exc:
        logger.error("create_allocation failed: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/{participant_id}/allocations/{allocation_id}", status_code=204)
async def delete_allocation(participant_id: str, allocation_id: str):
    await allocation_service.delete_allocation(allocation_id)
