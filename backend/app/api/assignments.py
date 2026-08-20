"""Assignment management API.

Links participants to support workers / allied health professionals via the
practitioner_allocations junction table.

Endpoints:
  GET    /api/assignments                — list assignments (coordinator: org, worker: own)
  POST   /api/assignments                — assign participant to worker (coordinator only)
  DELETE /api/assignments/{id}           — remove/deactivate assignment (coordinator only)
  GET    /api/assignments/my-participants — participants assigned to current user
  GET    /api/assignments/workers        — list workers in the org (coordinator only)
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from pydantic import BaseModel
from ..core.access import has_org_wide_access
from ..core.security import get_current_user, get_optional_user
from ..services.supabase_client import get_supabase_admin
from ..services import migration_state as _ms
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/assignments", tags=["assignments"])

TABLE = "practitioner_allocations"

_COORDINATOR_ROLES = frozenset({"support_coordinator"})

_VALID_ROLE_TYPES = frozenset({
    "support_worker", "allied_health", "primary_ot", "supervisor"
})


class AssignmentCreate(BaseModel):
    participant_id: str
    worker_user_id: str
    role_type: str = "support_worker"


def _require_coordinator(user: dict) -> None:
    if user.get("role") not in _COORDINATOR_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Only support coordinators can manage participant assignments.",
        )


def _worker_membership_profiles(org_id: Optional[str]) -> list[dict]:
    if not org_id:
        return []

    supabase = get_supabase_admin()
    try:
        memberships = (
            supabase.table("organization_members")
            .select("user_id, role, is_active, joined_at")
            .eq("organization_id", org_id)
            .in_("role", ["support_worker"])
            .execute()
        )
    except Exception as exc:
        logger.warning("worker membership lookup failed: %s", exc)
        return []

    rows = [row for row in (memberships.data or []) if isinstance(row, dict) and row.get("user_id")]
    if not rows:
        return []

    user_ids = [row["user_id"] for row in rows]
    try:
        profiles = (
            supabase.table("users")
            .select("id, full_name, email, role, account_type, is_active")
            .in_("id", user_ids)
            .execute()
        )
        profiles_by_id = {
            str(profile.get("id")): profile
            for profile in (profiles.data or [])
            if isinstance(profile, dict) and profile.get("id")
        }
    except Exception as exc:
        logger.warning("worker profile lookup failed: %s", exc)
        profiles_by_id = {}

    output: list[dict] = []
    for row in rows:
        profile = profiles_by_id.get(str(row["user_id"]), {})
        output.append({
            "id": row["user_id"],
            "full_name": profile.get("full_name") or profile.get("email") or "Worker",
            "email": profile.get("email"),
            "role": row.get("role") or profile.get("role"),
            "account_type": profile.get("account_type"),
            "is_active": bool(row.get("is_active")),
            "joined_at": row.get("joined_at"),
        })
    return output


# ---------------------------------------------------------------------------
# GET /assignments/my-participants  — must be BEFORE /{id} to avoid shadowing
# ---------------------------------------------------------------------------

@router.get("/my-participants")
async def get_my_participants(user: dict = Depends(get_current_user)):
    """Return participants assigned to the currently authenticated user."""
    if _ms.practitioner_allocations_table_missing:
        return []
    supabase = get_supabase_admin()
    uid = user.get("sub")
    try:
        alloc = (
            supabase.table(TABLE)
            .select("patient_id")
            .eq("user_id", uid)
            .eq("is_active", "true")
            .execute()
        )
        patient_ids = [r["patient_id"] for r in (alloc.data or [])]
        if not patient_ids:
            return []
        result = (
            supabase.table("patients")
            .select("id, full_name, ndis_number, plan_status, date_of_birth")
            .in_("id", patient_ids)
            .execute()
        )
        return result.data or []
    except Exception as exc:
        logger.warning("get_my_participants failed: %s", exc)
        return []


@router.get("/workers")
async def list_org_workers(user: dict = Depends(get_current_user)):
    """Return all users (workers) in the coordinator's organisation."""
    _require_coordinator(user)
    org_id = user.get("organization_id")

    workers = _worker_membership_profiles(org_id)
    if workers:
        return workers

    supabase = get_supabase_admin()
    try:
        q = (
            supabase.table("users")
            .select("id, full_name, email, role, account_type")
            .in_("role", ["support_worker"])
        )
        if org_id:
            q = q.eq("organization_id", org_id)
        result = q.execute()
        return result.data or []
    except Exception as exc:
        logger.warning("list_org_workers failed: %s", exc)
        return []


