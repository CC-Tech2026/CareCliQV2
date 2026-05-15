"""FastAPI router for participant (patient) endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from ..schemas.participant import (
    GoalsUpdateBody,
    NDISPlanCreate,
    ParticipantCreate,
    ParticipantUpdate,
    PatientGoalCreate,
    PatientGoalUpdate,
    PractitionerAllocationCreate,
)
from ..services import funding_service, participant_service, goals_service, allocation_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/participants", tags=["participants"])


# ---------------------------------------------------------------------------
# Participant CRUD
# ---------------------------------------------------------------------------

@router.get("")
async def list_participants():
    return await participant_service.get_all_participants()


@router.post("", status_code=201)
async def create_participant(body: ParticipantCreate):
    try:
        return await participant_service.create_participant(body)
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
async def replace_participant(participant_id: str, body: ParticipantUpdate):
    """Full replacement of participant data (all writable fields)."""
    updated = await participant_service.update_participant(participant_id, body)
    if not updated:
        raise HTTPException(status_code=404, detail="Participant not found")
    return updated


@router.patch("/{participant_id}")
async def update_participant(participant_id: str, body: ParticipantUpdate):
    """Partial update — only supplied fields are written."""
    updated = await participant_service.update_participant(participant_id, body)
    if not updated:
        raise HTTPException(status_code=404, detail="Participant not found")
    return updated


@router.delete("/{participant_id}", status_code=204)
async def delete_participant(participant_id: str):
    await participant_service.delete_participant(participant_id)


# ---------------------------------------------------------------------------
# NDIS Goals
# ---------------------------------------------------------------------------

@router.patch("/{participant_id}/goals")
async def update_participant_goals(participant_id: str, body: GoalsUpdateBody):
    """Replace the full goals list for a participant."""
    exists = await participant_service.get_participant_by_id(participant_id)
    if not exists:
        raise HTTPException(status_code=404, detail="Participant not found")

    updated = await participant_service.update_participant_goals(participant_id, body.goals)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update goals")
    return updated


# ---------------------------------------------------------------------------
# NDIS Plans & Budgets
# ---------------------------------------------------------------------------

@router.get("/{participant_id}/plan")
async def get_participant_plan(participant_id: str):
    """Return the active NDIS plan for a participant."""
    plan = await funding_service.get_plan_for_participant(participant_id)
    if not plan:
        return {"has_plan": False}
    return plan


@router.get("/{participant_id}/plans")
async def get_all_participant_plans(participant_id: str):
    """Return all NDIS plans for a participant."""
    return await funding_service.get_all_plans_for_participant(participant_id)


@router.post("/{participant_id}/plan", status_code=201)
async def create_participant_plan(participant_id: str, body: NDISPlanCreate):
    """Create or update the active NDIS plan and budget allocations."""
    participant = await participant_service.get_participant_by_id(participant_id)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")

    plan_data = {
        "plan_number": body.plan_number,
        "plan_start": str(body.plan_start),
        "plan_end": str(body.plan_end),
        "total_funding": body.total_funding,
        "status": body.status,
    }

    try:
        plan = await funding_service.create_or_update_plan(participant_id, plan_data)
        plan_id = plan.get("id")
        if plan_id:
            for category, amount in [
                ("core", body.core_budget),
                ("capacity_building", body.capacity_budget),
                ("capital", body.capital_budget),
            ]:
                if amount is not None and amount > 0:
                    await funding_service.upsert_plan_budget(plan_id, category, amount)
        return await funding_service.get_budget_summary(participant_id)
    except Exception as exc:
        logger.error("create_participant_plan(%s) failed: %s", participant_id, exc)
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/{participant_id}/budget-summary")
async def get_budget_summary(participant_id: str):
    """Return budget totals and usage by support category."""
    return await funding_service.get_budget_summary(participant_id)


@router.get("/{participant_id}/budget-usage")
async def get_budget_usage(participant_id: str):
    """Return paginated budget usage history."""
    return await funding_service.get_budget_usage_history(participant_id)


# ---------------------------------------------------------------------------
# Plan-linked Goals (patient_goals table)
# ---------------------------------------------------------------------------

@router.get("/{participant_id}/plan-goals")
async def get_plan_goals(participant_id: str):
    """Return goals linked to the participant's active NDIS plan."""
    return await goals_service.get_goals_for_participant(participant_id)


@router.post("/{participant_id}/plan-goals", status_code=201)
async def create_plan_goal(participant_id: str, body: PatientGoalCreate):
    """Add a new goal to the participant's active NDIS plan."""
    participant = await participant_service.get_participant_by_id(participant_id)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")
    try:
        goal = await goals_service.create_goal(
            participant_id=participant_id,
            description=body.description,
            category=body.category,
            goal_code=body.goal_code,
            target_date=body.target_date,
        )
        if not goal:
            raise HTTPException(status_code=500, detail="Failed to create goal")
        return goal
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error("create_plan_goal(%s) failed: %s", participant_id, exc)
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/{participant_id}/plan-goals/{goal_id}")
async def update_plan_goal(participant_id: str, goal_id: str, body: PatientGoalUpdate):
    """Partial update on a plan goal (description, category, target_date, is_achieved)."""
    updates = body.model_dump(exclude_unset=True)
    updated = await goals_service.update_goal(goal_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Goal not found")
    return updated


@router.delete("/{participant_id}/plan-goals/{goal_id}", status_code=204)
async def delete_plan_goal(participant_id: str, goal_id: str):
    """Delete a plan goal."""
    await goals_service.delete_goal(goal_id)


# ---------------------------------------------------------------------------
# Practitioner Allocations
# ---------------------------------------------------------------------------

@router.get("/{participant_id}/allocations")
async def get_allocations(participant_id: str):
    """Return all practitioner allocations for a participant."""
    return await allocation_service.get_allocations_for_participant(participant_id)


@router.post("/{participant_id}/allocations", status_code=201)
async def create_allocation(participant_id: str, body: PractitionerAllocationCreate):
    """Assign a practitioner to a participant."""
    participant = await participant_service.get_participant_by_id(participant_id)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")
    try:
        allocation = await allocation_service.create_allocation(
            participant_id=participant_id,
            user_id=body.user_id,
            allocated_role=body.allocated_role,
        )
        if not allocation:
            raise HTTPException(status_code=500, detail="Failed to create allocation")
        return allocation
    except Exception as exc:
        logger.error("create_allocation(%s) failed: %s", participant_id, exc)
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/{participant_id}/allocations/{allocation_id}", status_code=204)
async def delete_allocation(participant_id: str, allocation_id: str):
    """Remove a practitioner allocation."""
    await allocation_service.delete_allocation(allocation_id)


# ---------------------------------------------------------------------------
# Compliance history
# ---------------------------------------------------------------------------

@router.get("/{participant_id}/compliance-history")
async def get_compliance_history(participant_id: str):
    """Return the compliance audit log for all sessions of a participant."""
    from ..services.session_service import get_sessions_by_participant
    from ..services.funding_service import get_compliance_audit_logs

    sessions = await get_sessions_by_participant(participant_id)
    history = []
    for session in sessions[:20]:
        logs = await get_compliance_audit_logs(session["id"])
        if logs:
            history.append(
                {
                    "session_id": session["id"],
                    "session_date": session.get("session_date"),
                    "session_type": session.get("session_type"),
                    "latest_audit": logs[0],
                }
            )
    return history
