"""Meet & Greet summary: the conversation, by topic, without adding or
missing anything the participant and their family said; and the supports
they asked for, which draft the service agreement.

The model only proposes. What's kept is checked here, line by line:
- Nothing added: every point and support must cite transcript lines that
  exist, or it's dropped. A number of hours, how often, or where is kept
  only if the cited words actually say it; otherwise it's left blank for
  the managing director, never guessed. An NDIS item must be one from the
  list it was given.
- Nothing missed: every line the participant, family or anyone other than
  the coordinator said (and the coordinator's typed notes) that no point
  cites is listed under "said but not in the summary". Onboarding can't move
  on to the agreement until each one is included or dismissed.

Sources are the clean transcripts of the intake's Meet & Greet recordings
(Stage 1, plan_meeting_sessions) and the meeting notes typed before any
"Transcript:" block.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

TOPICS = ("goals", "supports", "schedule", "preferences", "access_and_risk", "people", "other")
FREQUENCIES = ("weekly", "fortnightly", "monthly", "as_scheduled")
LOCATIONS = ("home", "school", "preschool", "clinic", "other")
# Lines made only of these ("yeah okay", "thank you") carry no detail to
# miss. Anything else counts, however short: "Allergic to penicillin."
_FILLER = {
    "yeah", "yes", "yep", "yup", "ok", "okay", "no", "nope", "mm", "mhm", "um", "uh", "ah", "oh",
    "right", "sure", "thanks", "thank", "you", "hi", "hello", "hey", "bye", "cool", "great", "good",
    "nice", "alright", "so", "well", "and", "that's", "correct", "exactly", "absolutely",
}
_AGREEING = {"yes", "yeah", "yep", "yup", "correct", "exactly", "absolutely", "sure", "right", "that's"}

SYSTEM_PROMPT = """You summarise an NDIS Meet & Greet conversation between a disability support \
provider and a person who may become their participant. You receive numbered lines: the \
transcript, and the coordinator's own notes.

Rules:
- Use only what is in the lines. Do not add anything that was not said. Do not infer \
diagnoses, needs, preferences, times, amounts or places.
- Leave nothing out about the person: goals, the help they want, days and times, how much \
and how often, likes and dislikes, communication, language and culture, health, medication, \
mobility, behaviours, risks, home, family, carers, nominee, plan manager, other providers.
- Keep their own words where you can. One detail per point.
- Every point must list the ids of the lines it comes from in "source_ids".

Then list the supports to put in their service agreement: only help the person or their \
family asked for or agreed to. For each support:
- "description": what they asked for, in their words.
- "item_code": the code from the provided NDIS list that clearly matches, else null.
- "hours_per_week": a number only if a number of hours was said, else null.
- "frequency": weekly, fortnightly, monthly or as_scheduled, only if said, else null.
- "location": home, school, preschool, clinic or other (community), only if said, else null.
- "source_ids": the lines it comes from.

Reply with JSON only:
{"topics": {"goals": [{"text": "...", "source_ids": ["r1-s4"]}], "supports": [], "schedule": [],
 "preferences": [], "access_and_risk": [], "people": [], "other": []},
 "supports": [{"description": "...", "item_code": null, "hours_per_week": null,
 "frequency": null, "location": null, "source_ids": ["r1-s9"]}]}"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return None
    return value


# ── Sources ──────────────────────────────────────────────────────────────


def gather_sources(intake: dict[str, Any]) -> list[dict[str, Any]]:
    """Numbered lines to summarise: each recording's clean transcript, in
    order ("r1-s3" is recording 1, line s3), then the typed notes ("n1")."""
    supabase = get_supabase_admin()
    sessions = (
        supabase.table("plan_meeting_sessions")
        .select("id, coordinator_id, clean_transcript, created_at")
        .eq("organization_id", intake["organization_id"]).eq("intake_id", intake["id"])
        .eq("stage_1_status", "complete").order("created_at").execute()
    ).data or []
    coordinator_ids = sorted({str(s["coordinator_id"]) for s in sessions if s.get("coordinator_id")})
    coordinators: set[str] = set()
    if coordinator_ids:
        users = supabase.table("users").select("id, full_name").in_("id", coordinator_ids).execute().data or []
        coordinators = {str(u.get("full_name") or "").strip().lower() for u in users if u.get("full_name")}

    lines: list[dict[str, Any]] = []
    for n, session in enumerate(sessions, start=1):
        for seg in _json(session.get("clean_transcript")) or []:
            text = str(seg.get("text") or "").strip()
            if not text:
                continue
            speaker = str(seg.get("speaker_name") or "").strip() or "Unknown speaker"
            lines.append({
                "id": f"r{n}-{seg.get('segment_id') or len(lines) + 1}",
                "speaker": speaker,
                "text": text,
                "coordinator": speaker.lower() in coordinators,
            })
    notes = str(intake.get("meet_greet_notes") or "").split("Transcript:")[0]
    for n, para in enumerate((p.strip() for p in notes.splitlines() if p.strip()), start=1):
        lines.append({"id": f"n{n}", "speaker": "Coordinator notes", "text": para, "coordinator": False})
    return lines


