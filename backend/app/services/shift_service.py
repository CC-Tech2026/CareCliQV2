"""MyShift — shift lookup and worker shift APIs (CARECLIQV2-87 / CARECLIQV2-35 / CARECLIQV2-116 / CARECLIQV2-134)."""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from ..core.access import owner_payload
from .session_service import _prepare_session_payload
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

DEFAULT_SHIFT_TASKS: list[dict[str, Any]] = [
    {
        "task_id": "default_personal_hygiene",
        "type": "default",
        "label": "Personal Hygiene / Showering",
        "description": "Assist with bathing, grooming, oral care, or personal hygiene routine.",
        "completed": False,
        "completed_at": None,
        "note": "",
        "order": 1,
        "mandatory": True,
        "goal_id": "increase_independence",
        "goal_title": "Increase Independence",
        "outcome_tip": "Participant completed hygiene routine with appropriate support.",
    },
    {
        "task_id": "default_meal_prep",
        "type": "default",
        "label": "Meal Preparation",
        "description": "Prepare meals, snacks, and support hydration throughout the shift.",
        "completed": False,
        "completed_at": None,
        "note": "",
        "order": 2,
        "mandatory": True,
        "goal_id": "daily_living_skills",
        "goal_title": "Daily Living Skills",
        "outcome_tip": "Meals prepared safely with participant involvement where possible.",
    },
    {
        "task_id": "default_medication",
        "type": "default",
        "label": "Medication Administration",
        "description": "Prompt medications, verify compliance, and document administration.",
        "completed": False,
        "completed_at": None,
        "note": "",
        "order": 3,
        "mandatory": True,
        "goal_id": "health_wellbeing",
        "goal_title": "Health & Wellbeing",
        "outcome_tip": "Medications taken as prescribed with no adverse reactions noted.",
    },
    {
        "task_id": "default_documentation",
        "type": "default",
        "label": "Documentation / Notes",
        "description": "Record progress notes, incidents, and participant communication.",
        "completed": False,
        "completed_at": None,
        "note": "",
        "order": 4,
        "mandatory": True,
        "goal_id": "choice_control",
        "goal_title": "Choice & Control",
        "outcome_tip": "Progress notes capture what was done and participant response.",
    },
    {
        "task_id": "default_community_access",
        "type": "default",
        "label": "Community Access",
        "description": "Outings, social, activities",
        "completed": False,
        "completed_at": None,
        "note": "",
        "order": 5,
        "mandatory": False,
        "goal_id": "community_participation",
        "goal_title": "Community Participation",
        "outcome_tip": "Participant engaged in community activity with support as needed.",
    },
]


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return (
        "does not exist" in err
        or "42703" in err
        or "pgrst" in err
        or "could not find" in err
    )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_health_alerts(value: Any) -> list[dict[str, str]]:
    if not value:
        return []
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, str):
        alerts: list[dict[str, str]] = []
        for line in value.split("\n"):
            text = line.strip()
            if not text:
                continue
            severity = "important"
            if text.startswith("⛔") or "critical" in text.lower():
                severity = "critical"
            alerts.append({"title": text.lstrip("⛔⚠️ ").strip(), "severity": severity, "detail": text})
        return alerts
    return []


def _parse_support_instructions(shift: dict) -> list[dict[str, str]]:
    """Build category sections from shift snapshot fields (CARECLIQV2-157)."""
    sections: list[dict[str, str]] = []
    visit = (shift.get("visit_notes") or "").strip()
    if visit:
        sections.append({"category": "Visit Notes", "body": visit, "critical": "false"})
    allergies = (shift.get("allergies") or "").strip()
    if allergies:
        sections.append({"category": "Allergies", "body": allergies, "critical": "true"})
    flags = (shift.get("health_flags") or "").strip()
    if flags:
        sections.append({"category": "Health Flags", "body": flags, "critical": "true"})
    access = (shift.get("access_instructions") or "").strip()
    if access:
        sections.append({"category": "Access & Mobility", "body": access, "critical": "false"})
    return sections


