from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Dict, Any
import logging

from ..core.security import get_current_user
from ..services.supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/assignments", tags=["assignments"])

TABLE = "practitioner_allocations"

_COORDINATOR_ROLES = {"support_coordinator", "admin"}

_VALID_ROLE_TYPES = {
    "support_worker",
    "allied_health",
    "allied_health_pro",
    "primary_ot",
    "supervisor",
}


class AssignmentCreate(BaseModel):
    participant_id: str
    worker_user_id: str
    role_type: str = "support_worker"


def _require_coordinator(user: dict):
    if user.get("role") not in _COORDINATOR_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Only coordinators can manage assignments",
        )


# ---------------------------------------------------------------------
# LIST
# ---------------------------------------------------------------------
@router.get("")
async def list_assignments(user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()

    role = user.get("role")
    uid = user.get("sub")
    org_id = user.get("organization_id")

    q = supabase.table(TABLE).select("*").eq("is_active", True)

    if role in _COORDINATOR_ROLES:
        if org_id:
            q = q.eq("organization_id", org_id)
    else:
        q = q.eq("user_id", uid)

    result = q.execute()
    return result.data or []


# ---------------------------------------------------------------------
# CREATE
# ---------------------------------------------------------------------
@router.post("")
async def create_assignment(
    body: AssignmentCreate,
    user: dict = Depends(get_current_user),
):
    _require_coordinator(user)

    supabase = get_supabase_admin()
    org_id = user.get("organization_id")

    payload = {
        "patient_id": body.participant_id,
        "user_id": body.worker_user_id,
        "allocated_role": body.role_type if body.role_type in _VALID_ROLE_TYPES else "support_worker",
        "is_active": True,
    }

    if org_id:
        payload["organization_id"] = org_id

    role_type = payload["allocated_role"]
    try:
        result = (
            supabase.table(TABLE)
            .upsert(payload, on_conflict="patient_id,user_id")
            .execute()
        )

        # Sync assignment metadata onto patient record so access control and
        # participant reports can use direct lookup fields.
        if role_type == "support_worker":
            supabase.table("patients").update({"assigned_worker_id": body.worker_user_id}).eq("id", body.participant_id).execute()
        elif role_type in {"allied_health", "allied_health_pro"}:
            supabase.table("patients").update({"allied_health_id": body.worker_user_id}).eq("id", body.participant_id).execute()
        elif role_type in {"primary_ot", "supervisor"}:
            supabase.table("patients").update({
                "allied_health_id": body.worker_user_id,
                "clinician_id": body.worker_user_id,
            }).eq("id", body.participant_id).execute()

        return result.data[0] if result.data else payload

    except Exception as exc:
        logger.error("create_assignment failed: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))


# ---------------------------------------------------------------------
# DELETE (FIXED - NO deactivated_at)
# ---------------------------------------------------------------------
@router.delete("/{assignment_id}", status_code=204)
async def delete_assignment(
    assignment_id: str,
    user: dict = Depends(get_current_user),
):
    _require_coordinator(user)

    supabase = get_supabase_admin()

    try:
        # 1. fetch assignment
        alloc = (
            supabase.table(TABLE)
            .select("patient_id, allocated_role")
            .eq("id", assignment_id)
            .execute()
        )

        if not alloc.data:
            raise HTTPException(status_code=404, detail="Assignment not found")

        row = alloc.data[0]
        patient_id = row.get("patient_id")

        # 2. soft delete ONLY
        supabase.table(TABLE).update({
            "is_active": False
        }).eq("id", assignment_id).execute()

        # 3. cleanup patient links if needed
        remaining = (
            supabase.table(TABLE)
            .select("id")
            .eq("patient_id", patient_id)
            .eq("is_active", True)
            .execute()
        )

        if not remaining.data:
            supabase.table("patients").update({
                "assigned_worker_id": None,
                "allied_health_id": None,
            }).eq("id", patient_id).execute()

        return

    except Exception as exc:
        logger.error("delete_assignment failed: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))


#---------------------------------------------------------------------
# Get WORKERS (FIXED - NEW ENDPOINT)
# ---------------------------------------------------------------------

@router.get("/workers")
async def list_org_workers(user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()

    org_id = user.get("organization_id")

    q = (
        supabase.table("users")
        .select("id, full_name, email, role, account_type")
        .in_("role", ["support_worker", "allied_health", "allied_health_pro"])
    )

    if org_id:
        q = q.eq("organization_id", org_id)

    result = q.execute()
    return result.data or []