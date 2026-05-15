"""CRUD service for practitioner_allocations — who is assigned to which participant."""

from __future__ import annotations

import logging
from typing import Optional, List

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

TABLE = "practitioner_allocations"
USERS_TABLE = "users"


async def get_allocations_for_participant(participant_id: str) -> List[dict]:
    """Return all allocations (active + inactive) for a participant, with user details."""
    try:
        supabase = get_supabase_admin()
        result = (
            supabase.table(TABLE)
            .select("*")
            .eq("patient_id", participant_id)
            .order("assigned_at", desc=True)
            .execute()
        )
        rows = result.data or []
        if not rows:
            return []
        # Batch-fetch user details (avoid PostgREST join; two-query pattern)
        user_ids = list({r["user_id"] for r in rows})
        users_result = (
            supabase.table(USERS_TABLE)
            .select("id, email, full_name, role")
            .in_("id", user_ids)
            .execute()
        )
        user_map = {u["id"]: u for u in (users_result.data or [])}
        for row in rows:
            row["user"] = user_map.get(row["user_id"], {})
        return rows
    except Exception as exc:
        logger.warning("get_allocations_for_participant(%s) failed: %s", participant_id, exc)
        return []


async def get_allocations_for_user(user_id: str) -> List[dict]:
    """Return all participants allocated to a given practitioner."""
    try:
        supabase = get_supabase_admin()
        result = (
            supabase.table(TABLE)
            .select("*")
            .eq("user_id", user_id)
            .eq("is_active", True)
            .order("assigned_at", desc=True)
            .execute()
        )
        return result.data or []
    except Exception as exc:
        logger.warning("get_allocations_for_user(%s) failed: %s", user_id, exc)
        return []


async def create_allocation(
    participant_id: str,
    user_id: str,
    allocated_role: str = "support_worker",
) -> Optional[dict]:
    """Assign a practitioner to a participant (upserts on conflict)."""
    supabase = get_supabase_admin()
    payload = {
        "patient_id": participant_id,
        "user_id": user_id,
        "allocated_role": allocated_role,
        "is_active": True,
    }
    # Upsert: update role + is_active if the pair already exists
    try:
        result = (
            supabase.table(TABLE)
            .upsert(payload, on_conflict="patient_id,user_id")
            .execute()
        )
        return result.data[0] if result.data else None
    except Exception as exc:
        logger.error("create_allocation(%s, %s) failed: %s", participant_id, user_id, exc)
        raise


async def deactivate_allocation(allocation_id: str) -> bool:
    """Soft-delete: set is_active = false."""
    supabase = get_supabase_admin()
    supabase.table(TABLE).update({"is_active": False}).eq("id", allocation_id).execute()
    return True


async def delete_allocation(allocation_id: str) -> bool:
    """Hard delete an allocation record."""
    supabase = get_supabase_admin()
    supabase.table(TABLE).delete().eq("id", allocation_id).execute()
    return True