def _session_counts_as_active(session: Optional[dict[str, Any]]) -> bool:
    if not session:
        return False
    return (session.get("status") or "") in {"draft", "in_progress", "active"}


def _should_keep_shift_session_link(shift: dict) -> bool:
    """Keep session link only when resuming a shift that already started documenting."""
    if shift.get("status") != "in_progress" or not shift.get("clocked_in_at"):
        return False
    return _session_counts_as_active(_get_session_for_shift(shift))


def _shift_card_payload(shift: dict, session: Optional[dict] = None) -> dict[str, Any]:
    scheduled_start = shift.get("scheduled_start")
    scheduled_end = shift.get("scheduled_end")
    status = shift.get("status") or "scheduled"
    clocked_in = bool(shift.get("clocked_in_at"))
    session_status = (session or {}).get("status")
    session_active = _session_counts_as_active(session)

    if status == "completed":
        visual_state = "completed"
    elif status == "in_progress" and clocked_in and session_active:
        visual_state = "session_active"
    elif status == "in_progress" and clocked_in:
        visual_state = "clocked_in"
    else:
        visual_state = "scheduled"

    return {
        "id": shift.get("id"),
        "participant_id": shift.get("participant_id"),
        "participant_name": shift.get("participant_name"),
        "participant_phone": shift.get("participant_phone"),
        "participant_address": shift.get("participant_address"),
        "scheduled_start": scheduled_start,
        "scheduled_end": scheduled_end,
        "duration_minutes": shift.get("duration_minutes"),
        "clocked_in_at": shift.get("clocked_in_at"),
        "clocked_out_at": shift.get("clocked_out_at"),
        "status": status,
        "visual_state": visual_state,
        "coordinator_notes": shift.get("coordinator_notes"),
        "entry_instructions": shift.get("entry_instructions"),
        "access_instructions": shift.get("access_instructions"),
        "health_alerts": _parse_health_alerts(shift.get("health_alerts")),
        "allergies": shift.get("allergies"),
        "visit_notes": shift.get("visit_notes"),
        "health_flags": shift.get("health_flags"),
        "support_instructions": _parse_support_instructions(shift),
        "risks_acknowledged_at": shift.get("risks_acknowledged_at"),
        "risks_acknowledged_by": shift.get("risks_acknowledged_by"),
        "risks_acknowledged": bool(shift.get("risks_acknowledged_at")),
        "active_goals": shift.get("active_goals") or [],
        "tasks": shift.get("tasks") or [],
        "session_id": shift.get("session_id"),
        "session_status": session_status,
        "service_category": shift.get("service_category") or "CORE",
        "participant_dob": shift.get("participant_dob"),
        "participant_gender": shift.get("participant_gender"),
    }


