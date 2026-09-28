"""Business logic for participant (patient) CRUD and dashboard stats."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from .supabase_client import get_supabase_admin

from ..core.access import (
    ACCESS_METADATA_FIELDS,
    can_access_participant,
    get_user_role,
    is_coordinator,
    is_managing_director,
    is_support_worker,
    owner_payload,
    user_id,
    organization_id,
)

from ..schemas.participant import (
    ParticipantCreate,
    ParticipantUpdate,
)

from .access_log_service import (
    log_participant_read,
    log_participant_reads_bulk,
    log_security_event,
)

logger = logging.getLogger(__name__)

TABLE = "participants"

_PLAN_FIELD_MAP = {
    "plan_start_date": "plan_start",
    "plan_end_date": "plan_end",
    "total_budget": "total_funding",
    "plan_status": "status",
}


async def _sync_plan_fields_from_payload(
    participant_id: str,
    payload: dict,
    current_user: Optional[dict] = None,
) -> dict:
    """Route plan mirror edits to ndis_plans instead of participants."""
    plan_payload: dict = {}
    for patient_key, plan_key in _PLAN_FIELD_MAP.items():
        if patient_key in payload:
            plan_payload[plan_key] = payload.pop(patient_key)

    if not plan_payload:
        return payload

    from . import funding_service

    await funding_service.create_or_update_plan(participant_id, plan_payload, current_user)
    return payload


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


def _normalize(row: dict) -> dict:
    """Normalize patient row."""

    if not row:
        return row

    out = dict(row)
    out.pop("goals", None)
    out.pop("plan_management", None)
    out.pop("used_budget", None)

    out.setdefault("total_budget", 0.0)
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


# ---------------------------------------------------------------------------
# Service functions
# ---------------------------------------------------------------------------


async def _list_accessible_participants(
    current_user: Optional[dict],
) -> List[dict]:
    """Return normalized participant rows the user can access (no goals/plan enrichment)."""
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

        filtered_rows.append(scoped_row)

    if filtered_rows:
        await log_participant_reads_bulk(
            [str(row.get("id")) for row in filtered_rows if row.get("id")],
            user_id=user_id(current_user),
            organization_id=organization_id(current_user),
            purpose="Participant List Access",
        )

    return [_normalize(r) for r in filtered_rows]


async def get_all_participants(
    current_user: Optional[dict] = None,
) -> List[dict]:

    normalized = await _list_accessible_participants(current_user)
    if not normalized:
        return []

    from . import goals_service, funding_service

    with_goals = await goals_service.enrich_participants(normalized, active_only=False)
    return await funding_service.enrich_participants_plan_fields(with_goals)


async def get_participants_list_light(
    current_user: Optional[dict] = None,
) -> List[dict]:
    """Participant list without goals/plan enrichment — for dashboards and my-clients."""
    return await _list_accessible_participants(current_user)


async def get_participant_validation_context(
    participant_id: str,
    organization_id_: str,
) -> dict:
    """Minimal participant context for the real-time note-validation check
    (ai_service.validate_note_content) — deliberately not get_participant_by_id,
    which does full plan/goal enrichment and writes a "Participant Record
    Access" audit row on every call. This is called on every note save, so it
    stays to a direct, unlogged, minimal select instead."""
    if not participant_id or not organization_id_:
        return {}

    supabase = get_supabase_admin()
    try:
        participant_result = (
            supabase.table(TABLE)
            .select("id, full_name, primary_disability")
            .eq("id", participant_id)
            .eq("organization_id", organization_id_)
            .limit(1)
            .execute()
        )
        rows = participant_result.data or []
        if not rows:
            return {}
        participant = rows[0]

        goals_result = (
            supabase.table("ndis_goals")
            .select("name")
            .eq("participant_id", participant_id)
            .eq("organization_id", organization_id_)
            .eq("status", "active")
            .limit(5)
            .execute()
        )
        goal_titles = [g["name"] for g in (goals_result.data or []) if g.get("name")]

        return {
            "full_name": participant.get("full_name"),
            "primary_disability": participant.get("primary_disability"),
            "goal_titles": goal_titles,
        }
    except Exception:
        logger.warning("get_participant_validation_context failed for %s", participant_id, exc_info=True)
        return {}


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

            if is_support_worker(current_user) and await _worker_has_shift_for_participant(
                participant_id,
                current_user,
            ):
                # Rostered via a shift but assigned_worker_id/practitioner_allocations
                # haven't been synced for this participant yet — shift_service treats
                # shift ownership as proof of access for sessions, so the profile the
                # worker needs to prepare for that shift must be visible too.
                pass
            else:

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

        from . import goals_service, funding_service

        enriched = await goals_service.enrich_participant(
            _normalize(participant),
            active_only=False,
        )
        enriched = await funding_service.enrich_participant_plan_fields(enriched)

        # assigned_worker_id has always been on this record but was never
        # resolved to a name anywhere - coordinators/MD had no way to see
        # who is actually rostered to this participant, only who happened to
        # work any one specific already-completed shift (Shift History).
        assigned_worker_id = enriched.get("assigned_worker_id")
        if assigned_worker_id:
            try:
                worker_resp = (
                    supabase.table("users")
                    .select("full_name, email")
                    .eq("id", assigned_worker_id)
                    .maybe_single()
                    .execute()
                )
                if worker_resp and worker_resp.data:
                    enriched["assigned_worker_name"] = (
                        worker_resp.data.get("full_name") or worker_resp.data.get("email")
                    )
            except Exception:
                pass

        return enriched

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
    if not is_coordinator(current_user) and not is_managing_director(current_user):
        raise PermissionError("Only support coordinators or the managing director can create participants")

    supabase = get_supabase_admin()

    payload: dict = data.model_dump(exclude_none=True)

    payload.pop("address", None)

    payload = _strip_optional_columns(payload)
    payload = _serialize_dates(payload)
    payload.pop("goals", None)

    plan_payload: dict = {}
    for patient_key, plan_key in _PLAN_FIELD_MAP.items():
        if patient_key in payload:
            plan_payload[plan_key] = payload.pop(patient_key)

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

    # A participant belongs to the office that serves them. Default to the
    # creator's branch; the DB falls back to head office if that's unknown.
    if not payload.get("branch_id"):
        from .branch_service import member_branch_id

        branch_id = member_branch_id(user_id(current_user), organization_id(current_user))
        if branch_id:
            payload["branch_id"] = branch_id

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

    participant_id = str(rows[0].get("id") or "")
    # plan_status always carries a default ("active"), so plan_payload is
    # never truly empty — only create a plan when there's actual plan data
    # (a caller with nothing yet, e.g. participant onboarding activation
    # before any plan dates are captured, shouldn't get a placeholder plan
    # that immediately fails ndis_plans.plan_start's NOT NULL constraint).
    has_plan_data = any(k in plan_payload for k in ("plan_start", "plan_end", "total_funding"))
    if has_plan_data and participant_id:
        from . import funding_service

        await funding_service.create_or_update_plan(participant_id, plan_payload, current_user)

    from . import goals_service, funding_service

    enriched = await goals_service.enrich_participant(_normalize(rows[0]), active_only=False)
    return await funding_service.enrich_participant_plan_fields(enriched)


async def update_participant(
    participant_id: str,
    data: ParticipantUpdate,
    current_user: Optional[dict] = None,
) -> Optional[dict]:

    supabase = get_supabase_admin()

    payload: dict = data.model_dump(exclude_unset=True)
    # Moving a participant between offices changes their pay/billing clock;
    # only the MD does that (PUT /api/branches/participants/{id}).
    if "branch_id" in payload and get_user_role(current_user) != "managing_director":
        payload.pop("branch_id")

    payload.pop("address", None)

    if "plan_management_type" in payload:
        from . import billing_period_service

        payload["plan_management_type"] = billing_period_service.validate_plan_management_type_update(
            payload.get("plan_management_type")
        )

    payload = _strip_optional_columns(payload)
    payload = _serialize_dates(payload)
    payload.pop("goals", None)
    payload = await _sync_plan_fields_from_payload(participant_id, payload, current_user)

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

    if existing_before and current_user:
        from . import audit_service
        from ..core.access import get_user_id, get_user_organization_id

        await audit_service.log_action(
            action_type="participant.updated",
            entity_type="participant",
            entity_id=participant_id,
            user_id=get_user_id(current_user),
            organization_id=get_user_organization_id(current_user)
            or str(existing_before.get("organization_id") or ""),
            before_state={k: existing_before.get(k) for k in payload},
            after_state={k: updated.get(k) for k in payload},
        )

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

    from . import goals_service, funding_service

    enriched = await goals_service.enrich_participant(updated, active_only=False)
    return await funding_service.enrich_participant_plan_fields(enriched)


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


async def _worker_has_shift_for_participant(
    participant_id: str,
    current_user: Optional[dict],
) -> bool:
    """Fallback access check: a shift roster is itself proof a support worker
    may view this participant, even before assigned_worker_id/practitioner_allocations
    catch up. Mirrors the fallback shift_service.start_shift_session already
    relies on for session creation."""
    from . import shift_service

    uid = user_id(current_user)
    org_id = organization_id(current_user)
    if not uid or not org_id:
        return False

    return shift_service.worker_has_shift_for_participant(participant_id, uid, org_id)


async def _get_assignment_ids(current_user: Optional[dict]) -> tuple[set[str], set[str]]:
    """Return active assignment patient IDs for the current scoped user.

    The first set is support-worker scope, the second set is clinical/allied
    health scope. Fail closed on missing assignment metadata.
    """
    if not current_user or not is_support_worker(current_user):
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


_ACCESS_STUB_SELECT = (
    "id, organization_id, assigned_worker_id, allied_health_id, "
    "clinician_id, created_by, owner_user_id, support_worker_id"
)


async def get_participant_access_stubs(
    current_user: Optional[dict],
    participant_ids: list[str],
) -> dict[str, dict]:
    """Minimal participant rows for session access checks — no enrichment or audit logs."""
    if not current_user or not participant_ids:
        return {}

    org_id = organization_id(current_user)
    if not org_id:
        return {}

    ids = list({str(pid) for pid in participant_ids if pid})
    if not ids:
        return {}

    try:
        result = (
            get_supabase_admin()
            .table(TABLE)
            .select(_ACCESS_STUB_SELECT)
            .eq("organization_id", org_id)
            .in_("id", ids)
            .execute()
        )
    except Exception as exc:
        if _is_missing_column_error(exc):
            logger.warning("Participant access stub lookup failed closed: %s", exc)
            return {}
        raise

    rows = [r for r in (result.data or []) if isinstance(r, dict)]
    support_ids, clinical_ids = await _get_assignment_ids(current_user)

    stubs: dict[str, dict] = {}
    for row in rows:
        scoped = _annotate_assignment_scope(row, current_user, support_ids, clinical_ids)
        if can_access_participant(scoped, current_user):
            stubs[str(scoped.get("id"))] = scoped
    return stubs


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
