from fastapi import APIRouter, HTTPException
from ..schemas.participant import ParticipantCreate, ParticipantUpdate, NDISPlanCreate, GoalsUpdateBody
from ..services import participant_service
from ..services import funding_service
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/participants", tags=["participants"])


@router.get("")
async def list_participants():
    return await participant_service.get_all_participants()


@router.post("", status_code=201)
async def create_participant(body: ParticipantCreate):
    try:
        return await participant_service.create_participant(body)
    except Exception as e:
        logger.error(f"Error creating participant: {e}")
        raise HTTPException(status_code=400, detail=str(e))


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
    """Full update of participant data."""
    updated = await participant_service.update_participant(participant_id, body)
    if not updated:
        raise HTTPException(status_code=404, detail="Participant not found")
    return updated


@router.patch("/{participant_id}")
async def update_participant(participant_id: str, body: ParticipantUpdate):
    """Partial update of participant data."""
    updated = await participant_service.update_participant(participant_id, body)
    if not updated:
        raise HTTPException(status_code=404, detail="Participant not found")
    return updated


@router.delete("/{participant_id}", status_code=204)
async def delete_participant(participant_id: str):
    await participant_service.delete_participant(participant_id)


# ---------------------------------------------------------------------------
# NDIS Plan endpoints
# ---------------------------------------------------------------------------

@router.get("/{participant_id}/plan")
async def get_participant_plan(participant_id: str):
    """Get the active NDIS plan for a participant."""
    plan = await funding_service.get_plan_for_participant(participant_id)
    if not plan:
        return {"has_plan": False}
    return plan


@router.get("/{participant_id}/plans")
async def get_all_participant_plans(participant_id: str):
    """Get all NDIS plans for a participant."""
    return await funding_service.get_all_plans_for_participant(participant_id)


@router.post("/{participant_id}/plan", status_code=201)
async def create_participant_plan(participant_id: str, body: NDISPlanCreate):
    """Create or update the active NDIS plan for a participant."""
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
    except Exception as e:
        logger.error(f"Error creating plan for {participant_id}: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{participant_id}/budget-summary")
async def get_budget_summary(participant_id: str):
    """Get budget summary by support category."""
    return await funding_service.get_budget_summary(participant_id)


@router.get("/{participant_id}/budget-usage")
async def get_budget_usage(participant_id: str):
    """Get budget usage history."""
    return await funding_service.get_budget_usage_history(participant_id)


@router.patch("/{participant_id}/goals")
async def update_participant_goals(participant_id: str, body: GoalsUpdateBody):
    """Update NDIS goals for a participant (add/archive goals)."""
    participant = await participant_service.get_participant_by_id(participant_id)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")
    goals_data = [g.model_dump() for g in body.goals]
    from ..services.supabase_client import get_supabase_admin
    supabase = get_supabase_admin()
    # Pass goals_data as a plain list — PostgREST will store it as a proper JSONB
    # array, not as a quoted JSON string.
    result = supabase.table("patients").update({"goals": goals_data}).eq("id", participant_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Participant not found")
    return await participant_service.get_participant_by_id(participant_id)


@router.get("/{participant_id}/compliance-history")
async def get_compliance_history(participant_id: str):
    """Get compliance audit log history for all sessions of a participant."""
    from ..services.session_service import get_sessions_by_participant
    from ..services.funding_service import get_compliance_audit_logs
    sessions = await get_sessions_by_participant(participant_id)
    history = []
    for session in sessions[:20]:
        logs = await get_compliance_audit_logs(session["id"])
        if logs:
            history.append({
                "session_id": session["id"],
                "session_date": session.get("session_date"),
                "session_type": session.get("session_type"),
                "latest_audit": logs[0],
            })
    return history
