"""FastAPI router for participant (patient) endpoints."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

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
from ..services import (
    access_log_service,
    audit_service,
    funding_service,
    participant_service,
    goals_service,
    allocation_service,
)
from ..services import pii_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/participants", tags=["participants"])


# ---------------------------------------------------------------------------
# NDIS Act s.66 — Need-to-Know secrecy hook
# Mirrors the JS middleware from the brief, translated to Python/FastAPI.
# ---------------------------------------------------------------------------

def _client_ip(request: Request) -> Optional[str]:
    """Extract the real client IP, respecting the Replit proxy X-Forwarded-For header."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


async def _ndis_secrecy_audit(
    participant_id: str,
    request: Request,
    user: Optional[dict],
    action: str = "READ",
    purpose: str = "Provision of NDIS Supports",
) -> None:
    """Log the access and enforce NDIS Act secrecy provisions.

    Raises HTTP 403 only for users with an explicit *non-clinical* role that
    would indicate they have no business reading participant PII.
    Unauthenticated requests are logged but permitted for backward compatibility
    (existing callers that predate mandatory auth).
    """
    ip = _client_ip(request)
    uid = (user or {}).get("sub")
    org = (user or {}).get("organization_id")

    # 1. Log every access — NDIS Act s.66 audit requirement
    await access_log_service.log_participant_read(
        participant_id=participant_id,
        user_id=uid,
        ip_address=ip,
        purpose=purpose,
        action=action,
        organization_id=org,
    )

    # 2. Strict secrecy check — hasClearance equivalent
    CLEARED_ROLES = {"admin", "authorised_officer", "support_coordinator", "practitioner", "plan_manager", ""}
    role = (user or {}).get("role", "")
    if user and role not in CLEARED_ROLES:
        await access_log_service.log_security_event(
            event_type="unauthorized_participant_access",
            description=(
                f"User {uid!r} (role={role!r}) attempted to access "
                f"participant {participant_id} without clearance."
            ),
            accessor_id=uid,
            participant_id=participant_id,
            ip_address=ip,
            severity="high",
            organization_id=org,
        )
        raise HTTPException(
            status_code=403,
            detail="Unauthorized access to Protected Commission Information.",
        )


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


@router.get("/{participant_id}/export")
async def export_participant_data(
    participant_id: str,
    request: Request,
    user: Optional[dict] = Depends(get_optional_user),
):
    """Data Portability — Privacy Act 2026 APP 12.

    Returns a machine-readable JSON record of the participant's complete data
    including goals, plan summary, and NDIS metadata.
    """
    participant = await participant_service.get_participant_by_id(participant_id)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")

    # Decrypt PII fields before export (no-op when encryption is disabled)
    participant = pii_service.decrypt_participant(participant)

    await _ndis_secrecy_audit(
        participant_id, request, user,
        action="EXPORT",
        purpose="Data Portability Export — APP 12 Privacy Act 2026",
    )

    goals = await goals_service.get_goals_for_participant(participant_id)
    plan = await funding_service.get_ndis_plan(participant_id)

    return {
        "export_schema_version": "1.0",
        "export_generated_at": datetime.now(timezone.utc).isoformat(),
        "app_12_notice": (
            "This record was exported under APP 12 of the Privacy Act 2026 (Australia). "
            "The individual has a right to access personal information held about them."
        ),
        "participant": participant,
        "ndis_plan": plan,
        "ndis_goals": goals,
        "data_custodian": "NDIS Support Provider",
        "retention_policy": "7 years from last service delivery (Archives Act 1983)",
        "disposal_date": participant.get("disposal_date"),
    }


@router.delete("/{participant_id}/purge", status_code=200)
async def purge_participant_pii(
    participant_id: str,
    request: Request,
    user: Optional[dict] = Depends(get_optional_user),
):
    """Right-to-be-Forgotten — Privacy Act 2026 APP 3/6 update.

    Hard-deletes PII fields (name, DOB, email, phone, NDIS number) while
    retaining an anonymised record with goals for NDIS Commission reporting.
    Only ``admin`` / ``authorised_officer`` roles may invoke this endpoint.
    """
    ip = _client_ip(request)
    uid = (user or {}).get("sub")
    org = (user or {}).get("organization_id")
    role = (user or {}).get("role", "")

    PURGE_ROLES = {"admin", "authorised_officer"}
    if not user or role not in PURGE_ROLES:
        await access_log_service.log_security_event(
            event_type="purge_attempt_unauthorized",
            description=f"Unauthorised PII purge attempt on participant {participant_id} by user {uid!r} (role={role!r}).",
            accessor_id=uid,
            participant_id=participant_id,
            ip_address=ip,
            severity="critical",
            organization_id=org,
        )
        raise HTTPException(
            status_code=403,
            detail="PII purge requires Authorised Officer clearance (Privacy Act 2026 APP 3/6).",
        )

    existing = await participant_service.get_participant_by_id(participant_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Participant not found")
    if existing.get("is_purged"):
        return {
            "status": "already_purged",
            "participant_id": participant_id,
            "pseudonym": existing.get("external_pseudonym"),
        }

    purge_payload = pii_service.deidentify_participant(existing)
    await participant_service.force_update_participant(participant_id, purge_payload)

    await audit_service.log_action(
        action_type="participant.pii_purged",
        entity_type="participant",
        entity_id=participant_id,
        user_id=uid,
        organization_id=org,
        before_state={
            "ndis_number": existing.get("ndis_number"),
            "full_name": "[REDACTED FOR PURGE LOG]",
        },
        after_state={
            "is_purged": True,
            "external_pseudonym": purge_payload.get("external_pseudonym"),
        },
    )

    return {
        "status": "purged",
        "participant_id": participant_id,
        "pseudonym": purge_payload.get("external_pseudonym"),
        "message": (
            "PII hard-deleted per Privacy Act 2026 APP 3/6. "
            "Anonymised record retained for NDIS Commission reporting."
        ),
    }


@router.get("/{participant_id}")
async def get_participant(
    participant_id: str,
    request: Request,
    user: Optional[dict] = Depends(get_optional_user),
):
    participant = await participant_service.get_participant_by_id(participant_id)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")

    # NDIS Act s.66 — log every individual record read
    await _ndis_secrecy_audit(participant_id, request, user)

    # Decrypt any AES-256 GCM encrypted PII fields (no-op when disabled)
    return pii_service.decrypt_participant(participant)


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
