"""Business logic for participant (patient) CRUD and dashboard stats."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any, List, Optional

from .supabase_client import get_supabase_admin
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
            {"date": h.get("date", ""), "percentage": h.get("percentage", 0), "note": h.get("note")}
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

async def get_all_participants(org_id: Optional[str] = None) -> List[dict]:
    supabase = get_supabase_admin()
    q = supabase.table(TABLE).select("*").order("created_at", desc=True)
    if org_id:
        q = q.eq("organization_id", org_id)
    result = q.execute()
    return [_normalize(r) for r in (result.data or [])]


async def get_participant_by_id(participant_id: str) -> Optional[dict]:
    if not participant_id:
        return None
    supabase = get_supabase_admin()
    try:
        result = supabase.table(TABLE).select("*").eq("id", participant_id).execute()
        rows = result.data or []
        return _normalize(rows[0]) if rows else None
    except Exception as exc:
        logger.warning("get_participant_by_id(%s) failed: %s", participant_id, exc)
        return None


async def create_participant(data: ParticipantCreate, org_id: Optional[str] = None) -> dict:
    from .pii_service import generate_pseudonym, encrypt_participant
    from datetime import date

    supabase = get_supabase_admin()
    # exclude_none so we rely on DB/Pydantic defaults rather than sending nulls
    payload: dict = data.model_dump(exclude_none=True)
    payload.pop("address", None)
    payload = _strip_optional_columns(payload)
    payload = _serialize_dates(payload)

    if org_id:
        payload["organization_id"] = org_id

    # Privacy Act 2026 — APP 2 Anonymity: auto-generate external pseudonym
    if not payload.get("external_pseudonym"):
        payload["external_pseudonym"] = generate_pseudonym()

    # Archives Act 1983 — auto-set 7-year disposal date from today
    if not payload.get("disposal_date"):
        today = date.today()
        disposal = today.replace(year=today.year + 7)
        payload["disposal_date"] = str(disposal)

    # Serialize NDISGoal objects to plain dicts for JSONB
    if "goals" in payload:
        goals_raw = payload["goals"]
        payload["goals"] = [
            g if isinstance(g, dict) else g.model_dump()
            for g in goals_raw
        ] if goals_raw else []

    # AES-256 GCM PII encryption (Privacy Act 2026 APP 11) — no-op when disabled
    payload = encrypt_participant(payload)

    result = supabase.table(TABLE).insert(payload).execute()
    return _normalize(result.data[0]) if result.data else {}


async def update_participant(participant_id: str, data: ParticipantUpdate) -> Optional[dict]:
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
            payload.pop("goals")           # don't accidentally null out goals
        else:
            payload["goals"] = [
                g if isinstance(g, dict) else g.model_dump()
                for g in goals_list
            ]

    if not payload:
        # Nothing to update — return current record
        return await get_participant_by_id(participant_id)

    result = supabase.table(TABLE).update(payload).eq("id", participant_id).execute()
    return _normalize(result.data[0]) if result.data else None


async def update_participant_goals(participant_id: str, goals: List[NDISGoal]) -> Optional[dict]:
    """Replace the entire goals list for a participant."""
    supabase = get_supabase_admin()
    goals_data = _goals_to_jsonb(goals)
    result = (
        supabase.table(TABLE)
        .update({"goals": goals_data})
        .eq("id", participant_id)
        .execute()
    )
    if not result.data:
        return None
    return await get_participant_by_id(participant_id)


async def delete_participant(participant_id: str) -> bool:
    supabase = get_supabase_admin()
    supabase.table(TABLE).delete().eq("id", participant_id).execute()
    return True


async def get_dashboard_stats() -> dict:
    supabase = get_supabase_admin()
    week_ago = (datetime.utcnow() - timedelta(days=7)).date().isoformat()

    try:
        participants = supabase.table(TABLE).select("id, plan_status").execute()
        participant_data = participants.data or []
    except Exception:
        try:
            participants = supabase.table(TABLE).select("id").execute()
            participant_data = participants.data or []
        except Exception:
            participant_data = []

    try:
        sessions_week = (
            supabase.table("sessions").select("id").gte("session_date", week_ago).execute()
        )
        sessions_this_week = len(sessions_week.data or [])
    except Exception:
        sessions_this_week = 0

    try:
        sessions_all = supabase.table("sessions").select("id, status").execute()
        notes_missing = sum(
            1 for s in (sessions_all.data or []) if s.get("status") == "draft"
        )
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


async def force_update_participant(participant_id: str, payload: dict) -> Optional[dict]:
    """Direct field-level update without Pydantic validation.

    Used by the PII purge endpoint and the retention cron to write
    de-identified values without triggering the full update pipeline.
    """
    supabase = get_supabase_admin()
    clean: dict = {}
    for k, v in payload.items():
        # Convert date/datetime objects to ISO strings for PostgREST
        if v is not None and hasattr(v, "isoformat"):
            clean[k] = v.isoformat()
        else:
            clean[k] = v
    try:
        result = supabase.table(TABLE).update(clean).eq("id", participant_id).execute()
        rows = result.data or []
        return _normalize(rows[0]) if rows else None
    except Exception as exc:
        logger.error("force_update_participant(%s) failed: %s", participant_id, exc)
        return None
