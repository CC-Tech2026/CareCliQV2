"""FastAPI router for participant (patient) endpoints."""

from __future__ import annotations

import logging

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from ..core.access import is_coordinator_role
from ..core.security import get_current_user
from ..api.security import require_recent_reauth
from ..schemas.participant import (
    NDISPlanCreate,
    ParticipantCreate,
    ParticipantUpdate,
    PlanBudgetCategoryUpsert,
)
from ..schemas.progress import ParticipantProgressResponse
from ..services import funding_service, participant_service, progress_service

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


@router.get("/{participant_id}/progress", response_model=ParticipantProgressResponse)
async def get_participant_progress(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Per-goal progress trajectories and plan renewal readiness (CARECLIQV2-76)."""
    from ..core.access import is_support_worker

    if is_support_worker(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Support workers cannot access participant progress trajectories",
        )

    await _require_participant_access(participant_id, current_user)
    return await progress_service.get_participant_progress(participant_id, current_user)


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
    }
    if body.status:
        plan_data["status"] = body.status

    try:
        plan = await funding_service.create_or_update_plan(
            participant_id,
            plan_data,
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


@router.get("/{participant_id}/plan/budget-categories")
async def get_plan_budget_categories(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Fundable categories available for this participant's organization.

    Sourced from the org's loaded NDIS pricing schedule when one exists;
    falls back to the 3 legacy broad buckets otherwise.
    """

    participant = await _require_participant_access(
        participant_id,
        current_user,
    )

    org_id = participant.get("organization_id")
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Participant has no organization",
        )

    return await funding_service.list_available_categories(org_id)


@router.post("/{participant_id}/plan/budgets", status_code=status.HTTP_201_CREATED)
async def upsert_plan_budget_category(
    participant_id: str,
    body: PlanBudgetCategoryUpsert,
    current_user: dict = Depends(get_current_user),
):
    """
    Add or update a funded category and its allocated amount on the
    participant's NDIS plan. Part of the "Set Up NDIS Plan" flow.
    """

    if not is_coordinator_role(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only support coordinators can edit plan budgets",
        )

    participant = await _require_participant_access(
        participant_id,
        current_user,
    )

    org_id = participant.get("organization_id")
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Participant has no organization",
        )

    available = await funding_service.list_available_categories(org_id)
    matched = next((c for c in available if c["category"] == body.category), None)
    if not matched:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"'{body.category}' is not a fundable category for this organization",
        )

    plan = await funding_service.get_latest_plan_for_participant(participant_id)
    if not plan or not plan.get("id"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Set up the participant's NDIS plan before adding category budgets",
        )

    await funding_service.upsert_plan_budget(
        plan["id"],
        body.category,
        body.allocated_amount,
        category_group=matched["category_group"],
        category_name=matched["category_name"],
    )

    return await funding_service.get_budget_summary(participant_id)


@router.delete("/{participant_id}/plan/budgets/{category}")
async def delete_plan_budget_category(
    participant_id: str,
    category: str,
    current_user: dict = Depends(get_current_user),
):
    """Remove a funded category from the participant's NDIS plan."""

    if not is_coordinator_role(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only support coordinators can edit plan budgets",
        )

    await _require_participant_access(
        participant_id,
        current_user,
    )

    plan = await funding_service.get_latest_plan_for_participant(participant_id)
    if not plan or not plan.get("id"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Participant has no NDIS plan",
        )

    await funding_service.delete_plan_budget(plan["id"], category)

    return await funding_service.get_budget_summary(participant_id)


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


# ── Restricted Clinical (Coordinator-only) ────────────────────────────────────

@router.get("/{participant_id}/restricted-clinical")
async def get_restricted_clinical(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Full medical history + restricted behavioural notes — Support Coordinator only."""
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=403, detail="Support coordinator access required.")
    participant = await _require_participant_access(participant_id, current_user)
    return {
        "restricted_behavioural_notes": participant.get("restricted_behavioural_notes"),
        "behaviour_support_plan": participant.get("behaviour_support_plan"),
        "medications": participant.get("medications"),
        "medical_alerts": participant.get("medical_alerts"),
    }


class RestrictedClinicalUpdate(BaseModel):
    restricted_behavioural_notes: Optional[str] = None
    behaviour_support_plan: Optional[str] = None
    medications: Optional[str] = None
    medical_alerts: Optional[str] = None


@router.patch("/{participant_id}/restricted-clinical")
async def update_restricted_clinical(
    participant_id: str,
    body: RestrictedClinicalUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Update restricted clinical fields — Support Coordinator only."""
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=403, detail="Support coordinator access required.")
    await _require_participant_access(participant_id, current_user)
    from ..services.supabase_client import get_supabase_admin
    supabase = get_supabase_admin()
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=422, detail="No fields to update.")
    try:
        result = supabase.table("patients").update(update_data).eq("id", participant_id).execute()
        return result.data[0] if result.data else update_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Update failed: {e}")


