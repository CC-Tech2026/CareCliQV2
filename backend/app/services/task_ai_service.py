"""AI-powered task and goal suggestion service — participant-scoped, RAG-grounded.

When this participant has completed session history, suggestions are grounded in
that history and sources are populated with real session IDs and dates.
When no history exists, suggestions are still generated using general NDIS
knowledge — sources returns [] (honest: no citation because none exists).
The LLM is never given a fake or misleading citation.
"""

import json
import logging
from typing import Optional

from ..services.ai_service import client, _openai_configured
from ..services.supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)


# ── Shared helpers ──────────────────────────────────────────────────────────────

async def _fetch_participant_sessions(
    participant_id: str,
    organisation_id: str,
    limit: int = 4,
) -> list[dict]:
    """Participant-scoped session fetch. Returns [] when no completed sessions exist."""
    supabase = get_supabase_admin()
    try:
        result = (
            supabase.table("sessions")
            .select("id, session_date, compliance_input_text, translated_english_note, notes")
            .eq("patient_id", participant_id)
            .eq("organization_id", organisation_id)
            .eq("status", "completed")
            .order("session_date", desc=True)
            .limit(limit)
            .execute()
        )
        out = []
        for row in result.data or []:
            content = (
                row.get("compliance_input_text")
                or row.get("translated_english_note")
                or row.get("notes")
                or ""
            ).strip()
            if content:
                out.append({
                    "session_id": str(row["id"]),
                    "session_date": str(row.get("session_date") or ""),
                    "content": content,
                })
        return out
    except Exception as exc:
        logger.warning("Participant session fetch failed for AI context: %s", exc)
        return []


def _build_sources(sessions: list[dict]) -> list[dict]:
    return [
        {
            "type": "session",
            "id": s["session_id"],
            "shift_date": s["session_date"],
            "snippet": s["content"][:120],
        }
        for s in sessions
    ]


def _context_block(sessions: list[dict]) -> str:
    return "\n".join(
        f"- [{s['session_date'][:10]}] {s['content'][:200]}" for s in sessions
    )


async def _get_participant_name(participant_id: str) -> str:
    supabase = get_supabase_admin()
    try:
        result = (
            supabase.table("patients")
            .select("full_name")
            .eq("id", participant_id)
            .single()
            .execute()
        )
        return (result.data or {}).get("full_name") or "Participant"
    except Exception:
        return "Participant"


# ── Task description ────────────────────────────────────────────────────────────

async def suggest_task_description(
    participant_id: str,
    shift_type: str,
    category: str,
    organisation_id: str,
    lookback_days: int = 30,
) -> tuple[Optional[str], list[dict]]:
    """
    Returns (suggestion_text, sources).
    When this participant has completed session history, suggestion is grounded in
    that history and sources contains real session IDs and dates.
    When no history exists, a general NDIS-compliant suggestion is returned with
    sources=[] (honest — no citation because none exists).
    """
    if not _openai_configured():
        return None, []

    sessions = await _fetch_participant_sessions(participant_id, organisation_id)
    participant_name = await _get_participant_name(participant_id)

    if sessions:
        history_section = f"Recent session history for this participant:\n{_context_block(sessions)}"
    else:
        history_section = "No prior session history available for this participant."

    try:
        prompt = f"""You are an NDIS-compliant care coordinator creating a task template.

Participant: {participant_name}
Shift type: {shift_type}
Task category: {category.replace('_', ' ')}

{history_section}

Generate a clear, specific task description (1–2 sentences) that:
- Is concrete and measurable where possible
- Uses person-centered language
- Is appropriate for a {shift_type} shift
- Aligns with the {category.replace('_', ' ')} category

Respond with ONLY the task description, no additional text."""

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert NDIS care coordinator. Generate concise, measurable task descriptions.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=150,
        )
        suggestion = (response.choices[0].message.content or "").strip()
        sources = _build_sources(sessions)  # [] when no history — honest
        return (suggestion or None), sources

    except Exception as exc:
        logger.error("Task description suggestion failed: %s", exc)
        return None, []


# ── Task metadata ───────────────────────────────────────────────────────────────