def catalogue_choices() -> list[dict[str, str]]:
    """One NDIS item per support (the weekday daytime version where there is
    one) for the model to choose from; the agreement builder and verification
    then handle the time-of-day codes."""
    from . import agreement_support_service as supports

    groups: dict[tuple, list[dict[str, Any]]] = {}
    for row in supports._catalogue(None):
        groups.setdefault(supports.support_group_key(row), []).append(row)
    out = []
    for rows in groups.values():
        rows.sort(key=lambda r: (str(r.get("time_type") or "") != "Daytime", r["item_code"]))
        out.append({"code": rows[0]["item_code"], "name": supports._base_name(rows[0].get("name")) or rows[0].get("name") or ""})
    return sorted(out, key=lambda c: c["code"])


# ── Checking what the model proposed ─────────────────────────────────────

_NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "half": 0.5,
}
_FREQUENCY_WORDS = {
    "weekly": ("week",), "fortnightly": ("fortnight",), "monthly": ("month",),
    "as_scheduled": ("as needed", "when needed", "as required", "now and then", "occasional"),
}
_LOCATION_WORDS = {
    "home": ("home", "house", "my place", "at mine"), "school": ("school",), "preschool": ("preschool", "kindy", "kindergarten"),
    "clinic": ("clinic",), "other": ("community", "shops", "shopping", "park", "library", "pool", "gym", "out and about", "outings"),
}


def _says_number(text: str, value: float) -> bool:
    lowered = text.lower()
    for match in re.findall(r"\d+(?:\.\d+)?", lowered):
        if abs(float(match) - value) < 1e-9:
            return True
    for word, number in _NUMBER_WORDS.items():
        if abs(number - value) < 1e-9 and re.search(rf"\b{word}\b", lowered):
            return True
    return False


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z']+|\d+", text.lower())


def _counts(line: dict[str, Any], following: Optional[dict[str, Any]]) -> bool:
    """Whether a line holds a detail the summary must cover. The person's
    (and family's) lines do unless they're only filler; the coordinator's
    count when the person agrees with them ("So three hours on Tuesdays?"
    "Yes.")."""
    filler = all(w in _FILLER for w in _words(line["text"]))
    if not line.get("coordinator"):
        return not filler
    if filler or not following or following.get("coordinator"):
        return False
    reply = _words(following["text"])
    return bool(reply) and reply[0] in _AGREEING and all(w in _FILLER for w in reply)


def _cited(ids: Any, known: dict[str, dict[str, Any]]) -> list[str]:
    return [str(i) for i in (ids or []) if str(i) in known]


