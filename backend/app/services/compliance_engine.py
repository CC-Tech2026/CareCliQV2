"""
NDIS Compliance Rules Engine — R1 through R12

Each rule returns:
{
    "rule": "R{n}",
    "label": "Human-readable rule name",
    "status": "pass" | "fail" | "warning",
    "message": "Human readable message",
    "severity": "high" | "medium" | "low",
    "is_blocking": bool,
}

Patterns and thresholds are loaded from the compliance_rules.config JSONB column at
runtime (5-minute cache). Module-level constants are kept as fallback defaults so the
engine degrades gracefully when the DB is unavailable — saves are never blocked by a
configuration load error.

Final score = (passed + warnings * 0.5) / active_rules * 100
"""
from datetime import date
from typing import Optional, List
import json
import logging
import re
import time

logger = logging.getLogger(__name__)

BLOCKING_TRANSLATION_STATUSES = {"failed", "unsupported", "pending"}
COMPLIANCE_BLOCKED_MESSAGE = "Compliance blocked: English legal record is missing or translation failed."


class ComplianceBlockedError(ValueError):
    """Raised when compliance is attempted without a valid English legal record."""


# ---------------------------------------------------------------------------
# Hardcoded defaults — mirrors 015_compliance_rules_seed.sql
# Used when the DB is unavailable so blocking behaviour stays consistent.
# ---------------------------------------------------------------------------

_RULE_DEFAULTS: dict[str, dict] = {
    "R1":  {"severity": "high",   "is_active": True, "is_blocking": True,  "enforcement_tier": "block"},
    "R2":  {"severity": "high",   "is_active": True, "is_blocking": True,  "enforcement_tier": "warn"},
    "R3":  {"severity": "medium", "is_active": True, "is_blocking": False, "enforcement_tier": "info"},
    "R4":  {"severity": "medium", "is_active": True, "is_blocking": True,  "enforcement_tier": "block"},
    "R5":  {"severity": "high",   "is_active": True, "is_blocking": True,  "enforcement_tier": "warn"},
    "R6":  {"severity": "high",   "is_active": True, "is_blocking": True,  "enforcement_tier": "info"},
    "R7":  {"severity": "high",   "is_active": True, "is_blocking": True,  "enforcement_tier": "warn"},
    "R8":  {"severity": "high",   "is_active": True, "is_blocking": True,  "enforcement_tier": "block"},
    "R9":  {"severity": "high",   "is_active": True, "is_blocking": False, "enforcement_tier": "warn"},
    "R10": {"severity": "high",   "is_active": True, "is_blocking": True,  "enforcement_tier": "block"},
    "R11": {"severity": "medium", "is_active": True, "is_blocking": False, "enforcement_tier": "info"},
    "R12": {"severity": "medium", "is_active": True, "is_blocking": False, "enforcement_tier": "info"},
}


# ---------------------------------------------------------------------------
# Rule config cache
# ---------------------------------------------------------------------------

_rule_config_cache: dict[str, dict] = {}
_rule_config_cache_time: float = 0.0
_RULE_CONFIG_TTL = 300  # seconds


def load_rule_configs() -> dict[str, dict]:
    """Return a dict keyed by rule_code with the full DB row for each rule.

    Each value contains: severity, is_active, is_blocking, config, category, guidance_text.
    Falls back to {} on DB failure — engine uses module-level constant defaults.
    """
    global _rule_config_cache, _rule_config_cache_time

    now = time.monotonic()
    if _rule_config_cache and (now - _rule_config_cache_time) < _RULE_CONFIG_TTL:
        return _rule_config_cache

    try:
        from .supabase_client import get_supabase_admin
        supabase = get_supabase_admin()
        resp = (
            supabase.table("compliance_rules")
            .select("rule_code,severity,is_active,is_blocking,enforcement_tier,config,category,guidance_text")
            .execute()
        )
        if resp.data:
            _rule_config_cache = {row["rule_code"]: row for row in resp.data}
            _rule_config_cache_time = now
            return _rule_config_cache
    except Exception as exc:
        logger.warning("Could not load compliance_rules from DB (using defaults): %s", exc)

    return {}


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

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