async def suggest_task_metadata(
    participant_id: str,
    shift_type: str,
    category: str,
    organisation_id: str,
) -> dict:
    """
    Returns {"priority": ..., "evidence_required": ...}.
    Uses participant history when available; falls back to general NDIS guidance.
    """
    if not _openai_configured():
        return {"priority": "medium", "evidence_required": "none"}

    sessions = await _fetch_participant_sessions(participant_id, organisation_id, limit=2)

    if sessions:
        context_line = f"- Recent context: {_context_block(sessions)}"
    else:
        context_line = ""

    try:
        prompt = f"""Given these task parameters:
- Shift: {shift_type}
- Category: {category.replace('_', ' ')}
{context_line}

Suggest task metadata as JSON:
{{
  "priority": "low" | "medium" | "high",
  "evidence_required": "none" | "notes" | "photo" | "notes_and_photo"
}}

Base priority on frequency/importance. Base evidence on safety/compliance needs.
Respond ONLY with valid JSON, no other text."""

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.5,
            max_tokens=100,
        )
        result_text = (response.choices[0].message.content or "").strip()
        suggestion = json.loads(result_text)
        return {
            "priority": suggestion.get("priority", "medium"),
            "evidence_required": suggestion.get("evidence_required", "none"),
        }

    except Exception as exc:
        logger.error("Task metadata suggestion failed: %s", exc)
        return {"priority": "medium", "evidence_required": "none"}


# ── Goal description ────────────────────────────────────────────────────────────

async def suggest_goal_description(
    participant_id: str,
    goal_title: str,
    organisation_id: str,
) -> tuple[Optional[str], list[dict]]:
    """
    Returns (suggestion_text, sources).
    Grounded in participant history when available; general NDIS guidance otherwise.
    sources=[] is honest when there is no session history to cite.
    """
    if not _openai_configured():
        return None, []

    sessions = await _fetch_participant_sessions(participant_id, organisation_id)
    participant_name = await _get_participant_name(participant_id)

    if sessions:
        context_section = f"Context from participant's recent sessions:\n{_context_block(sessions)}"
    else:
        context_section = "No prior session history available for this participant."

    try:
        prompt = f"""Create an NDIS-compliant goal description for:

Participant: {participant_name}
Goal: {goal_title}

{context_section}

Generate a 2–3 sentence goal description that:
- Clearly states what will be achieved
- Is measurable where possible
- Is person-centered and strength-based
- Aligns with NDIS language and principles

Respond with ONLY the goal description."""

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert NDIS planner. Generate clear, measurable goal descriptions.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=200,
        )
        suggestion = (response.choices[0].message.content or "").strip()
        sources = _build_sources(sessions)
        return (suggestion or None), sources

    except Exception as exc:
        logger.error("Goal description suggestion failed: %s", exc)
        return None, []


# ── Goal full suggestions (multi-field) ─────────────────────────────────────────

async def suggest_goal_full_suggestions(
    participant_id: str,
    goal_area: str,
    organisation_id: str,
    current_title: str = "",
) -> dict:
    """
    Returns 3 options each for goal name, description, and success criteria.
    Grounded in participant session history when available; NDIS-general otherwise.
    """
    if not _openai_configured():
        return {"names": [], "descriptions": [], "success_criteria": []}

    sessions = await _fetch_participant_sessions(participant_id, organisation_id)
    participant_name = await _get_participant_name(participant_id)

    if sessions:
        context_section = (
            f"Context from {participant_name}'s recent completed sessions:\n"
            + _context_block(sessions)
        )
    else:
        context_section = "No prior session history available. Use evidence-based NDIS best-practice guidance."

    area_display = goal_area.replace("_", " ").title()
    title_hint = (
        f'The coordinator is considering the title: "{current_title}". '
        if current_title.strip()
        else ""
    )

    try:
        prompt = f"""You are an expert NDIS support coordinator helping plan goals.

Participant: {participant_name}
Goal area: {area_display}
{title_hint}
{context_section}

Generate suggestions for NDIS goal planning. Return ONLY valid JSON with this exact structure:
{{
  "names": ["<short action-oriented goal name>", "<second option>", "<third option>"],
  "descriptions": ["<2-3 sentence description — measurable, strength-based>", "<second option>", "<third option>"],
  "success_criteria": ["<specific measurable outcome>", "<second option>"]
}}

Guidelines:
- Names: under 10 words, person-centered, active voice
- Descriptions: state what will be achieved, how progress is measured, and support provided
- Success criteria: observable, time-bound where possible, NDIS-compliant language"""

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert NDIS planner generating participant-centered goal suggestions. Always return valid JSON.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.8,
            max_tokens=700,
            response_format={"type": "json_object"},
        )
        result = json.loads(response.choices[0].message.content or "{}")
        return {
            "names": (result.get("names") or [])[:3],
            "descriptions": (result.get("descriptions") or [])[:3],
            "success_criteria": (result.get("success_criteria") or [])[:2],
        }

    except Exception as exc:
        logger.error("Goal full suggestions failed: %s", exc)
        return {"names": [], "descriptions": [], "success_criteria": []}


