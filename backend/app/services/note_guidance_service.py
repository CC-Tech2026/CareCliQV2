"""Live help for a note being written: the real NDIS rules, run on the draft.

The worker app used to keep its own copy of some rules, which drifted from the
scored check (compliance_engine.py): it counted "no concerns" as answering the
concern question while R3 marks it as vague filler, accepted response words
R12 doesn't, and nudged at 10 words when R3 fails under 30. This runs the
engine's own rule functions, with each rule's configured patterns and
thresholds, on the English text of a draft, so the help a worker sees while
writing is exactly what the note is scored on afterwards.

Only the rules about what's written run here (R3, R5 to R12). R1 time and
duration, R2 documented within 48 hours and R4 support type come from the
shift itself and are checked when it's finished.

Each result carries a short, plain message for the worker (no rule codes in
the sentence, no dashes) and the next guide question to ask. Nothing is sent
to an AI service.
"""

from __future__ import annotations

import re
from typing import Any, Optional

from . import compliance_engine as engine

TEXT_RULES = ("R3", "R5", "R6", "R7", "R8", "R9", "R10", "R11", "R12")

RULE_TITLES = {
    "R3": "Enough detail",
    "R5": "Link to a goal",
    "R6": "What you saw or heard",
    "R7": "Person-first words",
    "R8": "Within your role",
    "R9": "Incidents",
    "R10": "Restrictive practices",
    "R11": "Written fresh",
    "R12": "How they responded",
}

# Guide questions, in the order a note answers them. "detail" is asked last,
# once the others are covered and the note is still short for R3.
QUESTIONS: dict[str, dict[str, str]] = {
    "did": {
        "question": "What did you support {name} with?",
        "starter": "I supported {name} to ",
        "rule": "R3",
    },
    "response": {
        "question": "How did {name} respond?",
        "starter": "{name} engaged ",
        "rule": "R12",
    },
    "goal": {
        "question": "Which goal did this work towards, and what progress did you see?",
        "starter": "This worked towards {name}'s goal to ",
        "rule": "R5",
    },
    "concern": {
        "question": "Did anything happen that worried you, or anything unusual?",
        "starter": "I noticed ",
        "rule": "R9",
    },
    "detail": {
        "question": "What else happened? Add times, places and specifics.",
        "starter": "",
        "rule": "R3",
    },
}

# Saying how the participant was (or that you checked) answers the concern
# question. Bare "no concerns" / "nothing to report" doesn't: R3 marks those
# as vague filler.
_CONCERN_ANSWERED = re.compile(
    r"\b(noticed|worr\w+|incident|unwell|pain|injur\w+|upset|distress\w*|anxious|agitated|"
    r"calm|settled|relaxed|comfortable|safe|bruis\w+|mark|rash|tired|sleep\w*|"
    r"report(?:ed|s)?\s+(?:no|feeling)|appeared\s+(?:well|content|happy|calm))\b",
    re.IGNORECASE,
)
_QUOTED = re.compile(r"[\"']([^\"']+)[\"']")


def _quoted(message: str) -> Optional[str]:
    match = _QUOTED.search(message or "")
    return match.group(1) if match else None


def _word_count(text: str) -> int:
    return len((text or "").split())


def hint_details(result: dict[str, Any], words: int, min_pass: int) -> tuple[Optional[str], dict[str, Any]]:
    """The app's hint id for a rule that isn't passing, and the values its
    translated message needs (the worker app shows hints in the worker's own
    app language; these ids match lib/worker-compliance's offline hints)."""
    rule, status = result.get("rule"), result.get("status")
    if status == "pass":
        return None, {}
    msg = str(result.get("message") or "")
    if rule == "R3":
        if result.get("too_short"):
            return "word-count", {"words": words, "min": min_pass}
        phrase = _quoted(msg)
        if phrase and "filler" in msg.lower():
            return "filler", {"phrase": phrase}
        return "word-count-brief", {"words": words, "min": min_pass}
    if rule == "R5":
        return "goal-link", {}
    if rule == "R6":
        return "subjective-language", {"phrase": _quoted(msg) or ""}
    if rule == "R7":
        return "person-first-short", {"suggestion": _quoted(msg) or ""}
    if rule == "R8":
        return "scope", {"phrase": _quoted(msg) or "a clinical task"}
    if rule in ("R9", "R10"):
        found = re.search(r"\(([^)]+)\)", msg)
        what = found.group(1) if found else ("an incident" if rule == "R9" else "restrictive practice")
        return ("incident" if rule == "R9" else "restrictive-practice"), {"phrase": what}
    if rule == "R11":
        return "copied", {}
    if rule == "R12":
        return "participant-response", {}
    return None, {}


