"""Business logic for participant (patient) CRUD and dashboard stats."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional

from .supabase_client import get_supabase_admin

from ..core.access import (
    ACCESS_METADATA_FIELDS,
    can_access_participant,
    is_coordinator,
    owner_payload,
    user_id,
    organization_id,
)

from ..schemas.participant import (
    NDISGoal,
    ParticipantCreate,
    ParticipantUpdate,
)

from .access_log_service import (
    log_participant_read,
    log_security_event,
)

logger = logging.getLogger(__name__)

TABLE = "patients"

# Default values injected into goal objects that pre-date the new schema
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
    """Remove columns that may not exist yet."""
    from . import migration_state

    if migration_state.biological_sex_column_missing:
        payload.pop("biological_sex", None)

    return payload


def _serialize_dates(payload: dict) -> dict:
    """Convert date objects to ISO strings."""
    for field in (
        "date_of_birth",
        "plan_start_date",
        "plan_end_date",
    ):
        if payload.get(field):
            payload[field] = str(payload[field])

    return payload


def _normalize_goals(raw: Any) -> list:
    """Normalize goals JSONB."""

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
    """Normalize patient row."""

    if not row:
        return row

    out = dict(row)

    out["goals"] = _normalize_goals(out.get("goals"))

    out.setdefault("total_budget", 0.0)
    out.setdefault("used_budget", 0.0)
    out.setdefault("plan_status", "active")

    return out


def _access_select() -> str:
    return """
        *,
        organization_id,
        assigned_worker_id,
        allied_health_id,
        clinician_id,
        created_by,
        owner_user_id
    """


def _is_missing_column_error(exc: Exception) -> bool:
    err = str(exc)

    return (
        "PGRST" in err
        or "does not exist" in err
        or "42703" in err
    )


def _strip_access_columns(payload: dict) -> dict:
    return {
        k: v
        for k, v in payload.items()
        if k not in ACCESS_METADATA_FIELDS
    }


def _goals_to_jsonb(
    goals: Optional[List[NDISGoal]],
) -> Optional[list]:
    """Convert Pydantic models to JSONB."""

    if goals is None:
        return None

    return [g.model_dump() for g in goals]


# ---------------------------------------------------------------------------
# Service functions
# ---------------------------------------------------------------------------


async def get_all_participants(
    current_user: Optional[dict] = None,
) -> List[dict]:

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
            supabase.table(TABLE)
            .select("*")
            .order("created_at", desc=True)
            .execute()
        )

    rows: List[dict] = [
        r for r in (result.data or [])
        if isinstance(r, dict)
    ]

    logger.warning("TOTAL PARTICIPANTS => %s", len(rows))
    logger.warning("CURRENT USER => %s", current_user)

    filtered_rows: List[dict] = []

    for row in rows:

        logger.warning(
            "PARTICIPANT => id=%s org=%s assigned=%s allied=%s created_by=%s owner=%s",
            row.get("id"),
            row.get("organization_id"),
            row.get("assigned_worker_id"),
            row.get("allied_health_id"),
            row.get("created_by"),
            row.get("owner_user_id"),
        )

        # TEMP DEBUG
        allowed = can_access_participant(row, current_user)

        logger.warning(
            "ACCESS RESULT => participant=%s allowed=%s user_org=%s row_org=%s",
            row.get("id"),
            allowed,
            organization_id(current_user),
            row.get("organization_id"),
        )

        # TEMPORARY DEBUG BYPASS
        # Uncomment this to test if access logic is the issue
        # allowed = True

        if not allowed:

            await log_security_event(
                event_type="unauthorized_access",
                description="Unauthorized participant list access attempt",
                accessor_id=user_id(current_user),
                participant_id=str(row.get("id")),
                organization_id=organization_id(current_user),
                severity="medium",
            )

            continue

        participant_id = str(row.get("id"))

        await log_participant_read(
            participant_id,
            user_id=user_id(current_user),
            organization_id=organization_id(current_user),
            purpose="Participant List Access",
        )

        filtered_rows.append(row)

    logger.warning(
        "FILTERED PARTICIPANTS => %s",
        len(filtered_rows),
    )

    return [_normalize(r) for r in filtered_rows]


async def get_participant_by_id(
    participant_id: str,
    current_user: Optional[dict] = None,
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
                supabase.table(TABLE)
                .select("*")
                .eq("id", participant_id)
                .execute()
            )

        rows: List[dict] = [
            r for r in (result.data or [])
            if isinstance(r, dict)
        ]

        if not rows:
            return None

        participant = rows[0]

        allowed = (
            can_access_participant(participant, current_user)
            if current_user
            else False
        )

        logger.warning(
            "GET PARTICIPANT ACCESS => participant=%s allowed=%s",
            participant_id,
            allowed,
        )

        if not allowed:

            await log_security_event(
                event_type="unauthorized_access",
                description="Unauthorized participant record access",
                accessor_id=user_id(current_user),
                participant_id=participant_id,
                organization_id=organization_id(current_user),
                severity="high",
            )

            return None

        await log_participant_read(
            participant_id,
            user_id=user_id(current_user),
            organization_id=organization_id(current_user),
            purpose="Participant Record Access",
        )

        return _normalize(participant)

    except Exception as exc:

        logger.exception(
            "get_participant_by_id(%s) failed",
            participant_id,
        )

        return None


async def create_participant(
    data: ParticipantCreate,
    current_user: Optional[dict] = None,
) -> Optional[dict]:

    supabase = get_supabase_admin()

    payload: dict = data.model_dump(exclude_none=True)

    payload.pop("address", None)

    payload = _strip_optional_columns(payload)
    payload = _serialize_dates(payload)

    if "goals" in payload:

        goals_raw = payload["goals"]

        payload["goals"] = (
            [
                g if isinstance(g, dict)
                else g.model_dump()
                for g in goals_raw
            ]
            if goals_raw
            else []
        )

    # ownership metadata
    if current_user:

        ownership = owner_payload(current_user)

        logger.warning(
            "OWNERSHIP PAYLOAD => %s",
            ownership,
        )

        for key in (
            "created_by",
            "organization_id",
            "assigned_worker_id",
            "allied_health_id",
            "clinician_id",
            "owner_user_id",
        ):
            if key in ownership:
                payload[key] = ownership[key]

    logger.warning("CREATE PAYLOAD => %s", payload)

    try:

        result = (
            supabase.table(TABLE)
            .insert(payload)
            .execute()
        )

    except Exception as exc:

        logger.exception("CREATE PARTICIPANT FAILED")

        if not _is_missing_column_error(exc):
            raise

        result = (
            supabase.table(TABLE)
            .insert(_strip_access_columns(payload))
            .execute()
        )

    rows: List[dict] = [
        r for r in (result.data or [])
        if isinstance(r, dict)
    ]

    if not rows:
        return None

    return _normalize(rows[0])


async def update_participant(
    participant_id: str,
    data: ParticipantUpdate,
    current_user: Optional[dict] = None,
) -> Optional[dict]:

    supabase = get_supabase_admin()

    payload: dict = data.model_dump(exclude_unset=True)

    payload.pop("address", None)

    payload = _strip_optional_columns(payload)
    payload = _serialize_dates(payload)

    if "goals" in payload:

        goals_list = payload["goals"]

        if goals_list is None:
            payload.pop("goals")

        else:
            payload["goals"] = [
                g if isinstance(g, dict)
                else g.model_dump()
                for g in goals_list
            ]

    if not payload:
        return await get_participant_by_id(
            participant_id,
            current_user,
        )

    if current_user:

        existing = await get_participant_by_id(
            participant_id,
            current_user,
        )

        if not existing:
            return None

    result = (
        supabase.table(TABLE)
        .update(payload)
        .eq("id", participant_id)
        .execute()
    )

    rows: List[dict] = [
        r for r in (result.data or [])
        if isinstance(r, dict)
    ]

    if not rows:
        return None

    return _normalize(rows[0])


async def update_participant_goals(
    participant_id: str,
    goals: List[NDISGoal],
    current_user: Optional[dict] = None,
) -> Optional[dict]:

    supabase = get_supabase_admin()

    if current_user:

        existing = await get_participant_by_id(
            participant_id,
            current_user,
        )

        if not existing:
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

    return await get_participant_by_id(
        participant_id,
        current_user,
    )


async def delete_participant(
    participant_id: str,
    current_user: Optional[dict] = None,
) -> bool:

    supabase = get_supabase_admin()

    if current_user:

        if not is_coordinator(current_user):
            return False

        existing = await get_participant_by_id(
            participant_id,
            current_user,
        )

        if not existing:
            return False

    supabase.table(TABLE).delete().eq(
        "id",
        participant_id,
    ).execute()

    return True


async def get_dashboard_stats(
    current_user: Optional[dict] = None,
) -> dict:

    supabase = get_supabase_admin()

    week_ago = (
        datetime.now(timezone.utc) - timedelta(days=7)
    ).date().isoformat()

    try:

        participants = (
            supabase.table(TABLE)
            .select(
                """
                id,
                plan_status,
                organization_id,
                assigned_worker_id,
                allied_health_id,
                clinician_id,
                created_by,
                owner_user_id
                """
            )
            .execute()
        )

        participant_data: List[dict] = [
            p for p in (participants.data or [])
            if isinstance(p, dict)
        ]

    except Exception:

        participant_data = []

    if current_user:

        participant_data = [
            p
            for p in participant_data
            if can_access_participant(p, current_user)
        ]

    participant_ids = {
        p.get("id")
        for p in participant_data
        if p.get("id")
    }

    try:

        sessions_week = (
            supabase.table("sessions")
            .select("id, patient_id")
            .gte("session_date", week_ago)
            .execute()
        )

        week_rows: List[dict] = [
            s for s in (sessions_week.data or [])
            if isinstance(s, dict)
        ]

        if current_user:
            week_rows = [
                s
                for s in week_rows
                if s.get("patient_id") in participant_ids
            ]

        sessions_this_week = len(week_rows)

    except Exception:

        sessions_this_week = 0

    try:

        sessions_all = (
            supabase.table("sessions")
            .select("id, status, patient_id")
            .execute()
        )

        session_rows: List[dict] = [
            s for s in (sessions_all.data or [])
            if isinstance(s, dict)
        ]

        if current_user:
            session_rows = [
                s
                for s in session_rows
                if s.get("patient_id") in participant_ids
            ]

        notes_missing = sum(
            1
            for s in session_rows
            if s.get("status") == "draft"
        )

    except Exception:

        notes_missing = 0

    try:

        alerts = (
            supabase.table("alerts")
            .select("id")
            .eq("is_read", False)
            .execute()
        )

        compliance_alerts = len(alerts.data or [])

    except Exception:

        compliance_alerts = 0

    return {
        "total_participants": len(participant_data),
        "sessions_this_week": sessions_this_week,
        "notes_missing": notes_missing,
        "compliance_alerts": compliance_alerts,
        "active_participants": sum(
            1
            for p in participant_data
            if p.get("plan_status") == "active"
        ),
    }