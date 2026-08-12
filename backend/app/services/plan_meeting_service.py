"""Plan meeting service — AI-assisted goal and task suggestions from coordinator notes.

Scope: Core supports only (Assistance with daily life, Social and community participation,
Transport). Any suggestion that would draw from Capacity Building or Capital Supports is blocked
before reaching the coordinator. If meeting notes suggest capacity building intent, the AI must
surface a flag rather than generating a task.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from .supabase_client import get_supabase_admin
from .ai_service import _openai_configured, _build_openai_client

logger = logging.getLogger(__name__)

# NDIS Core supports categories that CareCliQ supports (migration 088 and arch doc)
CORE_SUPPORT_CATEGORIES = frozenset({
    "Assistance with Daily Life",
    "Assistance with Social, Economic and Community Participation",
    "Transport",
    "Consumables",
})

_SYSTEM_PROMPT = """\
You are a support coordination assistant for an Australian NDIS provider using CareCliQ.
Your only job is to analyse coordinator notes from a plan meeting and suggest:
1. Goals to create in ndis_goals (Core supports only)
2. Task templates to activate for this participant (Core supports only)

HARD RULES — violating any of these invalidates your response:
- Only suggest tasks and goals that draw from Core supports funding lines.
  Core support categories: Assistance with Daily Life, Assistance with Social/Economic/Community
  Participation, Transport, Consumables.
- NEVER suggest anything that draws from Capacity Building or Capital Supports.
  If the coordinator's notes imply a capacity building intent (e.g. "learn to cook
  independently", "develop employment skills"), add a flag explaining why it is out of scope
  rather than generating a suggestion for it.
- NEVER generate a suggestion without a `reasoning` field that quotes or closely paraphrases
  the specific text from the meeting notes that triggered the suggestion.
- NEVER suggest a goal that already exists (matching name) in the participant's existing goals.
- NEVER suggest a task in a support category not present in the participant's plan_budgets.
- If the notes do not contain enough specific information to generate a concrete suggestion,
  say so explicitly in `flags` rather than generating a plausible-sounding guess.
- Return ONLY valid JSON matching the schema below. No markdown, no prose outside JSON.

