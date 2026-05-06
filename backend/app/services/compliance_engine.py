"""
NDIS Compliance Rules Engine

Each rule returns:
{
    "rule": "rule_name",
    "status": "pass" | "fail" | "warning",
    "message": "Human readable message",
    "severity": "high" | "medium" | "low"
}

Final score = (passed + warnings * 0.5) / total * 100
"""
from datetime import date
from typing import Optional, List
import json
import logging
import re

logger = logging.getLogger(__name__)


def _parse_list(value) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []
    return []


def _parse_date(value) -> Optional[date]:
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Individual rule checks
# ---------------------------------------------------------------------------

def check_duration_present(session: dict) -> dict:
    duration = session.get("duration_minutes", 0) or 0
    try:
        duration = float(duration)
    except (TypeError, ValueError):
        duration = 0
    if duration > 0:
        return {
            "rule": "duration_present",
            "status": "pass",
            "message": f"Session duration recorded: {int(duration)} min",
            "severity": "high",
        }
    return {
        "rule": "duration_present",
        "status": "fail",
        "message": "Duration is missing or zero — must be greater than 0 minutes",
        "severity": "high",
    }


def _structured_fields_text(session: dict) -> str:
    """Concatenate the 4 structured note columns into a single string for length/keyword checks."""
    parts = [
        session.get("activities_performed") or "",
        session.get("outcomes") or "",
        session.get("participant_response") or "",
        session.get("progress_toward_goals") or "",
    ]
    return " ".join(p.strip() for p in parts if p.strip())


def check_notes_not_empty(session: dict) -> dict:
    notes = (session.get("notes") or "").strip()
    structured_text = _structured_fields_text(session)
    # Use whichever is longer — structured fields count as documentation
    effective_text = structured_text if len(structured_text) > len(notes) else notes
    length = len(effective_text)
    source = "structured note fields" if len(structured_text) > len(notes) else "session notes"
    if length >= 50:
        return {
            "rule": "notes_not_empty",
            "status": "pass",
            "message": f"Clinical documentation present via {source} ({length} chars)",
            "severity": "high",
        }
    if length >= 20:
        return {
            "rule": "notes_not_empty",
            "status": "warning",
            "message": "Clinical notes are brief — add more detail for NDIS compliance",
            "severity": "medium",
        }
    return {
        "rule": "notes_not_empty",
        "status": "fail",
        "message": "Session notes are missing or too short (50+ chars recommended)",
        "severity": "high",
    }


def check_goals_linked(session: dict) -> dict:
    goals = _parse_list(session.get("goals_addressed"))
    if goals:
        return {
            "rule": "goals_linked",
            "status": "pass",
            "message": f"Session linked to {len(goals)} NDIS goal(s)",
            "severity": "high",
        }
    return {
        "rule": "goals_linked",
        "status": "fail",
        "message": "Session not linked to any NDIS goals — link to at least one goal",
        "severity": "high",
    }


def check_service_type_set(session: dict) -> dict:
    session_type = (session.get("session_type") or "").strip()
    if session_type:
        return {
            "rule": "service_type_set",
            "status": "pass",
            "message": f"Service type recorded: {session_type}",
            "severity": "medium",
        }
    return {
        "rule": "service_type_set",
        "status": "fail",
        "message": "Service type / support category not specified",
        "severity": "medium",
    }


def check_outcome_described(session: dict) -> dict:
    notes = (session.get("notes") or "").lower()
    structured_text = _structured_fields_text(session).lower()
    # Outcomes and participant_response columns are the most relevant for this rule
    outcomes_col = (session.get("outcomes") or "").strip()
    participant_response_col = (session.get("participant_response") or "").strip()
    # Use structured fields first when they have content
    if outcomes_col or participant_response_col:
        return {
            "rule": "outcome_described",
            "status": "pass",
            "message": "Outcomes and participant response documented in structured fields",
            "severity": "medium",
        }
    outcome_keywords = [
        "outcome", "achieved", "progress", "improvement", "goal", "result",
        "completed", "participant", "demonstrated", "able to", "successfully",
        "worked on", "supported", "assisted", "practiced", "developed",
    ]
    # Check both combined notes and structured text
    combined_text = (notes + " " + structured_text).strip()
    if not combined_text or len(combined_text) < 20:
        return {
            "rule": "outcome_described",
            "status": "fail",
            "message": "No outcome or session result described in notes",
            "severity": "medium",
        }
    if any(kw in combined_text for kw in outcome_keywords):
        return {
            "rule": "outcome_described",
            "status": "pass",
            "message": "Outcome or progress is described in session notes",
            "severity": "medium",
        }
    return {
        "rule": "outcome_described",
        "status": "warning",
        "message": "Consider explicitly describing the session outcome or participant progress",
        "severity": "low",
    }