def worker_message(result: dict[str, Any], name: str, config: dict[str, Any], words: int) -> Optional[str]:
    """A plain sentence telling the worker what to do about a rule that isn't
    passing. None for a pass."""
    rule, status = result.get("rule"), result.get("status")
    if status == "pass":
        return None
    msg = str(result.get("message") or "")
    min_pass = int((config.get("R3") or {}).get("min_words_pass", 80))
    if rule == "R3":
        if result.get("too_short"):
            return f"Add more detail: what you did, how {name} responded and how it went. ({words} of {min_pass} words)"
        phrase = _quoted(msg)
        if phrase and "filler" in msg.lower():
            return f'"{phrase}" is too vague for an audit. Write what actually happened instead.'
        return f"Good start. Add a little more detail, about {min_pass} words in all. ({words} so far)"
    if rule == "R5":
        return f"Say which of {name}'s goals this worked towards, and any progress you saw."
    if rule == "R6":
        phrase = _quoted(msg)
        return (
            f'Write what you saw or heard, not "{phrase}". For example "{name} said" or "{name} was".'
            if phrase else "Write what you saw or heard, not what you think."
        )
    if rule == "R7":
        suggestion = _quoted(msg)
        return f'Use person-first words, for example "{suggestion}".' if suggestion else "Use person-first words."
    if rule == "R8":
        label = _quoted(msg) or "a clinical task"
        return (
            f"This mentions {label}, which is outside a support worker's role. "
            "Describe what you saw and who you told, not a diagnosis or treatment."
        )
    if rule == "R9":
        found = re.search(r"\(([^)]+)\)", msg)
        what = found.group(1) if found else "an incident"
        return f"This sounds like an incident ({what}). Write exactly what happened and complete an incident report."
    if rule == "R10":
        found = re.search(r"\(([^)]+)\)", msg)
        what = found.group(1) if found else "restrictive practice"
        return f"This may describe a restrictive practice ({what}). It needs an incident report before the note can be approved."
    if rule == "R11":
        return "This is very like an earlier note. Write what was different about today."
    if rule == "R12":
        return f'Add how {name} responded, for example "{name} engaged well", "reported feeling tired" or "declined the walk".'
    return None


