from typing import List, Optional
from .supabase_client import get_supabase_admin
from ..schemas.participant import ParticipantCreate, ParticipantUpdate
import logging
import json

logger = logging.getLogger(__name__)

TABLE = "patients"


async def get_all_participants() -> List[dict]:
    supabase = get_supabase_admin()
    result = supabase.table(TABLE).select("*").order("created_at", desc=True).execute()
    rows = result.data or []
    return [_normalize(r) for r in rows]


async def get_participant_by_id(participant_id: str) -> Optional[dict]:
    supabase = get_supabase_admin()
    if not participant_id:
        return None
    try:
        result = supabase.table(TABLE).select("*").eq("id", participant_id).execute()
        rows = result.data or []
        return _normalize(rows[0]) if rows else None
    except Exception as e:
        logger.warning(f"get_participant_by_id({participant_id}) failed: {e}")
        return None


def _strip_missing_columns(payload: dict) -> dict:
    """Remove fields that don't yet exist in the DB so saves never fail silently.

    biological_sex is guarded here because the column requires a manual
    ALTER TABLE migration that may not have been run yet.  When the column is
    absent PostgREST returns 42703; we detect that at startup and set
    migration_state.biological_sex_column_missing so we can skip the field
    proactively.
    """
    from . import migration_state
    if migration_state.biological_sex_column_missing:
        payload.pop("biological_sex", None)
    return payload


async def create_participant(data: ParticipantCreate) -> dict:
    supabase = get_supabase_admin()
    payload = data.model_dump(exclude_none=True)

    # Remove fields that don't exist in the actual DB table
    payload.pop("address", None)
    payload = _strip_missing_columns(payload)

    # Date fields must be ISO strings
    for date_field in ("date_of_birth", "plan_start_date", "plan_end_date"):
        if date_field in payload and payload[date_field]:
            payload[date_field] = str(payload[date_field])

    # goals is JSONB — pass the list directly so PostgREST stores it as a proper
    # JSONB array, not as a quoted JSON string.
    if "goals" in payload and payload["goals"] is None:
        payload.pop("goals")

    result = supabase.table(TABLE).insert(payload).execute()
    return _normalize(result.data[0]) if result.data else {}


async def update_participant(participant_id: str, data: ParticipantUpdate) -> Optional[dict]:
    supabase = get_supabase_admin()
    payload = {k: v for k, v in data.model_dump().items() if v is not None}
    payload.pop("address", None)
    payload = _strip_missing_columns(payload)
    for date_field in ("date_of_birth", "plan_start_date", "plan_end_date"):
        if date_field in payload and payload[date_field]:
            payload[date_field] = str(payload[date_field])
    # goals is JSONB — pass the list directly so PostgREST stores it as a proper
    # JSONB array, not as a quoted JSON string.
    result = supabase.table(TABLE).update(payload).eq("id", participant_id).execute()
    return _normalize(result.data[0]) if result.data else None


async def delete_participant(participant_id: str) -> bool:
    supabase = get_supabase_admin()
    supabase.table(TABLE).delete().eq("id", participant_id).execute()
    return True


async def get_dashboard_stats() -> dict:
    supabase = get_supabase_admin()
    from datetime import datetime, timedelta
    week_ago = (datetime.utcnow() - timedelta(days=7)).isoformat()

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
        sessions_week = supabase.table("sessions").select("id").gte("session_date", week_ago[:10]).execute()
        sessions_this_week = len(sessions_week.data or [])
    except Exception:
        sessions_this_week = 0

    try:
        sessions_all = supabase.table("sessions").select("id, status").execute()
        all_sessions = sessions_all.data or []
        notes_missing = sum(1 for s in all_sessions if s.get("status") == "draft")
    except Exception:
        all_sessions = []
        notes_missing = 0

    try:
        alerts = supabase.table("alerts").select("id").eq("is_read", False).execute()
        compliance_alerts = len(alerts.data or [])
    except Exception:
        compliance_alerts = 0

    total_participants = len(participant_data)

    return {
        "total_participants": total_participants,
        "sessions_this_week": sessions_this_week,
        "notes_missing": notes_missing,
        "compliance_alerts": compliance_alerts,
        "active_participants": sum(1 for p in participant_data if p.get("plan_status") == "active"),
    }


def _normalize(row: dict) -> dict:
    """Normalise a patients row for API responses.

    After the NDISGoal migration all goals are stored as {id, title, status}
    objects in the JSONB column. This function only needs to parse the value if
    it arrives as a raw JSON string (defensive fallback) and fill in default
    values for nullable numeric/status fields.
    """
    if not row:
        return row
    out = dict(row)

    goals = out.get("goals")
    if isinstance(goals, str) and goals:
        try:
            parsed = json.loads(goals)
            out["goals"] = parsed if isinstance(parsed, list) else []
        except Exception:
            out["goals"] = []
    elif not isinstance(goals, list):
        out["goals"] = []

    if out.get("total_budget") is None:
        out["total_budget"] = 0.0
    if out.get("used_budget") is None:
        out["used_budget"] = 0.0
    if out.get("plan_status") is None:
        out["plan_status"] = "active"
    return out
