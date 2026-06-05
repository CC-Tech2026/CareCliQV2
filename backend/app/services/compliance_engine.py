"""
NDIS Compliance Rules Engine — R1 through R12

Each rule returns:
{
    "rule": "R{n}",
    "label": "Human-readable rule name",
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

BLOCKING_TRANSLATION_STATUSES = {"failed", "unsupported", "pending"}
COMPLIANCE_BLOCKED_MESSAGE = "Compliance blocked: English legal record is missing or translation failed."


class ComplianceBlockedError(ValueError):
    """Raised when compliance is attempted without a valid English legal record."""


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


def _structured_fields_text(session: dict) -> str:
    """Concatenate the 4 structured note columns into a single string."""
    parts = [
        session.get("activities_performed") or "",
        session.get("outcomes") or "",
        session.get("participant_response") or "",
        session.get("progress_toward_goals") or "",
    ]
    return " ".join(p.strip() for p in parts if p.strip())


# ---------------------------------------------------------------------------
# R1 — Session time and duration
# ---------------------------------------------------------------------------

def check_session_time_and_duration(session: dict) -> dict:
    """R1: start_time and end_time required; warn if duration exceeds 8 hours."""
    start_time = (session.get("start_time") or "").strip()
    end_time = (session.get("end_time") or "").strip()
    duration = session.get("duration_minutes", 0) or 0
    try:
        duration = float(duration)
    except (TypeError, ValueError):
        duration = 0

    issues = []
    if not start_time:
        issues.append("start time is missing")
    if not end_time:
        issues.append("end time is missing")
    if duration <= 0:
        issues.append("duration is missing or zero")

    if issues:
        return {
            "rule": "R1",
            "label": "Session time and duration",
            "status": "fail",
            "message": f"R1: {'; '.join(issues).capitalize()}",
            "severity": "high",
        }

    if duration > 480:
        return {
            "rule": "R1",
            "label": "Session time and duration",
            "status": "warning",
            "message": f"R1: Session duration is {int(duration)} min — exceeds 8 hours; confirm this is correct",
            "severity": "medium",
        }

    return {
        "rule": "R1",
        "label": "Session time and duration",
        "status": "pass",
        "message": f"R1: Session time recorded ({start_time} – {end_time}, {int(duration)} min)",
        "severity": "high",
    }


# ---------------------------------------------------------------------------
# R2 — 48-hour documentation rule
# ---------------------------------------------------------------------------

def check_48_hour_documentation(session: dict) -> dict:
    """R2: Note must be completed within 48 hours of the session date.

    Uses updated_at (actual note save time) as the documentation timestamp.
    Falls back to note_completed_at, then today as a proxy.
    """
    from datetime import datetime, timezone

    session_date = _parse_date(session.get("session_date"))
    note_time_raw = (
        session.get("note_completed_at")
        or session.get("updated_at")
        or ""
    )

    if not session_date:
        return {
            "rule": "R2",
            "label": "48-hour documentation",
            "status": "warning",
            "message": "R2: Session date not set — cannot check 48-hour documentation rule",
            "severity": "medium",
        }

    if not note_time_raw:
        note_date = datetime.now(timezone.utc).date()
    else:
        try:
            note_date = datetime.fromisoformat(str(note_time_raw)[:19]).date()
        except Exception:
            note_date = datetime.now(timezone.utc).date()

    delta_days = (note_date - session_date).days

    if delta_days < 0:
        return {
            "rule": "R2",
            "label": "48-hour documentation",
            "status": "warning",
            "message": "R2: Note date precedes session date — verify that the session date is correct",
            "severity": "medium",
        }
    if delta_days <= 2:
        return {
            "rule": "R2",
            "label": "48-hour documentation",
            "status": "pass",
            "message": f"R2: Note completed within 48 hours ({delta_days} day(s) after session)",
            "severity": "low",
        }
    if delta_days <= 7:
        return {
            "rule": "R2",
            "label": "48-hour documentation",
            "status": "warning",
            "message": f"R2: Note completed {delta_days} days after session — NDIS recommends documentation within 48 hours",
            "severity": "medium",
        }
    return {
        "rule": "R2",
        "label": "48-hour documentation",
        "status": "fail",
        "message": f"R2: Note completed {delta_days} days after session — exceeds the 48-hour NDIS requirement",
        "severity": "high",
    }


# ---------------------------------------------------------------------------
# R3 — Note quality: 80-word minimum + filler phrase detection
# ---------------------------------------------------------------------------

FILLER_PHRASES: list[tuple[str, str]] = [
    (r"\bgood session\b", "good session"),
    (r"\bdid\s+shopping\b", "did shopping"),
    (r"\ball\s+went\s+well\b", "all went well"),
    (r"\bwent\s+well\b", "went well"),
    (r"\bnothing\s+to\s+report\b", "nothing to report"),
    (r"\bno\s+issues\b", "no issues"),
    (r"\bsame\s+as\s+usual\b", "same as usual"),
    (r"\bas\s+per\s+usual\b", "as per usual"),
    (r"\bas\s+usual\b", "as usual"),
    (r"\bcompleted\s+tasks\b", "completed tasks"),
    (r"\bdone\s+for\s+the\s+day\b", "done for the day"),
    (r"\bno\s+concerns\b", "no concerns"),
    (r"\bstandard\s+session\b", "standard session"),
    (r"\bregular\s+session\b", "regular session"),
    (r"\bthe\s+usual\b", "the usual"),
    (r"\buneventful\b", "uneventful"),
    (r"\bsame\s+as\s+last\s+(?:time|session|week)\b", "same as last time"),
]


def check_note_quality(session: dict) -> dict:
    """R3: Note must be at least 80 words and must not contain vague filler phrases."""
    notes = (session.get("notes") or "").strip()
    structured_text = _structured_fields_text(session)
    effective_text = structured_text if len(structured_text) > len(notes) else notes

    for pattern, phrase in FILLER_PHRASES:
        if re.search(pattern, effective_text, re.IGNORECASE):
            return {
                "rule": "R3",
                "label": "Note quality",
                "status": "fail",
                "message": (
                    f"R3: Vague filler language detected: \"{phrase}\" — "
                    "replace with specific, objective clinical detail"
                ),
                "severity": "high",
            }

    word_count = len(effective_text.split())

    if word_count >= 80:
        return {
            "rule": "R3",
            "label": "Note quality",
            "status": "pass",
            "message": f"R3: Clinical documentation meets the 80-word standard ({word_count} words)",
            "severity": "high",
        }
    if word_count >= 30:
        return {
            "rule": "R3",
            "label": "Note quality",
            "status": "warning",
            "message": (
                f"R3: Note is brief ({word_count} words) — "
                "NDIS auditors expect at least 80 words of clinical detail"
            ),
            "severity": "medium",
        }
    return {
        "rule": "R3",
        "label": "Note quality",
        "status": "fail",
        "message": f"R3: Note is too short ({word_count} words) — must contain at least 80 words",
        "severity": "high",
    }


# ---------------------------------------------------------------------------
# R4 — Support type documented
# ---------------------------------------------------------------------------

def check_support_type(session: dict) -> dict:
    """R4: Support type / service category must be specified."""
    session_type = (session.get("session_type") or "").strip()
    if session_type:
        return {
            "rule": "R4",
            "label": "Support type documented",
            "status": "pass",
            "message": f"R4: Support type recorded: {session_type}",
            "severity": "medium",
        }
    return {
        "rule": "R4",
        "label": "Support type documented",
        "status": "fail",
        "message": "R4: Support type / support category not specified",
        "severity": "medium",
    }


# ---------------------------------------------------------------------------
# R5 — Goals linked with goal language confirmed in note body
# ---------------------------------------------------------------------------

_GOAL_LANGUAGE_PATTERNS: list[str] = [
    r"\bgoal\b",
    r"\bobjective\b",
    r"\baim(?:ed|s)?\b",
    r"\btarget\b",
    r"\bmilestone\b",
    r"\bworked\s+(?:on|toward)\b",
    r"\bprogress\b",
    r"\bachiev\w+\b",
    r"\bindependen\w+\b",
    r"\bskill\b",
    r"\bdevelop\w+\b",
    r"\bimprove\w+\b",
    r"\bndis\s+plan\b",
    r"\bplan\s+goal\b",
    r"\bfocus\s+area\b",
]


def check_goal_language_in_note(session: dict) -> dict:
    """R5: At least one goal must be linked AND goal language must appear in the note body.

    Accepts structured goal_progress_notes (SCRUM-226) as a stronger form of linkage —
    if present, the per-goal evidence fields satisfy both the linkage and language checks.
    """
    goals = _parse_list(session.get("goals_addressed"))
    goal_progress_notes = _parse_list(session.get("goal_progress_notes"))

    # Structured goal notes (SCRUM-226) are the richest form of evidence
    if goal_progress_notes:
        return {
            "rule": "R5",
            "label": "Goals referenced in note",
            "status": "pass",
            "message": (
                f"R5: Structured goal documentation provided for {len(goal_progress_notes)} goal(s) "
                "with evidence, outcomes, and observations"
            ),
            "severity": "high",
        }

    notes = (session.get("notes") or "").lower()
    structured_text = _structured_fields_text(session).lower()
    full_text = notes + " " + structured_text

    if not goals:
        return {
            "rule": "R5",
            "label": "Goals referenced in note",
            "status": "fail",
            "message": "R5: Session not linked to any NDIS goals — link at least one goal",
            "severity": "high",
        }

    if any(re.search(p, full_text, re.IGNORECASE) for p in _GOAL_LANGUAGE_PATTERNS):
        return {
            "rule": "R5",
            "label": "Goals referenced in note",
            "status": "pass",
            "message": f"R5: Goal language confirmed in note body ({len(goals)} goal(s) linked)",
            "severity": "high",
        }

    return {
        "rule": "R5",
        "label": "Goals referenced in note",
        "status": "warning",
        "message": (
            "R5: Goals are linked but goal language is absent from the note — "
            "describe the participant's progress toward each goal"
        ),
        "severity": "medium",
    }


# ---------------------------------------------------------------------------
# R6 — Objective language (no first-person subjective phrases)
# ---------------------------------------------------------------------------

_SUBJECTIVE_PHRASES: list[tuple[str, str]] = [
    (r"\bI\s+think\b", "I think"),
    (r"\bI\s+believe\b", "I believe"),
    (r"\bI\s+feel\b", "I feel"),
    (r"\bI\s+suspect\b", "I suspect"),
    (r"\bI\s+reckon\b", "I reckon"),
    (r"\bI\s+guess\b", "I guess"),
    (r"\bseems\s+like\b", "seems like"),
    (r"\bseems\s+to\s+be\b", "seems to be"),
    (r"\bprobably\s+(?:has|have|is|are|was|were)\b", "probably has/is"),
    (r"\bmight\s+be\s+(?:due|caused|because)\b", "might be due"),
]


def check_objective_language(session: dict) -> dict:
    """R6: Notes must use objective language — flag first-person subjective phrasing."""
    notes = session.get("notes") or ""
    structured_text = _structured_fields_text(session)
    full_text = notes + " " + structured_text

    for pattern, phrase in _SUBJECTIVE_PHRASES:
        if re.search(pattern, full_text, re.IGNORECASE):
            return {
                "rule": "R6",
                "label": "Objective language",
                "status": "fail",
                "message": (
                    f"R6: Subjective language detected: \"{phrase}\" — "
                    "rewrite as an objective, observable fact"
                ),
                "severity": "high",
            }

    return {
        "rule": "R6",
        "label": "Objective language",
        "status": "pass",
        "message": "R6: Notes use objective language throughout",
        "severity": "medium",
    }


# ---------------------------------------------------------------------------
# R7 — Person-first language
# ---------------------------------------------------------------------------

_PERSON_FIRST_VIOLATIONS: list[tuple[str, str]] = [
    (r"\bautistic\s+(?:person|child|adult|individual|client|man|woman|boy|girl)\b", "person with autism"),
    (r"\bwheelchair[- ]?bound\b", "person who uses a wheelchair"),
    (r"\bconfined\s+to\s+(?:a\s+)?wheelchair\b", "person who uses a wheelchair"),
    (r"\bsuffers?\s+from\b", "has a diagnosis of"),
    (r"\bthe\s+disabled\b", "person with disability"),
    (r"\bspecial\s+needs\b", "support needs"),
    (r"\bmental(?:ly)?\s+retard\w*\b", "person with intellectual disability"),
    (r"\bblind\s+(?:person|people|client)\b", "person who is blind"),
    (r"\bdeaf\s+(?:person|people|client)\b", "person who is deaf"),
    (r"\bepilept(?:ic|ics)\b", "person with epilepsy"),
]


def check_person_first_language(session: dict) -> dict:
    """R7: Warn if non-person-first language is detected in clinical notes."""
    notes = (session.get("notes") or "").lower()
    structured_text = _structured_fields_text(session).lower()
    full_text = notes + " " + structured_text

    for pattern, suggestion in _PERSON_FIRST_VIOLATIONS:
        if re.search(pattern, full_text, re.IGNORECASE):
            return {
                "rule": "R7",
                "label": "Person-first language",
                "status": "warning",
                "message": f"R7: Non-person-first language detected — use '{suggestion}'",
                "severity": "medium",
            }

    return {
        "rule": "R7",
        "label": "Person-first language",
        "status": "pass",
        "message": "R7: Person-first language used throughout",
        "severity": "low",
    }


# ---------------------------------------------------------------------------
# R8 — Scope of practice
# ---------------------------------------------------------------------------

_SCOPE_VIOLATION_PATTERNS: list[tuple[str, str]] = [
    (r"\bdiagnos(?:ed|es|ing|is)\b", "clinical diagnosis"),
    (r"\bdiagnosis\s+of\b", "clinical diagnosis"),
    (r"\badminister(?:ed|ing)?\s+(?:medication|meds|drug|tablet|dose|injection)\b", "medication administration"),
    (r"\bgave\s+(?:the\s+)?(?:medication|meds|tablet|pill|injection|dose)\b", "medication administration"),
    (r"\binjected\b", "injection administration"),
    (r"\bgave\s+(?:a\s+)?PRN\b", "PRN medication administration"),
    (r"\bclinical\s+assessment\b", "clinical assessment"),
    (r"\bmental\s+health\s+assessment\b", "mental health assessment"),
    (r"\bpsychiatric\s+(?:assessment|evaluation|review)\b", "psychiatric assessment"),
    (r"\bmedical\s+(?:assessment|evaluation|examination)\b", "medical assessment"),
    (r"\bwound\s+(?:care|dressing|management)\b", "wound care"),
    (r"\bprescrib(?:ed|es|ing)\b", "prescribing medication"),
    (r"\bnursing\s+assessment\b", "nursing assessment"),
]


def check_scope_of_practice(session: dict) -> dict:
    """R8: Support workers must not document clinical assessments, diagnoses, or medication admin."""
    notes = session.get("notes") or ""
    structured_text = _structured_fields_text(session)
    full_text = notes + " " + structured_text

    for pattern, label in _SCOPE_VIOLATION_PATTERNS:
        if re.search(pattern, full_text, re.IGNORECASE):
            return {
                "rule": "R8",
                "label": "Scope of practice",
                "status": "fail",
                "message": (
                    f"R8: Language outside support worker scope detected: \"{label}\" — "
                    "only qualified clinicians may document clinical assessments, diagnoses, or medication administration"
                ),
                "severity": "high",
            }

    return {
        "rule": "R8",
        "label": "Scope of practice",
        "status": "pass",
        "message": "R8: No scope-of-practice concerns detected",
        "severity": "medium",
    }


# ---------------------------------------------------------------------------
# R9 — Incident trigger words (auto-incident creation handled in sessions.py)
# ---------------------------------------------------------------------------

_INCIDENT_TRIGGER_PATTERNS: list[tuple[str, str]] = [
    (r"\bfell\b|\bfall(?:ing)?\b|\btripped\b", "fall/injury"),
    (
        r"\baggressive\b|\baggression\b|\bviolent\b|\battack(?:ed|ing)?\b"
        r"|\bhit\s+(?:a\s+)?(?:staff|worker|carer|support)\b",
        "aggression/violence",
    ),
    (r"\bhospital(?:ised|ized)?\b|\bemergency\s+department\b|\bED\b(?!\w)", "hospital/ED"),
    (r"\bambulance\b|\b000\b|\bparamedic\b", "ambulance/emergency services"),
    (r"\bself[-\s]harm\b|\bself[-\s]injur\w+\b|\bsuicid\w+\b", "self-harm/suicidality"),
    (r"\babuse\b|\bneglect\b|\bmistreat\w+\b|\bexploit\w+\b", "abuse/neglect"),
    (r"\boverdose\b", "overdose"),
    (r"\bseizure\b|\bconvuls\w+\b|\bepileptic\s+episode\b", "seizure/medical emergency"),
    (r"\bunconscious\b|\bpassed\s+out\b|\bfainted\b|\bunresponsive\b", "loss of consciousness"),
    (r"\bdeceased\b|\bpassed\s+away\b", "death"),
]


def check_incident_triggers(session: dict) -> dict:
    """R9: Scan for incident trigger words. Detected triggers drive auto-incident creation in sessions.py."""
    notes = session.get("notes") or ""
    structured_text = _structured_fields_text(session)
    full_text = notes + " " + structured_text

    matched: list[str] = []
    for pattern, label in _INCIDENT_TRIGGER_PATTERNS:
        if re.search(pattern, full_text, re.IGNORECASE) and label not in matched:
            matched.append(label)

    if matched:
        return {
            "rule": "R9",
            "label": "Incident triggers",
            "status": "fail",
            "message": (
                f"R9: Incident language detected ({', '.join(matched)}) — "
                "an incident draft has been created and the coordinator notified"
            ),
            "severity": "high",
            "incident_triggers": matched,
        }

    return {
        "rule": "R9",
        "label": "Incident triggers",
        "status": "pass",
        "message": "R9: No incident trigger language detected",
        "severity": "low",
        "incident_triggers": [],
    }


# ---------------------------------------------------------------------------
# Restrictive Practice (RP) Detection — shared with R10
# ---------------------------------------------------------------------------

RESTRICTIVE_PRACTICE_PHRASES: dict[str, list[str]] = {
    "chemical_restraint": [
        r"given\s+sedative",
        r"administered\s+sedative",
        r"chemical\s+calm",
        r"chemical\s+restraint",
        r"sedated\s+to\s+calm",
        r"medication\s+to\s+restrain",
        r"PRN\s+for\s+behaviour",
        r"calming\s+medication",
        r"chemical\s+control",
        r"medicated\s+for\s+behaviour",
    ],
    "physical_restraint": [
        r"held\s+down",
        r"physically\s+restrained",
        r"physical\s+restraint",
        r"pinned\s+down",
        r"grabbed\s+and\s+held",
        r"forced\s+to\s+stay",
        r"arm\s+held",
        r"restrained\s+by\s+staff",
        r"manual\s+restraint",
        r"staff\s+held",
        r"body\s+hold",
        r"crisis\s+hold",
        r"prone\s+restraint",
    ],
    "mechanical_restraint": [
        r"tied\s+to\s+chair",
        r"strapped\s+to",
        r"mechanical\s+restraint",
        r"wrist\s+restraint",
        r"lap\s+belt",
        r"safety\s+strap",
        r"restrained\s+with",
        r"wheelchair\s+strap",
        r"body\s+suit",
        r"restraint\s+device",
    ],
    "environmental_restraint": [
        r"locked\s+in\s+room",
        r"environmental\s+restraint",
        r"confined\s+to",
        r"restricted\s+to\s+room",
        r"door\s+locked",
        r"prevented\s+from\s+leaving",
        r"access\s+denied",
        r"not\s+allowed\s+to\s+leave",
        r"restricted\s+access",
        r"room\s+locked",
    ],
    "seclusion": [
        r"placed\s+in\s+seclusion",
        r"seclusion\s+room",
        r"isolated\s+in",
        r"secluded",
        r"time[\s-]out\s+room",
        r"placed\s+alone\s+in",
        r"removed\s+and\s+isolated",
        r"solitary",
        r"seclusion\s+used",
    ],
}


def detect_restrictive_practices(session: dict) -> list[dict]:
    """Scan session text fields for restrictive practice indicators.

    Returns a list of flag dicts:
        {category, phrase, context, severity, suggestion}
    where ``suggestion`` is None (filled later by Claude via enrich_rp_suggestions).
    """
    fields_to_scan = [
        session.get("notes") or "",
        session.get("activities_performed") or "",
        session.get("outcomes") or "",
        session.get("participant_response") or "",
        session.get("progress_toward_goals") or "",
    ]
    full_text = "\n".join(f.strip() for f in fields_to_scan if f.strip())

    if not full_text:
        return []

    flags: list[dict] = []
    seen_phrases: set[str] = set()

    for category, patterns in RESTRICTIVE_PRACTICE_PHRASES.items():
        severity = "critical" if category in ("chemical_restraint", "physical_restraint") else "high"
        for pattern in patterns:
            for match in re.finditer(pattern, full_text, re.IGNORECASE):
                matched_phrase = match.group(0)
                key = f"{category}:{matched_phrase.lower()}"
                if key in seen_phrases:
                    continue
                seen_phrases.add(key)

                start = max(0, match.start() - 30)
                end = min(len(full_text), match.end() + 30)
                context = full_text[start:end].strip()

                flags.append({
                    "category": category,
                    "phrase": matched_phrase,
                    "context": context,
                    "severity": severity,
                    "suggestion": None,
                })

    return flags


# ---------------------------------------------------------------------------
# R10 — Restrictive practice must be linked to an incident report
# ---------------------------------------------------------------------------

def check_restrictive_practice_reported(session: dict) -> dict:
    """R10: Notes mentioning restrictive practices require a linked incident report."""
    rp_flags = detect_restrictive_practices(session)

    if not rp_flags:
        return {
            "rule": "R10",
            "label": "Restrictive practice reported",
            "status": "pass",
            "message": "R10: No restrictive practice language detected",
            "severity": "high",
        }

    categories = list({f["category"] for f in rp_flags})
    category_labels = ", ".join(c.replace("_", " ") for c in categories)

    # rp_incident_linked is set by coordinators once an incident report is filed
    if session.get("rp_incident_linked"):
        return {
            "rule": "R10",
            "label": "Restrictive practice reported",
            "status": "pass",
            "message": f"R10: Restrictive practice ({category_labels}) is linked to an incident report",
            "severity": "high",
        }

    return {
        "rule": "R10",
        "label": "Restrictive practice reported",
        "status": "fail",
        "message": (
            f"R10: Restrictive practice detected ({category_labels}) — "
            "this note cannot be approved without a linked incident report"
        ),
        "severity": "high",
    }


# ---------------------------------------------------------------------------
# R11 — Note uniqueness: similarity against last 5 notes (same worker + participant)
# ---------------------------------------------------------------------------

def _jaccard_similarity(text_a: str, text_b: str) -> float:
    words_a = set(re.findall(r"\b\w+\b", text_a.lower()))
    words_b = set(re.findall(r"\b\w+\b", text_b.lower()))
    if not words_a or not words_b:
        return 0.0
    return len(words_a & words_b) / len(words_a | words_b)


def check_note_similarity(session: dict, existing_sessions: List[dict]) -> dict:
    """R11: Compare current note against last 5 notes for the same worker and participant."""
    session_id = session.get("id", "")
    participant_id = session.get("patient_id") or session.get("participant_id") or ""
    worker_id = session.get("worker_id") or session.get("user_id") or ""
    current_text = (session.get("notes") or "").strip()

    if not current_text or len(current_text.split()) < 10:
        return {
            "rule": "R11",
            "label": "Note uniqueness",
            "status": "warning",
            "message": "R11: Note is too short to assess uniqueness — add more clinical detail",
            "severity": "low",
        }

    # Last 5 sessions: same participant AND same worker, excluding the current session
    relevant = [
        s for s in existing_sessions
        if s.get("id") != session_id
        and (s.get("patient_id") or s.get("participant_id")) == participant_id
        and (s.get("worker_id") or s.get("user_id")) == worker_id
    ]
    relevant_sorted = sorted(
        relevant,
        key=lambda s: str(s.get("session_date") or ""),
        reverse=True,
    )[:5]

    if not relevant_sorted:
        return {
            "rule": "R11",
            "label": "Note uniqueness",
            "status": "pass",
            "message": "R11: No previous notes found for comparison",
            "severity": "low",
        }

    max_similarity = 0.0
    for prev in relevant_sorted:
        prev_text = (
            prev.get("compliance_input_text")
            or prev.get("translated_english_note")
            or prev.get("notes")
            or ""
        ).strip()
        if not prev_text:
            continue
        sim = _jaccard_similarity(current_text, prev_text)
        if sim > max_similarity:
            max_similarity = sim

    if max_similarity >= 0.75:
        return {
            "rule": "R11",
            "label": "Note uniqueness",
            "status": "fail",
            "message": (
                f"R11: This note is {max_similarity:.0%} similar to a previous note — "
                "describe what was unique about this session"
            ),
            "severity": "high",
        }
    if max_similarity >= 0.55:
        return {
            "rule": "R11",
            "label": "Note uniqueness",
            "status": "warning",
            "message": (
                f"R11: This note is {max_similarity:.0%} similar to a previous note — "
                "consider adding more session-specific detail"
            ),
            "severity": "medium",
        }
    return {
        "rule": "R11",
        "label": "Note uniqueness",
        "status": "pass",
        "message": f"R11: Note is sufficiently unique (similarity: {max_similarity:.0%})",
        "severity": "low",
    }


# ---------------------------------------------------------------------------
# R12 — Participant response language
# ---------------------------------------------------------------------------

_PARTICIPANT_RESPONSE_PATTERNS: list[str] = [
    r"\breport(?:ed|s)?\b",
    r"\bdemonstrat(?:ed|es|ing)?\b",
    r"\bengag(?:ed|es|ing)?\b",
    r"\bdeclin(?:ed|es|ing)?\b",
    r"\bexpress(?:ed|es|ing)?\b",
    r"\bstat(?:ed|es|ing)?\b",
    r"\bindicated\b",
    r"\brespond(?:ed|s)?\b",
    r"\bparticipat(?:ed|es|ing)?\b",
    r"\bcommunicat(?:ed|es|ing)?\b",
    r"\bverbalised\b|\bverbalized\b",
    r"\bappear(?:ed|s)?\b",
    r"\bobserv(?:ed|es|ing)?\b",
    r"\bcomment(?:ed|s)?\b",
]


def check_participant_response_language(session: dict) -> dict:
    """R12: Notes must include language describing how the participant responded."""
    participant_response_col = (session.get("participant_response") or "").strip()
    if participant_response_col:
        return {
            "rule": "R12",
            "label": "Participant response",
            "status": "pass",
            "message": "R12: Participant response documented in structured fields",
            "severity": "medium",
        }

    notes = (session.get("notes") or "").lower()
    structured_text = _structured_fields_text(session).lower()
    full_text = notes + " " + structured_text

    if any(re.search(p, full_text, re.IGNORECASE) for p in _PARTICIPANT_RESPONSE_PATTERNS):
        return {
            "rule": "R12",
            "label": "Participant response",
            "status": "pass",
            "message": "R12: Participant response language present in note",
            "severity": "medium",
        }

    return {
        "rule": "R12",
        "label": "Participant response",
        "status": "warning",
        "message": (
            "R12: No participant-response language detected — describe how the participant responded "
            "(e.g., 'reported', 'demonstrated', 'engaged', 'declined', 'expressed')"
        ),
        "severity": "medium",
    }


# ---------------------------------------------------------------------------
# Additional helpers (used in sessions.py outside the 12-rule check)
# ---------------------------------------------------------------------------

def check_budget_not_exceeded(
    session: dict, participant: Optional[dict] = None
) -> dict:
    """Budget check — not part of R1-R12; called separately from sessions.py for alerts."""
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
    custom_physical_types: Optional[List[str]] = None,  # retained for API compat
) -> dict:
    """
    Run all 12 NDIS compliance rules (R1–R12) and RP detection against a session.

    Returns:
        {
            "rules": [...],                     # R1–R12 individual rule results
            "score": float,                     # 0–100
            "passed": int,
            "warnings": int,
            "failed": int,
            "total_rules": int,
            "failed_rules": [...],
            "rp_flags": [...],                  # RP flags (suggestion=None until enriched)
            "restrictive_practice_detected": bool,
            "restrictive_practice_types": [...],
        }
    """
    translation_status = str(session.get("translation_status") or "not_required")
    legal_text = (
        session.get("compliance_input_text")
        or session.get("translated_english_note")
        or ""
    )
    if translation_status in BLOCKING_TRANSLATION_STATUSES or not str(legal_text).strip():
        raise ComplianceBlockedError(COMPLIANCE_BLOCKED_MESSAGE)

    # Normalise: use compliance text as the authoritative notes field
    session = {
        **session,
        "notes": str(legal_text).strip(),
        "activities_performed": "",
        "outcomes": "",
        "participant_response": "",
        "progress_toward_goals": "",
    }

    rules = [
        check_session_time_and_duration(session),                          # R1
        check_48_hour_documentation(session),                              # R2
        check_note_quality(session),                                       # R3
        check_support_type(session),                                       # R4
        check_goal_language_in_note(session),                              # R5
        check_objective_language(session),                                 # R6
        check_person_first_language(session),                              # R7
        check_scope_of_practice(session),                                  # R8
        check_incident_triggers(session),                                  # R9
        check_restrictive_practice_reported(session),                      # R10
        check_note_similarity(session, existing_sessions or []),           # R11
        check_participant_response_language(session),                      # R12
    ]

    total = len(rules)
    passed = sum(1 for r in rules if r["status"] == "pass")
    warnings = sum(1 for r in rules if r["status"] == "warning")
    failed = sum(1 for r in rules if r["status"] == "fail")

    score = round((passed + warnings * 0.5) / total * 100, 1)

    # RP detection for enrichment (already computed inside R10, re-use here)
    rp_flags = detect_restrictive_practices(session)
    rp_categories = list({f["category"] for f in rp_flags}) if rp_flags else []

    return {
        "rules": rules,
        "total_rules": total,
        "passed": passed,
        "warnings": warnings,
        "failed": failed,
        "score": score,
        "failed_rules": [r for r in rules if r["status"] == "fail"],
        "rp_flags": rp_flags,
        "restrictive_practice_detected": len(rp_flags) > 0,
        "restrictive_practice_types": rp_categories,
    }