def check_draft(
    text: str,
    *,
    participant_name: Optional[str] = None,
    goal_ids: Optional[list[str]] = None,
    participant_has_goals: bool = False,
    previous_notes: Optional[list[dict[str, Any]]] = None,
    skipped: Optional[list[str]] = None,
    rp_incident_linked: bool = False,
    participant_id: Optional[str] = None,
    worker_id: Optional[str] = None,
) -> dict[str, Any]:
    """Run the text rules on a draft (its English text). Pure apart from the
    cached rule settings, so it's cheap to call while the worker types."""
    body = (text or "").strip()
    name = (participant_name or "").strip() or "the participant"
    configs_raw = engine.load_rule_configs()
    configs = {code: (configs_raw.get(code) or {}).get("config") or {} for code in TEXT_RULES}
    active = {
        code for code in TEXT_RULES
        if (configs_raw.get(code) or engine._RULE_DEFAULTS.get(code, {})).get("is_active", True)
    }

    session = {
        "id": "draft",
        "patient_id": participant_id or "",
        "worker_id": worker_id or "",
        "notes": body,
        "goals_addressed": goal_ids or [],
        "rp_incident_linked": rp_incident_linked,
    }
    words = _word_count(body)

    checks = {
        "R3": lambda: engine.check_note_quality(session, config=configs["R3"]),
        "R5": lambda: engine.check_goal_language_in_note(session, config=configs["R5"]),
        "R6": lambda: engine.check_objective_language(session, config=configs["R6"]),
        "R7": lambda: engine.check_person_first_language(session, config=configs["R7"]),
        "R8": lambda: engine.check_scope_of_practice(session, config=configs["R8"]),
        "R9": lambda: engine.check_incident_triggers(session, config=configs["R9"]),
        "R10": lambda: engine.check_restrictive_practice_reported(session, config=configs["R10"]),
        "R11": lambda: engine.check_note_similarity(session, previous_notes or [], config=configs["R11"]),
        "R12": lambda: engine.check_participant_response_language(session, config=configs["R12"]),
    }

    rules: list[dict[str, Any]] = []
    if body:
        for code in TEXT_RULES:
            if code not in active:
                continue
            # A note not linked to a goal, for a participant with none on
            # file, has nothing to link: R5 doesn't apply to the draft.
            if code == "R5" and not goal_ids and not participant_has_goals:
                continue
            # R11's own "too short to compare" warning repeats R3.
            if code == "R11" and words < 10:
                continue
            result = checks[code]()
            status = result.get("status")
            hint_id, params = hint_details(result, words, int(configs["R3"].get("min_words_pass", 80)))
            rules.append({
                "rule": code,
                "title": RULE_TITLES[code],
                "status": status,
                "severity": result.get("severity"),
                "blocks_approval": code in ("R10",) and status == "fail",
                "message": worker_message(result, name, configs, words),
                "hint_id": hint_id,
                "params": params,
            })

    by_rule = {r["rule"]: r for r in rules}
    skip = set(skipped or [])

    def failing(code: str) -> bool:
        return code in by_rule and by_rule[code]["status"] != "pass"

    concern_answered = bool(_CONCERN_ANSWERED.search(body)) or failing("R9") or failing("R10")
    order = [
        ("did", not body),
        ("response", failing("R12")),
        ("goal", failing("R5")),
        ("concern", not concern_answered),
        ("detail", failing("R3")),
    ]
    next_id = next((qid for qid, needed in order if needed and qid not in skip), None)
    next_question = None
    if next_id:
        q = QUESTIONS[next_id]
        next_question = {
            "id": next_id,
            "rule": q["rule"],
            "question": q["question"].format(name=name),
            "starter": q["starter"].format(name=name),
        }

    return {
        "rules": rules,
        "issues": [r for r in rules if r["status"] != "pass"],
        "word_count": words,
        "min_words": int(configs["R3"].get("min_words_pass", 80)),
        "next_question": next_question,
        "ready": bool(body) and not any(r["status"] == "fail" for r in rules),
        "checked_when_finished": ["R1", "R2", "R4"],
    }


def improvement_adds_facts(original: str, improved: str) -> list[str]:
    """Rules an AI rewrite newly trips that the worker's own words didn't:
    an incident, a restrictive practice or a clinical task appearing in a
    rewrite means it added something the worker never said."""
    before = check_draft(original)
    after = check_draft(improved)
    failed_before = {r["rule"] for r in before["rules"] if r["status"] == "fail"}
    return [
        r["rule"] for r in after["rules"]
        if r["status"] == "fail" and r["rule"] in ("R8", "R9", "R10") and r["rule"] not in failed_before
    ]


# Times ("2:30", "3pm", "14:00"), numbers with units ("30 minutes", "2 tablets",
# "5mg"), and plain numbers: details that are evidence and must survive a rewrite.
_DETAIL_RE = re.compile(
    r"\b\d{1,2}[:.]\d{2}\s*(?:am|pm)?\b|\b\d+(?:\.\d+)?\s*(?:am|pm|mg|ml|mcg|g|kg|km|m|min|mins|minutes?|hours?|hrs?|tablets?|units?|%)?",
    re.IGNORECASE,
)
_QUOTE_RE = re.compile(r"[\"\u201c]([^\"\u201d]{3,})[\"\u201d]")


def _details(text: str) -> set[str]:
    return {re.sub(r"\s+", "", m.group(0).lower()) for m in _DETAIL_RE.finditer(text or "") if m.group(0).strip()}


def improvement_drops_facts(original: str, improved: str) -> list[str]:
    """What an AI rewrite lost from the worker's note: times, numbers and
    quoted words that no longer appear, or most of the note cut away. Notes
    are evidence, so a rewrite that drops any of these is not offered."""
    lost: list[str] = []
    before, after = _details(original), _details(improved)
    missing = sorted(before - after)
    if missing:
        lost.append("details:" + ",".join(missing[:5]))
    improved_lower = (improved or "").lower()
    for quote in _QUOTE_RE.findall(original or ""):
        if quote.strip().lower() not in improved_lower:
            lost.append("quote")
            break
    words_before = len((original or "").split())
    words_after = len((improved or "").split())
    if words_before >= 40 and words_after < words_before * 0.75:
        lost.append("shortened")
    return lost
