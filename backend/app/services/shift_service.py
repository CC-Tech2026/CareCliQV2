"""MyShift — shift lookup and worker shift APIs (CARECLIQV2-87 / CARECLIQV2-35 / CARECLIQV2-116 / CARECLIQV2-134)."""

from __future__ import annotations

import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from ..core.access import owner_payload
from .check_in_service import (
    log_shift_check_in,
    normalize_client_timestamp,
    resolve_participant_coordinates,
    validate_clock_in_window,
    verify_gps_location,
    verify_qr_token_for_shift,
)
from .session_service import _prepare_session_payload
from .shift_validation_service import compute_shift_validation
from .supabase_client import get_supabase_admin
from ..core.timezone import APP_TIMEZONE, app_today, parse_shift_datetime

logger = logging.getLogger(__name__)


class ShiftAccessDenied(Exception):
    """Worker or organisation does not match the shift row (CARECLIQV2-90)."""


class ShiftAlreadyClockedIn(Exception):
    """Shift already has clocked_in_at set (CARECLIQV2-90)."""


class ShiftNotScheduledToday(Exception):
    """Shift scheduled_start is not on the current calendar day (CARECLIQV2-90)."""


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
        "goal_id": "daily_living_skills",
        "goal_title": "Develop Daily Living Skills",
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
        "goal_title": "Develop Daily Living Skills",
        "outcome_tip": "Meals prepared safely with participant involvement where possible.",
    },
    {
        "task_id": "default_medication",
        "type": "default",
        "label": "Medication Administration",
        "description": "Assist with medication as per the Medication Administration Record.",
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
        "task_id": "default_health_wellness",
        "type": "default",
        "label": "Health & Wellness Check",
        "description": "Check vitals, mood, and general wellbeing.",
        "completed": False,
        "completed_at": None,
        "note": "",
        "order": 4,
        "mandatory": False,
        "goal_id": "health_wellbeing",
        "goal_title": "Health & Wellbeing",
        "outcome_tip": "Participant wellbeing observed and any concerns documented.",
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
    {
        "task_id": "default_documentation",
        "type": "default",
        "label": "Documentation / Notes",
        "description": "Record progress notes, incidents, and participant communication.",
        "completed": False,
        "completed_at": None,
        "note": "",
        "order": 6,
        "mandatory": True,
        "goal_id": "documentation_reporting",
        "goal_title": "Documentation & Reporting",
        "outcome_tip": "Progress notes capture what was done and participant response.",
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


PARTICIPANT_RISK_TYPES = (
    "allergy",
    "legal_blindness",
    "falls_risk",
    "seizures",
    "bsp",
    "swallowing_risk",
    "other",
)

RISK_TYPE_LABELS: dict[str, str] = {
    "allergy": "Allergies",
    "legal_blindness": "Legal Blindness",
    "falls_risk": "Falls Risk",
    "seizures": "Seizures",
    "bsp": "Behaviour Support Plan (BSP)",
    "swallowing_risk": "Swallowing Risk",
    "other": "Safety Alert",
}


def _risk_type_label(risk_type: str) -> str:
    return RISK_TYPE_LABELS.get(risk_type, RISK_TYPE_LABELS["other"])


def _infer_risk_type(text: str) -> str:
    lower = text.lower()
    if any(token in lower for token in ("allerg", "anaphyl", "epipen", "nut ")):
        return "allergy"
    if any(token in lower for token in ("blind", "vision impair", "sight loss", "legally blind")):
        return "legal_blindness"
    if "fall" in lower:
        return "falls_risk"
    if any(token in lower for token in ("seizure", "epilep", "convuls")):
        return "seizures"
    if any(token in lower for token in ("behaviour support", "behavior support", " bsp", "bsp ")):
        return "bsp"
    if any(token in lower for token in ("swallow", "aspirat", "dysphag", "choking")):
        return "swallowing_risk"
    return "other"


def _normalise_risk_alert(raw: dict[str, Any]) -> dict[str, Any]:
    risk_type = (raw.get("type") or "other").strip().lower()
    if risk_type not in PARTICIPANT_RISK_TYPES:
        risk_type = _infer_risk_type(str(raw.get("title") or raw.get("description") or ""))
    title = (raw.get("title") or _risk_type_label(risk_type)).strip()
    description = (raw.get("description") or raw.get("detail") or title).strip()
    instructions = (raw.get("instructions") or description).strip()
    severity = (raw.get("severity") or "important").strip().lower()
    if severity not in {"critical", "important"}:
        severity = "critical" if severity in {"severe", "anaphylactic", "high"} else "important"
    return {
        "type": risk_type,
        "title": title,
        "description": description,
        "instructions": instructions,
        "severity": severity,
        "detail": instructions or description,
    }


def _make_risk_alert(
    risk_type: str,
    *,
    title: str,
    description: str = "",
    instructions: str = "",
    severity: str = "important",
) -> dict[str, Any]:
    return _normalise_risk_alert({
        "type": risk_type,
        "title": title,
        "description": description or title,
        "instructions": instructions or description or title,
        "severity": severity,
    })


def _risk_dedupe_key(alert: dict[str, Any]) -> str:
    return f"{alert.get('type')}::{str(alert.get('title') or '').strip().lower()}"


def _parse_health_alerts(value: Any) -> list[dict[str, str]]:
    structured = build_structured_health_alerts(value, shift=None, organization_id=None)
    return [
        {
            "type": item.get("type", "other"),
            "title": item.get("title", ""),
            "description": item.get("description", ""),
            "instructions": item.get("instructions", ""),
            "severity": item.get("severity", "important"),
            "detail": item.get("detail") or item.get("description") or item.get("title", ""),
        }
        for item in structured
    ]


def _alerts_from_shift_text(value: Any) -> list[dict[str, Any]]:
    if not value:
        return []
    if isinstance(value, list):
        return [_normalise_risk_alert(item) for item in value if isinstance(item, dict)]
    if isinstance(value, str):
        alerts: list[dict[str, Any]] = []
        for line in value.split("\n"):
            text = line.strip()
            if not text:
                continue
            severity = "important"
            if text.startswith("⛔") or "critical" in text.lower():
                severity = "critical"
            cleaned = text.lstrip("⛔⚠️ ").strip()
            risk_type = _infer_risk_type(cleaned)
            title = _risk_type_label(risk_type) if risk_type != "other" else cleaned.split("—")[0].split("-")[0].strip()
            alerts.append(_make_risk_alert(
                risk_type,
                title=title[:120] or "Safety Alert",
                description=cleaned,
                instructions=cleaned,
                severity=severity,
            ))
        return alerts
    return []


def validate_shift_scheduled_today(
    scheduled_start: str,
    *,
    today: Optional[date] = None,
) -> None:
    """Reject clock-in when the shift is not scheduled for today (CARECLIQV2-90)."""
    if not scheduled_start:
        return
    try:
        start = parse_shift_datetime(scheduled_start)
        shift_day = start.astimezone(APP_TIMEZONE).date()
    except ValueError:
        return
    if shift_day != (today or app_today()):
        raise ShiftNotScheduledToday("Shift not scheduled for today")


def _fetch_patient_risk_fields(participant_id: str, organization_id: str) -> dict[str, Any]:
    if not participant_id:
        return {}
    try:
        resp = (
            get_supabase_admin()
            .table("patients")
            .select(
                "allergies, medical_alerts, current_conditions, behaviour_support_plan, "
                "risk_triggers, risk_management_plan"
            )
            .eq("id", participant_id)
            .eq("organization_id", organization_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else {}
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return {}
        logger.debug("patient risk fields lookup failed: %s", exc)
        return {}


def build_structured_health_alerts(
    value: Any,
    *,
    shift: Optional[dict[str, Any]] = None,
    organization_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Normalise shift/participant sources into structured risk alerts (CARECLIQV2-158)."""
    alerts: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add(alert: dict[str, Any]) -> None:
        key = _risk_dedupe_key(alert)
        if key in seen:
            return
        seen.add(key)
        alerts.append(alert)

    for alert in _alerts_from_shift_text(value):
        add(alert)

    if shift:
        if shift.get("allergies") and not any(a.get("type") == "allergy" for a in alerts):
            add(_make_risk_alert(
                "allergy",
                title="Allergies",
                description=str(shift.get("allergies")),
                instructions=str(shift.get("allergies")),
                severity="critical",
            ))
        if shift.get("health_flags"):
            for line in str(shift.get("health_flags")).split("\n"):
                text = line.strip()
                if not text:
                    continue
                add(_make_risk_alert(
                    _infer_risk_type(text),
                    title=text.split("—")[0].split("-")[0].strip()[:120] or "Health flag",
                    description=text,
                    instructions=text,
                    severity="important",
                ))

    participant_id = str((shift or {}).get("participant_id") or "")
    org_id = str(organization_id or (shift or {}).get("organization_id") or "")
    if participant_id and org_id:
        for row in _fetch_participant_allergies(participant_id, org_id):
            allergen = str(row.get("allergen") or "").strip()
            if not allergen:
                continue
            notes = str(row.get("notes") or "").strip()
            severity_raw = str(row.get("severity") or "moderate").lower()
            severity = "critical" if severity_raw in {"severe", "anaphylactic"} else "important"
            instructions = f"Avoid all exposure to {allergen}."
            if notes:
                instructions = f"{instructions} {notes}".strip()
            add(_make_risk_alert(
                "allergy",
                title=f"Allergy — {allergen}",
                description=notes or f"Allergic to {allergen} ({severity_raw}).",
                instructions=instructions,
                severity=severity,
            ))

        patient = _fetch_patient_risk_fields(participant_id, org_id)
        if patient.get("behaviour_support_plan"):
            body = str(patient["behaviour_support_plan"]).strip()
            add(_make_risk_alert(
                "bsp",
                title="Behaviour Support Plan (BSP)",
                description=body,
                instructions=body,
                severity="important",
            ))
        if patient.get("current_conditions"):
            for line in str(patient["current_conditions"]).split("\n"):
                text = line.strip()
                if not text:
                    continue
                add(_make_risk_alert(
                    _infer_risk_type(text),
                    title=text.split("—")[0].split("-")[0].strip()[:120] or "Medical condition",
                    description=text,
                    instructions=text,
                    severity="important",
                ))
        if patient.get("medical_alerts"):
            for line in str(patient["medical_alerts"]).split("\n"):
                text = line.strip()
                if not text:
                    continue
                add(_make_risk_alert(
                    _infer_risk_type(text),
                    title=text.split("—")[0].split("-")[0].strip()[:120] or "Medical alert",
                    description=text,
                    instructions=text,
                    severity="critical" if "⛔" in text or "critical" in text.lower() else "important",
                ))
        if patient.get("allergies"):
            patient_allergies = str(patient["allergies"]).strip()
            if participant_id:
                add(_make_risk_alert(
                    "allergy",
                    title="Allergies",
                    description=patient_allergies,
                    instructions=patient_allergies,
                    severity="critical",
                ))
        for trigger in _normalise_risk_text_list(patient.get("risk_triggers")):
            add(_make_risk_alert(
                _infer_risk_type(trigger),
                title="Risk trigger",
                description=trigger,
                instructions=trigger,
                severity="important",
            ))
        plan_text = str(patient.get("risk_management_plan") or "").strip()
        if plan_text:
            add(_make_risk_alert(
                "other",
                title="Risk management plan",
                description=plan_text[:280],
                instructions=plan_text,
                severity="important",
            ))

    return alerts


def _normalise_risk_text_list(raw: Any) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    if isinstance(raw, str):
        return [line.strip() for line in raw.splitlines() if line.strip()]
    return []


def _fetch_active_goals_for_participant(
    participant_id: str,
    organization_id: str,
) -> list[dict[str, Any]]:
    """Active NDIS goals for shift briefing (CARECLIQV2-90)."""
    if not participant_id:
        return []
    try:
        plan_resp = (
            get_supabase_admin()
            .table("ndis_plans")
            .select("id")
            .eq("patient_id", participant_id)
            .eq("status", "active")
            .order("plan_start", desc=True)
            .limit(1)
            .execute()
        )
        plan_rows = plan_resp.data or []
        if not plan_rows:
            return []
        plan_id = plan_rows[0].get("id")
        if not plan_id:
            return []
        goals_resp = (
            get_supabase_admin()
            .table("patient_goals")
            .select("id, title, description, category, status, priority, worker_focus")
            .eq("plan_id", plan_id)
            .eq("status", "active")
            .order("priority", desc=False)
            .order("created_at")
            .execute()
        )
        goals: list[dict[str, Any]] = []
        for row in goals_resp.data or []:
            goals.append({
                "id": row.get("id"),
                "title": row.get("title") or row.get("description") or "",
                "description": row.get("description") or row.get("title") or "",
                "category": row.get("category") or "general",
                "priority": row.get("priority"),
                "worker_focus": row.get("worker_focus") or [],
            })
        return goals
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        logger.debug("active goals lookup failed: %s", exc)
        return []


def build_participant_risks(shift: dict[str, Any], organization_id: str) -> list[dict[str, Any]]:
    return build_structured_health_alerts(
        shift.get("health_alerts"),
        shift=shift,
        organization_id=organization_id,
    )



def _ensure_risks_acknowledged_if_required(shift: dict[str, Any], organization_id: str) -> None:
    if shift.get("risks_acknowledged_at"):
        pass
    elif build_participant_risks(shift, organization_id):
        raise ValueError("Acknowledge risks before continuing.")

    participant_id = str(shift.get("participant_id") or "")
    worker_id = str(shift.get("worker_id") or "")
    if participant_id and worker_id:
        from .safety_protocol_service import build_worker_safety_status

        status = build_worker_safety_status(
            participant_id=participant_id,
            organization_id=organization_id,
            worker_id=worker_id,
        )
        if status.get("requires_safety_ack"):
            raise ValueError(
                "Read and acknowledge the participant safety card before clocking in."
            )


def _resolve_worker_display_name(worker_id: str) -> Optional[str]:
    if not worker_id:
        return None
    try:
        resp = (
            get_supabase_admin()
            .table("users")
            .select("full_name, email")
            .eq("id", worker_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return None
        row = rows[0]
        name = (row.get("full_name") or "").strip()
        return name or (row.get("email") or "").strip() or None
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        logger.debug("worker name lookup failed: %s", exc)
        return None


def _attach_risk_acknowledgement_metadata(payload: dict[str, Any], shift: dict[str, Any]) -> None:
    worker_id = str(shift.get("risks_acknowledged_by") or "")
    if worker_id:
        payload["risks_acknowledged_by_name"] = _resolve_worker_display_name(worker_id)


SUPPORT_INSTRUCTION_CATEGORIES = (
    "Mobility",
    "Transfers",
    "Medication Prompts",
    "Meals",
    "Behaviour Support",
    "Personal Care",
)


def _normalise_instruction_section(raw: Any) -> Optional[dict[str, str]]:
    if not isinstance(raw, dict):
        return None
    category = (raw.get("category") or "").strip()
    body = (raw.get("body") or "").strip()
    if not category or not body:
        return None
    critical = raw.get("critical")
    if isinstance(critical, bool):
        critical_flag = "true" if critical else "false"
    else:
        critical_flag = "true" if str(critical or "").lower() in {"true", "1", "yes"} else "false"
    section: dict[str, str] = {
        "category": category,
        "body": body,
        "critical": critical_flag,
    }
    image_url = (raw.get("image_url") or "").strip()
    if image_url:
        section["image_url"] = image_url
    return section


def _stored_support_instructions(shift: dict) -> list[dict[str, str]]:
    raw = shift.get("support_instructions")
    if not raw:
        return []
    if isinstance(raw, list):
        sections = [_normalise_instruction_section(item) for item in raw]
        return [section for section in sections if section]
    return []


def _line_is_critical(text: str) -> bool:
    stripped = text.strip()
    return stripped.startswith("⛔") or stripped.lower().startswith("critical:")


def _body_has_critical_lines(body: str) -> bool:
    return any(_line_is_critical(line) for line in body.splitlines())


def _instruction_section(category: str, body: str, *, critical: bool = False, image_url: str = "") -> dict[str, str]:
    text = body.strip()
    is_critical = critical or _body_has_critical_lines(text)
    section: dict[str, str] = {
        "category": category,
        "body": text,
        "critical": "true" if is_critical else "false",
    }
    if image_url.strip():
        section["image_url"] = image_url.strip()
    return section


def _append_section(sections: list[dict[str, str]], category: str, body: str, **kwargs: Any) -> None:
    text = (body or "").strip()
    if not text:
        return
    sections.append(_instruction_section(category, text, **kwargs))


def _legacy_support_instructions(shift: dict, participant_ctx: Optional[dict[str, Any]] = None) -> list[dict[str, str]]:
    """Map legacy shift snapshot + participant fields into CARECLIQV2-157 categories."""
    sections: list[dict[str, str]] = []
    prefs = (participant_ctx or {}).get("preferences") or {}
    profile = (participant_ctx or {}).get("profile") or {}

    _append_section(sections, "Mobility", shift.get("access_instructions") or "")

    visit = (shift.get("visit_notes") or "").strip()
    transfer_lines = [line for line in visit.splitlines() if "transfer" in line.lower() or "gait belt" in line.lower()]
    if transfer_lines:
        _append_section(sections, "Transfers", "\n".join(transfer_lines), critical=True)
    elif visit and "transfer" in visit.lower():
        _append_section(sections, "Transfers", visit, critical=True)

    med_lines = [
        line for line in visit.splitlines()
        if any(token in line.lower() for token in ("medication", "medications", "mar chart", "meds"))
    ]
    medications = (profile.get("medications") or "").strip()
    if med_lines:
        _append_section(sections, "Medication Prompts", "\n".join(med_lines))
    elif medications:
        _append_section(sections, "Medication Prompts", medications)
    elif visit and any(token in visit.lower() for token in ("medication", "medications", "mar chart")):
        _append_section(sections, "Medication Prompts", visit)

    meal_hint = (shift.get("coordinator_notes") or "").strip()
    if meal_hint and any(token in meal_hint.lower() for token in ("meal", "hydration", "food", "snack")):
        _append_section(sections, "Meals", meal_hint)

    behaviour = (prefs.get("behaviour_support") or "").strip()
    if behaviour:
        _append_section(sections, "Behaviour Support", behaviour)

    personal_parts: list[str] = []
    flags = (shift.get("health_flags") or "").strip()
    if flags:
        personal_parts.append(flags)
    allergies = (shift.get("allergies") or "").strip()
    if allergies:
        personal_parts.append(f"Allergies: {allergies}")
    remaining_visit = "\n".join(
        line for line in visit.splitlines()
        if line not in transfer_lines and line not in med_lines
    ).strip()
    if remaining_visit and not any(
        token in remaining_visit.lower()
        for token in ("transfer", "gait belt", "medication", "medications", "mar chart")
    ):
        personal_parts.append(remaining_visit)
    if personal_parts:
        _append_section(sections, "Personal Care", "\n\n".join(personal_parts), critical=bool(allergies or flags))

    return sections


def build_support_instructions(
    shift: dict,
    participant_ctx: Optional[dict[str, Any]] = None,
) -> list[dict[str, str]]:
    """Return labelled support-instruction sections for a shift (CARECLIQV2-157)."""
    stored = _stored_support_instructions(shift)
    if stored:
        return stored
    return _legacy_support_instructions(shift, participant_ctx)


def _parse_support_instructions(
    shift: dict,
    participant_ctx: Optional[dict[str, Any]] = None,
) -> list[dict[str, str]]:
    return build_support_instructions(shift, participant_ctx)


def _session_counts_as_active(session: Optional[dict[str, Any]]) -> bool:
    if not session:
        return False
    return (session.get("status") or "") in {"draft", "in_progress", "active"}


def _should_keep_shift_session_link(shift: dict) -> bool:
    """Keep session link only when resuming a shift that already started documenting."""
    if shift.get("status") != "in_progress" or not shift.get("clocked_in_at"):
        return False
    return _session_counts_as_active(_get_session_for_shift(shift))


def _org_contact_number(organization_id: str) -> Optional[str]:
    if not organization_id:
        return None
    try:
        result = (
            get_supabase_admin()
            .table("organizations")
            .select("contact_number")
            .eq("organization_id", organization_id)
            .maybe_single()
            .execute()
        )
        row = result.data if result else None
        if isinstance(row, dict):
            value = str(row.get("contact_number") or "").strip()
            return value or None
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            logger.debug("org contact lookup failed: %s", exc)
    return None


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

    health_alerts = _parse_health_alerts(shift.get("health_alerts"))
    has_risk_alerts = bool(health_alerts) or bool(shift.get("allergies")) or bool(shift.get("health_flags"))

    payload = {
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
        "confirmation_status": shift.get("confirmation_status") or "confirmed",
        "visual_state": visual_state,
        "coordinator_notes": shift.get("coordinator_notes"),
        "entry_instructions": shift.get("entry_instructions"),
        "access_instructions": shift.get("access_instructions"),
        "health_alerts": health_alerts,
        "has_risk_alerts": has_risk_alerts,
        "allergies": shift.get("allergies"),
        "visit_notes": shift.get("visit_notes"),
        "health_flags": shift.get("health_flags"),
        "support_instructions": _parse_support_instructions(shift, None),
        "risks_acknowledged_at": shift.get("risks_acknowledged_at"),
        "risks_acknowledged_by": shift.get("risks_acknowledged_by"),
        "risks_acknowledged": bool(shift.get("risks_acknowledged_at")),
        "active_goals": shift.get("active_goals") or [],
        "tasks": shift.get("tasks") or [],
        "session_id": shift.get("session_id"),
        "session_status": session_status,
        "session_started_at": (session or {}).get("start_time"),
        "service_category": shift.get("service_category") or "CORE",
        "participant_dob": shift.get("participant_dob"),
        "participant_gender": shift.get("participant_gender"),
        "clock_in_method": shift.get("clock_in_method"),
        "clock_in_location": shift.get("clock_in_location"),
        "clock_in_verified": bool(shift.get("clock_in_verified")),
        "office_contact_number": _org_contact_number(str(shift.get("organization_id") or "")),
    }
    _attach_risk_acknowledgement_metadata(payload, shift)
    return payload


def _build_completion_summary(shift: dict[str, Any], session: Optional[dict[str, Any]]) -> dict[str, Any]:
    tasks = shift.get("tasks") or []
    mandatory = [
        t
        for t in tasks
        if t.get("mandatory") or (t.get("type") == "default" and int(t.get("order") or 0) <= 4)
    ]
    session_id = shift.get("session_id") or (session or {}).get("id")
    return {
        "tasks_completed": sum(1 for t in tasks if t.get("completed")),
        "tasks_total": len(tasks),
        "mandatory_completed": sum(1 for t in mandatory if t.get("completed")),
        "mandatory_total": len(mandatory),
        "session_id": session_id,
        "notes_submitted": bool((session or {}).get("compliance_input_text") or (session or {}).get("notes")),
    }


def _enrich_worker_shift_card(
    payload: dict[str, Any],
    shift: dict[str, Any],
    organization_id: str,
    session: Optional[dict[str, Any]] = None,
    worker_id: Optional[str] = None,
) -> dict[str, Any]:
    """Hydrate list/detail cards with participant risks, goals, and completion metadata."""
    participant_id = str(shift.get("participant_id") or "")
    risks = build_participant_risks(shift, organization_id)
    payload["health_alerts"] = risks
    payload["has_risk_alerts"] = bool(risks) or bool(shift.get("allergies")) or bool(shift.get("health_flags"))

    if not (payload.get("allergies") or "").strip():
        allergy_lines = [
            str(alert.get("description") or alert.get("title") or "").strip()
            for alert in risks
            if str(alert.get("type") or "").lower() == "allergy"
        ]
        allergy_lines = [line for line in allergy_lines if line]
        if allergy_lines:
            payload["allergies"] = "; ".join(dict.fromkeys(allergy_lines))

    if participant_id:
        active_goals = _fetch_active_goals_for_participant(participant_id, organization_id)
        if active_goals:
            payload["active_goals"] = active_goals

    if payload.get("status") == "completed" or payload.get("visual_state") == "completed":
        payload["completion_summary"] = _build_completion_summary(shift, session)
        try:
            from .shift_signature_service import get_shift_signature

            signature = get_shift_signature(str(shift.get("id") or ""))
            if signature:
                payload["shift_signature"] = signature
        except Exception:
            pass

    if worker_id and payload.get("visual_state") == "scheduled" and not shift.get("clocked_in_at"):
        try:
            from .briefing_service import is_briefing_complete_for_shift

            complete = is_briefing_complete_for_shift(shift, worker_id)
            payload["briefing_complete"] = complete
            payload["requires_briefing"] = not complete
        except Exception as exc:
            logger.debug("briefing list enrichment failed: %s", exc)
            payload.setdefault("briefing_complete", False)
            payload.setdefault("requires_briefing", True)

    return payload


def _parse_emergency_contact(raw: Any) -> dict[str, Any] | str | None:
    """Normalise emergency contact for worker profile display."""
    if raw is None:
        return None
    if isinstance(raw, dict):
        name = (raw.get("name") or raw.get("contact_name") or "").strip()
        phone = (raw.get("phone") or raw.get("contact_phone") or "").strip()
        relationship = (raw.get("relationship") or "").strip()
        if not name and not phone:
            return None
        return {
            "name": name or None,
            "phone": phone or None,
            "relationship": relationship or None,
            "display": " — ".join(p for p in (name, relationship, phone) if p) or phone or name,
        }
    text = str(raw).strip()
    return text or None


def _fetch_participant_allergies(participant_id: str, organization_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("participant_allergies")
            .select("id, allergen, severity, notes")
            .eq("participant_id", participant_id)
            .eq("organization_id", organization_id)
            .order("severity", desc=False)
            .execute()
        )
        return [dict(row) for row in (resp.data or []) if isinstance(row, dict)]
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        logger.debug("participant allergies lookup failed: %s", exc)
        return []


def _normalise_behavioural_notes(raw: Any) -> list[dict[str, str]]:
    if not raw:
        return []
    if isinstance(raw, str):
        text = raw.strip()
        return [{"title": "Behavioural note", "body": text}] if text else []
    if not isinstance(raw, list):
        return []
    notes: list[dict[str, str]] = []
    for item in raw:
        if isinstance(item, dict):
            body = (item.get("body") or item.get("text") or "").strip()
            if not body:
                continue
            notes.append({
                "title": (item.get("title") or "Behavioural note").strip(),
                "body": body,
            })
        elif isinstance(item, str) and item.strip():
            notes.append({"title": "Behavioural note", "body": item.strip()})
    return notes


def _normalise_activities(raw: Any) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    if isinstance(raw, str) and raw.strip():
        return [line.strip() for line in raw.splitlines() if line.strip()]
    return []


def _enrich_shift_participant_context(payload: dict[str, Any], shift: dict[str, Any]) -> None:
    """Merge shift snapshot + participant row into worker-facing profile/preferences/context."""
    profile = dict(payload.get("profile") or {})
    preferences = dict(payload.get("preferences") or {})
    context = dict(payload.get("context") or {})
    medical = dict(context.get("medical") or {})

    if not profile.get("preferred_name") and shift.get("participant_name"):
        profile["preferred_name"] = shift.get("participant_name")
    if not profile.get("phone") and shift.get("participant_phone"):
        profile["phone"] = shift.get("participant_phone")
    if not profile.get("date_of_birth") and shift.get("participant_dob"):
        profile["date_of_birth"] = shift.get("participant_dob")

    if not preferences.get("routines") and shift.get("visit_notes"):
        preferences["routines"] = shift.get("visit_notes")
    if not preferences.get("health_flags") and shift.get("health_flags"):
        preferences["health_flags"] = shift.get("health_flags")
    if not preferences.get("likes_dislikes") and shift.get("allergies"):
        preferences["likes_dislikes"] = shift.get("allergies")
    if not preferences.get("communication_style") and shift.get("coordinator_notes"):
        preferences["communication_style"] = shift.get("coordinator_notes")

    if not medical.get("alerts") and shift.get("allergies"):
        medical["alerts"] = shift.get("allergies")
    if not medical.get("conditions") and profile.get("primary_disability"):
        medical["conditions"] = profile.get("primary_disability")

    context["medical"] = medical
    payload["profile"] = profile
    payload["preferences"] = preferences
    payload["context"] = context
    payload.setdefault("context_synced_at", _now_iso())


def _fetch_participant_context(participant_id: str, organization_id: str) -> dict[str, Any]:
    """Load read-only participant profile + preferences + context (CARECLIQV2-195/196/295)."""
    if not participant_id:
        return {}
    synced_at = _now_iso()
    # Note: visit_notes / health_flags live on shifts, not patients.
    select_cols = (
        "id, full_name, preferred_name, ndis_number, date_of_birth, phone, email, "
        "communication_preferences, allergies, primary_disability, "
        "emergency_contact, behaviour_support_plan, restricted_behavioural_notes, "
        "medications, medical_alerts, current_conditions, "
        "case_manager_name, case_manager_phone, likes_dislikes, sensory_preferences, "
        "cultural_preferences, preferred_activities, communication_guidance, "
        "previous_visit_notes, previous_visit_notes_updated_at, behavioural_notes"
    )
    try:
        resp = (
            get_supabase_admin()
            .table("patients")
            .select(select_cols)
            .eq("id", participant_id)
            .eq("organization_id", organization_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return {}
        row = rows[0]
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return _fetch_participant_context_legacy(participant_id, organization_id)
        logger.debug("participant context lookup failed: %s", exc)
        return {}

    allergies = _fetch_participant_allergies(participant_id, organization_id)
    behavioural = _normalise_behavioural_notes(row.get("behavioural_notes"))
    if not behavioural and (row.get("restricted_behavioural_notes") or "").strip():
        behavioural = _normalise_behavioural_notes(row.get("restricted_behavioural_notes"))

    preferred_name = (row.get("preferred_name") or row.get("full_name") or "").strip() or None
    emergency = _parse_emergency_contact(row.get("emergency_contact"))

    return {
        "profile": {
            "preferred_name": preferred_name,
            "date_of_birth": row.get("date_of_birth"),
            "ndis_number": row.get("ndis_number"),
            "phone": row.get("phone"),
            "email": row.get("email"),
            "emergency_contact": emergency,
            "case_manager": {
                "name": row.get("case_manager_name"),
                "phone": row.get("case_manager_phone"),
            },
            "primary_disability": row.get("primary_disability"),
            "medications": row.get("medications"),
        },
        "preferences": {
            "communication_style": row.get("communication_preferences"),
            "likes_dislikes": row.get("likes_dislikes") or row.get("allergies"),
            "routines": None,
            "sensory_preferences": row.get("sensory_preferences"),
            "cultural_preferences": row.get("cultural_preferences"),
            "behaviour_support": row.get("behaviour_support_plan"),
            "health_flags": None,
        },
        "context": {
            "medical": {
                "allergies": allergies,
                "conditions": row.get("current_conditions") or row.get("primary_disability"),
                "medications": row.get("medications"),
                "alerts": row.get("medical_alerts"),
            },
            "behavioural_notes": behavioural,
            "preferred_activities": _normalise_activities(row.get("preferred_activities")),
            "previous_visit_notes": row.get("previous_visit_notes"),
            "previous_visit_notes_updated_at": row.get("previous_visit_notes_updated_at"),
            "communication_guidance": row.get("communication_guidance"),
        },
        "context_synced_at": synced_at,
    }


def _fetch_participant_context_legacy(participant_id: str, organization_id: str) -> dict[str, Any]:
    """Fallback when 036 migration columns are not yet applied."""
    try:
        resp = (
            get_supabase_admin()
            .table("patients")
            .select(
                "id, full_name, ndis_number, date_of_birth, phone, email, "
                "communication_preferences, allergies, primary_disability, "
                "behaviour_support_plan, restricted_behavioural_notes, "
                "medications, medical_alerts"
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
        synced_at = _now_iso()
        return {
            "profile": {
                "preferred_name": row.get("full_name"),
                "date_of_birth": row.get("date_of_birth"),
                "ndis_number": row.get("ndis_number"),
                "phone": row.get("phone"),
                "email": row.get("email"),
                "emergency_contact": _parse_emergency_contact(row.get("emergency_contact")),
                "case_manager": {"name": None, "phone": None},
                "primary_disability": row.get("primary_disability"),
                "medications": row.get("medications"),
            },
            "preferences": {
                "communication_style": row.get("communication_preferences"),
                "behaviour_support": row.get("behaviour_support_plan"),
                "restricted_notes": row.get("restricted_behavioural_notes"),
                "routines": None,
                "health_flags": None,
                "likes_dislikes": row.get("allergies"),
            },
            "context": {
                "medical": {
                    "allergies": [],
                    "conditions": row.get("primary_disability"),
                    "medications": row.get("medications"),
                    "alerts": row.get("medical_alerts"),
                },
                "behavioural_notes": _normalise_behavioural_notes(row.get("restricted_behavioural_notes")),
                "preferred_activities": [],
                "previous_visit_notes": None,
                "previous_visit_notes_updated_at": None,
                "communication_guidance": row.get("communication_preferences"),
            },
            "context_synced_at": synced_at,
        }
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return {}
        logger.debug("participant context legacy lookup failed: %s", exc)
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
            .select("id, status, session_date, duration_minutes, start_time, notes, compliance_input_text")
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
        card = _shift_card_payload(shift, session)
        cards.append(_enrich_worker_shift_card(card, shift, organization_id, session, worker_id))
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
        raise ShiftAccessDenied("You do not have access to this shift.")
    if str(shift.get("organization_id") or "") != str(organization_id):
        raise ShiftAccessDenied("Shift does not belong to your organisation.")
    session = _get_session_for_shift(shift)
    payload = _shift_card_payload(shift, session)
    participant_id = str(shift.get("participant_id") or "")
    ctx = _fetch_participant_context(participant_id, organization_id)
    payload.update(ctx)
    _enrich_shift_participant_context(payload, shift)
    payload["support_instructions"] = build_support_instructions(shift, payload)
    payload["health_alerts"] = build_participant_risks(shift, organization_id)
    payload["has_risk_alerts"] = bool(payload["health_alerts"])
    if participant_id and worker_id:
        from .safety_protocol_service import build_worker_safety_status, get_protocol

        safety_status = build_worker_safety_status(
            participant_id=participant_id,
            organization_id=organization_id,
            worker_id=worker_id,
        )
        payload.update(safety_status)
        if safety_status.get("has_safety_content"):
            protocol = get_protocol(participant_id, organization_id)
            protocol = {**protocol, **safety_status}
            payload["safety_protocol"] = protocol
    active_goals = _fetch_active_goals_for_participant(participant_id, organization_id)
    if active_goals:
        payload["active_goals"] = active_goals
    primary_contact = (payload.get("profile") or {}).get("emergency_contact")
    if primary_contact:
        payload["primary_contact"] = primary_contact
    try:
        from .shift_signature_service import get_shift_signature

        signature = get_shift_signature(shift_id)
        if signature:
            payload["shift_signature"] = signature
    except Exception:
        pass
    try:
        from .briefing_service import get_briefing_for_worker, is_briefing_complete_for_shift

        briefing = get_briefing_for_worker(shift_id, worker_id, organization_id)
        payload["briefing_complete"] = briefing.get("briefing_complete", False)
        payload["requires_briefing"] = not is_briefing_complete_for_shift(shift, worker_id)
        payload["special_instructions"] = briefing.get("special_instructions")
    except Exception as exc:
        logger.debug("briefing enrichment failed: %s", exc)
        payload.setdefault("briefing_complete", bool(shift.get("clocked_in_at")))
        payload.setdefault("requires_briefing", not bool(shift.get("clocked_in_at")))
    return payload


def _get_worker_shift_or_none(
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
    return shift


def get_participant_risks_for_worker(
    shift_id: str,
    worker_id: str,
    organization_id: str,
) -> Optional[dict[str, Any]]:
    """Structured participant risk alerts for a shift (CARECLIQV2-158)."""
    shift = _get_worker_shift_or_none(shift_id, worker_id, organization_id)
    if not shift:
        return None
    risks = build_participant_risks(shift, organization_id)
    payload: dict[str, Any] = {
        "shift_id": shift_id,
        "participant_id": shift.get("participant_id"),
        "alerts": risks,
        "risks_acknowledged": bool(shift.get("risks_acknowledged_at")),
        "risks_acknowledged_at": shift.get("risks_acknowledged_at"),
        "risks_acknowledged_by": shift.get("risks_acknowledged_by"),
    }
    _attach_risk_acknowledgement_metadata(payload, shift)
    return payload


def get_support_instructions_for_worker(
    shift_id: str,
    worker_id: str,
    organization_id: str,
) -> Optional[dict[str, Any]]:
    """Dedicated support-instructions payload for MyShift detail (CARECLIQV2-157)."""
    shift = _get_worker_shift_or_none(shift_id, worker_id, organization_id)
    if not shift:
        return None
    ctx = _fetch_participant_context(str(shift.get("participant_id") or ""), organization_id)
    return {
        "shift_id": shift_id,
        "support_instructions": build_support_instructions(shift, ctx),
    }


def get_participant_profile_for_worker(
    shift_id: str,
    worker_id: str,
    organization_id: str,
) -> Optional[dict[str, Any]]:
    """Dedicated participant profile payload for My Shift (CARECLIQV2-195 / subtask 150)."""
    shift = _get_worker_shift_or_none(shift_id, worker_id, organization_id)
    if not shift:
        return None
    payload: dict[str, Any] = {}
    ctx = _fetch_participant_context(str(shift.get("participant_id") or ""), organization_id)
    payload.update(ctx)
    _enrich_shift_participant_context(payload, shift)
    return {
        "shift_id": shift_id,
        "participant_id": shift.get("participant_id"),
        "profile": payload.get("profile") or {},
        "context_synced_at": payload.get("context_synced_at"),
    }


def get_participant_preferences_for_worker(
    shift_id: str,
    worker_id: str,
    organization_id: str,
) -> Optional[dict[str, Any]]:
    """Dedicated participant preferences payload for My Shift (CARECLIQV2-196 / subtask 160)."""
    shift = _get_worker_shift_or_none(shift_id, worker_id, organization_id)
    if not shift:
        return None
    payload: dict[str, Any] = {}
    ctx = _fetch_participant_context(str(shift.get("participant_id") or ""), organization_id)
    payload.update(ctx)
    _enrich_shift_participant_context(payload, shift)
    return {
        "shift_id": shift_id,
        "participant_id": shift.get("participant_id"),
        "preferences": payload.get("preferences") or {},
        "context_synced_at": payload.get("context_synced_at"),
    }


def _default_tasks_copy() -> list[dict[str, Any]]:
    import copy
    return copy.deepcopy(DEFAULT_SHIFT_TASKS)


def _apply_verified_check_in(
    shift: dict[str, Any],
    organization_id: str,
    *,
    method: str,
    location: Optional[dict[str, Any]] = None,
    qr_token: Optional[str] = None,
) -> dict[str, Any]:
    method = (method or "").strip().lower()
    if method not in {"gps", "qr"}:
        raise ValueError("Check-in method must be gps or qr.")

    verified = False
    verification_distance: Optional[float] = None
    qr_code_id: Optional[str] = None

    if method == "gps":
        if not location or location.get("lat") is None or location.get("lng") is None:
            raise ValueError("GPS check-in requires your device location.")
        worker_lat = float(location["lat"])
        worker_lng = float(location["lng"])
        accuracy = location.get("accuracy")
        coords = resolve_participant_coordinates(
            shift,
            shift.get("participant_id"),
            organization_id,
        )
        if coords:
            ok, verification_distance = verify_gps_location(
                worker_lat,
                worker_lng,
                coords[0],
                coords[1],
                accuracy=float(accuracy) if accuracy is not None else None,
            )
            if not ok:
                dist_label = int(verification_distance or 0)
                raise ValueError(
                    f"You are too far from the participant location ({dist_label}m away). "
                    "Move closer or scan the location QR code."
                )
            verified = True
    elif method == "qr":
        if not qr_token:
            raise ValueError("QR check-in requires a scanned code.")
        _, qr_code_id, _ = verify_qr_token_for_shift(qr_token, shift, organization_id)
        verified = True

    return {
        "clock_in_method": method,
        "clock_in_location": location,
        "clock_in_verified": verified,
        "_verification_distance_meters": verification_distance,
        "_qr_code_id": qr_code_id,
    }


def clock_in_shift(
    shift_id: str,
    worker_id: str,
    organization_id: str,
    *,
    method: Optional[str] = None,
    location: Optional[dict[str, Any]] = None,
    qr_token: Optional[str] = None,
    client_timestamp: Optional[str] = None,
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

    if shift.get("clocked_in_at"):
        raise ShiftAlreadyClockedIn("Shift is already clocked in.")

    _ensure_risks_acknowledged_if_required(shift, organization_id)
    from .briefing_service import ensure_briefing_completed

    ensure_briefing_completed(shift, worker_id)

    validate_shift_scheduled_today(str(shift.get("scheduled_start") or ""))
    check_in_meta: dict[str, Any] = {}
    verification_distance: Optional[float] = None
    qr_code_id: Optional[str] = None

    validate_clock_in_window(str(shift.get("scheduled_start") or ""))
    if not method:
        raise ValueError(
            "Verified check-in required. Choose GPS or scan the location QR code."
        )
    check_in_meta = _apply_verified_check_in(
        shift,
        organization_id,
        method=method,
        location=location,
        qr_token=qr_token,
    )
    verification_distance = check_in_meta.pop("_verification_distance_meters", None)
    qr_code_id = check_in_meta.pop("_qr_code_id", None)

    normalized_client_ts = normalize_client_timestamp(client_timestamp)
    now = normalized_client_ts or _now_iso()
    tasks = shift.get("tasks") or []
    if not tasks:
        tasks = _default_tasks_copy()

    update_payload: dict[str, Any] = {
        "status": "in_progress",
        "clocked_in_at": shift.get("clocked_in_at") or now,
        "tasks": tasks,
        "updated_at": _now_iso(),
    }
    update_payload.update(check_in_meta)
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
            stripped = {
                key: value
                for key, value in update_payload.items()
                if key not in {"clock_in_method", "clock_in_location", "clock_in_verified"}
            }
            try:
                resp = (
                    get_supabase_admin()
                    .table("shifts")
                    .update(stripped)
                    .eq("id", shift_id)
                    .execute()
                )
                rows = resp.data or []
                updated = rows[0] if rows else {**shift, **stripped}
            except Exception as retry_exc:
                if _is_missing_schema_error(retry_exc):
                    logger.debug("shifts table unavailable: %s", retry_exc)
                    return None
                raise
        else:
            raise

    if check_in_meta:
        log_shift_check_in(
            shift_id=shift_id,
            worker_id=worker_id,
            organization_id=organization_id,
            method=str(check_in_meta.get("clock_in_method") or method or "manual"),
            location=check_in_meta.get("clock_in_location"),
            verified=bool(check_in_meta.get("clock_in_verified")),
            verification_distance_meters=verification_distance,
            qr_code_id=qr_code_id,
            client_timestamp=normalized_client_ts,
        )

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

    for task in tasks:
        if task.get("marked_na"):
            continue
        is_mandatory = task.get("mandatory") is True or (
            task.get("type") == "default"
            and task.get("mandatory") is not False
            and int(task.get("order") or 0) <= 4
        )
        if is_mandatory and task.get("completed") and not _mandatory_task_satisfied(task):
            label = str(task.get("label") or "task")
            raise ValueError(
                f'Mandatory task "{label}" needs a photo, voice memo, or note of at least 20 characters.'
            )

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

    risks = build_participant_risks(shift, organization_id)
    if not risks:
        raise ValueError("No safety alerts to acknowledge for this shift.")

    if shift.get("risks_acknowledged_at"):
        session = _get_session_for_shift(shift)
        payload = _shift_card_payload(shift, session)
        payload["health_alerts"] = risks
        payload["has_risk_alerts"] = True
        return payload

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
    payload = _shift_card_payload(updated, session)
    payload["health_alerts"] = build_participant_risks(updated, organization_id)
    payload["has_risk_alerts"] = bool(payload["health_alerts"])
    return payload


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


def worker_has_shift_for_participant(
    participant_id: str,
    worker_id: str,
    organization_id: str,
) -> bool:
    """True when the worker has at least one shift for this participant in-org."""
    if not participant_id or not worker_id or not organization_id:
        return False
    if not _participant_exists_in_org(participant_id, organization_id):
        return False
    try:
        resp = (
            get_supabase_admin()
            .table("shifts")
            .select("id")
            .eq("participant_id", participant_id)
            .eq("worker_id", worker_id)
            .eq("organization_id", organization_id)
            .limit(1)
            .execute()
        )
        return bool(resp.data)
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return False
        logger.debug("worker_has_shift_for_participant failed: %s", exc)
        return False


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
    _ensure_risks_acknowledged_if_required(shift, organization_id)

    participant_id = shift.get("participant_id")
    if not participant_id:
        raise ValueError("Shift has no participant.")
    if not _participant_exists_in_org(str(participant_id), str(organization_id)):
        raise ValueError("Participant not found")

    existing_session_id = shift.get("session_id")
    if existing_session_id:
        session = _get_session_for_shift(shift)
        if _session_counts_as_active(session):
            return _shift_card_payload(shift, session)
        # Stale link (e.g. prior completed session) — start a fresh draft below.

    duration = 60
    if shift.get("scheduled_start") and shift.get("scheduled_end"):
        try:
            start = datetime.fromisoformat(str(shift["scheduled_start"]).replace("Z", "+00:00"))
            end = datetime.fromisoformat(str(shift["scheduled_end"]).replace("Z", "+00:00"))
            duration = max(1, int((end - start).total_seconds() // 60))
        except ValueError:
            pass

    started_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    payload = _prepare_session_payload({
        "participant_id": str(participant_id),
        "session_date": date.today(),
        "duration_minutes": duration,
        "session_type": "support_work",
        "status": "draft",
        "shift_id": shift_id,
        "start_time": started_at,
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
            payload.pop("start_time", None)
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


def _format_start_session_response(session: dict, shift: Optional[dict] = None) -> dict[str, Any]:
    status = (session.get("status") or "draft").lower()
    api_status = "active" if status in ("draft", "in_progress", "active") else status
    started_at = session.get("start_time") or _now_iso()
    payload = {
        "success": True,
        "session": {
            "sessionId": str(session.get("id")),
            "status": api_status,
            "startedAt": started_at,
            "participantId": session.get("participant_id") or session.get("patient_id"),
            "shiftId": session.get("shift_id") or (shift or {}).get("id"),
        },
    }
    if shift:
        payload["shift"] = _shift_card_payload(shift, session)
    return payload


def start_session_by_id(
    session_id: str,
    worker_id: str,
    organization_id: str,
    started_at: Optional[str] = None,
    worker_location: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Start an existing session by id (CARECLIQV2-244)."""
    try:
        resp = (
            get_supabase_admin()
            .table("sessions")
            .select("*")
            .eq("id", str(session_id))
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_schema_error(exc):
            raise ValueError("Session not found") from exc
        raise

    rows = resp.data or []
    if not rows:
        raise ValueError("Session not found")
    session = rows[0]

    session_org = str(session.get("organization_id") or "")
    if session_org and session_org != str(organization_id):
        raise ValueError("Session not found")

    shift = get_shift_for_session(session)
    if shift:
        if str(shift.get("worker_id") or "") != str(worker_id):
            raise PermissionError("Not authorized to start this session")
        if str(shift.get("organization_id") or "") != str(organization_id):
            raise ValueError("Session not found")
        if not shift.get("clocked_in_at"):
            raise ValueError("Clock in before starting a session.")
        _ensure_risks_acknowledged_if_required(shift, organization_id)
    else:
        owner = str(session.get("worker_id") or session.get("created_by") or "")
        if owner and owner != str(worker_id):
            raise PermissionError("Not authorized to start this session")

    status = (session.get("status") or "").lower()
    if status in ("completed", "cancelled"):
        raise ValueError("Session cannot be started")

    if _session_counts_as_active(session) and session.get("start_time"):
        return _format_start_session_response(session, shift)

    started = started_at or _now_iso()
    update_payload: dict[str, Any] = {
        "start_time": started,
        "status": "draft",
    }
    if worker_location and isinstance(worker_location, dict):
        lat = worker_location.get("lat")
        lng = worker_location.get("lng")
        if lat is not None and lng is not None:
            update_payload["worker_location"] = {"lat": lat, "lng": lng}

    try:
        get_supabase_admin().table("sessions").update(update_payload).eq("id", str(session_id)).execute()
    except Exception as exc:
        if _is_missing_schema_error(exc):
            update_payload.pop("worker_location", None)
            get_supabase_admin().table("sessions").update(update_payload).eq("id", str(session_id)).execute()
        else:
            raise

    refreshed = (
        get_supabase_admin()
        .table("sessions")
        .select("*")
        .eq("id", str(session_id))
        .limit(1)
        .execute()
    )
    updated_session = (refreshed.data or [session])[0]
    updated_shift = get_shift_for_session(updated_session) or shift
    return _format_start_session_response(updated_session, updated_shift)


def _mandatory_task_satisfied(task: dict[str, Any]) -> bool:
    if not task.get("completed"):
        return False
    note = str(task.get("note") or task.get("context_note") or "").strip()
    has_photo = bool(task.get("photo_evidence")) or bool(task.get("has_photo")) or bool(task.get("photo_thumbnails"))
    has_voice = bool(task.get("voice_evidence")) or bool(task.get("has_voice")) or bool(task.get("voice_duration_seconds"))
    if has_photo or has_voice:
        return True
    if len(note) >= 20:
        return True
    return False


def _mandatory_tasks_complete(tasks: list[dict[str, Any]]) -> bool:
    for task in tasks:
        if task.get("marked_na"):
            continue
        is_mandatory = task.get("mandatory") is True or (
            task.get("type") == "default" and task.get("mandatory") is not False and int(task.get("order") or 0) <= 4
        )
        if not is_mandatory:
            continue
        if not _mandatory_task_satisfied(task):
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

    from .shift_signature_service import require_signature_for_shift

    require_signature_for_shift(shift_id)

    tasks = shift.get("tasks") or []
    validation = compute_shift_validation(tasks)
    if force:
        validation["force_ended"] = True

    if tasks and not _mandatory_tasks_complete(tasks) and not force:
        raise ValueError("Complete all mandatory tasks before ending the shift.")

    now = _now_iso()
    session_id = shift.get("session_id")
    if session_id:
        try:
            session_update: dict[str, Any] = {
                "status": "completed",
                "updated_at": now,
                "end_validation": validation,
            }
            get_supabase_admin().table("sessions").update(session_update).eq("id", str(session_id)).execute()
        except Exception as exc:
            if not _is_missing_schema_error(exc):
                raise
            try:
                get_supabase_admin().table("sessions").update({
                    "status": "completed",
                    "updated_at": now,
                }).eq("id", str(session_id)).execute()
            except Exception as inner_exc:
                if not _is_missing_schema_error(inner_exc):
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
    payload["completion_summary"] = {
        **_build_completion_summary(updated, session),
        "validation": validation,
    }
    try:
        from .conversation_service import set_conversation_read_only_for_shift

        set_conversation_read_only_for_shift(shift_id)
    except Exception:
        pass
    try:
        from .shift_signature_service import get_shift_signature

        sig = get_shift_signature(shift_id)
        if sig:
            payload["shift_signature"] = sig
    except Exception:
        pass
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
    *,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """Merge task evidence into sessions.task_evidence (CARECLIQV2-228)."""
    from .compliance_evidence_service import record_text_evidence_metadata

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
        stored = {**item, "session_id": session_id, "synced": True}
        etype = str(item.get("type") or "")
        if etype in ("photo", "voice") and not item.get("file_url"):
            content = str(item.get("content") or "")
            if content.startswith("data:") and len(content) > 500:
                stored["content"] = ""
        by_id[eid] = stored
        synced_ids.append(eid)
        if etype == "text":
            record_text_evidence_metadata(
                evidence_id=eid,
                session_id=session_id,
                organization_id=organization_id,
                uploaded_by=worker_id,
                content=str(item.get("content") or ""),
                task_id=str(item.get("task_id") or "") or None,
                goal_id=item.get("goal_id"),
                ip_address=ip_address,
                user_agent=user_agent,
            )

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


def list_shift_visit_notes(
    shift_id: str,
    worker_id: str,
    organization_id: str,
) -> list[dict[str, Any]]:
    shift = _get_worker_shift_or_none(shift_id, worker_id, organization_id)
    if not shift:
        return []
    try:
        result = (
            get_supabase_admin()
            .table("shift_visit_notes")
            .select("*")
            .eq("shift_id", shift_id)
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )
        return result.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        raise


def create_shift_visit_note(
    shift_id: str,
    worker_id: str,
    organization_id: str,
    content: str,
    category: Optional[str] = None,
    session_id: Optional[str] = None,
    attachment_urls: Optional[list[str]] = None,
) -> Optional[dict[str, Any]]:
    shift = _get_worker_shift_or_none(shift_id, worker_id, organization_id)
    if not shift:
        return None
    text = (content or "").strip()
    if not text:
        raise ValueError("Note content is required.")
    now = _now_iso()
    payload = {
        "organization_id": organization_id,
        "shift_id": shift_id,
        "worker_id": worker_id,
        "session_id": session_id or shift.get("session_id"),
        "content": text,
        "category": (category or "").strip() or None,
        "attachment_urls": attachment_urls or [],
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = get_supabase_admin().table("shift_visit_notes").insert(payload).execute()
        rows = result.data or []
        return rows[0] if rows else None
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        raise


TASK_CONTEXT_NOTE_MAX = 150
SESSION_PROGRESS_NOTE_MAX = 500


def _goal_id_for_shift_task(shift: dict[str, Any], task_id: Optional[str]) -> Optional[str]:
    if not task_id:
        return None
    tasks = shift.get("tasks") or []
    if not isinstance(tasks, list):
        return None
    for task in tasks:
        if not isinstance(task, dict):
            continue
        if str(task.get("task_id") or "") == str(task_id):
            goal = task.get("goal_id")
            return str(goal) if goal else None
    return None


def _note_payload_from_row(row: dict[str, Any]) -> dict[str, Any]:
    category = str(row.get("category") or "")
    note_type = "text"
    if category.endswith("_voice"):
        note_type = "voice"
    elif category.endswith("_photo"):
        note_type = "photo"
    elif category.endswith("_file"):
        note_type = "file"
    attachments = row.get("attachment_urls") or []
    file_name = None
    if attachments and isinstance(attachments, list) and attachments[0]:
        first = str(attachments[0])
        if first.startswith("name:"):
            file_name = first.split(":", 1)[1] if ":" in first else None
    content = row.get("content") or ""
    if not file_name and content.startswith("[Attachment"):
        match = re.search(r"\[Attachment(?:\s+selected)?:\s*([^\]]+)\]", content)
        if match:
            file_name = match.group(1).strip()
    return {
        "note_id": str(row.get("client_note_id") or row.get("id") or ""),
        "id": row.get("id"),
        "session_id": row.get("session_id"),
        "task_id": row.get("task_id"),
        "goal_id": row.get("goal_id"),
        "content": content,
        "created_at": row.get("created_at"),
        "auto_saved_at": row.get("auto_saved_at") or row.get("updated_at"),
        "synced": True,
        "note_type": note_type,
        "file_name": file_name,
        "attachment_urls": [u for u in attachments if isinstance(u, str) and not u.startswith("name:")],
    }


def _get_worker_session_or_none(
    session_id: str,
    worker_id: str,
    organization_id: str,
) -> Optional[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("sessions")
            .select("id, shift_id, worker_id, support_worker_id, owner_user_id, created_by, organization_id")
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
    return session


def list_session_notes(
    session_id: str,
    worker_id: str,
    organization_id: str,
) -> Optional[list[dict[str, Any]]]:
    """List notes for an active session (CARECLIQV2-231)."""
    session = _get_worker_session_or_none(session_id, worker_id, organization_id)
    if not session:
        return None
    try:
        result = (
            get_supabase_admin()
            .table("shift_visit_notes")
            .select("*")
            .eq("session_id", session_id)
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )
        rows = result.data or []
        return [_note_payload_from_row(row) for row in rows]
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        raise


def sync_session_notes(
    session_id: str,
    worker_id: str,
    organization_id: str,
    note_items: list[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    """Upsert session/task-linked notes from the worker client (CARECLIQV2-231)."""
    session = _get_worker_session_or_none(session_id, worker_id, organization_id)
    if not session:
        return None

    shift = get_shift_for_session(session)
    if not shift:
        return None
    if str(shift.get("worker_id") or "") != str(worker_id):
        return None

    shift_id = str(shift.get("id") or "")
    now = _now_iso()
    confirmed: list[dict[str, Any]] = []

    for item in note_items:
        if not isinstance(item, dict):
            continue
        content = str(item.get("content") or "").strip()
        if not content:
            continue

        task_id = str(item.get("task_id") or "").strip() or None
        max_len = TASK_CONTEXT_NOTE_MAX if task_id else SESSION_PROGRESS_NOTE_MAX
        if len(content) > max_len:
            content = content[:max_len]

        goal_id = str(item.get("goal_id") or "").strip() or None
        if task_id and not goal_id:
            goal_id = _goal_id_for_shift_task(shift, task_id)

        client_note_id = str(item.get("note_id") or item.get("client_note_id") or "").strip() or None
        auto_saved_at = item.get("auto_saved_at") or now
        created_at = item.get("created_at") or now
        note_type = str(item.get("note_type") or "text").strip().lower()
        if task_id:
            category = "task_context"
        elif note_type == "voice":
            category = "session_progress_voice"
        elif note_type == "photo":
            category = "session_progress_photo"
        elif note_type == "file":
            category = "session_progress_file"
        else:
            category = "session_progress"

        attachment_urls: list[str] = []
        raw_attachments = item.get("attachment_urls")
        if isinstance(raw_attachments, list):
            attachment_urls = [str(u) for u in raw_attachments if u]
        file_name = str(item.get("file_name") or "").strip()
        if file_name and not any(u.startswith("name:") for u in attachment_urls):
            attachment_urls = [f"name:{file_name}", *attachment_urls]

        payload = {
            "organization_id": organization_id,
            "shift_id": shift_id,
            "worker_id": worker_id,
            "session_id": session_id,
            "content": content,
            "task_id": task_id,
            "goal_id": goal_id,
            "auto_saved_at": auto_saved_at,
            "updated_at": now,
            "category": category,
        }
        if client_note_id:
            payload["client_note_id"] = client_note_id

        try:
            if client_note_id:
                existing = (
                    get_supabase_admin()
                    .table("shift_visit_notes")
                    .select("id")
                    .eq("session_id", session_id)
                    .eq("client_note_id", client_note_id)
                    .limit(1)
                    .execute()
                )
                rows = existing.data or []
                if rows:
                    row_id = rows[0]["id"]
                    get_supabase_admin().table("shift_visit_notes").update(payload).eq("id", row_id).execute()
                    payload["id"] = row_id
                    payload["created_at"] = created_at
                    confirmed.append(_note_payload_from_row({**payload, "id": row_id}))
                    continue

            insert_payload = {
                **payload,
                "attachment_urls": attachment_urls,
                "created_at": created_at,
            }
            result = get_supabase_admin().table("shift_visit_notes").insert(insert_payload).execute()
            rows = result.data or []
            if rows:
                confirmed.append(_note_payload_from_row(rows[0]))
        except Exception as exc:
            if _is_missing_schema_error(exc):
                return None
            raise

    return {
        "session_id": session_id,
        "notes": confirmed,
    }


def delete_session_note(
    session_id: str,
    note_id: str,
    worker_id: str,
    organization_id: str,
) -> bool:
    """Delete a session note by server id or client note id (CARECLIQV2-231)."""
    session = _get_worker_session_or_none(session_id, worker_id, organization_id)
    if not session:
        return False

    try:
        for column in ("id", "client_note_id"):
            check = (
                get_supabase_admin()
                .table("shift_visit_notes")
                .select("id")
                .eq("session_id", session_id)
                .eq(column, note_id)
                .limit(1)
                .execute()
            )
            rows = check.data or []
            if not rows:
                continue
            row_id = rows[0].get("id")
            if not row_id:
                continue
            get_supabase_admin().table("shift_visit_notes").delete().eq("id", row_id).execute()
            return True
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return False
        raise
    return False


def list_shift_office_messages(
    shift_id: str,
    worker_id: str,
    organization_id: str,
) -> list[dict[str, Any]]:
    shift = _get_worker_shift_or_none(shift_id, worker_id, organization_id)
    if not shift:
        return []
    try:
        result = (
            get_supabase_admin()
            .table("shift_office_messages")
            .select("*")
            .eq("shift_id", shift_id)
            .order("created_at", desc=True)
            .limit(100)
            .execute()
        )
        return result.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        raise


def create_shift_office_message(
    shift_id: str,
    worker_id: str,
    organization_id: str,
    message: str,
    priority: str = "normal",
    attachment_urls: Optional[list[str]] = None,
    attachment_data: Optional[list[str]] = None,
) -> Optional[dict[str, Any]]:
    shift = _get_worker_shift_or_none(shift_id, worker_id, organization_id)
    if not shift:
        return None
    text = (message or "").strip()
    if not text:
        raise ValueError("Message is required.")
    priority_norm = priority if priority in ("normal", "urgent", "emergency") else "normal"
    now = _now_iso()
    urls = list(attachment_urls or [])
    if attachment_data:
        from .incident_service import _upload_incident_photos

        uploaded = _upload_incident_photos(
            attachment_data,
            str(organization_id),
            f"office_{shift_id}_{uuid.uuid4().hex[:8]}",
        )
        urls.extend(uploaded)
    payload = {
        "organization_id": organization_id,
        "shift_id": shift_id,
        "worker_id": worker_id,
        "message": text,
        "priority": priority_norm,
        "attachment_urls": urls,
        "created_at": now,
    }
    try:
        result = get_supabase_admin().table("shift_office_messages").insert(payload).execute()
        rows = result.data or []
        return rows[0] if rows else None
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        raise


def get_shift_location_details(
    shift_id: str,
    worker_id: str,
    organization_id: str,
) -> Optional[dict[str, Any]]:
    """Navigation payload for CARECLIQV2-214."""
    shift = _get_worker_shift_or_none(shift_id, worker_id, organization_id)
    if not shift:
        return None
    return {
        "shift_id": shift_id,
        "participant_name": shift.get("participant_name"),
        "address": shift.get("participant_address"),
        "access_instructions": shift.get("access_instructions"),
        "entry_instructions": shift.get("entry_instructions"),
        "visit_notes": shift.get("visit_notes"),
        "coordinator_notes": shift.get("coordinator_notes"),
    }
