"""FastAPI router for participant (patient) endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status

from ..core.access import is_coordinator_role
from ..core.security import get_current_user
from ..api.security import require_recent_reauth
from ..schemas.participant import (
    GoalsUpdateBody,
    NDISPlanCreate,
    ParticipantCreate,
    ParticipantUpdate,
)
from ..services import funding_service, participant_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/participants",
    tags=["participants"],
)


# ============================================================================
# Helpers
# ============================================================================


async def _require_participant_access(
    participant_id: str,
    current_user: dict,
):
    """
    Ensures:
    - participant exists
    - current user has access
    """

    participant = await participant_service.get_participant_by_id(
        participant_id,
        current_user,
    )

    if not participant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Participant not found",
        )

    return participant


# ============================================================================
# Participant CRUD
# ============================================================================


@router.get("")
async def list_participants(
    current_user: dict = Depends(get_current_user),
):
    """
    Returns participants visible to current user.

    Coordinator:
        - all organization participants

    Support worker:
        - assigned participants only

    Allied health:
        - allocated caseload only
    """

    return await participant_service.get_all_participants(current_user)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
)
async def create_participant(
    body: ParticipantCreate,
    current_user: dict = Depends(get_current_user),
):
    """
    Create participant within current user's organization.
    """

    if not is_coordinator_role(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only support coordinators can create participants",
        )

    try:
        return await participant_service.create_participant(
            body,
            current_user,
        )

    except Exception as exc:
        logger.exception("create_participant failed")

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )


@router.get("/dashboard-stats")
async def dashboard_stats(
    current_user: dict = Depends(get_current_user),
):
    """
    Dashboard statistics scoped to visible participants.
    """

    return await participant_service.get_dashboard_stats(current_user)


@router.get("/{participant_id}")
async def get_participant(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Retrieve single participant.
    """

    return await _require_participant_access(
        participant_id,
        current_user,
    )


@router.put("/{participant_id}")
async def replace_participant(
    participant_id: str,
    body: ParticipantUpdate,
    current_user: dict = Depends(get_current_user),
):
    """
    Full replacement update.
    """

    if not is_coordinator_role(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only support coordinators can update participant records",
        )

    await _require_participant_access(
        participant_id,
        current_user,
    )

    updated = await participant_service.update_participant(
        participant_id,
        body,
        current_user,
    )

    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Participant not found",
        )

    return updated


@router.patch("/{participant_id}")
async def update_participant(
    participant_id: str,
    body: ParticipantUpdate,
    current_user: dict = Depends(get_current_user),
):
    """
    Partial update.
    """

    if not is_coordinator_role(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only support coordinators can update participant records",
        )

    await _require_participant_access(
        participant_id,
        current_user,
    )

    updated = await participant_service.update_participant(
        participant_id,
        body,
        current_user,
    )

    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Participant not found",
        )

    return updated


@router.delete(
    "/{participant_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_participant(
    participant_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """
    Delete participant.

    Usually support coordinator only.
    """

    if not is_coordinator_role(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only support coordinators can delete participants",
        )

    require_recent_reauth(request, current_user)

    await _require_participant_access(
        participant_id,
        current_user,
    )

    deleted = await participant_service.delete_participant(
        participant_id,
        current_user,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Participant not found",
        )

    return None


# ============================================================================
# Goals
# ============================================================================


@router.patch("/{participant_id}/goals")
async def update_participant_goals(
    participant_id: str,
    body: GoalsUpdateBody,
    current_user: dict = Depends(get_current_user),
):
    """
    Replace full participant goals array.
    """

    if not is_coordinator_role(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only support coordinators can update participant goals",
        )

    await _require_participant_access(
        participant_id,
        current_user,
    )

    updated = await participant_service.update_participant_goals(
        participant_id,
        body.goals,
        current_user,
    )

    if not updated:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update goals",
        )

    return updated


# ============================================================================
# NDIS Plans
# ============================================================================


@router.get("/{participant_id}/plan")
async def get_participant_plan(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Return active NDIS plan.
    """

    await _require_participant_access(
        participant_id,
        current_user,
    )

    plan = await funding_service.get_plan_for_participant(
        participant_id,
    )

    if not plan:
        return {
            "has_plan": False,
        }

    return plan


@router.get("/{participant_id}/plans")
async def get_all_participant_plans(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Return all participant plans.
    """

    await _require_participant_access(
        participant_id,
        current_user,
    )

    return await funding_service.get_all_plans_for_participant(
        participant_id,
    )


@router.post(
    "/{participant_id}/plan",
    status_code=status.HTTP_201_CREATED,
)
async def create_participant_plan(
    participant_id: str,
    body: NDISPlanCreate,
    current_user: dict = Depends(get_current_user),
):
    """
    Create or update participant NDIS plan.
    """

    if not is_coordinator_role(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only support coordinators can create or update NDIS plans",
        )

    await _require_participant_access(
        participant_id,
        current_user,
    )

    plan_data = {
        "plan_number": body.plan_number,
        "plan_start": str(body.plan_start),
        "plan_end": str(body.plan_end),
        "total_funding": body.total_funding,
        "status": body.status,
    }

    try:
        plan = await funding_service.create_or_update_plan(
            participant_id,
            plan_data,
        )

        plan_id = plan.get("id")

        if plan_id:
            budget_updates = [
                ("core", body.core_budget),
                ("capacity_building", body.capacity_budget),
                ("capital", body.capital_budget),
            ]

            for category, amount in budget_updates:
                if amount and amount > 0:
                    await funding_service.upsert_plan_budget(
                        plan_id,
                        category,
                        amount,
                    )

        return await funding_service.get_budget_summary(
            participant_id,
        )

    except Exception as exc:
        logger.exception(
            "create_participant_plan(%s) failed",
            participant_id,
        )

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )


# ============================================================================
# Budgets
# ============================================================================


@router.get("/{participant_id}/budget-summary")
async def get_budget_summary(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Budget totals + usage summary.
    """

    await _require_participant_access(
        participant_id,
        current_user,
    )

    return await funding_service.get_budget_summary(
        participant_id,
    )


@router.get("/{participant_id}/budget-usage")
async def get_budget_usage(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Detailed budget usage history.
    """

    await _require_participant_access(
        participant_id,
        current_user,
    )

    return await funding_service.get_budget_usage_history(
        participant_id,
    )


# ============================================================================
# Compliance History
# ============================================================================


@router.get("/{participant_id}/compliance-history")
async def get_compliance_history(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Compliance audit history for participant sessions.
    """

    from ..services.funding_service import (
        get_compliance_audit_logs,
    )
    from ..services.session_service import (
        get_sessions_by_participant,
    )

    await _require_participant_access(
        participant_id,
        current_user,
    )

    sessions = await get_sessions_by_participant(
        participant_id,
        current_user,
    )

    history = []

    for session in sessions[:20]:
        logs = await get_compliance_audit_logs(
            session["id"],
        )

        if not logs:
            continue

        history.append(
            {
                "session_id": session["id"],
                "session_date": session.get("session_date"),
                "session_type": session.get("session_type"),
                "latest_audit": logs[0],
            }
        )

    return history