def check_within_plan_dates(
    session: dict,
    plan_start: Optional[str] = None,
    plan_end: Optional[str] = None,
) -> dict:
    session_date = _parse_date(session.get("session_date"))
    if not session_date:
        return {
            "rule": "within_plan_dates",
            "status": "warning",
            "message": "Session date not recorded — cannot validate against plan dates",
            "severity": "high",
        }

    start = _parse_date(plan_start)
    end = _parse_date(plan_end)

    if start and end:
        if start <= session_date <= end:
            return {
                "rule": "within_plan_dates",
                "status": "pass",
                "message": f"Session date {session_date} is within the NDIS plan period",
                "severity": "high",
            }
        return {
            "rule": "within_plan_dates",
            "status": "fail",
            "message": (
                f"Session date {session_date} is outside the plan period "
                f"({plan_start} → {plan_end})"
            ),
            "severity": "high",
        }

    return {
        "rule": "within_plan_dates",
        "status": "warning",
        "message": "Plan dates not configured — set plan start/end dates to enable this check",
        "severity": "medium",
    }


def check_no_duplicate_timestamp(
    session: dict, existing_sessions: List[dict]
) -> dict:
    session_date_raw = str(session.get("session_date", ""))[:10]
    session_id = session.get("id", "")
    patient_id = session.get("patient_id") or session.get("participant_id") or ""

    duplicates = [
        s
        for s in existing_sessions
        if str(s.get("session_date", ""))[:10] == session_date_raw
        and (s.get("patient_id") or s.get("participant_id")) == patient_id
        and s.get("id") != session_id
    ]

    if not duplicates:
        return {
            "rule": "no_duplicate_timestamp",
            "status": "pass",
            "message": "No duplicate sessions found on the same date",
            "severity": "medium",
        }
    return {
        "rule": "no_duplicate_timestamp",
        "status": "warning",
        "message": (
            f"{len(duplicates)} other session(s) exist on {session_date_raw} "
            "for this participant — confirm this is correct"
        ),
        "severity": "medium",
    }


PHYSICAL_SESSION_TYPES = {
    "physiotherapy", "physio", "occupational therapy", "ot",
    "physical therapy", "therapy", "exercise physiology",
    "hydrotherapy", "rehabilitation", "rehab", "massage",
    "manual therapy", "sports therapy",
}


def _requires_physical_assessment(
    session: dict,
    custom_physical_types: Optional[List[str]] = None,
) -> bool:
    """Return True when the session type implies a physical/body examination.

    Uses whole-word / whole-phrase matching (regex word boundaries) to avoid
    false positives from short tokens like 'ot' matching 'remote' or 'root'.

    If ``custom_physical_types`` is supplied (from practitioner settings), those
    terms are checked *instead of* the built-in ``PHYSICAL_SESSION_TYPES`` set.
    """
    session_type = (session.get("session_type") or "").lower().strip()
    types_to_check = (
        [t.lower().strip() for t in custom_physical_types if t and t.strip()]
        if custom_physical_types is not None
        else PHYSICAL_SESSION_TYPES
    )
    return any(
        re.search(r"\b" + re.escape(term) + r"\b", session_type)
        for term in types_to_check
    )


def check_body_examination_documented(
    session: dict,
    custom_physical_types: Optional[List[str]] = None,
) -> dict:
    """Warn when a physical-assessment session has no body markers recorded."""
    if not _requires_physical_assessment(session, custom_physical_types):
        return {
            "rule": "body_examination_documented",
            "status": "pass",
            "message": "Physical examination not required for this session type",
            "severity": "low",
        }

    markers = _parse_list(session.get("body_markers"))
    if markers:
        return {
            "rule": "body_examination_documented",
            "status": "pass",
            "message": f"Physical examination recorded with {len(markers)} body marker(s)",
            "severity": "medium",
        }

    session_type = (session.get("session_type") or "this session type").strip()
    return {
        "rule": "body_examination_documented",
        "status": "warning",
        "message": (
            f"No body markers recorded for a {session_type} session — "
            "document physical findings on the body map"
        ),
        "severity": "medium",
    }


