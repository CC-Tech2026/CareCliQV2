"""CRUD service for patient_goals — NDIS plan-linked goals."""

from __future__ import annotations

import logging
from datetime import date as date_type
from typing import Any, List, Optional

from .supabase_client import get_supabase_admin
from ..services import funding_service

logger = logging.getLogger(__name__)

TABLE = "patient_goals"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_rows(data: Any) -> List[dict]:
    """Ensure Supabase data is always a list of dicts."""
    if not isinstance(data, list):
        return []

    return [row for row in data if isinstance(row, dict)]


def _safe_row(data: Any) -> Optional[dict]:
    """Ensure row is a dict."""
    return data if isinstance(data, dict) else None


def _normalize(row: dict[str, Any]) -> dict[str, Any]:
    """Normalize goal row."""
    out: dict[str, Any] = dict(row)

    target_date = out.get("target_date")

    if target_date and not isinstance(target_date, str):
        out["target_date"] = str(target_date)

    out.setdefault("is_achieved", False)
    out.setdefault("category", "general")

    return out


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------

async def get_goals_for_participant(
    participant_id: str,
) -> List[dict[str, Any]]:
    """Return all goals for participant active plan."""

    try:
        plan = await funding_service.get_plan_for_participant(
            participant_id
        )

        if not isinstance(plan, dict):
            return []

        plan_id = plan.get("id")

        if not isinstance(plan_id, str):
            return []

        supabase = get_supabase_admin()

        result = (
            supabase
            .table(TABLE)
            .select("*")
            .eq("plan_id", plan_id)
            .order("created_at")
            .execute()
        )

        rows = _safe_rows(result.data)

        return [_normalize(row) for row in rows]

    except Exception as exc:
        logger.warning(
            "get_goals_for_participant(%s) failed: %s",
            participant_id,
            exc,
        )

        return []


async def get_goals_for_plan(
    plan_id: str,
) -> List[dict[str, Any]]:
    """Return all goals for a plan."""

    try:
        supabase = get_supabase_admin()

        result = (
            supabase
            .table(TABLE)
            .select("*")
            .eq("plan_id", plan_id)
            .order("created_at")
            .execute()
        )

        rows = _safe_rows(result.data)

        return [_normalize(row) for row in rows]

    except Exception as exc:
        logger.warning(
            "get_goals_for_plan(%s) failed: %s",
            plan_id,
            exc,
        )

        return []


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

async def create_goal(
    participant_id: str,
    description: str,
    category: str = "general",
    goal_code: Optional[str] = None,
    target_date: Optional[date_type] = None,
) -> Optional[dict[str, Any]]:
    """Create goal for participant active plan."""

    plan = await funding_service.get_plan_for_participant(
        participant_id
    )

    if not isinstance(plan, dict):
        raise ValueError(
            f"No active NDIS plan found for participant {participant_id}"
        )

    plan_id = plan.get("id")

    if not isinstance(plan_id, str):
        raise ValueError(
            f"Invalid plan ID for participant {participant_id}"
        )

    supabase = get_supabase_admin()

    payload: dict[str, Any] = {
        "plan_id": plan_id,
        "description": description,
        "category": category,
        "is_achieved": False,
    }

    if goal_code:
        payload["goal_code"] = goal_code

    if target_date:
        payload["target_date"] = str(target_date)

    result = (
        supabase
        .table(TABLE)
        .insert(payload)
        .execute()
    )

    rows = _safe_rows(result.data)

    if not rows:
        return None

    return _normalize(rows[0])


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

async def update_goal(
    goal_id: str,
    updates: dict[str, Any],
) -> Optional[dict[str, Any]]:
    """Update patient goal."""

    supabase = get_supabase_admin()

    clean: dict[str, Any] = {
        key: value
        for key, value in updates.items()
        if value is not None
    }

    if (
        "target_date" in clean
        and clean["target_date"]
    ):
        clean["target_date"] = str(
            clean["target_date"]
        )

    result = (
        supabase
        .table(TABLE)
        .update(clean)
        .eq("id", goal_id)
        .execute()
    )

    rows = _safe_rows(result.data)

    if not rows:
        return None

    return _normalize(rows[0])


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

async def delete_goal(goal_id: str) -> bool:
    """Delete goal by ID."""

    try:
        supabase = get_supabase_admin()

        (
            supabase
            .table(TABLE)
            .delete()
            .eq("id", goal_id)
            .execute()
        )

        return True

    except Exception as exc:
        logger.warning(
            "delete_goal(%s) failed: %s",
            goal_id,
            exc,
        )

        return False


# ---------------------------------------------------------------------------
# Goal completion
# ---------------------------------------------------------------------------

async def mark_goal_achieved(
    goal_id: str,
    achieved: bool = True,
) -> Optional[dict[str, Any]]:
    """Mark goal as achieved/unachieved."""

    return await update_goal(
        goal_id,
        {
            "is_achieved": achieved,
        },
    )