def check_session_time_and_duration(session: dict, config: dict | None = None) -> dict:
    cfg = config or {}
    max_duration_minutes = cfg.get("max_duration_minutes", 480)

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

    if duration > max_duration_minutes:
        max_hours = max_duration_minutes // 60
        return {
            "rule": "R1",
            "label": "Session time and duration",
            "status": "warning",
            "message": f"R1: Session duration is {int(duration)} min — exceeds {max_hours} hours; confirm this is correct",
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

def check_48_hour_documentation(session: dict, config: dict | None = None) -> dict:
    from datetime import datetime, timezone

    cfg = config or {}
    warn_after_days = cfg.get("warn_after_days", 2)
    fail_after_days = cfg.get("fail_after_days", 7)

    session_date = _parse_date(session.get("session_date"))
    note_time_raw = session.get("note_completed_at") or session.get("updated_at") or ""

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
    if delta_days <= warn_after_days:
        return {
            "rule": "R2",
            "label": "48-hour documentation",
            "status": "pass",
            "message": f"R2: Note completed within 48 hours ({delta_days} day(s) after session)",
            "severity": "low",
        }
    if delta_days <= fail_after_days:
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
# R3 — Note quality: minimum word count + filler phrase detection
# Fallback constant used when DB config is unavailable.
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


def check_note_quality(session: dict, config: dict | None = None) -> dict:
    cfg = config or {}
    min_words_pass = cfg.get("min_words_pass", 80)
    min_words_warn = cfg.get("min_words_warn", 30)

    filler_phrases_cfg = cfg.get("filler_phrases")
    phrases = (
        [(p["pattern"], p["label"]) for p in filler_phrases_cfg]
        if filler_phrases_cfg else FILLER_PHRASES
    )

    notes = (session.get("notes") or "").strip()
    structured_text = _structured_fields_text(session)
    effective_text = structured_text if len(structured_text) > len(notes) else notes

    for pattern, phrase in phrases:
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

    if word_count >= min_words_pass:
        return {
            "rule": "R3",
            "label": "Note quality",
            "status": "pass",
            "message": f"R3: Clinical documentation meets the {min_words_pass}-word standard ({word_count} words)",
            "severity": "high",
        }
    if word_count >= min_words_warn:
        return {
            "rule": "R3",
            "label": "Note quality",
            "status": "warning",
            "message": (
                f"R3: Note is brief ({word_count} words) — "
                f"NDIS auditors expect at least {min_words_pass} words of clinical detail"
            ),
            "severity": "medium",
        }
    return {
        "rule": "R3",
        "label": "Note quality",
        "status": "fail",
        "message": f"R3: Note is too short ({word_count} words) — must contain at least {min_words_pass} words",
        "severity": "high",
    }


# ---------------------------------------------------------------------------
# R4 — Support type documented  (no configurable parameters)
# ---------------------------------------------------------------------------

def check_support_type(session: dict) -> dict:
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


def check_goal_language_in_note(session: dict, config: dict | None = None) -> dict:
    cfg = config or {}
    patterns = cfg.get("goal_language_patterns") or _GOAL_LANGUAGE_PATTERNS

    goals = _parse_list(session.get("goals_addressed"))
    goal_progress_notes = _parse_list(session.get("goal_progress_notes"))

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

    if any(re.search(p, full_text, re.IGNORECASE) for p in patterns):
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


def check_objective_language(session: dict, config: dict | None = None) -> dict:
    cfg = config or {}
    phrases_cfg = cfg.get("subjective_phrases")
    phrases = (
        [(p["pattern"], p["label"]) for p in phrases_cfg]
        if phrases_cfg else _SUBJECTIVE_PHRASES
    )

    notes = session.get("notes") or ""
    structured_text = _structured_fields_text(session)
    full_text = notes + " " + structured_text

    for pattern, phrase in phrases:
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


def check_person_first_language(session: dict, config: dict | None = None) -> dict:
    cfg = config or {}
    violations_cfg = cfg.get("violations")
    violations = (
        [(v["pattern"], v["suggestion"]) for v in violations_cfg]
        if violations_cfg else _PERSON_FIRST_VIOLATIONS
    )

    notes = (session.get("notes") or "").lower()
    structured_text = _structured_fields_text(session).lower()
    full_text = notes + " " + structured_text

    for pattern, suggestion in violations:
        if re.search(pattern, full_text, re.IGNORECASE):
            return {
                "rule": "R7",
                "label": "Person-first language",
                "status": "fail",
                "message": f"R7: Non-person-first language detected — use '{suggestion}'",
                "severity": "high",
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


def check_scope_of_practice(session: dict, config: dict | None = None) -> dict:
    cfg = config or {}
    patterns_cfg = cfg.get("violation_patterns")
    patterns = (
        [(p["pattern"], p["label"]) for p in patterns_cfg]
        if patterns_cfg else _SCOPE_VIOLATION_PATTERNS
    )

    notes = session.get("notes") or ""
    structured_text = _structured_fields_text(session)
    full_text = notes + " " + structured_text

    for pattern, label in patterns:
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
# R9 — Incident trigger words
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


def check_incident_triggers(session: dict, config: dict | None = None) -> dict:
    cfg = config or {}
    triggers_cfg = cfg.get("trigger_patterns")
    trigger_patterns = (
        [(p["pattern"], p["label"]) for p in triggers_cfg]
        if triggers_cfg else _INCIDENT_TRIGGER_PATTERNS
    )

    notes = session.get("notes") or ""
    structured_text = _structured_fields_text(session)
    full_text = notes + " " + structured_text

    matched: list[str] = []
    for pattern, label in trigger_patterns:
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
# Restrictive Practice (RP) detection — shared between R10 and the RP deep scan
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


def detect_restrictive_practices(session: dict, phrases: dict | None = None) -> list[dict]:
    """Scan session text fields for restrictive practice indicators.

    phrases: DB-driven config in the form {category: {severity, patterns[]}}.
    Falls back to the RESTRICTIVE_PRACTICE_PHRASES module constant when None.

    Returns a list of flag dicts: {category, phrase, context, severity, suggestion}
    where suggestion is None until enriched by Claude via enrich_rp_suggestions.
    """
    # Normalise input into {category: {severity, patterns}} regardless of source
    if phrases:
        categories = {
            cat: {
                "severity": cfg.get("severity", "high"),
                "patterns": cfg.get("patterns", []),
            }
            for cat, cfg in phrases.items()
        }
    else:
        categories = {
            cat: {
                "severity": "critical" if cat in ("chemical_restraint", "physical_restraint") else "high",
                "patterns": pats,
            }
            for cat, pats in RESTRICTIVE_PRACTICE_PHRASES.items()
        }

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

    for category, cat_cfg in categories.items():
        severity = cat_cfg["severity"]
        for pattern in cat_cfg["patterns"]:
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
# (no configurable parameters — uses the shared RP scanner above)
# ---------------------------------------------------------------------------

def check_restrictive_practice_reported(session: dict, config: dict | None = None) -> dict:
    cfg = config or {}
    rp_flags = detect_restrictive_practices(session, phrases=cfg.get("categories"))

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
# R11 — Note uniqueness: similarity against last N notes
# ---------------------------------------------------------------------------

def _jaccard_similarity(text_a: str, text_b: str) -> float:
    words_a = set(re.findall(r"\b\w+\b", text_a.lower()))
    words_b = set(re.findall(r"\b\w+\b", text_b.lower()))
    if not words_a or not words_b:
        return 0.0
    return len(words_a & words_b) / len(words_a | words_b)


def check_note_similarity(session: dict, existing_sessions: List[dict], config: dict | None = None) -> dict:
    cfg = config or {}
    fail_threshold = cfg.get("fail_threshold", 0.75)
    warn_threshold = cfg.get("warn_threshold", 0.55)
    lookback_count = int(cfg.get("lookback_count", 5))

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
    )[:lookback_count]

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

    if max_similarity >= fail_threshold:
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
    if max_similarity >= warn_threshold:
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


def check_participant_response_language(session: dict, config: dict | None = None) -> dict:
    cfg = config or {}
    patterns = cfg.get("response_patterns") or _PARTICIPANT_RESPONSE_PATTERNS

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

    if any(re.search(p, full_text, re.IGNORECASE) for p in patterns):
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
# Budget check (not part of R1–R12; called separately for alerts)
# ---------------------------------------------------------------------------

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
    custom_physical_types: Optional[List[str]] = None,  # retained for API compat
) -> dict:
    """
    Run all 12 NDIS compliance rules (R1–R12) and RP detection against a session.

    Rule metadata (severity, is_active, is_blocking) and pattern/threshold config
    are loaded from the compliance_rules DB table. Module-level constants serve as
    fallback defaults when the DB is unavailable.

    Returns:
        {
            "rules": [...],                     # active rule results with is_blocking stamped
            "score": float,                     # 0–100
            "passed": int,
            "warnings": int,
            "failed": int,
            "total_rules": int,
            "failed_rules": [...],
            "rp_flags": [...],
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

    # Use compliance text as the authoritative notes field
    session = {
        **session,
        "notes": str(legal_text).strip(),
        "activities_performed": "",
        "outcomes": "",
        "participant_response": "",
        "progress_toward_goals": "",
    }

    # Load DB configs first so patterns/thresholds reach each check function
    rule_configs = load_rule_configs()

    def _cfg(code: str) -> dict:
        return (rule_configs.get(code) or {}).get("config") or {}

    raw_rules = [
        check_session_time_and_duration(session,             config=_cfg("R1")),
        check_48_hour_documentation(session,                 config=_cfg("R2")),
        check_note_quality(session,                          config=_cfg("R3")),
        check_support_type(session),                                              # R4 — no config
        check_goal_language_in_note(session,                 config=_cfg("R5")),
        check_objective_language(session,                    config=_cfg("R6")),
        check_person_first_language(session,                 config=_cfg("R7")),
        check_scope_of_practice(session,                     config=_cfg("R8")),
        check_incident_triggers(session,                     config=_cfg("R9")),
        check_restrictive_practice_reported(session,        config=_cfg("R10")),
        check_note_similarity(session, existing_sessions or [], config=_cfg("R11")),
        check_participant_response_language(session,         config=_cfg("R12")),
    ]

    # Apply metadata: DB row takes precedence, _RULE_DEFAULTS used as fallback
    # so blocking behaviour is consistent even when the DB is unavailable.
    rules: list[dict] = []
    for result in raw_rules:
        rule_code = result.get("rule", "")
        row = rule_configs.get(rule_code) or _RULE_DEFAULTS.get(rule_code, {})

        if row.get("is_active") is False:
            continue  # Disabled — excluded from scoring entirely

        if row.get("severity"):
            result["severity"] = row["severity"]

        result["is_blocking"] = row.get("is_blocking", False)
        # enforcement_tier: DB value takes precedence, fallback to _RULE_DEFAULTS
        default_tier = _RULE_DEFAULTS.get(rule_code, {}).get("enforcement_tier", "block")
        result["enforcement_tier"] = row.get("enforcement_tier") or default_tier
        rules.append(result)

    total = len(rules)
    passed = sum(1 for r in rules if r["status"] == "pass")
    warnings = sum(1 for r in rules if r["status"] == "warning")
    failed = sum(1 for r in rules if r["status"] == "fail")

    score = round((passed + warnings * 0.5) / total * 100, 1) if total else 0.0

    rp_flags = detect_restrictive_practices(session, phrases=_cfg("R10").get("categories"))
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