def _fetch_participant_context(participant_id: str, organization_id: str) -> dict[str, Any]:
    """Load read-only participant profile + preferences for shift detail (CARECLIQV2-195/196)."""
    if not participant_id:
        return {}
    try:
        resp = (
            get_supabase_admin()
            .table("patients")
            .select(
                "id, full_name, ndis_number, date_of_birth, phone, email, "
                "communication_preferences, allergies, primary_disability, "
                "emergency_contact, behaviour_support_plan, restricted_behavioural_notes, "
                "visit_notes, health_flags"
            )
            .eq("id", participant_id)
            .eq("organization_id", organization_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return {}
        row = rows[0]
        return {
            "profile": {
                "preferred_name": row.get("full_name"),
                "date_of_birth": row.get("date_of_birth"),
                "ndis_number": row.get("ndis_number"),
                "phone": row.get("phone"),
                "email": row.get("email"),
                "emergency_contact": row.get("emergency_contact"),
                "primary_disability": row.get("primary_disability"),
            },
            "preferences": {
                "communication_style": row.get("communication_preferences"),
                "behaviour_support": row.get("behaviour_support_plan"),
                "restricted_notes": row.get("restricted_behavioural_notes"),
                "routines": row.get("visit_notes"),
                "health_flags": row.get("health_flags"),
                "likes_dislikes": row.get("allergies"),
            },
        }
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return {}
        logger.debug("participant context lookup failed: %s", exc)
        return {}


def get_shift_by_id(shift_id: str) -> Optional[dict[str, Any]]:
    """Return a shift row by primary key, or None if missing / table absent."""
    if not shift_id:
        return None
    try:
        resp = (
            get_supabase_admin()
            .table("shifts")
            .select("*")
            .eq("id", shift_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None
    except Exception as exc:
        if _is_missing_schema_error(exc):
            logger.debug("shifts table unavailable: %s", exc)
            return None
        raise


def _get_session_for_shift(shift: dict) -> Optional[dict[str, Any]]:
    session_id = shift.get("session_id")
    if not session_id:
        return None
    try:
        resp = (
            get_supabase_admin()
            .table("sessions")
            .select("id, status, session_date, duration_minutes")
            .eq("id", str(session_id))
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None
    except Exception:
        return None


WORKER_SHIFT_FILTERS = frozenset({"today", "upcoming", "past", "completed", "cancelled", "all"})
WORKER_SHIFT_COUNT_FILTERS = ("today", "upcoming", "completed", "cancelled")


def _normalize_shift_filter(filter_name: str) -> str:
    name = (filter_name or "today").lower()
    return name if name in WORKER_SHIFT_FILTERS else "today"


def _date_part(value: Any) -> str:
    if not value:
        return ""
    return str(value)[:10]


def _utc_day_bounds(today: date) -> tuple[str, str]:
    day_start = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc)
    next_day = day_start + timedelta(days=1)
    return day_start.isoformat(), next_day.isoformat()


def _matches_filter(shift: dict, filter_name: str, today: date) -> bool:
    status = (shift.get("status") or "scheduled").lower()
    day = _date_part(shift.get("scheduled_start"))
    shift_day: Optional[date] = None
    if day:
        try:
            shift_day = date.fromisoformat(day)
        except ValueError:
            shift_day = None

    if filter_name == "completed":
        return status == "completed"
    if filter_name == "cancelled":
        return status == "cancelled"
    if not shift_day:
        return filter_name == "all"

    if filter_name == "today":
        return shift_day == today and status != "cancelled"
    if filter_name == "upcoming":
        return shift_day > today and status not in {"completed", "cancelled"}
    if filter_name == "past":
        return shift_day < today and status != "cancelled"
    return True


def filter_shift_rows(
    rows: list[dict[str, Any]],
    filter_name: str,
    today: Optional[date] = None,
) -> list[dict[str, Any]]:
    """Filter shift rows by bucket (CARECLIQV2-132)."""
    bucket = _normalize_shift_filter(filter_name)
    ref = today or date.today()
    return [row for row in rows if _matches_filter(row, bucket, ref)]


def count_shifts_by_filter(
    rows: list[dict[str, Any]],
    today: Optional[date] = None,
) -> dict[str, int]:
    """Count shifts per UI filter bucket (CARECLIQV2-133)."""
    ref = today or date.today()
    return {
        name: sum(1 for row in rows if _matches_filter(row, name, ref))
        for name in WORKER_SHIFT_COUNT_FILTERS
    }


def _apply_shift_list_query(query: Any, filter_name: str, today: date) -> Any:
    """Push list filters to the DB query when possible (CARECLIQV2-133)."""
    if filter_name == "all":
        return query
    if filter_name == "completed":
        return query.eq("status", "completed")
    if filter_name == "cancelled":
        return query.eq("status", "cancelled")

    day_start_iso, next_day_iso = _utc_day_bounds(today)
    if filter_name == "today":
        return (
            query.gte("scheduled_start", day_start_iso)
            .lt("scheduled_start", next_day_iso)
            .neq("status", "cancelled")
        )
    if filter_name == "upcoming":
        return (
            query.gte("scheduled_start", next_day_iso)
            .not_.in_("status", ["completed", "cancelled"])
        )
    if filter_name == "past":
        return query.lt("scheduled_start", day_start_iso).neq("status", "cancelled")
    return query


def _fetch_worker_shift_rows(
    worker_id: str,
    organization_id: str,
    *,
    columns: str = "*",
    filter_name: Optional[str] = None,
) -> list[dict[str, Any]]:
    try:
        query = (
            get_supabase_admin()
            .table("shifts")
            .select(columns)
            .eq("organization_id", organization_id)
            .eq("worker_id", worker_id)
        )
        if filter_name:
            query = _apply_shift_list_query(query, filter_name, date.today())
        resp = query.order("scheduled_start", desc=False).execute()
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            logger.debug("shifts table unavailable: %s", exc)
            return []
        raise


def count_shifts_for_worker(worker_id: str, organization_id: str) -> dict[str, int]:
    """Lightweight per-filter counts without building full shift cards (CARECLIQV2-133)."""
    rows = _fetch_worker_shift_rows(
        worker_id,
        organization_id,
        columns="status, scheduled_start",
    )
    return count_shifts_by_filter(rows)


def list_shifts_for_worker(
    worker_id: str,
    organization_id: str,
    filter_name: str = "today",
) -> list[dict[str, Any]]:
    """Return shift cards for a worker, filtered by date bucket."""
    bucket = _normalize_shift_filter(filter_name)
    today = date.today()
    rows = _fetch_worker_shift_rows(
        worker_id,
        organization_id,
        filter_name=None if bucket == "all" else bucket,
    )
    filtered = filter_shift_rows(rows, bucket, today)
    cards: list[dict[str, Any]] = []
    for shift in filtered:
        session = _get_session_for_shift(shift)
        cards.append(_shift_card_payload(shift, session))
    return cards


def get_shift_detail_for_worker(
    shift_id: str,
    worker_id: str,
    organization_id: str,
) -> Optional[dict[str, Any]]:
    shift = get_shift_by_id(shift_id)
    if not shift:
        return None
    if str(shift.get("worker_id") or "") != str(worker_id):
        return None
    if str(shift.get("organization_id") or "") != str(organization_id):
        return None
    session = _get_session_for_shift(shift)
    payload = _shift_card_payload(shift, session)
    ctx = _fetch_participant_context(str(shift.get("participant_id") or ""), organization_id)
    payload.update(ctx)
    return payload


def _default_tasks_copy() -> list[dict[str, Any]]:
    import copy
    return copy.deepcopy(DEFAULT_SHIFT_TASKS)


def clock_in_shift(
    shift_id: str,
    worker_id: str,
    organization_id: str,
) -> Optional[dict[str, Any]]:
    shift = get_shift_by_id(shift_id)
    if not shift:
        return None
    if str(shift.get("worker_id") or "") != str(worker_id):
        return None
    if str(shift.get("organization_id") or "") != str(organization_id):
        return None
    if shift.get("status") == "completed":
        raise ValueError("Shift is already completed.")

    now = _now_iso()
    tasks = shift.get("tasks") or []
    if not tasks:
        tasks = _default_tasks_copy()

    update_payload: dict[str, Any] = {
        "status": "in_progress",
        "clocked_in_at": shift.get("clocked_in_at") or now,
        "tasks": tasks,
        "updated_at": now,
    }
    if not _should_keep_shift_session_link(shift):
        update_payload["session_id"] = None

    try:
        resp = (
            get_supabase_admin()
            .table("shifts")
            .update(update_payload)
            .eq("id", shift_id)
            .execute()
        )
        rows = resp.data or []
        updated = rows[0] if rows else {**shift, **update_payload}
    except Exception as exc:
        if _is_missing_schema_error(exc):
            logger.debug("shifts table unavailable: %s", exc)
            return None
        raise

    session = _get_session_for_shift(updated)
    return _shift_card_payload(updated, session)


def update_shift_tasks(
    shift_id: str,
    worker_id: str,
    organization_id: str,
    tasks: list[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    shift = get_shift_by_id(shift_id)
    if not shift:
        return None
    if str(shift.get("worker_id") or "") != str(worker_id):
        return None
    if str(shift.get("organization_id") or "") != str(organization_id):
        return None

    now = _now_iso()
    try:
        resp = (
            get_supabase_admin()
            .table("shifts")
            .update({"tasks": tasks, "updated_at": now})
            .eq("id", shift_id)
            .execute()
        )
        rows = resp.data or []
        updated = rows[0] if rows else {**shift, "tasks": tasks}
    except Exception as exc:
        if _is_missing_schema_error(exc):
            logger.debug("shifts table unavailable: %s", exc)
            return None
        raise

    session_id = updated.get("session_id")
    if session_id:
        try:
            get_supabase_admin().table("sessions").update({"tasks": tasks}).eq("id", str(session_id)).execute()
        except Exception:
            pass

    session = _get_session_for_shift(updated)
    return _shift_card_payload(updated, session)


def add_custom_shift_task(
    shift_id: str,
    worker_id: str,
    organization_id: str,
    label: str,
) -> Optional[dict[str, Any]]:
    label = (label or "").strip()
    if not label:
        raise ValueError("Task name is required.")

    shift = get_shift_by_id(shift_id)
    if not shift:
        return None
    if str(shift.get("worker_id") or "") != str(worker_id):
        return None
    if str(shift.get("organization_id") or "") != str(organization_id):
        return None

    tasks = list(shift.get("tasks") or _default_tasks_copy())
    max_order = max((int(t.get("order") or 0) for t in tasks), default=0)
    tasks.append({
        "task_id": f"custom_{uuid.uuid4().hex[:8]}",
        "type": "custom",
        "label": label,
        "description": "",
        "completed": False,
        "completed_at": None,
        "note": "",
        "order": max_order + 1,
    })
    return update_shift_tasks(shift_id, worker_id, organization_id, tasks)


def _is_custom_task(task: dict[str, Any]) -> bool:
    return str(task.get("type") or "") == "custom" or str(task.get("task_id") or "").startswith("custom_")


def _purge_session_task_evidence(session_id: str, task_id: str) -> None:
    try:
        resp = (
            get_supabase_admin()
            .table("sessions")
            .select("task_evidence")
            .eq("id", session_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return
        existing = rows[0].get("task_evidence") or []
        if not isinstance(existing, list):
            return
        filtered = [
            item for item in existing
            if not (isinstance(item, dict) and str(item.get("task_id") or "") == task_id)
        ]
        if len(filtered) == len(existing):
            return
        get_supabase_admin().table("sessions").update({
            "task_evidence": filtered,
            "updated_at": _now_iso(),
        }).eq("id", session_id).execute()
    except Exception:
        pass


def delete_custom_shift_task(
    shift_id: str,
    worker_id: str,
    organization_id: str,
    task_id: str,
) -> Optional[dict[str, Any]]:
    task_id = (task_id or "").strip()
    if not task_id:
        raise ValueError("Task id is required.")

    shift = get_shift_by_id(shift_id)
    if not shift:
        return None
    if str(shift.get("worker_id") or "") != str(worker_id):
        return None
    if str(shift.get("organization_id") or "") != str(organization_id):
        return None
    if shift.get("status") == "completed":
        raise ValueError("Cannot modify tasks on a completed shift.")

    tasks = list(shift.get("tasks") or [])
    target = next((t for t in tasks if str(t.get("task_id") or "") == task_id), None)
    if not target:
        raise ValueError("Task not found.")
    if not _is_custom_task(target):
        raise ValueError("Only custom tasks can be deleted.")

    next_tasks = [t for t in tasks if str(t.get("task_id") or "") != task_id]
    session_id = shift.get("session_id")
    if session_id:
        _purge_session_task_evidence(str(session_id), task_id)

    return update_shift_tasks(shift_id, worker_id, organization_id, next_tasks)


def acknowledge_shift_risks(
    shift_id: str,
    worker_id: str,
    organization_id: str,
) -> Optional[dict[str, Any]]:
    shift = get_shift_by_id(shift_id)
    if not shift:
        return None
    if str(shift.get("worker_id") or "") != str(worker_id):
        return None
    if str(shift.get("organization_id") or "") != str(organization_id):
        return None

    now = _now_iso()
    try:
        resp = (
            get_supabase_admin()
            .table("shifts")
            .update({
                "risks_acknowledged_at": now,
                "risks_acknowledged_by": worker_id,
                "updated_at": now,
            })
            .eq("id", shift_id)
            .execute()
        )
        rows = resp.data or []
        updated = rows[0] if rows else {**shift, "risks_acknowledged_at": now, "risks_acknowledged_by": worker_id}
    except Exception as exc:
        if _is_missing_schema_error(exc):
            logger.debug("shifts table unavailable: %s", exc)
            return None
        raise

    session = _get_session_for_shift(updated)
    return _shift_card_payload(updated, session)


def _participant_exists_in_org(participant_id: str, org_id: str) -> bool:
    try:
        resp = (
            get_supabase_admin()
            .table("patients")
            .select("id")
            .eq("id", participant_id)
            .eq("organization_id", org_id)
            .limit(1)
            .execute()
        )
        return bool(resp.data)
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return False
        raise


def start_shift_session(
    shift_id: str,
    worker_id: str,
    organization_id: str,
    current_user: dict,
) -> Optional[dict[str, Any]]:
    """Create (or return) a draft session for a clocked-in shift.

    Shift ownership proves the worker may document this participant even when
    patients.assigned_worker_id / practitioner_allocations are not synced yet.
    """
    shift = get_shift_by_id(shift_id)
    if not shift:
        return None
    if str(shift.get("worker_id") or "") != str(worker_id):
        return None
    if str(shift.get("organization_id") or "") != str(organization_id):
        return None
    if not shift.get("clocked_in_at"):
        raise ValueError("Clock in before starting a session.")
    if shift.get("health_alerts") and not shift.get("risks_acknowledged_at"):
        raise ValueError("Acknowledge risks before starting a session.")

    participant_id = shift.get("participant_id")
    if not participant_id:
        raise ValueError("Shift has no participant.")
    if not _participant_exists_in_org(str(participant_id), str(organization_id)):
        raise ValueError("Participant not found")

    existing_session_id = shift.get("session_id")
    if existing_session_id:
        session = _get_session_for_shift(shift)
        return _shift_card_payload(shift, session)

    duration = 60
    if shift.get("scheduled_start") and shift.get("scheduled_end"):
        try:
            start = datetime.fromisoformat(str(shift["scheduled_start"]).replace("Z", "+00:00"))
            end = datetime.fromisoformat(str(shift["scheduled_end"]).replace("Z", "+00:00"))
            duration = max(1, int((end - start).total_seconds() // 60))
        except ValueError:
            pass

    payload = _prepare_session_payload({
        "participant_id": str(participant_id),
        "session_date": date.today(),
        "duration_minutes": duration,
        "session_type": "support_work",
        "status": "draft",
        "shift_id": shift_id,
    })

    ownership = owner_payload(current_user)
    for key in (
        "created_by",
        "owner_user_id",
        "organization_id",
        "worker_id",
        "practitioner_id",
    ):
        if key in ownership:
            payload[key] = ownership[key]

    tasks = shift.get("tasks") or []
    if tasks:
        payload["tasks"] = tasks

    try:
        resp = get_supabase_admin().table("sessions").insert(payload).execute()
    except Exception as exc:
        if _is_missing_schema_error(exc):
            payload.pop("tasks", None)
            payload.pop("shift_id", None)
            resp = get_supabase_admin().table("sessions").insert(payload).execute()
        else:
            raise

    rows = resp.data or []
    if not rows:
        raise ValueError("Failed to create session")

    session_id = str(rows[0].get("id"))
    link_shift_session(shift_id, session_id)

    if tasks:
        try:
            get_supabase_admin().table("sessions").update({"tasks": tasks}).eq("id", session_id).execute()
        except Exception:
            pass

    updated_shift = get_shift_by_id(shift_id) or shift
    session = _get_session_for_shift(updated_shift)
    return _shift_card_payload(updated_shift, session)


def _mandatory_tasks_complete(tasks: list[dict[str, Any]]) -> bool:
    for task in tasks:
        is_mandatory = task.get("mandatory") is True or (
            task.get("type") == "default" and task.get("mandatory") is not False and int(task.get("order") or 0) <= 4
        )
        if is_mandatory and not task.get("completed"):
            return False
    return True


def clock_out_without_session(
    shift_id: str,
    worker_id: str,
    organization_id: str,
) -> Optional[dict[str, Any]]:
    """Leave site without starting a session (CARECLIQV2-127 emergency exit)."""
    shift = get_shift_by_id(shift_id)
    if not shift:
        return None
    if str(shift.get("worker_id") or "") != str(worker_id):
        return None
    if str(shift.get("organization_id") or "") != str(organization_id):
        return None
    if not shift.get("clocked_in_at"):
        raise ValueError("Not clocked in.")
    if shift.get("session_id"):
        raise ValueError("End the session before clocking out.")

    now = _now_iso()
    update_payload = {
        "status": "scheduled",
        "clocked_in_at": None,
        "clocked_out_at": now,
        "updated_at": now,
    }
    try:
        resp = (
            get_supabase_admin()
            .table("shifts")
            .update(update_payload)
            .eq("id", shift_id)
            .execute()
        )
        rows = resp.data or []
        updated = rows[0] if rows else {**shift, **update_payload}
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        raise

    return _shift_card_payload(updated)


def end_shift(
    shift_id: str,
    worker_id: str,
    organization_id: str,
    force: bool = False,
) -> Optional[dict[str, Any]]:
    """Complete shift and linked session (CARECLIQV2-156)."""
    shift = get_shift_by_id(shift_id)
    if not shift:
        return None
    if str(shift.get("worker_id") or "") != str(worker_id):
        return None
    if str(shift.get("organization_id") or "") != str(organization_id):
        return None
    if shift.get("status") == "completed":
        raise ValueError("Shift is already completed.")
    if not shift.get("clocked_in_at"):
        raise ValueError("Clock in before ending the shift.")

    tasks = shift.get("tasks") or []
    if tasks and not _mandatory_tasks_complete(tasks) and not force:
        raise ValueError("Complete all mandatory tasks before ending the shift.")

    now = _now_iso()
    session_id = shift.get("session_id")
    if session_id:
        try:
            get_supabase_admin().table("sessions").update({
                "status": "completed",
                "updated_at": now,
            }).eq("id", str(session_id)).execute()
        except Exception as exc:
            if not _is_missing_schema_error(exc):
                raise

    update_payload = {
        "status": "completed",
        "clocked_out_at": now,
        "updated_at": now,
    }
    try:
        resp = (
            get_supabase_admin()
            .table("shifts")
            .update(update_payload)
            .eq("id", shift_id)
            .execute()
        )
        rows = resp.data or []
        updated = rows[0] if rows else {**shift, **update_payload}
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        raise

    session = _get_session_for_shift(updated)
    payload = _shift_card_payload(updated, session)
    mandatory = [t for t in tasks if t.get("mandatory") or (t.get("type") == "default" and int(t.get("order") or 0) <= 4)]
    payload["completion_summary"] = {
        "tasks_completed": sum(1 for t in tasks if t.get("completed")),
        "tasks_total": len(tasks),
        "mandatory_completed": sum(1 for t in mandatory if t.get("completed")),
        "mandatory_total": len(mandatory),
        "session_id": session_id,
        "notes_submitted": bool((session or {}).get("compliance_input_text") or (session or {}).get("notes")),
    }
    return payload


def link_shift_session(shift_id: str, session_id: str) -> None:
    now = _now_iso()
    try:
        get_supabase_admin().table("shifts").update({
            "session_id": session_id,
            "updated_at": now,
        }).eq("id", shift_id).execute()
        get_supabase_admin().table("sessions").update({
            "shift_id": shift_id,
        }).eq("id", session_id).execute()
    except Exception as exc:
        if _is_missing_schema_error(exc):
            logger.debug("shift session link failed: %s", exc)
            return
        raise


def get_shift_for_session(session: dict) -> Optional[dict[str, Any]]:
    """Resolve shift for compliance duration checks.

    Prefers sessions.shift_id (CARECLIQV2-35). Falls back to shifts.session_id link.
    """
    shift_id = session.get("shift_id")
    if shift_id:
        return get_shift_by_id(str(shift_id))

    session_id = session.get("id")
    if not session_id:
        return None

    try:
        resp = (
            get_supabase_admin()
            .table("shifts")
            .select("*")
            .eq("session_id", str(session_id))
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None
    except Exception as exc:
        if _is_missing_schema_error(exc):
            logger.debug("shifts table unavailable: %s", exc)
            return None
        raise


def build_duration_consistency_context(session: dict) -> Optional[dict[str, Any]]:
    """Build context for check_duration_consistency when session.shift_id is set."""
    if not session.get("shift_id"):
        return None

    shift = get_shift_by_id(str(session["shift_id"]))
    if not shift:
        return None

    session_mins = int(session.get("duration_minutes") or 0)
    shift_mins = int(shift.get("duration_minutes") or 0)

    return {
        "shift_id": shift.get("id"),
        "session_duration_minutes": session_mins,
        "shift_duration_minutes": shift_mins,
        "deviation_minutes": abs(session_mins - shift_mins),
    }


def _session_owned_by_worker(session: dict, worker_id: str, org_id: str) -> bool:
    if str(session.get("organization_id") or "") != str(org_id):
        return False
    owners = {
        str(session.get("worker_id") or ""),
        str(session.get("support_worker_id") or ""),
        str(session.get("owner_user_id") or ""),
        str(session.get("created_by") or ""),
    }
    return str(worker_id) in owners


def sync_session_task_evidence(
    session_id: str,
    worker_id: str,
    organization_id: str,
    evidence_items: list[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    """Merge task evidence into sessions.task_evidence (CARECLIQV2-228)."""
    try:
        resp = (
            get_supabase_admin()
            .table("sessions")
            .select("id, task_evidence, worker_id, support_worker_id, owner_user_id, created_by, organization_id")
            .eq("id", session_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        raise

    rows = resp.data or []
    if not rows:
        return None
    session = rows[0]
    if not _session_owned_by_worker(session, worker_id, organization_id):
        return None

    existing = session.get("task_evidence") or []
    if not isinstance(existing, list):
        existing = []
    by_id: dict[str, dict[str, Any]] = {
        str(item.get("evidence_id")): item
        for item in existing
        if isinstance(item, dict) and item.get("evidence_id")
    }
    synced_ids: list[str] = []
    for item in evidence_items:
        eid = str(item.get("evidence_id") or "")
        if not eid:
            continue
        by_id[eid] = {**item, "session_id": session_id, "synced": True}
        synced_ids.append(eid)

    merged = list(by_id.values())
    now = _now_iso()
    try:
        get_supabase_admin().table("sessions").update({
            "task_evidence": merged,
            "updated_at": now,
        }).eq("id", session_id).execute()
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        raise

    return {
        "session_id": session_id,
        "synced_ids": synced_ids,
        "task_evidence": merged,
    }