def check_pain_markers_have_notes(session: dict) -> dict:
    """Warn when any red (pain) body marker has no accompanying clinical note."""
    markers = _parse_list(session.get("body_markers"))

    if not markers:
        return {
            "rule": "pain_markers_have_notes",
            "status": "pass",
            "message": "No body markers recorded",
            "severity": "medium",
        }

    pain_markers = [
        m for m in markers
        if isinstance(m, dict) and m.get("color") == "red"
    ]

    if not pain_markers:
        return {
            "rule": "pain_markers_have_notes",
            "status": "pass",
            "message": "No pain markers recorded",
            "severity": "medium",
        }

    undocumented = [
        m for m in pain_markers
        if not (m.get("note") or "").strip()
    ]

    if undocumented:
        zones = [m.get("zone", "unknown") for m in undocumented]
        return {
            "rule": "pain_markers_have_notes",
            "status": "warning",
            "message": (
                f"{len(undocumented)} pain marker(s) have no clinical note — "
                f"add notes for: {', '.join(zones)}"
            ),
            "severity": "medium",
        }

    return {
        "rule": "pain_markers_have_notes",
        "status": "pass",
        "message": f"All {len(pain_markers)} pain marker(s) have clinical notes",
        "severity": "medium",
    }


def check_budget_not_exceeded(
    session: dict, participant: Optional[dict] = None
) -> dict:
    if not participant:
        return {
            "rule": "budget_not_exceeded",
            "status": "warning",
            "message": "Cannot verify budget — participant data unavailable",
            "severity": "medium",
        }

    total = float(participant.get("total_budget") or 0)
    used = float(participant.get("used_budget") or 0)

    if total <= 0:
        return {
            "rule": "budget_not_exceeded",
            "status": "warning",
            "message": "No total budget set for this participant",
            "severity": "low",
        }

    pct = used / total * 100
    if pct >= 100:
        return {
            "rule": "budget_not_exceeded",
            "status": "fail",
            "message": f"NDIS budget is fully exhausted ({pct:.0f}% used of ${total:,.0f})",
            "severity": "high",
        }
    if pct >= 80:
        remaining = total - used
        return {
            "rule": "budget_not_exceeded",
            "status": "warning",
            "message": f"Budget nearing limit — {pct:.0f}% used, ${remaining:,.0f} remaining",
            "severity": "medium",
        }
    return {
        "rule": "budget_not_exceeded",
        "status": "pass",
        "message": f"Budget within limits — {pct:.0f}% used of ${total:,.0f}",
        "severity": "low",
    }


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def run_compliance_check(
    session: dict,
    participant: Optional[dict] = None,
    existing_sessions: Optional[List[dict]] = None,
    custom_physical_types: Optional[List[str]] = None,
) -> dict:
    """
    Run all compliance rules against a session and return a full report.

    Returns:
        {
            "rules": [...],       # individual rule results
            "score": float,       # 0–100
            "passed": int,
            "warnings": int,
            "failed": int,
            "total_rules": int,
            "failed_rules": [...],
        }
    """
    plan_start = participant.get("plan_start_date") if participant else None
    plan_end = participant.get("plan_end_date") if participant else None

    rules = [
        check_duration_present(session),
        check_notes_not_empty(session),
        check_goals_linked(session),
        check_service_type_set(session),
        check_outcome_described(session),
        check_within_plan_dates(session, plan_start, plan_end),
        check_no_duplicate_timestamp(session, existing_sessions or []),
        check_budget_not_exceeded(session, participant),
        check_body_examination_documented(session, custom_physical_types),
        check_pain_markers_have_notes(session),
    ]

    total = len(rules)
    passed = sum(1 for r in rules if r["status"] == "pass")
    warnings = sum(1 for r in rules if r["status"] == "warning")
    failed = sum(1 for r in rules if r["status"] == "fail")

    # Warnings earn half credit
    score = round((passed + warnings * 0.5) / total * 100, 1)

    return {
        "rules": rules,
        "total_rules": total,
        "passed": passed,
        "warnings": warnings,
        "failed": failed,
        "score": score,
        "failed_rules": [r for r in rules if r["status"] == "fail"],
    }
