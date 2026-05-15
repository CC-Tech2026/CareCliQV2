"""CRUD service for patient_goals — NDIS plan-linked goals."""

from __future__ import annotations

import logging
from typing import Optional, List
from datetime import date as date_type

from .supabase_client import get_supabase_admin
from ..services import funding_service

logger = logging.getLogger(__name__)

TABLE = "patient_goals"


def _normalize(row: dict) -> dict:
    out = dict(row)
    if out.get("target_date") and not isinstance(out["target_date"], str):
        out["target_date"] = str(out["target_date"])
    out.setdefault("is_achieved", False)
    out.setdefault("category", "general")
    return out


async def get_goals_for_participant(participant_id: str) -> List[dict]:
    """Return all patient_goals for the participant's active NDIS plan."""
    try:
        plan = await funding_service.get_plan_for_participant(participant_id)
        if not plan:
            return []
        supabase = get_supabase_admin()
        result = (
            supabase.table(TABLE)
            .select("*")
            .eq("plan_id", plan["id"])
            .order("created_at")
            .execute()
        )
        return [_normalize(r) for r in (result.data or [])]
    except Exception as exc:
        logger.warning("get_goals_for_participant(%s) failed: %s", participant_id, exc)
        return []


async def get_goals_for_plan(plan_id: str) -> List[dict]:
    """Return all goals for a specific NDIS plan."""
    try:
        supabase = get_supabase_admin()
        result = (
            supabase.table(TABLE)
            .select("*")
            .eq("plan_id", plan_id)
            .order("created_at")
            .execute()
        )
        return [_normalize(r) for r in (result.data or [])]
    except Exception as exc:
        logger.warning("get_goals_for_plan(%s) failed: %s", plan_id, exc)
        return []


async def create_goal(
    participant_id: str,
    description: str,
    category: str = "general",
    goal_code: Optional[str] = None,
    target_date: Optional[date_type] = None,
) -> Optional[dict]:
    """Create a new goal linked to the participant's active plan."""
    plan = await funding_service.get_plan_for_participant(participant_id)
    if not plan:
        raise ValueError(f"No active NDIS plan found for participant {participant_id}")

    supabase = get_supabase_admin()
    payload: dict = {
        "plan_id": plan["id"],
        "description": description,
        "category": category,
        "is_achieved": False,
    }
    if goal_code:
        payload["goal_code"] = goal_code
    if target_date:
        payload["target_date"] = str(target_date)

    result = supabase.table(TABLE).insert(payload).execute()
    return _normalize(result.data[0]) if result.data else None


async def update_goal(goal_id: str, updates: dict) -> Optional[dict]:
    """Partial update on a patient_goal row."""
    supabase = get_supabase_admin()
    clean: dict = {k: v for k, v in updates.items() if v is not None}
    if "target_date" in clean and clean["target_date"]:
        clean["target_date"] = str(clean["target_date"])

    result = supabase.table(TABLE).update(clean).eq("id", goal_id).execute()
    return _normalize(result.data[0]) if result.data else None


async def delete_goal(goal_id: str) -> bool:
    supabase = get_supabase_admin()
    supabase.table(TABLE).delete().eq("id", goal_id).execute()
    return True


async def mark_goal_achieved(goal_id: str, achieved: bool = True) -> Optional[dict]:
    return await update_goal(goal_id, {"is_achieved": achieved})