# ── Task full suggestions (multi-field) ─────────────────────────────────────────

async def suggest_task_full_suggestions(
    participant_id: str,
    task_purpose: str,
    organisation_id: str,
    goal_name: str = "",
    goal_description: str = "",
) -> dict:
    """
    Returns name options, instruction options, and suggested category/priority for a task.
    Grounded in linked goal context (when provided) + participant session history.
    """
    if not _openai_configured():
        return {"names": [], "instructions": [], "category": None, "priority": None}

    sessions = await _fetch_participant_sessions(participant_id, organisation_id)
    participant_name = await _get_participant_name(participant_id)

    if sessions:
        context_section = (
            f"Context from {participant_name}'s recent completed sessions:\n"
            + _context_block(sessions)
        )
    else:
        context_section = "No prior session history available. Use evidence-based NDIS best-practice guidance."

    if goal_name.strip():
        purpose_context = f'This task supports the NDIS goal: "{goal_name.strip()}"'
        if goal_description.strip():
            purpose_context += f"\nGoal description: {goal_description.strip()[:300]}"
    else:
        purpose_context = "This is a core support task (not linked to a specific goal)."

    try:
        prompt = f"""You are an expert NDIS support coordinator creating a support task.

Participant: {participant_name}
{purpose_context}

{context_section}

Generate task planning suggestions. Return ONLY valid JSON with this exact structure:
{{
  "names": ["<concise task name>", "<second option>", "<third option>"],
  "instructions": ["<specific worker instruction>", "<second option>", "<third option>"],
  "category": "<one of: personal_care | medication | domestic_assistance | community_access | transport | other>",
  "priority": "<one of: low | medium | high>"
}}

Guidelines:
- Names: under 8 words, action-oriented, specific to participant context
- Instructions: 1-2 sentences, tell workers exactly what to do and how, person-centered
- Category: most appropriate NDIS support category given the goal and participant history
- Priority: based on frequency and importance relative to participant's goals"""

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert NDIS care coordinator creating participant-centered support tasks. Always return valid JSON.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=600,
            response_format={"type": "json_object"},
        )
        result = json.loads(response.choices[0].message.content or "{}")
        return {
            "names": (result.get("names") or [])[:3],
            "instructions": (result.get("instructions") or [])[:3],
            "category": result.get("category") or None,
            "priority": result.get("priority") or None,
        }

    except Exception as exc:
        logger.error("Task full suggestions failed: %s", exc)
        return {"names": [], "instructions": [], "category": None, "priority": None}


# ── Goal insight recommendation ─────────────────────────────────────────────────

async def suggest_goal_insight_recommendation(
    participant_id: str,
    goal_title: str,
    completion_rate: float,
    completed: int,
    total: int,
    organisation_id: str,
) -> str:
    """
    Returns an LLM-generated recommendation grounded in participant history when
    available. Falls back to a deterministic stat-based message when AI is
    unavailable — never claims AI grounding it doesn't have.
    """

    def _stat_fallback() -> str:
        if completion_rate >= 0.8:
            return (
                f"{completed}/{total} tasks completed. "
                "Excellent progress — consider increasing goal complexity or frequency."
            )
        if completion_rate >= 0.5:
            return f"{completed}/{total} tasks completed. Good progress at a sustainable pace."
        if completion_rate > 0:
            return (
                f"{completed}/{total} tasks completed. "
                "Review barriers and consider adjusting support or task frequency."
            )
        return "No tasks completed yet. Consider simplifying the goal or adding more targeted support."

    if not _openai_configured():
        return _stat_fallback()

    sessions = await _fetch_participant_sessions(participant_id, organisation_id, limit=3)
    participant_name = await _get_participant_name(participant_id)

    if sessions:
        history_section = f"Recent session history:\n{_context_block(sessions)}"
    else:
        history_section = "No prior session history available for this participant."

    try:
        prompt = f"""You are reviewing goal progress for an NDIS participant.

Participant: {participant_name}
Goal: {goal_title}
Completion rate: {round(completion_rate * 100)}% ({completed}/{total} tasks)

{history_section}

Write a 2-sentence coordinator recommendation that:
- Acknowledges the completion rate honestly
- Suggests a specific, actionable next step
- Is person-centered and practical

Respond with ONLY the recommendation, no preamble."""

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert NDIS coordinator reviewing goal progress.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.6,
            max_tokens=150,
        )
        text = (response.choices[0].message.content or "").strip()
        return text if text else _stat_fallback()

    except Exception as exc:
        logger.error("Goal insight recommendation failed: %s", exc)
        return _stat_fallback()
