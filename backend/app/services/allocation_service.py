"""CRUD service for practitioner_allocations — who is assigned to which participant."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, cast

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

TABLE = "practitioner_allocations"
USERS_TABLE = "users"


# ---------------------------------------------------------------------------
# SAFE HELPERS
# ---------------------------------------------------------------------------

def _safe_rows(data: Any) -> List[Dict[str, Any]]:
    """Normalize Supabase response data into list[dict]."""
    if not isinstance(data, list):
        return []

    return [
        cast(Dict[str, Any], row)
        for row in data
        if isinstance(row, dict)
    ]


# ---------------------------------------------------------------------------
# SERVICES
# ---------------------------------------------------------------------------

async def get_allocations_for_participant(participant_id: str) -> List[Dict[str, Any]]:
    """Return all allocations (active + inactive) for a participant, with user details."""
    try:
        supabase = get_supabase_admin()

        result = (
            supabase.table(TABLE)
            .select("*")
            .eq("patient_id", participant_id)
            .order("created_at", desc=True)
            .execute()
        )

        rows: List[Dict[str, Any]] = _safe_rows(result.data)

        if not rows:
            return []

        # Batch-fetch user details
        user_ids: List[str] = [
            str(r.get("user_id"))
            for r in rows
            if r.get("user_id")
        ]

        users_result = (
            supabase.table(USERS_TABLE)
            .select("id, email, full_name, role")
            .in_("id", user_ids)
            .execute()
        )

        users_rows: List[Dict[str, Any]] = _safe_rows(users_result.data)

        user_map: Dict[str, Dict[str, Any]] = {
            str(u.get("id")): u
            for u in users_rows
        }

        enriched_rows: List[Dict[str, Any]] = []

        for row in rows:
            allocation = dict(row)

            allocation["user"] = user_map.get(
                str(allocation.get("user_id")),
                {},
            )

            enriched_rows.append(allocation)

        return enriched_rows

    except Exception as exc:
        logger.warning(
            "get_allocations_for_participant(%s) failed: %s",
            participant_id,
            exc,
        )
        return []


async def get_allocations_for_user(user_id: str) -> List[Dict[str, Any]]:
    """Return all participants allocated to a given practitioner."""
    try:
        supabase = get_supabase_admin()

        result = (
            supabase.table(TABLE)
            .select("*")
            .eq("user_id", user_id)
            .eq("is_active", "true")
            .order("created_at", desc=True)
            .execute()
        )

        return _safe_rows(result.data)

    except Exception as exc:
        logger.warning(
            "get_allocations_for_user(%s) failed: %s",
            user_id,
            exc,
        )
        return []


async def create_allocation(
    participant_id: str,
    user_id: str,
    allocated_role: str = "support_worker",
    organization_id: Optional[str] = None,
    assigned_by: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Assign a practitioner to a participant (upserts on conflict)."""

    supabase = get_supabase_admin()

    payload: Dict[str, Any] = {
        "patient_id": participant_id,
        "user_id": user_id,
        "allocated_role": allocated_role,
        "is_active": True,
    }

    if organization_id:
        payload["organization_id"] = organization_id
    if assigned_by:
        payload["assigned_by"] = assigned_by

    try:
        result = (
            supabase.table(TABLE)
            .upsert(payload, on_conflict="patient_id,user_id")
            .execute()
        )

        rows: List[Dict[str, Any]] = _safe_rows(result.data)

        if not rows:
            return None

        return rows[0]

    except Exception as exc:
        logger.error(
            "create_allocation(%s, %s) failed: %s",
            participant_id,
            user_id,
            exc,
        )
        raise


async def deactivate_allocation(allocation_id: str) -> bool:
    """Soft-delete: set is_active = false."""

    supabase = get_supabase_admin()

    supabase.table(TABLE).update({
        "is_active": False
    }).eq("id", allocation_id).execute()

    return True


async def delete_allocation(allocation_id: str) -> bool:
    """Hard delete an allocation record."""

    supabase = get_supabase_admin()

    supabase.table(TABLE).delete().eq(
        "id",
        allocation_id,
    ).execute()

    return True