# ---------------------------------------------------------------------------
# GET /assignments
# ---------------------------------------------------------------------------

@router.get("")
async def list_assignments(
    worker_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
):
    """List assignments.

    Coordinators and managing directors see all active assignments in their
    org (optionally narrowed to one worker via ?worker_id=, e.g. the staff
    profile "participants" view). Workers see only their own assignments.
    """
    if _ms.practitioner_allocations_table_missing:
        return []
    supabase = get_supabase_admin()
    org_id = user.get("organization_id")
    uid    = user.get("sub")
    org_wide = has_org_wide_access(user)

    try:
        q = supabase.table(TABLE).select("*").eq("is_active", "true")
        if org_wide:
            if org_id:
                q = q.eq("organization_id", org_id)
            if worker_id:
                q = q.eq("user_id", worker_id)
        else:
            q = q.eq("user_id", uid)
        result = q.execute()
        rows = result.data or []

        # Enrich with participant info
        patient_ids = list({r["patient_id"] for r in rows if r.get("patient_id")})
        if patient_ids:
            p_result = (
                supabase.table("patients")
                .select("id, full_name, ndis_number")
                .in_("id", patient_ids)
                .execute()
            )
            p_map = {r["id"]: r for r in (p_result.data or [])}
            for row in rows:
                pid = row.get("patient_id")
                row["participant"] = p_map.get(pid) if pid else None

        return rows
    except Exception as exc:
        logger.warning("list_assignments failed: %s", exc)
        return []


# ---------------------------------------------------------------------------
# POST /assignments
# ---------------------------------------------------------------------------

@router.post("", status_code=201)
async def create_assignment(body: AssignmentCreate, user: dict = Depends(get_current_user)):
    """Assign a participant to a worker. Coordinator-only."""
    _require_coordinator(user)

    if _ms.practitioner_allocations_table_missing:
        raise HTTPException(
            status_code=503,
            detail="Assignments table not yet created. Run supabase_setup.sql in Supabase SQL editor.",
        )

    role_type = body.role_type if body.role_type in _VALID_ROLE_TYPES else "support_worker"
    supabase  = get_supabase_admin()
    org_id    = user.get("organization_id")

    payload: dict = {
        "patient_id":     body.participant_id,
        "user_id":        body.worker_user_id,
        "allocated_role": role_type,
        "is_active":      True,
    }

    # Add org + assigner columns only when they exist (graceful migration)
    extra: dict = {}
    if org_id:
        extra["organization_id"] = org_id
    if user.get("sub"):
        extra["assigned_by"] = user["sub"]

    try:
        # Upsert on (patient_id, user_id) — re-activates a previously removed assignment
        result = (
            supabase.table(TABLE)
            .upsert({**payload, **extra}, on_conflict="patient_id,user_id")
            .execute()
        )
        if result.data:
            logger.info(
                "Assignment created: participant=%s worker=%s role=%s org=%s",
                body.participant_id[:8], body.worker_user_id[:8], role_type, org_id or "none",
            )
            return result.data[0]
        return payload
    except Exception as exc:
        err = str(exc)
        # If org/assigner columns don't exist yet, retry without them
        if ("assigned_by" in err or "organization_id" in err) and (
            "does not exist" in err or "42703" in err
        ):
            logger.info("Retrying assignment upsert without extra columns (migration pending)")
            try:
                result = (
                    supabase.table(TABLE)
                    .upsert(payload, on_conflict="patient_id,user_id")
                    .execute()
                )
                return result.data[0] if result.data else payload
            except Exception as exc2:
                logger.error("create_assignment retry failed: %s", exc2)
                raise HTTPException(status_code=400, detail=str(exc2))
        logger.error("create_assignment failed: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))


# ---------------------------------------------------------------------------
# DELETE /assignments/{id}
# ---------------------------------------------------------------------------

@router.delete("/{assignment_id}", status_code=204)
async def delete_assignment(assignment_id: str, user: dict = Depends(get_current_user)):
    """Deactivate an assignment. Coordinator-only."""
    _require_coordinator(user)
    supabase = get_supabase_admin()
    try:
        supabase.table(TABLE).update({"is_active": False}).eq("id", assignment_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