def check_summary(raw: dict[str, Any], sources: list[dict[str, Any]], allowed_codes: set[str]) -> dict[str, Any]:
    """Keep only what the transcript supports, and list what it didn't cover."""
    known = {s["id"]: s for s in sources}
    dropped = 0
    topics: dict[str, list[dict[str, Any]]] = {t: [] for t in TOPICS}
    for topic, points in ((raw or {}).get("topics") or {}).items():
        key = topic if topic in TOPICS else "other"
        for point in points or []:
            text = str((point or {}).get("text") or "").strip()
            ids = _cited((point or {}).get("source_ids"), known)
            if not text or not ids:
                dropped += 1
                continue
            topics[key].append({"text": text, "source_ids": ids})

    supports: list[dict[str, Any]] = []
    for item in (raw or {}).get("supports") or []:
        ids = _cited((item or {}).get("source_ids"), known)
        description = str((item or {}).get("description") or "").strip()
        if not ids or not description:
            dropped += 1
            continue
        said = " ".join(known[i]["text"] for i in ids)
        unverified: list[str] = []
        hours = item.get("hours_per_week")
        try:
            hours = float(hours) if hours is not None else None
        except (TypeError, ValueError):
            hours = None
        if hours is not None and not _says_number(said, hours):
            hours, unverified = None, unverified + ["hours"]
        frequency = item.get("frequency") if item.get("frequency") in FREQUENCIES else None
        if frequency and not any(w in said.lower() for w in _FREQUENCY_WORDS[frequency]):
            frequency, unverified = None, unverified + ["frequency"]
        location = item.get("location") if item.get("location") in LOCATIONS else None
        if location and not any(w in said.lower() for w in _LOCATION_WORDS[location]):
            location, unverified = None, unverified + ["location"]
        code = item.get("item_code") if item.get("item_code") in allowed_codes else None
        supports.append({
            "description": description, "item_code": code, "hours_per_week": hours,
            "frequency": frequency, "location": location, "source_ids": ids, "unverified": unverified,
        })

    cited = {i for pts in topics.values() for p in pts for i in p["source_ids"]}
    cited |= {i for s in supports for i in s["source_ids"]}
    uncovered = [
        {"id": s["id"], "speaker": s["speaker"], "text": s["text"], "status": "open"}
        for n, s in enumerate(sources)
        if s["id"] not in cited and _counts(s, sources[n + 1] if n + 1 < len(sources) else None)
    ]
    return {
        "topics": topics,
        "supports": supports,
        "uncovered": uncovered,
        "dropped_points": dropped,
        "sources": [{"id": s["id"], "speaker": s["speaker"], "text": s["text"]} for s in sources],
    }


# ── Generating and reviewing ─────────────────────────────────────────────


def _ask_model(sources: list[dict[str, Any]], choices: list[dict[str, str]]) -> dict[str, Any]:
    from .ai_service import _build_openai_client, _openai_configured

    if not _openai_configured():
        raise HTTPException(status_code=503, detail="Summaries need the AI service, which isn't set up.")
    lines = "\n".join(f"[{s['id']}] {s['speaker']}: {s['text']}" for s in sources)
    items = "\n".join(f"{c['code']} | {c['name']}" for c in choices)
    try:
        response = _build_openai_client().chat.completions.create(
            model="gpt-4o-mini",
            temperature=0,
            response_format={"type": "json_object"},
            timeout=60,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"NDIS items:\n{items}\n\nLines:\n{lines}"},
            ],
        )
        return json.loads(response.choices[0].message.content or "{}")
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Meet & Greet summary failed: %s", exc)
        raise HTTPException(status_code=502, detail="The summary couldn't be written. Try again.") from exc


def _save(intake: dict[str, Any], summary: dict[str, Any]) -> dict[str, Any]:
    get_supabase_admin().table("participant_intakes").update({
        "meet_greet_summary": summary, "updated_at": _now(),
    }).eq("id", intake["id"]).eq("organization_id", intake["organization_id"]).execute()
    return summary


def summarise(intake: dict[str, Any], user_id: Optional[str]) -> dict[str, Any]:
    sources = gather_sources(intake)
    if not sources:
        raise HTTPException(status_code=422, detail="Record the Meet & Greet or write notes first.")
    choices = catalogue_choices()
    summary = check_summary(_ask_model(sources, choices), sources, {c["code"] for c in choices})
    return _save(intake, {**summary, "generated_at": _now(), "generated_by": user_id})


def review_line(intake: dict[str, Any], line_id: str, action: str) -> dict[str, Any]:
    """Include a line the summary missed (word for word, under "other"), or
    dismiss it as not about the person."""
    if action not in ("include", "dismiss"):
        raise HTTPException(status_code=422, detail="Choose include or dismiss.")
    summary = intake.get("meet_greet_summary") or {}
    line = next(
        (u for u in summary.get("uncovered") or [] if u.get("id") == line_id and u.get("status") == "open"), None,
    )
    if not line:
        raise HTTPException(status_code=404, detail="That line isn't waiting for review.")
    line["status"] = "included" if action == "include" else "dismissed"
    if action == "include":
        summary.setdefault("topics", {}).setdefault("other", []).append({"text": line["text"], "source_ids": [line_id]})
    return _save(intake, summary)


def open_lines(intake: dict[str, Any]) -> int:
    """Lines said that the summary doesn't cover and nobody has reviewed."""
    summary = intake.get("meet_greet_summary") or {}
    return sum(1 for u in summary.get("uncovered") or [] if u.get("status") == "open")
