"""Business logic for participant (patient) CRUD and dashboard stats."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any, List, Optional

from .supabase_client import get_supabase_admin
from ..core.access import (
    ACCESS_METADATA_FIELDS,
    can_access_participant,
    is_coordinator,
    owner_payload,
)
from ..schemas.participant import NDISGoal, ParticipantCreate, ParticipantUpdate

logger = logging.getLogger(__name__)

TABLE = "patients"

# Default values injected into goal objects that pre-date the new schema so the
# frontend always receives a consistent shape.
_GOAL_DEFAULTS: dict[str, Any] = {
    "category": "general",
    "progress_percentage": 0,
    "target_date": None,
    "progress_history": [],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _strip_optional_columns(payload: dict) -> dict:
    """Remove columns that require manual DB migrations and may not exist yet.

    biological_sex — added via ALTER TABLE; guarded by migration_state flag
    set at startup after probing the live schema.
    """
    from . import migration_state

    if migration_state.biological_sex_column_missing:
        payload.pop("biological_sex", None)
    return payload


def _serialize_dates(payload: dict) -> dict:
    """Convert date objects to ISO strings so PostgREST accepts them."""
    for field in ("date_of_birth", "plan_start_date", "plan_end_date"):
        if payload.get(field):
            payload[field] = str(payload[field])
    return payload


def _normalize_goals(raw: Any) -> list:
    """Parse and backfill NDIS goals from a JSONB column value.

    • Handles raw JSON string (defensive fallback for old rows).
    • Backfills missing keys introduced by the NDISGoal schema migration so
      the frontend always receives a complete object.
    """
    if isinstance(raw, str) and raw:
        try:
            parsed = json.loads(raw)
            raw = parsed if isinstance(parsed, list) else []
        except Exception:
            raw = []

    if not isinstance(raw, list):
        return []

    normalized: list = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        goal = {**_GOAL_DEFAULTS, **item}
        # Ensure progress_history entries are also complete
        history = goal.get("progress_history") or []
        goal["progress_history"] = [
            {
                "date": h.get("date", ""),
                "percentage": h.get("percentage", 0),
                "note": h.get("note"),
            }
            for h in history
            if isinstance(h, dict)
        ]
        normalized.append(goal)
    return normalized


def _normalize(row: dict) -> dict:
    """Normalise a raw ``patients`` DB row for API responses."""
    if not row:
        return row
    out = dict(row)
    out["goals"] = _normalize_goals(out.get("goals"))
    out.setdefault("total_budget", 0.0)
    out.setdefault("used_budget", 0.0)
    out.setdefault("plan_status", "active")
    return out


def _access_select() -> str:
    return "*, organization_id, assigned_worker_id, allied_health_id, clinician_id, created_by, owner_user_id"


def _is_missing_column_error(exc: Exception) -> bool:
    err = str(exc)
    return "PGRST" in err or "does not exist" in err or "42703" in err


def _strip_access_columns(payload: dict) -> dict:
    return {k: v for k, v in payload.items() if k not in ACCESS_METADATA_FIELDS}


def _goals_to_jsonb(goals: Optional[List[NDISGoal]]) -> Optional[list]:
    """Serialise a list of NDISGoal Pydantic models to plain dicts for PostgREST.

    ``exclude_none=False`` is intentional — we want explicit ``null`` values
    stored so the column stays consistent rather than relying on _normalize
    defaults on every read.
    """
    if goals is None:
        return None
    return [g.model_dump() for g in goals]


# ---------------------------------------------------------------------------
# Service functions
# ---------------------------------------------------------------------------


async def get_all_participants(current_user: Optional[dict] = None) -> List[dict]:
    supabase = get_supabase_admin()
    try:
        result = (
            supabase.table(TABLE)
            .select(_access_select())
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        if not _is_missing_column_error(exc):
            raise
        result = (
            supabase.table(TABLE).select("*").order("created_at", desc=True).execute()
        )
    rows = result.data or []
    if current_user:
        rows = [r for r in rows if can_access_participant(r, current_user)]
    return [_normalize(r) for r in rows]


async def get_participant_by_id(
    participant_id: str, current_user: Optional[dict] = None
) -> Optional[dict]:
    if not participant_id:
        return None
    supabase = get_supabase_admin()
    try:
        try:
            result = (
                supabase.table(TABLE)
                .select(_access_select())
                .eq("id", participant_id)
                .execute()
            )
        except Exception as exc:
            if not _is_missing_column_error(exc):
                raise
            result = (
                supabase.table(TABLE).select("*").eq("id", participant_id).execute()
            )
        rows = result.data or []
        if not rows:
            return None
        if current_user and not can_access_participant(rows[0], current_user):
            return None
        return _normalize(rows[0])
    except Exception as exc:
        logger.warning("get_participant_by_id(%s) failed: %s", participant_id, exc)
        return None


async def create_participant(
    data: ParticipantCreate, current_user: Optional[dict] = None
) -> dict:
    supabase = get_supabase_admin()
    # exclude_none so we rely on DB/Pydantic defaults rather than sending nulls
    payload: dict = data.model_dump(exclude_none=True)
    payload.pop("address", None)
    payload = _strip_optional_columns(payload)
    payload = _serialize_dates(payload)

    # Serialize NDISGoal objects to plain dicts for JSONB
    if "goals" in payload:
        goals_raw = payload["goals"]
        payload["goals"] = (
            [g if isinstance(g, dict) else g.model_dump() for g in goals_raw]
            if goals_raw
            else []
        )

    if current_user:
        ownership = owner_payload(current_user)
        for key in (
            "created_by",
            "organization_id",
            "assigned_worker_id",
            "allied_health_id",
            "clinician_id",
        ):
            if key in ownership:
                payload[key] = ownership[key]

    try:
        result = supabase.table(TABLE).insert(payload).execute()
    except Exception as exc:
        if not _is_missing_column_error(exc) or not any(
            col in str(exc) for col in ACCESS_METADATA_FIELDS
        ):
            raise
        result = supabase.table(TABLE).insert(_strip_access_columns(payload)).execute()
    return _normalize(result.data[0]) if result.data else {}


async def update_participant(
    participant_id: str, data: ParticipantUpdate, current_user: Optional[dict] = None
) -> Optional[dict]:
    """Partial update — only sends fields that were explicitly set in the request."""
    supabase = get_supabase_admin()

    # exclude_unset so a PATCH with only {full_name} doesn't wipe every other field
    payload: dict = data.model_dump(exclude_unset=True)
    payload.pop("address", None)
    payload = _strip_optional_columns(payload)
    payload = _serialize_dates(payload)

    # Serialize NDISGoal objects to plain dicts for JSONB
    if "goals" in payload:
        goals_list = payload["goals"]
        if goals_list is None:
            payload.pop("goals")  # don't accidentally null out goals
        else:
            payload["goals"] = [
                g if isinstance(g, dict) else g.model_dump() for g in goals_list
            ]

    if not payload:
        # Nothing to update — return current record
        return await get_participant_by_id(participant_id, current_user)

    if current_user and not await get_participant_by_id(participant_id, current_user):
        return None

    result = supabase.table(TABLE).update(payload).eq("id", participant_id).execute()
    return _normalize(result.data[0]) if result.data else None


async def update_participant_goals(
    participant_id: str, goals: List[NDISGoal], current_user: Optional[dict] = None
) -> Optional[dict]:
    """Replace the entire goals list for a participant."""
    supabase = get_supabase_admin()
    if current_user and not await get_participant_by_id(participant_id, current_user):
        return None
    goals_data = _goals_to_jsonb(goals)
    result = (
        supabase.table(TABLE)
        .update({"goals": goals_data})
        .eq("id", participant_id)
        .execute()
    )
    if not result.data:
        return None
    return await get_participant_by_id(participant_id, current_user)


async def delete_participant(
    participant_id: str, current_user: Optional[dict] = None
) -> bool:
    supabase = get_supabase_admin()
    if current_user and (
        not is_coordinator(current_user)
        or not await get_participant_by_id(participant_id, current_user)
    ):
        return False
    supabase.table(TABLE).delete().eq("id", participant_id).execute()
    return True


async def get_dashboard_stats(current_user: Optional[dict] = None) -> dict:
    supabase = get_supabase_admin()
    week_ago = (datetime.utcnow() - timedelta(days=7)).date().isoformat()

    try:
        participants = (
            supabase.table(TABLE)
            .select(
                "id, plan_status, organization_id, assigned_worker_id, allied_health_id, clinician_id, created_by, owner_user_id"
            )
            .execute()
        )
        participant_data = participants.data or []
    except Exception:
        try:
            participants = supabase.table(TABLE).select("id").execute()
            participant_data = participants.data or []
        except Exception:
            participant_data = []

    if current_user:
        participant_data = [
            p for p in participant_data if can_access_participant(p, current_user)
        ]
    participant_ids = {p.get("id") for p in participant_data if p.get("id")}

    try:
        sessions_week = (
            supabase.table("sessions")
            .select("id, patient_id")
            .gte("session_date", week_ago)
            .execute()
        )
        week_rows = sessions_week.data or []
        if current_user:
            week_rows = [s for s in week_rows if s.get("patient_id") in participant_ids]
        sessions_this_week = len(week_rows)
    except Exception:
        sessions_this_week = 0

    try:
        sessions_all = (
            supabase.table("sessions").select("id, status, patient_id").execute()
        )
        session_rows = sessions_all.data or []
        if current_user:
            session_rows = [
                s for s in session_rows if s.get("patient_id") in participant_ids
            ]
        notes_missing = sum(1 for s in session_rows if s.get("status") == "draft")
    except Exception:
        notes_missing = 0

    try:
        alerts = supabase.table("alerts").select("id").eq("is_read", False).execute()
        compliance_alerts = len(alerts.data or [])
    except Exception:
        compliance_alerts = 0

    return {
        "total_participants": len(participant_data),
        "sessions_this_week": sessions_this_week,
        "notes_missing": notes_missing,
        "compliance_alerts": compliance_alerts,
        "active_participants": sum(
            1 for p in participant_data if p.get("plan_status") == "active"
        ),
    }
