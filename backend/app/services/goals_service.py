"""CRUD service for ndis_goals — unified NDIS goals for all roles."""

from __future__ import annotations

import logging
from datetime import date as date_type, datetime, timezone
from typing import Any, List, Optional

from .supabase_client import get_supabase_admin
from ..services import funding_service

logger = logging.getLogger(__name__)

TABLE = "ndis_goals"

_CATEGORY_TO_GOAL_AREA: dict[str, str] = {
    "general": "daily_living",
    "daily_living": "daily_living",
    "community": "community",
    "health": "health",
    "social": "social",
    "employment": "employment",
    "other": "other",
}

_GOAL_AREA_TO_CATEGORY: dict[str, str] = {
    "daily_living": "general",
    "community": "community",
    "health": "health",
    "social": "social",
    "employment": "employment",
    "other": "other",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_rows(data: Any) -> List[dict]:
    """Ensure Supabase data is always a list of dicts."""
    if not isinstance(data, list):
        return []

    return [row for row in data if isinstance(row, dict)]


def _category_to_goal_area(category: str | None) -> str:
    key = (category or "general").strip().lower()
    return _CATEGORY_TO_GOAL_AREA.get(key, "daily_living")


def _goal_area_to_category(goal_area: str | None) -> str:
    key = (goal_area or "daily_living").strip().lower()
    return _GOAL_AREA_TO_CATEGORY.get(key, "general")


def _normalize(row: dict[str, Any]) -> dict[str, Any]:
    """Normalize ndis_goals row to worker-facing shape (no funding fields)."""
    out: dict[str, Any] = dict(row)

    target_date = out.get("target_date")
    if target_date and not isinstance(target_date, str):
        out["target_date"] = str(target_date)

    status = out.get("status") or "active"
    out["status"] = status
    out["is_achieved"] = status == "completed"
    out["category"] = _goal_area_to_category(out.get("goal_area"))
    out["priority"] = out.get("priority") if out.get("priority") is not None else 99
    out["why_it_matters"] = out.get("why_it_matters") or out.get("success_criteria")
    out["success_criteria"] = out.get("why_it_matters")  # API alias for UI
    out["worker_focus"] = out.get("worker_focus") if isinstance(out.get("worker_focus"), list) else []

    # Worker UI expects `title`; ndis_goals stores `name`.
    if not out.get("title"):
        out["title"] = out.get("name") or out.get("description") or ""

    if not out.get("description"):
        out["description"] = out.get("name") or out.get("title") or ""

    for _field in (
        "total_funding",
        "used_funding",
        "budget",
        "funding_amount",
        "plan_funding",
        "allocated_funding",
    ):
        out.pop(_field, None)

    return out


async def _participant_org_id(participant_id: str) -> Optional[str]:
    try:
        result = (
            get_supabase_admin()
            .table("participants")
            .select("organization_id")
            .eq("id", participant_id)
            .limit(1)
            .execute()
        )
        rows = _safe_rows(result.data)
        if not rows:
            return None
        org_id = rows[0].get("organization_id")
        return org_id if isinstance(org_id, str) else None
    except Exception as exc:
        logger.warning("_participant_org_id(%s) failed: %s", participant_id, exc)
        return None


def _apply_status_filter(query: Any, active_only: bool) -> Any:
    if active_only:
        return query.eq("status", "active")
    return query


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------

async def get_goals_for_participant(
    participant_id: str,
    active_only: bool = True,
) -> List[dict[str, Any]]:
    """Return NDIS goals for a participant, sorted by priority."""

    try:
        org_id = await _participant_org_id(participant_id)
        if not org_id:
            return []

        supabase = get_supabase_admin()
        query = (
            supabase
            .table(TABLE)
            .select("*")
            .eq("participant_id", participant_id)
            .eq("organization_id", org_id)
        )
        query = _apply_status_filter(query, active_only)

        result = (
            query
            .order("priority", desc=False)
            .order("created_at")
            .execute()
        )

        return [_normalize(row) for row in _safe_rows(result.data)]

    except Exception as exc:
        logger.warning(
            "get_goals_for_participant(%s) failed: %s",
            participant_id,
            exc,
        )
        return []


async def get_goals_for_plan(
    plan_id: str,
    active_only: bool = False,
) -> List[dict[str, Any]]:
    """Return goals linked to a plan, sorted by priority."""

    try:
        supabase = get_supabase_admin()
        query = (
            supabase
            .table(TABLE)
            .select("*")
            .eq("plan_id", plan_id)
        )
        query = _apply_status_filter(query, active_only)

        result = (
            query
            .order("priority", desc=False)
            .order("created_at")
            .execute()
        )

        return [_normalize(row) for row in _safe_rows(result.data)]

    except Exception as exc:
        logger.warning(
            "get_goals_for_plan(%s) failed: %s",
            plan_id,
            exc,
        )
        return []


def fetch_active_goals_for_shift(
    participant_id: str,
    organization_id: str,
) -> list[dict[str, Any]]:
    """Sync helper for shift briefings — active goals only."""
    return fetch_active_goals_map_for_participants(
        [participant_id],
        organization_id,
    ).get(str(participant_id), [])


def fetch_active_goals_map_for_participants(
    participant_ids: list[str],
    organization_id: str,
) -> dict[str, list[dict[str, Any]]]:
    """Batch-fetch active goals formatted for shift cards (single query)."""
    ids = [str(pid) for pid in participant_ids if pid]
    if not ids or not organization_id:
        return {}

    try:
        goals_resp = (
            get_supabase_admin()
            .table(TABLE)
            .select("id, participant_id, name, description, goal_area, status, priority, worker_focus")
            .in_("participant_id", ids)
            .eq("organization_id", organization_id)
            .eq("status", "active")
            .order("priority", desc=False)
            .order("created_at")
            .execute()
        )
        grouped: dict[str, list[dict[str, Any]]] = {pid: [] for pid in ids}
        for row in goals_resp.data or []:
            if not isinstance(row, dict):
                continue
            pid = str(row.get("participant_id") or "")
            if pid not in grouped:
                continue
            normalized = _normalize(row)
            grouped[pid].append({
                "id": normalized.get("id"),
                "title": normalized.get("title") or "",
                "description": normalized.get("description") or "",
                "category": normalized.get("category") or "general",
                "priority": normalized.get("priority"),
                "worker_focus": normalized.get("worker_focus") or [],
            })
        return grouped
    except Exception as exc:
        logger.debug("fetch_active_goals_map_for_participants failed: %s", exc)
        return {pid: [] for pid in ids}


async def get_goals_map_for_participants(
    participant_ids: list[str],
    active_only: bool = False,
) -> dict[str, list[dict[str, Any]]]:
    """Batch-fetch goals for many participants (single query)."""
    ids = [str(pid) for pid in participant_ids if pid]
    if not ids:
        return {}

    try:
        supabase = get_supabase_admin()
        query = (
            supabase
            .table(TABLE)
            .select("*")
            .in_("participant_id", ids)
        )
        query = _apply_status_filter(query, active_only)
        result = (
            query
            .order("priority", desc=False)
            .order("created_at")
            .execute()
        )
        grouped: dict[str, list[dict[str, Any]]] = {pid: [] for pid in ids}
        for row in _safe_rows(result.data):
            pid = str(row.get("participant_id") or "")
            if pid in grouped:
                grouped[pid].append(_normalize(row))
        return grouped
    except Exception as exc:
        logger.warning("get_goals_map_for_participants failed: %s", exc)
        return {pid: [] for pid in ids}


async def enrich_participant(
    participant: dict[str, Any],
    *,
    active_only: bool = True,
) -> dict[str, Any]:
    """Attach ndis_goals to a participant dict (replaces legacy patients.goals JSONB)."""
    pid = str(participant.get("id") or "")
    if not pid:
        return {**participant, "goals": []}
    goals = await get_goals_for_participant(pid, active_only=active_only)
    return {**participant, "goals": goals}


async def enrich_participants(
    participants: list[dict[str, Any]],
    *,
    active_only: bool = False,
) -> list[dict[str, Any]]:
    """Attach ndis_goals to each participant in a list."""
    if not participants:
        return []
    ids = [str(p.get("id") or "") for p in participants if p.get("id")]
    goals_map = await get_goals_map_for_participants(ids, active_only=active_only)
    return [
        {**p, "goals": goals_map.get(str(p.get("id") or ""), [])}
        for p in participants
    ]


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

async def create_goal(
    participant_id: str,
    description: str,
    category: str = "general",
    goal_code: Optional[str] = None,
    target_date: Optional[date_type] = None,
    *,
    title: Optional[str] = None,
    why_it_matters: Optional[str] = None,
    worker_focus: Optional[list[str]] = None,
    priority: int = 99,
) -> Optional[dict[str, Any]]:
    """Create an NDIS goal for a participant."""

    plan = await funding_service.get_plan_for_participant(participant_id)
    plan_id = plan.get("id") if isinstance(plan, dict) else None

    org_id = await _participant_org_id(participant_id)
    if not org_id:
        raise ValueError(f"Participant {participant_id} not found or missing organization")

    now = datetime.now(timezone.utc).isoformat()
    name = (title or description or "Untitled goal").strip()

    payload: dict[str, Any] = {
        "participant_id": participant_id,
        "organization_id": org_id,
        "plan_id": plan_id,
        "name": name,
        "goal_area": _category_to_goal_area(category),
        "description": description,
        "why_it_matters": why_it_matters,
        "worker_focus": worker_focus or [],
        "priority": priority,
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }

    if target_date:
        payload["target_date"] = str(target_date)

    if goal_code:
        payload["description"] = f"[{goal_code}] {description}".strip()

    result = (
        get_supabase_admin()
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
    """Update an NDIS goal."""

    supabase = get_supabase_admin()
    clean: dict[str, Any] = {}

    for key, value in updates.items():
        if value is None:
            continue
        if key == "is_achieved":
            clean["status"] = "completed" if value else "active"
            if value:
                clean["completed_at"] = datetime.now(timezone.utc).isoformat()
            continue
        if key == "title":
            clean["name"] = value
            continue
        if key == "category":
            clean["goal_area"] = _category_to_goal_area(str(value))
            continue
        clean[key] = value

    if "target_date" in clean and clean["target_date"]:
        clean["target_date"] = str(clean["target_date"])

    clean["updated_at"] = datetime.now(timezone.utc).isoformat()

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
        (
            get_supabase_admin()
            .table(TABLE)
            .delete()
            .eq("id", goal_id)
            .execute()
        )
        return True
    except Exception as exc:
        logger.warning("delete_goal(%s) failed: %s", goal_id, exc)
        return False


# ---------------------------------------------------------------------------
# Goal completion
# ---------------------------------------------------------------------------

async def mark_goal_achieved(
    goal_id: str,
    achieved: bool = True,
) -> Optional[dict[str, Any]]:
    """Mark goal as completed/active."""

    updates: dict[str, Any] = {"is_achieved": achieved}
    if achieved:
        updates["completed_at"] = datetime.now(timezone.utc).isoformat()
    return await update_goal(goal_id, updates)
