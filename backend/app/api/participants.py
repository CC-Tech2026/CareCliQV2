"""FastAPI router for participant (patient) endpoints aligned to Supabase schema."""

from __future__ import annotations

import logging
from typing import Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status

from ..core.security import get_current_user
from ..schemas.participant import (
    GoalsUpdateBody,
    ParticipantUpdate,
)
from ..services import participant_service, funding_service

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
# LIST
# ============================================================================

@router.get("")
async def list_participants(
    current_user: dict = Depends(get_current_user),
):
    return await participant_service.get_all_participants(current_user)


# ============================================================================
# CREATE (DB ALIGNED)
# ============================================================================

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_participant(
    body: Dict[str, Any],
    current_user: dict = Depends(get_current_user),
):
    """
    FULL DB ALIGNMENT:
    Matches Supabase participants table exactly.
    """

    normalized = {
        # identity
        "full_name": body.get("full_name") or body.get("fullName"),
        "ndis_number": body.get("ndis_number") or body.get("ndisNumber"),
        "external_pseudonym": body.get("external_pseudonym"),

        # contact
        "email": body.get("email"),
        "phone": body.get("phone"),
        "address": body.get("address"),
        "emergency_contact": body.get("emergency_contact") or body.get("emergencyContact"),

        # demographics
        "date_of_birth": body.get("date_of_birth") or body.get("dateOfBirth"),
        "biological_sex": body.get("biological_sex") or body.get("gender"),

        # plan
        "ndis_plan_id": body.get("ndis_plan_id") or body.get("ndisPlanId"),
        "plan_status": body.get("plan_status") or body.get("planStatus"),
        "plan_start_date": body.get("plan_start_date") or body.get("planStartDate"),
        "plan_end_date": body.get("plan_end_date") or body.get("planEndDate"),
        "total_budget": body.get("total_budget") or body.get("totalBudget"),
        "used_budget": body.get("used_budget") or body.get("usedBudget"),

        # clinical
        "primary_disability": body.get("primary_disability") or body.get("primaryDisability"),
        "goals": body.get("goals") or [],
        "allergies": body.get("allergies"),
        "communication_preferences": body.get("communication_preferences") or body.get("communicationPreferences"),

        # risk
        "risk_level": body.get("risk_level") or body.get("riskLevel"),
        "risk_triggers": body.get("risk_triggers") or body.get("riskTriggers"),
        "risk_management_plan": body.get("risk_management_plan") or body.get("riskManagementPlan"),

        # assignments
        "assigned_worker_id": body.get("assigned_worker_id") or body.get("assignedWorkerId"),
        "allied_health_id": body.get("allied_health_id") or body.get("alliedHealthId"),
        "clinician_id": body.get("clinician_id") or body.get("clinicianId"),

        # ownership (security-critical)
        "organization_id": current_user.get("organization_id"),
        "created_by": current_user.get("id"),
        "owner_user_id": current_user.get("id"),
    }

    cleaned = {k: v for k, v in normalized.items() if v is not None}

    logger.info("CREATE PARTICIPANT (DB ALIGNED) => %s", cleaned)

    return await participant_service.create_participant(
        cleaned,
        current_user,
    )


# ============================================================================
# GET
# ============================================================================

@router.get("/{participant_id}")
async def get_participant(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await _require_participant_access(participant_id, current_user)


# ============================================================================
# UPDATE (DB SAFE)
# ============================================================================

@router.patch("/{participant_id}")
async def update_participant(
    participant_id: str,
    body: ParticipantUpdate,
    current_user: dict = Depends(get_current_user),
):
    await _require_participant_access(participant_id, current_user)

    return await participant_service.update_participant(
        participant_id,
        body.model_dump(exclude_unset=True),
        current_user,
    )


# ============================================================================
# DELETE
# ============================================================================

@router.delete("/{participant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_participant(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    await _require_participant_access(participant_id, current_user)

    await participant_service.delete_participant(
        participant_id,
        current_user,
    )

    return None


# ============================================================================
# GOALS
# ============================================================================

@router.patch("/{participant_id}/goals")
async def update_goals(
    participant_id: str,
    body: GoalsUpdateBody,
    current_user: dict = Depends(get_current_user),
):
    await _require_participant_access(participant_id, current_user)

    return await participant_service.update_participant_goals(
        participant_id,
        body.goals,
        current_user,
    )


# ============================================================================
# FUNDING (SIMPLIFIED TO YOUR REAL SCHEMA)
# ============================================================================

@router.get("/{participant_id}/budget")
async def get_budget(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    await _require_participant_access(participant_id, current_user)

    return await funding_service.get_budget_summary(participant_id)


@router.get("/{participant_id}/budget-usage")
async def get_budget_usage(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    await _require_participant_access(participant_id, current_user)

    return await funding_service.get_budget_usage_history(participant_id)