# ── Shift context (Coordinator authoring — CARECLIQV2-295) ─────────────────────

class AllergyItem(BaseModel):
    id: Optional[str] = None
    allergen: str
    severity: str = "mild"
    notes: Optional[str] = None


class BehaviouralNoteItem(BaseModel):
    title: str = "Behavioural note"
    body: str


class ShiftContextUpdate(BaseModel):
    preferred_name: Optional[str] = None
    case_manager_name: Optional[str] = None
    case_manager_phone: Optional[str] = None
    emergency_contact: Optional[dict] = None
    likes_dislikes: Optional[str] = None
    sensory_preferences: Optional[str] = None
    cultural_preferences: Optional[str] = None
    communication_preferences: Optional[str] = None
    communication_guidance: Optional[str] = None
    preferred_activities: Optional[list[str]] = None
    previous_visit_notes: Optional[str] = None
    current_conditions: Optional[str] = None
    behavioural_notes: Optional[list[BehaviouralNoteItem]] = None
    allergies: Optional[list[AllergyItem]] = None
    background_summary: Optional[str] = None
    briefing_alerts: Optional[list[str]] = None


@router.get("/{participant_id}/shift-context")
async def get_shift_context(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Coordinator view of participant shift-context fields."""
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=403, detail="Support coordinator access required.")
    await _require_participant_access(participant_id, current_user)
    from ..core.access import get_user_organization_id
    from ..services import briefing_service
    from ..services.shift_service import _fetch_participant_context
    from ..services.supabase_client import get_supabase_admin

    org_id = str(get_user_organization_id(current_user) or "")
    ctx = _fetch_participant_context(participant_id, org_id)
    if not ctx:
        raise HTTPException(status_code=404, detail="Participant not found")
    try:
        supabase = get_supabase_admin()
        patient_resp = (
            supabase.table("patients")
            .select("background_summary, background_summary_updated_at")
            .eq("id", participant_id)
            .limit(1)
            .execute()
        )
        patient_row = (patient_resp.data or [{}])[0]
        ctx["background_summary"] = patient_row.get("background_summary")
        ctx["background_summary_updated_at"] = patient_row.get("background_summary_updated_at")
        ctx["briefing_alerts"] = [
            row.get("alert_text") or ""
            for row in briefing_service.list_participant_briefing_alerts(participant_id, org_id)
        ]
    except Exception:
        ctx.setdefault("briefing_alerts", [])
    return ctx


@router.patch("/{participant_id}/shift-context")
async def update_shift_context(
    participant_id: str,
    body: ShiftContextUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Update participant shift-context fields — coordinator only."""
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=403, detail="Support coordinator access required.")
    await _require_participant_access(participant_id, current_user)
    from ..core.access import get_user_organization_id
    from ..services.supabase_client import get_supabase_admin

    supabase = get_supabase_admin()
    org_id = str(get_user_organization_id(current_user) or "")
    now = datetime.utcnow().isoformat() + "Z"

    patient_fields = {
        k: v
        for k, v in {
            "preferred_name": body.preferred_name,
            "case_manager_name": body.case_manager_name,
            "case_manager_phone": body.case_manager_phone,
            "emergency_contact": body.emergency_contact,
            "likes_dislikes": body.likes_dislikes,
            "sensory_preferences": body.sensory_preferences,
            "cultural_preferences": body.cultural_preferences,
            "communication_preferences": body.communication_preferences,
            "communication_guidance": body.communication_guidance,
            "preferred_activities": body.preferred_activities,
            "current_conditions": body.current_conditions,
            "behavioural_notes": (
                [n.model_dump() for n in body.behavioural_notes]
                if body.behavioural_notes is not None
                else None
            ),
        }.items()
        if v is not None
    }
    if body.previous_visit_notes is not None:
        patient_fields["previous_visit_notes"] = body.previous_visit_notes
        patient_fields["previous_visit_notes_updated_at"] = now

    if body.background_summary is not None:
        from ..services import briefing_service

        try:
            briefing_service.update_participant_background_summary(
                participant_id, org_id, body.background_summary
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    if body.briefing_alerts is not None:
        from ..services import briefing_service

        try:
            briefing_service.save_participant_briefing_alerts(
                participant_id, org_id, body.briefing_alerts
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    if patient_fields:
        try:
            supabase.table("patients").update(patient_fields).eq("id", participant_id).execute()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Update failed: {e}") from e

    if body.allergies is not None:
        try:
            supabase.table("participant_allergies").delete().eq(
                "participant_id", participant_id
            ).eq("organization_id", org_id).execute()
            for item in body.allergies:
                supabase.table("participant_allergies").insert({
                    "participant_id": participant_id,
                    "organization_id": org_id,
                    "allergen": item.allergen,
                    "severity": item.severity,
                    "notes": item.notes,
                    "updated_at": now,
                }).execute()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Allergy update failed: {e}") from e

    from ..services import briefing_service
    from ..services.shift_service import _fetch_participant_context

    ctx = _fetch_participant_context(participant_id, org_id)
    try:
        patient_resp = (
            supabase.table("patients")
            .select("background_summary, background_summary_updated_at")
            .eq("id", participant_id)
            .limit(1)
            .execute()
        )
        patient_row = (patient_resp.data or [{}])[0]
        ctx["background_summary"] = patient_row.get("background_summary")
        ctx["background_summary_updated_at"] = patient_row.get("background_summary_updated_at")
        ctx["briefing_alerts"] = [
            row.get("alert_text") or ""
            for row in briefing_service.list_participant_briefing_alerts(participant_id, org_id)
        ]
    except Exception:
        ctx.setdefault("briefing_alerts", [])
    return ctx


# ── Safety protocols (coordinator authoring) ───────────────────────────────────

from ..schemas.safety_protocol import SafetyProtocolUpdate
from ..services import safety_protocol_service


@router.get("/{participant_id}/safety-protocol")
async def get_safety_protocol(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=403, detail="Support coordinator access required.")
    await _require_participant_access(participant_id, current_user)
    from ..core.access import get_user_organization_id

    org_id = str(get_user_organization_id(current_user) or "")
    return safety_protocol_service.get_protocol(participant_id, org_id)


@router.put("/{participant_id}/safety-protocol")
async def update_safety_protocol(
    participant_id: str,
    body: SafetyProtocolUpdate,
    current_user: dict = Depends(get_current_user),
):
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=403, detail="Support coordinator access required.")
    await _require_participant_access(participant_id, current_user)
    from ..core.access import get_user_organization_id

    org_id = str(get_user_organization_id(current_user) or "")
    try:
        return safety_protocol_service.upsert_protocol(
            participant_id,
            org_id,
            body,
            updated_by=current_user.get("sub"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


class CheckInCodeCreate(BaseModel):
    label: str = "Primary location"
    latitude: Optional[float] = None
    longitude: Optional[float] = None


@router.get("/{participant_id}/check-in-codes")
async def list_check_in_codes(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    """List active QR check-in codes for a participant (CARECLIQV2-200)."""
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=403, detail="Support coordinator access required.")
    await _require_participant_access(participant_id, current_user)
    from ..core.access import get_user_organization_id
    from ..services.check_in_service import list_participant_check_in_codes

    org_id = str(get_user_organization_id(current_user) or "")
    return list_participant_check_in_codes(participant_id, org_id)


@router.post("/{participant_id}/check-in-codes", status_code=status.HTTP_201_CREATED)
async def create_check_in_code(
    participant_id: str,
    body: CheckInCodeCreate,
    current_user: dict = Depends(get_current_user),
):
    """Generate a QR check-in code for a participant location (CARECLIQV2-200)."""
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=403, detail="Support coordinator access required.")
    await _require_participant_access(participant_id, current_user)
    from ..core.access import get_user_id, get_user_organization_id
    from ..services.check_in_service import create_participant_check_in_code

    org_id = str(get_user_organization_id(current_user) or "")
    try:
        return create_participant_check_in_code(
            participant_id,
            org_id,
            label=body.label,
            latitude=body.latitude,
            longitude=body.longitude,
            created_by=get_user_id(current_user),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
