"""FastAPI router for participant (patient) endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from ..core.security import get_current_user

from ..schemas.participant import (
    GoalsUpdateBody,
    NDISPlanCreate,
    ParticipantCreate,
    ParticipantUpdate,
)
from ..services import funding_service, participant_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/participants", tags=["participants"])


# ---------------------------------------------------------------------------
# Participant CRUD
# ---------------------------------------------------------------------------

@router.get("")
async def list_participants(current_user: dict = Depends(get_current_user)):
    return await participant_service.get_all_participants(current_user)


@router.post("", status_code=201)
async def create_participant(body: ParticipantCreate, current_user: dict = Depends(get_current_user)):
    try:
        return await participant_service.create_participant(body, current_user)
    except Exception as exc:
        logger.error("create_participant failed: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/dashboard-stats")
async def dashboard_stats(current_user: dict = Depends(get_current_user)):
    return await participant_service.get_dashboard_stats(current_user)


@router.get("/{participant_id}")
async def get_participant(participant_id: str, current_user: dict = Depends(get_current_user)):
    participant = await participant_service.get_participant_by_id(participant_id, current_user)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")
    return participant


@router.put("/{participant_id}")
async def replace_participant(participant_id: str, body: ParticipantUpdate, current_user: dict = Depends(get_current_user)):
    """Full replacement of participant data (all writable fields)."""
    updated = await participant_service.update_participant(participant_id, body, current_user)
    if not updated:
        raise HTTPException(status_code=404, detail="Participant not found")
    return updated


@router.patch("/{participant_id}")
async def update_participant(participant_id: str, body: ParticipantUpdate, current_user: dict = Depends(get_current_user)):
    """Partial update — only supplied fields are written."""
    updated = await participant_service.update_participant(participant_id, body, current_user)
    if not updated:
        raise HTTPException(status_code=404, detail="Participant not found")
    return updated


@router.delete("/{participant_id}", status_code=204)
async def delete_participant(participant_id: str, current_user: dict = Depends(get_current_user)):
    deleted = await participant_service.delete_participant(participant_id, current_user)
    if not deleted:
        raise HTTPException(status_code=404, detail="Participant not found")


# ---------------------------------------------------------------------------
# NDIS Goals
# ---------------------------------------------------------------------------

@router.patch("/{participant_id}/goals")
async def update_participant_goals(participant_id: str, body: GoalsUpdateBody, current_user: dict = Depends(get_current_user)):
    """Replace the full goals list for a participant."""
    exists = await participant_service.get_participant_by_id(participant_id, current_user)
    if not exists:
        raise HTTPException(status_code=404, detail="Participant not found")

    updated = await participant_service.update_participant_goals(participant_id, body.goals, current_user)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update goals")
    return updated


# ---------------------------------------------------------------------------
# NDIS Plans & Budgets
# ---------------------------------------------------------------------------

@router.get("/{participant_id}/plan")
async def get_participant_plan(participant_id: str, current_user: dict = Depends(get_current_user)):
    """Return the active NDIS plan for a participant."""
    if not await participant_service.get_participant_by_id(participant_id, current_user):
        raise HTTPException(status_code=404, detail="Participant not found")
    plan = await funding_service.get_plan_for_participant(participant_id)
    if not plan:
        return {"has_plan": False}
    return plan


@router.get("/{participant_id}/plans")
async def get_all_participant_plans(participant_id: str, current_user: dict = Depends(get_current_user)):
    """Return all NDIS plans for a participant."""
    if not await participant_service.get_participant_by_id(participant_id, current_user):
        raise HTTPException(status_code=404, detail="Participant not found")
    return await funding_service.get_all_plans_for_participant(participant_id)


@router.post("/{participant_id}/plan", status_code=201)
async def create_participant_plan(participant_id: str, body: NDISPlanCreate, current_user: dict = Depends(get_current_user)):
    """Create or update the active NDIS plan and budget allocations."""
    participant = await participant_service.get_participant_by_id(participant_id, current_user)
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
async def get_budget_summary(participant_id: str, current_user: dict = Depends(get_current_user)):
    """Return budget totals and usage by support category."""
    if not await participant_service.get_participant_by_id(participant_id, current_user):
        raise HTTPException(status_code=404, detail="Participant not found")
    return await funding_service.get_budget_summary(participant_id)


@router.get("/{participant_id}/budget-usage")
async def get_budget_usage(participant_id: str, current_user: dict = Depends(get_current_user)):
    """Return paginated budget usage history."""
    if not await participant_service.get_participant_by_id(participant_id, current_user):
        raise HTTPException(status_code=404, detail="Participant not found")
    return await funding_service.get_budget_usage_history(participant_id)


# ---------------------------------------------------------------------------
# Compliance history
# ---------------------------------------------------------------------------

@router.get("/{participant_id}/compliance-history")
async def get_compliance_history(participant_id: str, current_user: dict = Depends(get_current_user)):
    """Return the compliance audit log for all sessions of a participant."""
    from ..services.session_service import get_sessions_by_participant
    from ..services.funding_service import get_compliance_audit_logs

    if not await participant_service.get_participant_by_id(participant_id, current_user):
        raise HTTPException(status_code=404, detail="Participant not found")
    sessions = await get_sessions_by_participant(participant_id, current_user)
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