RESPONSE SCHEMA:
{
  "suggested_goals": [
    {
      "name": "string — concise goal name",
      "description": "string",
      "goal_area": "daily_living | community | health | social | employment | other",
      "support_category": "string — must be an exact NDIS Core supports category name",
      "success_criteria": "string",
      "reasoning": "string — quote the meeting note text that triggered this suggestion"
    }
  ],
  "suggested_tasks": [
    {
      "template_id": "string | null — UUID of matching system template, or null if new custom task",
      "template_name": "string — name of the system template, or proposed name if new",
      "link_to_goal_name": "string | null — must match a suggested_goal.name or existing goal name",
      "shift_type": "morning | afternoon | evening | overnight | all",
      "requirement_level": "mandatory | optional",
      "customised_notes": "string — participant-specific instructions based on meeting notes",
      "reasoning": "string — quote the meeting note text that triggered this suggestion"
    }
  ],
  "flags": [
    "string — concerns, out-of-scope items, or requests for more information"
  ]
}
"""


def _fetch_meeting_context(
    participant_id: str,
    organization_id: str,
    supabase,
) -> dict[str, Any]:
    """Load participant goals, budgets, recent AI patterns, and system templates for AI context."""
    ctx: dict[str, Any] = {}

    try:
        goals_resp = (
            supabase.table("ndis_goals")
            .select("name, goal_area, support_category, status")
            .eq("participant_id", participant_id)
            .eq("organization_id", organization_id)
            .eq("status", "active")
            .execute()
        )
        ctx["existing_goals"] = goals_resp.data or []
    except Exception as exc:
        logger.debug("goals fetch failed: %s", exc)
        ctx["existing_goals"] = []

    try:
        plans_resp = (
            supabase.table("ndis_plans")
            .select("id")
            .eq("patient_id", participant_id)
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        plan_rows = plans_resp.data or []
        if plan_rows:
            plan_id = plan_rows[0]["id"]
            budgets_resp = (
                supabase.table("plan_budgets")
                .select("category, allocated_amount, used_amount")
                .eq("plan_id", plan_id)
                .execute()
            )
            ctx["plan_budgets"] = budgets_resp.data or []
        else:
            ctx["plan_budgets"] = []
        ctx["funded_categories"] = list({b["category"] for b in ctx["plan_budgets"] if b.get("category")})
    except Exception as exc:
        logger.debug("budget fetch failed: %s", exc)
        ctx["plan_budgets"] = []
        ctx["funded_categories"] = []

    try:
        patterns_resp = (
            supabase.table("ai_detected_patterns")
            .select("pattern_type, severity, title, message")
            .eq("participant_id", participant_id)
            .eq("organization_id", organization_id)
            .is_("dismissed_at", "null")
            .order("detected_at", desc=True)
            .limit(5)
            .execute()
        )
        ctx["recent_patterns"] = patterns_resp.data or []
    except Exception:
        ctx["recent_patterns"] = []

    try:
        templates_resp = (
            supabase.table("participant_task_templates")
            .select("id, name, category, primary_shift_type")
            .eq("organization_id", organization_id)
            .eq("is_custom", False)
            .is_("participant_id", "null")
            .eq("status", "active")
            .execute()
        )
        ctx["system_templates"] = templates_resp.data or []
    except Exception:
        ctx["system_templates"] = []

    return ctx


def _build_user_prompt(meeting: dict[str, Any], ctx: dict[str, Any]) -> str:
    lines: list[str] = [
        "=== MEETING NOTES ===",
        f"Meeting type: {meeting.get('meeting_type', 'check_in')}",
        f"Meeting date: {meeting.get('meeting_date', '')}",
        f"Attendees: {', '.join(meeting.get('attendees') or [])}",
        "",
        "What the participant said they want support with:",
        meeting.get("participant_priorities") or "(not recorded)",
        "",
        "Coordinator observations:",
        meeting.get("coordinator_observations") or "(not recorded)",
        "",
        "Full conversation notes:",
        meeting.get("conversation_notes") or "(not recorded)",
        "",
        "What was agreed:",
        meeting.get("agreed_outcomes") or "(not recorded)",
        "",
        "=== PARTICIPANT CONTEXT ===",
        "Existing active goals (do not duplicate):",
    ]
    for g in ctx.get("existing_goals") or []:
        lines.append(f"  - {g.get('name')} ({g.get('support_category') or g.get('goal_area')})")
    if not ctx.get("existing_goals"):
        lines.append("  (none)")

    lines += [
        "",
        "Funded budget categories (only suggest tasks in these categories):",
    ]
    for cat in ctx.get("funded_categories") or []:
        lines.append(f"  - {cat}")
    if not ctx.get("funded_categories"):
        lines.append("  (no budget data available — flag any suggestions accordingly)")

    lines += [
        "",
        "Recent AI-detected patterns (for context):",
    ]
    for p in ctx.get("recent_patterns") or []:
        lines.append(f"  - [{p.get('severity')}] {p.get('title')}: {p.get('message')}")
    if not ctx.get("recent_patterns"):
        lines.append("  (none)")

    lines += [
        "",
        "Available system task templates (use template_id when suggesting these):",
    ]
    for t in ctx.get("system_templates") or []:
        lines.append(f"  - id={t.get('id')} | {t.get('name')} | {t.get('category')} | shift={t.get('primary_shift_type')}")
    if not ctx.get("system_templates"):
        lines.append("  (none seeded)")

    lines.append("\nGenerate suggestions now following the JSON schema exactly.")
    return "\n".join(lines)


def _validate_suggestions(
    raw: dict[str, Any],
    ctx: dict[str, Any],
) -> dict[str, Any]:
    """Block suggestions that violate Core supports scope or missing budget categories."""
    funded = {c.lower() for c in (ctx.get("funded_categories") or [])}
    existing_goal_names = {g["name"].lower() for g in (ctx.get("existing_goals") or [])}
    flags = list(raw.get("flags") or [])

    valid_goals: list[dict] = []
    for g in raw.get("suggested_goals") or []:
        name = (g.get("name") or "").strip()
        if not name:
            continue
        if name.lower() in existing_goal_names:
            flags.append(f"Goal '{name}' already exists — skipped.")
            continue
        cat = (g.get("support_category") or "").strip()
        # Block capacity building / capital supports
        cat_lower = cat.lower()
        if any(kw in cat_lower for kw in ("capacity building", "capital", "employment", "improved learning")):
            flags.append(
                f"Goal '{name}' (category: {cat}) requires Capacity Building funding — "
                "out of scope for CareCliQ core support delivery. Discuss with plan manager."
            )
            continue
        if funded and cat.lower() not in funded:
            flags.append(
                f"Goal '{name}' category '{cat}' is not in this participant's funded budget — skipped."
            )
            continue
        g["reasoning"] = g.get("reasoning") or ""
        valid_goals.append(g)

    valid_tasks: list[dict] = []
    for t in raw.get("suggested_tasks") or []:
        t["reasoning"] = t.get("reasoning") or ""
        valid_tasks.append(t)

    return {
        "suggested_goals": valid_goals,
        "suggested_tasks": valid_tasks,
        "flags": flags,
    }


def generate_plan_meeting_suggestions(
    meeting_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """Call AI to generate goal/task suggestions for a recorded plan meeting.

    Returns the validated suggestions dict and persists it to the meeting row.
    Raises ValueError if AI is not configured or the meeting is not found.
    """
    if not _openai_configured():
        raise ValueError("AI service is not configured. Set OPENAI_API_KEY or Replit AI Integrations.")

    supabase = get_supabase_admin()

    meeting_resp = (
        supabase.table("participant_plan_meetings")
        .select("*")
        .eq("id", meeting_id)
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    )
    rows = meeting_resp.data or []
    if not rows:
        raise ValueError("Plan meeting not found.")
    meeting = rows[0]

    participant_id = str(meeting.get("participant_id") or "")
    ctx = _fetch_meeting_context(participant_id, organization_id, supabase)

    user_prompt = _build_user_prompt(meeting, ctx)

    client = _build_openai_client()
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
            max_tokens=2000,
            response_format={"type": "json_object"},
        )
        raw_text = response.choices[0].message.content or "{}"
        raw = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"AI returned invalid JSON: {exc}") from exc
    except Exception as exc:
        raise ValueError(f"AI call failed: {exc}") from exc

    suggestions = _validate_suggestions(raw, ctx)
    now = datetime.now(timezone.utc).isoformat()

    supabase.table("participant_plan_meetings").update({
        "ai_suggestions_raw": suggestions,
        "suggestions_status": "pending_review",
        "ai_generated_at": now,
        "updated_at": now,
    }).eq("id", meeting_id).execute()

    return suggestions


def apply_plan_meeting_suggestions(
    meeting_id: str,
    organization_id: str,
    coordinator_id: str,
    accepted_goals: list[dict],
    accepted_tasks: list[dict],
) -> dict[str, Any]:
    """Apply coordinator-reviewed suggestions: create ndis_goals and task templates.

    `meeting_id` may be either a legacy `participant_plan_meetings` id (text-notes
    flow) or a two-stage-pipeline `plan_meeting_sessions` id (record + transcribe
    flow) — both are looked up here so one function serves both, instead of a
    parallel near-duplicate. Goal/task dicts are read with fallbacks so both the
    legacy `SuggestedGoal`/`SuggestedTask` shape (name/description/...) and the
    newer `ExtractedGoal`/`ExtractedTask` shape (goal_text/task_text/...) work.

    Returns counts of what was created.
    """
    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc).isoformat()

    meeting_resp = (
        supabase.table("participant_plan_meetings")
        .select("participant_id, organization_id")
        .eq("id", meeting_id)
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    )
    rows = meeting_resp.data or []
    source = "legacy"
    if not rows:
        session_resp = (
            supabase.table("plan_meeting_sessions")
            .select("participant_id, organization_id")
            .eq("id", meeting_id)
            .eq("organization_id", organization_id)
            .limit(1)
            .execute()
        )
        rows = session_resp.data or []
        source = "session"
    if not rows:
        raise ValueError("Plan meeting not found.")
    meeting = rows[0]
    if not meeting.get("participant_id"):
        raise ValueError("This meeting has no participant identified yet.")
    participant_id = str(meeting["participant_id"])

    goals_created = 0
    goal_name_to_id: dict[str, str] = {}

    for g in accepted_goals:
        name = (g.get("name") or g.get("goal_text") or "").strip()
        if not name:
            continue
        payload: dict[str, Any] = {
            "participant_id": participant_id,
            "organization_id": organization_id,
            "created_by": coordinator_id,
            "name": name,
            "description": g.get("description") or g.get("goal_text") or "",
            "goal_area": g.get("goal_area") or "other",
            "support_category": g.get("support_category") or None,
            "success_criteria": g.get("success_criteria") or None,
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }
        try:
            resp = supabase.table("ndis_goals").insert(payload).execute()
            if resp.data:
                goal_name_to_id[name.lower()] = str(resp.data[0]["id"])
                goals_created += 1
        except Exception as exc:
            logger.warning("Failed to create goal '%s': %s", name, exc)

    tasks_created = 0
    for t in accepted_tasks:
        template_name = (t.get("template_name") or t.get("task_text") or "").strip()
        if not template_name:
            continue

        linked_goal_id: Optional[str] = None
        link_name = (t.get("link_to_goal_name") or t.get("linked_goal_text") or "").strip().lower()
        if link_name:
            linked_goal_id = goal_name_to_id.get(link_name)
            if not linked_goal_id:
                # Try existing goals
                try:
                    gr = (
                        supabase.table("ndis_goals")
                        .select("id")
                        .eq("participant_id", participant_id)
                        .eq("organization_id", organization_id)
                        .ilike("name", link_name)
                        .limit(1)
                        .execute()
                    )
                    if gr.data:
                        linked_goal_id = str(gr.data[0]["id"])
                except Exception:
                    pass

        payload = {
            "participant_id": participant_id,
            "organization_id": organization_id,
            "created_by": coordinator_id,
            "name": template_name,
            "description": t.get("customised_notes") or t.get("task_text") or "",
            "is_custom": True,
            "is_active": True,
            "status": "active",
            "primary_shift_type": t.get("shift_type") or "morning",
            "recurrence_type": "recurring",
            "is_mandatory": (t.get("requirement_level") or "optional") == "mandatory",
            "linked_goal_id": linked_goal_id,
            "sort_order": 99,
            "created_at": now,
            "updated_at": now,
        }
        try:
            supabase.table("participant_task_templates").insert(payload).execute()
            tasks_created += 1
        except Exception as exc:
            logger.warning("Failed to create task template '%s': %s", template_name, exc)

    if source == "legacy":
        accepted_payload = {
            "accepted_goals": accepted_goals,
            "accepted_tasks": accepted_tasks,
            "applied_at": now,
            "applied_by": coordinator_id,
        }
        supabase.table("participant_plan_meetings").update({
            "suggestions_accepted": accepted_payload,
            "suggestions_status": "applied",
            "updated_at": now,
        }).eq("id", meeting_id).execute()
    else:
        supabase.table("plan_meeting_sessions").update({
            "review_status": "approved",
            "reviewed_by": coordinator_id,
            "reviewed_at": now,
        }).eq("id", meeting_id).execute()

    return {
        "goals_created": goals_created,
        "tasks_created": tasks_created,
        "meeting_id": meeting_id,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 1: Name Resolution & Transcript Cleanup
# ═══════════════════════════════════════════════════════════════════════════════

async def run_stage_1_name_resolution(
    session_id: str,
    organization_id: str,
    raw_transcript_segments: list[dict[str, Any]],
    prefilled_names: Optional[dict[str, Any]] = None,
    meeting_context: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    STAGE 1: Name Resolution & Transcript Cleanup
    
    Takes raw speaker-diarized transcript and resolves speaker identities
    against optional pre-filled name hints. Cleans up ASR errors without
    altering meaning. Never invents content.
    
    Args:
        session_id: ID of the plan_meeting_sessions row
        organization_id: For audit/logging
        raw_transcript_segments: List of dicts with {segment_id, start, speaker_label, text}
        prefilled_names: Optional list of {"name": "...", "role": "..."} for matching hints
        meeting_context: Optional dict with {meeting_type, participant_priorities, ...} for context clues
    
    Returns:
        {
            "resolved_speakers": [{speaker_label, resolved_name, confidence, ...}],
            "clean_transcript": [{segment_id, start, speaker_name, text}],
            "flags": [{segment_id, issue, detail}]
        }
    
    Raises:
        ValueError if AI not configured
    """
    if not _openai_configured():
        raise ValueError("AI service is not configured.")
    
    from .plan_meeting_prompts import (
        STAGE_1_SYSTEM_PROMPT,
        STAGE_1_USER_MESSAGE_TEMPLATE,
    )
    
    # Format input for prompt
    prefilled_json = json.dumps(prefilled_names or [])
    raw_transcript_json = json.dumps(raw_transcript_segments)
    
    # Build user message
    user_message = STAGE_1_USER_MESSAGE_TEMPLATE.format(
        prefilled_names_json=prefilled_json,
        raw_transcript_json=raw_transcript_json,
    )
    
    # Call OpenAI
    client = _build_openai_client()
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": STAGE_1_SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            temperature=0,
            timeout=30,
        )
        result_text = response.choices[0].message.content.strip()
    except Exception as exc:
        logger.exception("Stage 1 AI call failed: %s", exc)
        raise ValueError(f"Stage 1 name resolution failed: {exc}")
    
    # Parse JSON output
    try:
        result = json.loads(result_text)
        logger.info(f"Stage 1 parsed result keys: {result.keys()}")
    except json.JSONDecodeError as exc:
        logger.error("Stage 1 returned non-JSON: %s", result_text[:500])
        raise ValueError(f"Stage 1 returned invalid JSON: {exc}")
    except Exception as exc:
        logger.exception(f"Stage 1 result parsing error: {exc}")
        raise ValueError(f"Stage 1 processing failed: {exc}")
    
    # Update session in database with Stage 1 results
    supabase = get_supabase_admin()
    try:
        supabase.table("plan_meeting_sessions").update({
            "stage_1_status": "complete",
            "raw_transcript": json.dumps(raw_transcript_segments),
            "clean_transcript": json.dumps(result.get("clean_transcript", [])),
            "resolved_names": result.get("resolved_speakers", []),
            "stage_1_completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", session_id).execute()
    except Exception as exc:
        logger.warning("Failed to update session with Stage 1 results: %s", exc)
    
    return result


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 2: Goal & Task Extraction
# ═══════════════════════════════════════════════════════════════════════════════

async def run_stage_2_goal_extraction(
    session_id: str,
    organization_id: str,
    clean_transcript: list[dict[str, Any]],
    support_category_taxonomy: Optional[list[str]] = None,
) -> dict[str, Any]:
    """
    STAGE 2: Goal & Task Extraction
    
    Takes clean, speaker-attributed transcript from Stage 1 and extracts
    candidate NDIS goals and core support tasks, each grounded in specific
    transcript segments.
    
    ⚠️ CRITICAL: Must receive Stage 1's clean_transcript output, NOT raw.
    Never chains off raw transcript.
    
    Args:
        session_id: ID of the plan_meeting_sessions row
        organization_id: For audit/logging
        clean_transcript: Output from Stage 1 run_stage_1_name_resolution()
        support_category_taxonomy: Optional list of allowed categories. Falls back to defaults if None.
    
    Returns:
        {
            "draft_goals": [{goal_text, support_category, source_segment_ids, confidence}],
            "draft_tasks": [{task_text, requirement_level, source_segment_ids, confidence}],
            "attention_flags": [{type, source_segment_ids, detail}]
        }
    
    Raises:
        ValueError if AI not configured or transcript empty
    """
    if not _openai_configured():
        raise ValueError("AI service is not configured.")
    
    if not clean_transcript:
        raise ValueError("clean_transcript cannot be empty. Must run Stage 1 first.")
    
    from .plan_meeting_prompts import (
        STAGE_2_SYSTEM_PROMPT,
        STAGE_2_USER_MESSAGE_TEMPLATE,
        NDIS_SUPPORT_CATEGORIES,
    )
    
    # Use default taxonomy if not provided
    taxonomy = support_category_taxonomy or NDIS_SUPPORT_CATEGORIES
    
    # Format inputs for prompt
    support_category_json = json.dumps(taxonomy)
    clean_transcript_json = json.dumps(clean_transcript)
    
    # Build user message
    user_message = STAGE_2_USER_MESSAGE_TEMPLATE.format(
        support_category_list=support_category_json,
        clean_transcript_json=clean_transcript_json,
    )
    
    # Call OpenAI
    client = _build_openai_client()
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": STAGE_2_SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            temperature=0,
            timeout=30,
        )
        result_text = response.choices[0].message.content.strip()
    except Exception as exc:
        logger.exception("Stage 2 AI call failed: %s", exc)
        raise ValueError(f"Stage 2 goal extraction failed: {exc}")
    
    # Parse JSON output
    try:
        result = json.loads(result_text)
    except json.JSONDecodeError as exc:
        logger.error("Stage 2 returned non-JSON: %s", result_text[:200])
        raise ValueError(f"Stage 2 returned invalid JSON: {exc}")
    
    # Update session in database with Stage 2 results
    supabase = get_supabase_admin()
    try:
        supabase.table("plan_meeting_sessions").update({
            "stage_2_status": "complete",
            "extracted_goals": result.get("draft_goals", []),
            "extracted_tasks": result.get("draft_tasks", []),
            "stage_2_completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", session_id).execute()
    except Exception as exc:
        logger.warning("Failed to update session with Stage 2 results: %s", exc)
    
    return result
