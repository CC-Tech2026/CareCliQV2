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
    get_user_role,
    is_allied_health,
    is_coordinator,
    is_support_worker,
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

    if migration_state.upcoming_review_date_column_missing:
        payload.pop("upcoming_review_date", None)

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

    if not current_user or not user_id(current_user) or not get_user_role(current_user):
        return []

    org_id = organization_id(current_user)
    if not org_id:
        return []

    supabase = get_supabase_admin()

    try:
        query = (
            supabase.table(TABLE)
            .select(_access_select())
            .order("created_at", desc=True)
        )
        query = query.eq("organization_id", org_id)
        result = query.execute()

    except Exception as exc:

        if _is_missing_column_error(exc):
            logger.warning("Participant access metadata missing; list failed closed")
            return []
        raise

    rows: List[dict] = [
        r for r in (result.data or [])
        if isinstance(r, dict)
    ]

    support_ids, clinical_ids = await _get_assignment_ids(current_user)

    filtered_rows: List[dict] = []

    for row in rows:
        scoped_row = _annotate_assignment_scope(
            row,
            current_user,
            support_ids,
            clinical_ids,
        )

        if not can_access_participant(scoped_row, current_user):
            continue

        participant_id = str(scoped_row.get("id"))

        await log_participant_read(
            participant_id,
            user_id=user_id(current_user),
            organization_id=organization_id(current_user),
            purpose="Participant List Access",
        )

        filtered_rows.append(scoped_row)

    return [_normalize(r) for r in filtered_rows]


async def get_participant_by_id(
    participant_id: str,
    current_user: Optional[dict] = None,
) -> Optional[dict]:

    if (
        not participant_id
        or not current_user
        or not user_id(current_user)
        or not get_user_role(current_user)
    ):
        return None

    supabase = get_supabase_admin()

    try:

        result = (
            supabase.table(TABLE)
            .select(_access_select())
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
        support_ids, clinical_ids = await _get_assignment_ids(current_user)
        participant = _annotate_assignment_scope(
            participant,
            current_user,
            support_ids,
            clinical_ids,
        )

        if not can_access_participant(participant, current_user):

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

        if _is_missing_column_error(exc):
            logger.warning("Participant access metadata missing; detail failed closed")
            return None

        logger.exception(
            "get_participant_by_id(%s) failed",
            participant_id,
        )

        return None


async def create_participant(
    data: ParticipantCreate,
    current_user: Optional[dict] = None,
) -> Optional[dict]:

    if not current_user or not user_id(current_user) or not organization_id(current_user):
        raise PermissionError("Authenticated organization membership is required")
    if not is_coordinator(current_user):
        raise PermissionError("Only support coordinators can create participants")

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

    ownership = owner_payload(current_user)

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

    try:

        result = (
            supabase.table(TABLE)
            .insert(payload)
            .execute()
        )

    except Exception as exc:

        logger.exception("CREATE PARTICIPANT FAILED")
        raise

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

    if "plan_management_type" in payload:
        from . import billing_period_service

        payload["plan_management_type"] = billing_period_service.validate_plan_management_type_update(
            payload.get("plan_management_type")
        )

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

    existing_before: Optional[dict] = None
    if current_user:

        existing_before = await get_participant_by_id(
            participant_id,
            current_user,
        )

        if not existing_before:
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

    updated = _normalize(rows[0])

    if (
        existing_before
        and current_user
        and "plan_management_type" in payload
    ):
        from . import audit_service
        from ..core.access import get_user_id, get_user_organization_id
        from ..models.billing_period import normalize_plan_management_type

        before_type = normalize_plan_management_type(
            existing_before.get("plan_management_type")
            or existing_before.get("plan_management")
        )
        after_type = normalize_plan_management_type(updated.get("plan_management_type"))
        if before_type != after_type:
            await audit_service.log_action(
                action_type="participant.plan_management_type_changed",
                entity_type="participant",
                entity_id=participant_id,
                user_id=get_user_id(current_user),
                organization_id=get_user_organization_id(current_user)
                or str(existing_before.get("organization_id") or ""),
                before_state={"plan_management_type": before_type},
                after_state={"plan_management_type": after_type},
            )

    return updated


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

    if not current_user or not user_id(current_user) or not organization_id(current_user):
        return _empty_dashboard_stats()

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
            .eq("organization_id", organization_id(current_user))
            .execute()
        )

        participant_data: List[dict] = [
            p for p in (participants.data or [])
            if isinstance(p, dict)
        ]

    except Exception:

        return _empty_dashboard_stats()

    support_ids, clinical_ids = await _get_assignment_ids(current_user)

    participant_data = [
        _annotate_assignment_scope(p, current_user, support_ids, clinical_ids)
        for p in participant_data
    ]
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
            .eq("organization_id", organization_id(current_user))
            .execute()
        )

        week_rows: List[dict] = [
            s for s in (sessions_week.data or [])
            if isinstance(s, dict)
        ]

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
            .eq("organization_id", organization_id(current_user))
            .execute()
        )

        session_rows: List[dict] = [
            s for s in (sessions_all.data or [])
            if isinstance(s, dict)
        ]

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
            .eq("organization_id", organization_id(current_user))
            .eq("is_read", "false")
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


async def _get_assignment_ids(current_user: Optional[dict]) -> tuple[set[str], set[str]]:
    """Return active assignment patient IDs for the current scoped user.

    The first set is support-worker scope, the second set is clinical/allied
    health scope. Fail closed on missing assignment metadata.
    """
    if not current_user or not (is_support_worker(current_user) or is_allied_health(current_user)):
        return set(), set()

    uid = user_id(current_user)
    org_id = organization_id(current_user)
    if not uid or not org_id:
        return set(), set()

    try:
        supabase = get_supabase_admin()
        result = (
            supabase.table("practitioner_allocations")
            .select("patient_id, allocated_role, organization_id")
            .eq("user_id", uid)
            .eq("organization_id", org_id)
            .eq("is_active", "true")
            .execute()
        )
    except Exception as exc:
        logger.warning("Participant assignment lookup failed closed: %s", exc)
        return set(), set()

    support_ids: set[str] = set()
    clinical_ids: set[str] = set()
    for row in result.data or []:
        if not isinstance(row, dict) or str(row.get("organization_id")) != org_id:
            continue
        patient_id = row.get("patient_id")
        if not patient_id:
            continue
        allocated_role = str(row.get("allocated_role") or "")
        if allocated_role in {"support_worker", "supervisor"}:
            support_ids.add(str(patient_id))
        if allocated_role in {"allied_health", "primary_ot"}:
            clinical_ids.add(str(patient_id))

    return support_ids, clinical_ids


def _annotate_assignment_scope(
    row: dict,
    current_user: Optional[dict],
    support_ids: set[str],
    clinical_ids: set[str],
) -> dict:
    if not current_user or not row:
        return row

    uid = user_id(current_user)
    org_id = organization_id(current_user)
    participant_id = str(row.get("id") or "")
    annotated = dict(row)

    if uid and participant_id in support_ids:
        annotated["_support_assignment_user_ids"] = [uid]
        annotated["_assignment_user_ids"] = [uid]
        annotated["_assignment_org_id"] = org_id

    if uid and participant_id in clinical_ids:
        annotated["_clinical_assignment_user_ids"] = [uid]
        annotated["_assignment_user_ids"] = [uid]
        annotated["_assignment_org_id"] = org_id

    return annotated


def _empty_dashboard_stats() -> dict:
    return {
        "total_participants": 0,
        "sessions_this_week": 0,
        "notes_missing": 0,
        "compliance_alerts": 0,
        "active_participants": 0,
    }
