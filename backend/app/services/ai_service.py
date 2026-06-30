"""AI service — CareScribe compliance engine backed by OpenAI GPT-4o-mini.

The CareScribe system prompt (CARESCRIBE_SYSTEM_PROMPT) is injected as the
system role on every compliance-related call so every AI output is guaranteed
to be NDIS-compliant, person-centred, and audit-ready.
"""
from openai import OpenAI
from typing import Any
from ..core.config import settings
import json
import os
import re
import urllib.request
import logging

logger = logging.getLogger(__name__)

def _openai_configured() -> bool:
    """True when either Replit AI Integrations or a direct OpenAI key is available."""
    if os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL") and os.environ.get(
        "AI_INTEGRATIONS_OPENAI_API_KEY"
    ):
        return True
    return bool((settings.openai_api_key or "").strip())


def _build_openai_client() -> OpenAI:
    """Prefer Replit AI Integrations (OpenAI-compatible, no user key required);
    fall back to a direct OPENAI_API_KEY when the integration is not configured."""
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    integ_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
    if base_url and integ_key:
        return OpenAI(api_key=integ_key, base_url=base_url)
    return OpenAI(api_key=settings.openai_api_key)


client = _build_openai_client()


class TranslationProviderUnavailable(RuntimeError):
    """Raised when no server-side translation provider is configured."""


class TranslationProviderFailure(RuntimeError):
    """Raised when a configured translation provider cannot translate."""


BLOCKING_TRANSLATION_STATUSES = {"failed", "unsupported", "pending"}
LEGAL_RECORD_REQUIRED_MESSAGE = "Compliance blocked: English legal record is missing or translation failed."

VALID_PROMPT_LEVELS = frozenset({"full", "partial", "independent"})
_PRIOR_TRAJECTORY_MAX_CHARS = 1600  # ~400 tokens


def parse_progress_delta(raw) -> list[dict] | None:
    """Validate GPT progress_delta output; return None on malformed data (never blocks save)."""
    if raw is None:
        return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            logger.warning("progress_delta parse failed: invalid JSON string")
            return None
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list):
        logger.warning("progress_delta parse failed: expected list or object")
        return None

    cleaned: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        entry: dict = {}
        if item.get("goal_id"):
            entry["goal_id"] = str(item["goal_id"])
        prompt = str(item.get("prompt_level") or "").strip().lower()
        if prompt in VALID_PROMPT_LEVELS:
            entry["prompt_level"] = prompt
        try:
            rating = item.get("independence_rating")
            if rating is not None:
                rating_int = int(rating)
                if 1 <= rating_int <= 5:
                    entry["independence_rating"] = rating_int
        except (TypeError, ValueError):
            pass
        if item.get("skill_step"):
            entry["skill_step"] = str(item["skill_step"]).strip()[:500]
        if item.get("delta_summary"):
            entry["delta_summary"] = str(item["delta_summary"]).strip()[:2000]
        if entry:
            cleaned.append(entry)

    return cleaned or None


def format_prior_trajectory_context(prior_by_goal: dict[str, list[dict]]) -> str:
    """Compact prior-session trajectory for GPT prompt (CARECLIQV2-79)."""
    if not prior_by_goal:
        return ""
    lines = ["PRIOR TRAJECTORY (based on past session records):"]
    for goal_id, sessions in prior_by_goal.items():
        if not sessions:
            continue
        lines.append(f"Goal {goal_id}:")
        for row in sessions[:5]:
            delta = row.get("progress_delta") or {}
            date = row.get("session_date") or "unknown date"
            prompt = delta.get("prompt_level") or "n/a"
            rating = delta.get("independence_rating", "n/a")
            summary = (delta.get("delta_summary") or "")[:120]
            lines.append(
                f"  {date}: prompt={prompt}, independence={rating}"
                + (f' — "{summary}"' if summary else "")
            )
    text = "\n".join(lines)
    if len(text) > _PRIOR_TRAJECTORY_MAX_CHARS:
        return text[:_PRIOR_TRAJECTORY_MAX_CHARS] + "\n[truncated]"
    return text


def _legal_record_text_or_raise(session_data: dict) -> str:
    """Return the English legal record text, failing closed on raw/source notes."""
    translation_status = str(session_data.get("translation_status") or "not_required")
    legal_text = (
        session_data.get("compliance_input_text")
        or session_data.get("translated_english_note")
        or ""
    )
    if translation_status in BLOCKING_TRANSLATION_STATUSES or not str(legal_text).strip():
        raise ValueError(LEGAL_RECORD_REQUIRED_MESSAGE)
    return str(legal_text).strip()


# ---------------------------------------------------------------------------
# CareScribe Master System Prompt (from spec)
# ---------------------------------------------------------------------------

CARESCRIBE_SYSTEM_PROMPT = """You are CareScribe — a 100% Compliance Engine with AI support designed to support Australian NDIS providers with accurate, safe, and compliant clinical documentation.

Your responsibilities:

1. NDIS Compliance (Australia)
   Ensure all outputs align with:
   • NDIS Practice Standards
   • NDIS Code of Conduct
   • Privacy Act 1988 (Australia)
   • Safe, respectful, non-restrictive language requirements

   Never:
   • Suggest medical diagnosis outside professional scope
   • Encourage restrictive practices
   • Generate unsafe, judgmental, or non-person-centred language
   • Fabricate clinical facts

   Always:
   • Use person-first language
   • Focus on functional support, goals, and participation
   • Align documentation with funding categories (Core, Capacity Building, Capital)
   • Ensure notes are suitable for audit and claim justification

2. Clinical Documentation Structure (Mandatory Format)
   All session outputs must be structured as:
   • Activities Performed
   • Participant Response
   • Outcomes
   • Progress Toward NDIS Goals
   • Support Category Mapping
   • Risk / Incident Flags (if any)

3. Restrictive Practice Detection
   Detect and flag: physical restraint, chemical restraint, environmental restriction,
   mechanical restraint, seclusion, coercion or controlling language.
   If detected: set restrictive_practice_detected = true, explain it, provide safer
   alternative wording, recommend escalation to supervisor review.

4. Compliance Scoring System (0–100)
   Score based on these weighted criteria:
   • Documentation completeness (30%): notes present, structured fields populated, sufficient detail
   • Goal alignment (25%): NDIS goals linked, progress toward goals documented
   • NDIS language compliance (20%): person-first language, correct NDIS terminology, no deficit language
   • Risk detection accuracy (15%): restrictive practices identified if present, incidents flagged
   • Audit readiness (10%): service type set, duration recorded, within plan dates, billing justification

5. Budget & Funding Alignment
   Map all sessions to: Core Supports, Capacity Building Supports, or Capital Supports.
   Estimate session cost based on duration and session type using NDIS price guide logic.
   Flag: over-budget usage, misclassified services, missing billing justification.

6. Language Rules
   Use: "Participant" not "patient"
   Use: "Support worker" not "carer" (unless context requires)
   Use: "Support needs" not "deficits"
   Use: "Assisted with" not "controlled"

7. Escalation Rules
   Immediately flag if:
   • Risk of harm is described
   • Restrictive practice is implied or described
   • Budget misuse is detected
   • Legal/NDIS breach language appears

Always respond with valid JSON matching the exact output format requested."""


# ---------------------------------------------------------------------------
# Anthropic client (optional — for RP suggestion enrichment only)
# ---------------------------------------------------------------------------

def get_anthropic_client():
    """Return an Anthropic client. Prefers Replit AI Integrations (no user key
    required); falls back to a direct ANTHROPIC_API_KEY. Returns None if neither
    is configured."""
    base_url = os.environ.get("AI_INTEGRATIONS_ANTHROPIC_BASE_URL")
    integ_key = os.environ.get("AI_INTEGRATIONS_ANTHROPIC_API_KEY")
    api_key = settings.anthropic_api_key
    if not ((base_url and integ_key) or api_key):
        return None
    try:
        import anthropic
        if base_url and integ_key:
            return anthropic.Anthropic(api_key=integ_key, base_url=base_url)
        return anthropic.Anthropic(api_key=api_key)
    except Exception as e:
        logger.warning(f"Failed to create Anthropic client: {e}")
        return None


# ---------------------------------------------------------------------------
# LibreTranslate helper
# ---------------------------------------------------------------------------

_LIBRETRANSLATE_URL = os.getenv("LIBRETRANSLATE_URL", "").rstrip("/")

# ---------------------------------------------------------------------------
# Google Cloud Translation helper (v2 Basic REST — no SDK dependency)
# ---------------------------------------------------------------------------

_GOOGLE_CLOUD_TRANSLATION_API_KEY = settings.google_cloud_translation_api_key.strip()
_GOOGLE_TRANSLATE_URL = settings.google_translate_url.rstrip("/")


def _google_cloud_translate_sync(text: str) -> dict:
    """Translate text via Google Cloud Translation API v2. Raises on failure."""
    if not _GOOGLE_CLOUD_TRANSLATION_API_KEY:
        raise RuntimeError("GOOGLE_CLOUD_TRANSLATION_API_KEY not configured")
    payload = json.dumps({"q": text, "target": "en", "format": "text"}).encode()
    req = urllib.request.Request(
        f"{_GOOGLE_TRANSLATE_URL}?key={_GOOGLE_CLOUD_TRANSLATION_API_KEY}",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=8) as resp:
        data = json.loads(resp.read())
    translation = (data.get("data", {}).get("translations") or [{}])[0]
    translated_text = (translation.get("translatedText") or "").strip()
    if not translated_text:
        raise RuntimeError("Google Cloud Translation returned empty translation")
    return {
        "translated": translated_text,
        "detected_language": (translation.get("detectedSourceLanguage") or "en").lower(),
        "confidence": 0.98,
    }


def _libretranslate_sync(text: str) -> dict:
    """Try LibreTranslate via LIBRETRANSLATE_URL env var. Raises on failure."""
    if not _LIBRETRANSLATE_URL:
        raise RuntimeError("LIBRETRANSLATE_URL not configured")
    payload = json.dumps({"q": text, "source": "auto", "target": "en", "format": "text"}).encode()
    req = urllib.request.Request(
        f"{_LIBRETRANSLATE_URL}/translate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=8) as resp:
        data = json.loads(resp.read())
    detected = data.get("detectedLanguage", {}).get("language", "")
    translated_text = (data.get("translatedText") or "").strip()
    if not translated_text:
        raise RuntimeError("LibreTranslate returned empty translation")
    return {
        "translated": translated_text,
        "detected_language": detected or "en",
        "confidence": data.get("detectedLanguage", {}).get("confidence", 0.9),
        "provider": "libretranslate",
        "model": None,
    }


# ---------------------------------------------------------------------------
# RP suggestion enrichment (Anthropic / fallback)
# ---------------------------------------------------------------------------

async def enrich_rp_suggestions(rp_flags: list[dict], anthropic_client) -> list[dict]:
    """Call Claude to add NDIS-compliant rewrite suggestions for each RP flag.

    All flags are batched into a single Claude call to minimise latency.
    If Claude is unavailable or fails, rewrites via GPT-4o-mini instead.
    """
    if not rp_flags:
        return rp_flags

    flags_text = "\n".join(
        f"{i + 1}. Category: {f['category']} | Flagged phrase: \"{f['phrase']}\" | Context: \"{f['context']}\""
        for i, f in enumerate(rp_flags)
    )

    prompt = f"""You are an NDIS compliance specialist helping support workers rewrite documentation that contains language indicating restrictive practices.

For each flagged phrase below, provide a single concise NDIS-compliant rewrite sentence that:
- Uses person-centred, strengths-based language
- Replaces restrictive language with positive behaviour support terminology
- Meets NDIS Quality and Safeguards Commission documentation standards
- Is professional and factual in tone

Flagged phrases:
{flags_text}

Respond with a JSON object in this exact format:
{{
  "rewrites": [
    {{"index": 1, "suggestion": "NDIS-compliant rewrite sentence here"}},
    {{"index": 2, "suggestion": "NDIS-compliant rewrite sentence here"}}
  ]
}}

Provide one rewrite per flagged phrase, matching the index number."""

    # Try Anthropic first if available
    if anthropic_client is not None:
        try:
            message = anthropic_client.messages.create(
                model="claude-3-5-haiku-20241022",
                max_tokens=1024,
                system=CARESCRIBE_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = message.content[0].text if message.content else ""
            raw = raw.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
                raw = raw.strip()
            result = json.loads(raw)
            rewrites = {item["index"]: item.get("suggestion") for item in result.get("rewrites", [])}
            return [{**flag, "suggestion": rewrites.get(i + 1)} for i, flag in enumerate(rp_flags)]
        except Exception as e:
            logger.warning(f"Claude RP enrichment failed, falling back to GPT: {e}")

    # Fallback: GPT-4o-mini with CareScribe system prompt
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": CARESCRIBE_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            max_tokens=1024,
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        result = json.loads(response.choices[0].message.content)
        rewrites = {item["index"]: item.get("suggestion") for item in result.get("rewrites", [])}
        return [{**flag, "suggestion": rewrites.get(i + 1)} for i, flag in enumerate(rp_flags)]
    except Exception as e:
        logger.warning(f"GPT RP enrichment also failed (non-critical): {e}")
        return rp_flags


# ---------------------------------------------------------------------------
# Master session analysis (new unified function — spec JSON output)
# ---------------------------------------------------------------------------

async def generate_session_analysis(
    session_data: dict,
    participant_data: dict,
    rp_flags: list | None = None,
    prior_trajectory: dict[str, list[dict]] | None = None,
) -> dict:
    """Run the full CareScribe compliance analysis on a session.

    Returns a dict matching the spec JSON format:
    {
      "session_summary": str,
      "structured_notes": {activities_performed, participant_response, outcomes, progress_toward_goals},
      "ndis_mapping": {support_category, support_items},
      "compliance": {score, flags, restrictive_practice_detected, recommendations},
      "budget_insights": {estimated_cost, budget_status},
      // backward-compat fields:
      "key_observations": list,
      "concerns": list,
      "next_session_recommendations": list,
      "progress_trend": str,
    }

    The compliance.score uses the spec-weighted breakdown:
      documentation completeness (30%) + goal alignment (25%) +
      NDIS language compliance (20%) + risk detection (15%) + audit readiness (10%)
    """
    # Resolve goal titles from IDs
    raw_goals = session_data.get("goals_addressed") or []
    if isinstance(raw_goals, str):
        try:
            raw_goals = json.loads(raw_goals)
        except Exception:
            raw_goals = []

    participant_goals = participant_data.get("goals") or []
    if isinstance(participant_goals, str):
        try:
            participant_goals = json.loads(participant_goals)
        except Exception:
            participant_goals = []

    goal_title_map: dict = {}
    for g in participant_goals:
        if isinstance(g, dict) and g.get("id") and g.get("title"):
            goal_title_map[g["id"]] = g["title"]

    resolved_goals = [goal_title_map.get(gid, str(gid)) for gid in raw_goals]
    goals_context = ", ".join(resolved_goals) if resolved_goals else "None linked"

    # Build RP flags context for the AI
    rp_context = ""
    if rp_flags:
        rp_context = "\n\nRESTRICTIVE PRACTICE FLAGS (already detected by rules engine):\n" + "\n".join(
            f"- {f['category'].replace('_', ' ').title()}: \"{f['phrase']}\" (severity: {f['severity']})"
            for f in rp_flags
        )

    legal_record_text = _legal_record_text_or_raise(session_data)

    # Build structured notes context only when those fields are already part of
    # the English legal record. Raw source-language structured fields are audit
    # context, not compliance input.
    raw_structured = {
        "activities_performed": session_data.get("activities_performed") or "",
        "participant_response": session_data.get("participant_response") or "",
        "outcomes": session_data.get("outcomes") or "",
        "progress_toward_goals": session_data.get("progress_toward_goals") or "",
    }
    existing_structured = {
        key: value if str(value).strip() and str(value).strip() in legal_record_text else ""
        for key, value in raw_structured.items()
    }
    has_structured = any(v.strip() for v in existing_structured.values())

    notes_section = f"Session Notes: {legal_record_text}"
    if has_structured:
        notes_section += f"""
Structured Fields Already Completed:
  Activities Performed: {existing_structured['activities_performed'] or 'Not entered'}
  Participant Response: {existing_structured['participant_response'] or 'Not entered'}
  Outcomes: {existing_structured['outcomes'] or 'Not entered'}
  Progress Toward Goals: {existing_structured['progress_toward_goals'] or 'Not entered'}"""

    prior_context = format_prior_trajectory_context(prior_trajectory or {})

    # Estimate cost context
    duration = int(session_data.get("duration_minutes") or 0)
    session_type = session_data.get("session_type") or "Support"
    total_budget = float(participant_data.get("total_budget") or 0)
    used_budget = float(participant_data.get("used_budget") or 0)

    user_prompt = f"""Analyse this NDIS support session and return a full CareScribe compliance report.

PARTICIPANT INFORMATION:
  Name: {participant_data.get('full_name', 'Unknown')}
  NDIS Number: {participant_data.get('ndis_number', 'N/A')}
  Primary Disability / Support Needs: {participant_data.get('primary_disability', 'Not specified')}
  NDIS Plan Status: {participant_data.get('plan_status', 'active')}
  NDIS Goals: {goals_context}
  Total Budget: ${total_budget:,.2f} | Used Budget: ${used_budget:,.2f}

SESSION INFORMATION:
  Date: {session_data.get('session_date', 'Not specified')}
  Session Type: {session_type}
  Duration: {duration} minutes
  Tags: {', '.join(session_data.get('tags', []) or [])}
  Goals Addressed This Session: {goals_context}

{notes_section}
{rp_context}
{prior_context}

PROGRESS EXTRACTION (NDIS terminology):
For each goal addressed this session, extract measurable progress signals into progress_delta.
- prompt_level: full | partial | independent (support prompting required)
- independence_rating: integer 1-5 (1=full support, 5=independent)
- skill_step: brief skill acquisition stage label
- delta_summary: plain-language change vs prior sessions when prior trajectory is available
Reference prior trajectory when present (e.g. "improvement from full to partial prompting").

SCORING INSTRUCTIONS:
Calculate compliance.score (0-100) using these EXACT weights:
  • Documentation completeness (30%): Are notes present, structured fields populated, detail sufficient?
  • Goal alignment (25%): Are NDIS goals linked? Is progress documented?
  • NDIS language compliance (20%): Is person-first language used? Correct NDIS terminology?
  • Risk detection accuracy (15%): Are any restrictive practices or incidents flagged?
  • Audit readiness (10%): Service type set, duration recorded, notes justify the claim?

Return ONLY this JSON (no markdown, no explanation):
{{
  "session_summary": "2-3 sentence clinical summary in person-first NDIS language",
  "structured_notes": {{
    "activities_performed": "what was done during the session",
    "participant_response": "how the participant engaged and responded",
    "outcomes": "what was achieved or observed",
    "progress_toward_goals": "progress toward the participant's NDIS goals"
  }},
  "ndis_mapping": {{
    "support_category": "Core Supports | Capacity Building Supports | Capital Supports",
    "support_items": ["NDIS support item description"]
  }},
  "compliance": {{
    "score": 0,
    "score_breakdown": {{
      "documentation_completeness": 0,
      "goal_alignment": 0,
      "ndis_language_compliance": 0,
      "risk_detection": 0,
      "audit_readiness": 0
    }},
    "flags": ["compliance flag if any"],
    "restrictive_practice_detected": false,
    "recommendations": ["specific actionable improvement"]
  }},
  "budget_insights": {{
    "estimated_cost": 0.0,
    "budget_status": "within budget | nearing limit | exceeded"
  }},
  "key_observations": ["specific clinical observation"],
  "concerns": ["clinical concern if any"],
  "next_session_recommendations": ["specific recommendation"],
  "progress_trend": "improving | stable | declining",
  "progress_delta": [
    {{
      "goal_id": "goal id when known",
      "prompt_level": "full | partial | independent",
      "independence_rating": 1,
      "skill_step": "skill acquisition step",
      "delta_summary": "plain-language progress vs prior sessions"
    }}
  ]
}}

If structured_notes are already completed above, preserve them exactly (do not rewrite). Only generate them if fields are empty.
If no measurable progress is documented, return progress_delta as an empty array []."""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": CARESCRIBE_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=1200,
        temperature=0.2,
        response_format={"type": "json_object"},
    )

    result = json.loads(response.choices[0].message.content)

    # If the AI didn't populate structured_notes but session has them, preserve
    if has_structured:
        sn = result.get("structured_notes") or {}
        for key, val in existing_structured.items():
            if val.strip() and not (sn.get(key) or "").strip():
                sn[key] = val
        result["structured_notes"] = sn

    # Ensure score is numeric and clamped 0-100
    try:
        score = float(result.get("compliance", {}).get("score", 0))
        score = max(0.0, min(100.0, score))
        if "compliance" in result:
            result["compliance"]["score"] = score
    except (TypeError, ValueError):
        if "compliance" in result:
            result["compliance"]["score"] = 0.0

    # Ensure backward-compat fields exist
    result.setdefault("key_observations", [])
    result.setdefault("concerns", [])
    result.setdefault("next_session_recommendations", [])
    result.setdefault("progress_trend", "stable")
    result.setdefault("summary", result.get("session_summary", ""))
    result["progress_delta"] = parse_progress_delta(result.get("progress_delta"))

    return result


# ---------------------------------------------------------------------------
# Participant summary (for the overview tab)
# ---------------------------------------------------------------------------

async def generate_patient_summary(participant_data: dict, sessions: list) -> str:
    sessions_text = "\n".join([
        f"- {s.get('session_date', 'Unknown date')}: {s.get('session_type', 'Session')} "
        f"({s.get('duration_minutes', 0)} min) — "
        f"{(s.get('translated_english_note') or s.get('compliance_input_text') or 'English legal record unavailable')[:200]}"
        for s in sessions[-5:]
    ])

    prompt = f"""You are a clinical assistant for an NDIS (National Disability Insurance Scheme) provider in Australia.

Participant: {participant_data.get('full_name', 'Unknown')}
NDIS Number: {participant_data.get('ndis_number', 'N/A')}
Primary Disability / Support Needs: {participant_data.get('primary_disability', 'Not specified')}
Plan Status: {participant_data.get('plan_status', 'active')}
Goals: {', '.join(
        (g.get('title') or g.get('description') or str(g)) if isinstance(g, dict) else str(g)
        for g in (participant_data.get('goals') or [])
    ) or 'None specified'}

Recent Sessions:
{sessions_text or 'No sessions recorded yet'}

Write a concise clinical summary (3-4 sentences) covering:
1. Current functional status and progress toward NDIS goals
2. Key achievements or areas of concern observed
3. Recommended focus areas for next session

Use person-first language, be professional and factual, and align with NDIS Active Support principles."""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": CARESCRIBE_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        max_tokens=300,
        temperature=0.3,
    )
    return response.choices[0].message.content


# ---------------------------------------------------------------------------
# Clinical insights (backward-compat — used by session detail page)
# ---------------------------------------------------------------------------

async def generate_clinical_insights(session_data: dict, participant_data: dict) -> dict:
    """Generate clinical insights for the session detail view.

    Delegates to generate_session_analysis and maps the result to the
    backward-compatible format expected by the UI.
    """
    analysis = await generate_session_analysis(session_data, participant_data)

    # Map to existing format
    return {
        "summary": analysis.get("session_summary") or analysis.get("summary", ""),
        "key_observations": analysis.get("key_observations", []),
        "progress_indicators": [],   # deprecated — rolled into key_observations
        "concerns": analysis.get("concerns", []),
        "next_session_recommendations": analysis.get("next_session_recommendations", []),
        "progress_trend": analysis.get("progress_trend", "stable"),
        # Include full spec output for richer UI
        "session_summary": analysis.get("session_summary", ""),
        "structured_notes": analysis.get("structured_notes", {}),
        "ndis_mapping": analysis.get("ndis_mapping", {}),
        "budget_insights": analysis.get("budget_insights", {}),
        "compliance_spec": analysis.get("compliance", {}),
    }


# ---------------------------------------------------------------------------
# AI compliance check — spec-weighted scoring + narrative
# ---------------------------------------------------------------------------

async def check_compliance(session_data: dict) -> dict:
    """AI-based compliance check using the spec's 5-dimension weighted scoring.

    Kept for backward compatibility with the /compliance endpoints.
    For new code, prefer generate_session_analysis() which returns the full spec.
    """
    # Quick local pre-assessment for context. Compliance AI is allowed to see
    # only the English legal record, never the raw source-language note.
    effective_text = _legal_record_text_or_raise(session_data)
    goals = session_data.get("goals_addressed") or []
    if isinstance(goals, str):
        try:
            goals = json.loads(goals)
        except Exception:
            goals = []
    duration = int(session_data.get("duration_minutes") or 0)
    session_type = (session_data.get("session_type") or "").strip()
    tags = session_data.get("tags") or []

    prompt = f"""You are a CareScribe NDIS compliance specialist auditing session documentation.

Session Details:
- Notes / structured text length: {len(effective_text)} characters
- Notes preview: {effective_text[:400]}
- Duration: {duration} minutes
- Goals Addressed: {', '.join(str(g) for g in goals) if goals else 'None linked'}
- Session Type: {session_type or 'Not specified'}
- Tags: {', '.join(tags) if tags else 'None'}

Assess compliance using the CareScribe weighted scoring:
  • Documentation completeness (30%): notes present, structured fields, detail sufficient
  • Goal alignment (25%): NDIS goals linked, progress documented
  • NDIS language compliance (20%): person-first, correct terminology
  • Risk detection accuracy (15%): RP or incidents flagged if present
  • Audit readiness (10%): service type, duration, billing justification

Respond with a JSON object:
{{
  "score": <weighted 0-100>,
  "assessment": "2-3 sentence compliance assessment for NDIS audit purposes",
  "score_breakdown": {{
    "documentation_completeness": <0-30>,
    "goal_alignment": <0-25>,
    "ndis_language_compliance": <0-20>,
    "risk_detection": <0-15>,
    "audit_readiness": <0-10>
  }},
  "flags": ["flag if any"]
}}"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": CARESCRIBE_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        max_tokens=400,
        temperature=0.2,
        response_format={"type": "json_object"},
    )

    result = json.loads(response.choices[0].message.content)

    score = float(result.get("score", 0))
    score = max(0.0, min(100.0, score))

    return {
        "score": score,
        "assessment": result.get("assessment", ""),
        "score_breakdown": result.get("score_breakdown", {}),
        "flags": result.get("flags", []),
        # Legacy format — kept for UI compatibility
        "checks": {
            "notes_present": len(effective_text) > 50,
            "duration_recorded": duration > 0,
            "goals_linked": bool(goals),
            "session_type_set": bool(session_type),
            "outcome_described": bool(
                any(kw in effective_text.lower() for kw in [
                    "outcome", "achieved", "progress", "improvement", "goal",
                    "completed", "participant", "demonstrated", "able to", "successfully",
                ])
            ),
        },
        "passed": 0,
        "total": 0,
    }


# ---------------------------------------------------------------------------
# Compliance explanation (for session detail "explain" button)
# ---------------------------------------------------------------------------

async def explain_compliance(failed_rules: list, session_notes: str) -> dict:
    """Generate human-readable compliance explanation and actionable fix suggestions."""
    if not failed_rules:
        return {
            "explanation": "This session meets all NDIS documentation requirements and is ready for audit.",
            "fix_suggestion": "",
            "priority": "info",
        }

    rules_text = "\n".join([
        f"- {r.get('rule', 'Unknown rule').replace('_', ' ').title()}: {r.get('message', '')}"
        for r in failed_rules
    ])

    has_critical = any(
        r.get("severity") in ("critical", "high") or r.get("status") == "fail"
        for r in failed_rules
    )

    prompt = f"""You are an NDIS compliance specialist helping a support worker improve their session documentation.

Session Notes (excerpt): {session_notes[:500] if session_notes else "No notes provided"}

Compliance Issues Found:
{rules_text}

Respond with a JSON object:
{{
  "explanation": "Start with 'This session may not meet NDIS requirements because...' then explain specifically what is missing and why it matters for NDIS audits. 2-3 sentences.",
  "fix_suggestion": "Start with 'To improve compliance, consider:' then give 2-4 specific, practical actions using bullet points (•). Each bullet should be a concrete action the worker can take right now.",
  "priority": "{'critical' if has_critical else 'warning'}"
}}

Write in plain English. Be specific about what information is actually missing. Avoid jargon."""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": CARESCRIBE_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        max_tokens=450,
        temperature=0.2,
        response_format={"type": "json_object"},
    )
    result = json.loads(response.choices[0].message.content)
    result["priority"] = "critical" if has_critical else "warning"
    return result


async def improve_note(
    notes: str,
    failed_rules: list[dict],
    rp_flags: list[dict] | None = None,
    participant_id: str | None = None,
    organisation_id: str | None = None,
) -> dict:
    """Generate an improved clinical note that fixes all failed compliance rules.

    When participant context is available, retrieves high-scoring past notes via RAG
    (CARECLIQV2-33) so suggestions reference participant-specific documentation.
    """
    if not notes or not notes.strip():
        return {
            "improved_note": "",
            "rule_suggestions": [],
        }

    rag_context = ""
    if participant_id and organisation_id:
        try:
            from .rag_service import retrieve_high_scoring_participant_notes

            past_notes = await retrieve_high_scoring_participant_notes(
                participant_id=participant_id,
                organisation_id=organisation_id,
                query_text=notes[:500],
                min_score=85.0,
                k=3,
            )
            if past_notes:
                snippets = []
                for n in past_notes:
                    date = n.get("session_date") or "prior session"
                    score = n.get("compliance_score")
                    content = (n.get("content") or "")[:400]
                    snippets.append(f"[{date}, score={score}]: {content}")
                rag_context = (
                    "\n\nHIGH-SCORING PAST SESSION RECORDS FOR THIS PARTICIPANT "
                    "(based on past session records — use for participant-specific context):\n"
                    + "\n".join(snippets)
                )
        except Exception as rag_err:
            logger.warning("RAG context for note improvement failed (non-critical): %s", rag_err)

    rules_text = "\n".join([
        f"- {r.get('rule', '').replace('_', ' ').title()}: {r.get('message', '')}"
        for r in failed_rules
    ]) or "No specific rule failures"

    rp_text = ""
    if rp_flags:
        rp_text = "\nRestrictive Practice flags (must be documented correctly):\n" + "\n".join([
            f"- {f.get('phrase', '')} ({f.get('category', '')})"
            for f in rp_flags[:5]
        ])

    prompt = f"""You are an expert NDIS clinical documentation specialist. Rewrite the clinical note below to fix all NDIS compliance issues.

ORIGINAL NOTE:
{notes[:2000]}

FAILED COMPLIANCE RULES:
{rules_text}{rp_text}{rag_context}

Requirements for the improved note:
- When past session records are provided, reference participant-specific context (e.g. "Jordan previously demonstrated…")
- Use objective, observable, third-person language (no "I think", "seems", "probably")
- Use person-first language (e.g. "participant" not "the disabled person")
- Include what was done (activities), how the participant responded, and what was achieved (outcome)
- Reference NDIS goals or support category where relevant
- Mention next steps or follow-up actions
- Keep it professional and concise (3-6 sentences typical)

Respond with JSON:
{{
  "improved_note": "the complete rewritten clinical note",
  "rule_suggestions": [
    {{
      "rule": "rule_name_from_failed_list",
      "issue": "brief description of the specific problem",
      "suggestion": "specific one-sentence fix or addition to the original note"
    }}
  ]
}}"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": CARESCRIBE_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        max_tokens=700,
        temperature=0.3,
        response_format={"type": "json_object"},
    )
    result = json.loads(response.choices[0].message.content)
    return {
        "improved_note": result.get("improved_note", ""),
        "rule_suggestions": result.get("rule_suggestions", []),
    }


async def generate_session_embedding(text: str) -> list[float]:
    """Generate a text-embedding-3-small vector for a session note."""
    from .query_embedding_service import generate_query_embedding

    return await generate_query_embedding(text)


# ---------------------------------------------------------------------------
# Translation & clinical rewrite
# ---------------------------------------------------------------------------

async def translate_to_english(text: str, source_language: str = "auto") -> dict:
    """Translate text into fluent English.

    Raises when no provider can produce an English translation. Callers must not
    silently save raw non-English text as the legal record.
    """
    if not text or not text.strip():
        return {
            "translated": "",
            "detected_language": "en",
            "confidence": 1.0,
            "provider": "none",
            "model": None,
        }

    try:
        return _libretranslate_sync(text)
    except Exception as libre_exc:
        logger.info("LibreTranslate unavailable, trying Google Cloud Translation: %s", libre_exc)

    try:
        return _google_cloud_translate_sync(text)
    except Exception as google_exc:
        logger.info("Google Cloud Translation unavailable, using OpenAI translation: %s", google_exc)

    if not _openai_configured():
        raise TranslationProviderUnavailable(
            "Translation provider is not configured. Add GOOGLE_CLOUD_TRANSLATION_API_KEY, OPENAI_API_KEY, or LIBRETRANSLATE_URL on the backend."
        )

    lang_hint = (
        f"The source language is {source_language}."
        if source_language != "auto"
        else "Detect the source language automatically."
    )

    prompt = f"""You are a multilingual clinical translator.
{lang_hint}

Translate the following text into fluent, natural English. Preserve clinical and medical meaning exactly. Do not paraphrase — only translate.

Input: {text}

Respond with a JSON object:
{{
  "translated": "the English translation",
  "detected_language": "ISO 639-1 language code of the source text (e.g. fr, es, zh)"
}}"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": CARESCRIBE_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            max_tokens=500,
            temperature=0.1,
            response_format={"type": "json_object"},
        )
    except Exception as exc:
        logger.error("OpenAI translation provider failed", exc_info=True)
        raise TranslationProviderFailure(
            "Translation provider failed. Check backend translation configuration."
        ) from exc
    result = json.loads(response.choices[0].message.content)
    translated = (result.get("translated") or "").strip()
    detected = (result.get("detected_language") or "").strip().lower()
    if not translated or not detected:
        raise RuntimeError("OpenAI translation returned incomplete data")
    return {
        "translated": translated,
        "detected_language": detected,
        "confidence": 0.95,
        "provider": "openai",
        "model": "gpt-4o-mini",
        "fallback_used": bool(_LIBRETRANSLATE_URL),
    }


async def clinical_rewrite(text: str, source_language: str = "auto") -> dict:
    """Rewrite dictated or informal text into NDIS-compliant clinical documentation.

    If the input is non-English (determined by source_language hint or the
    [Input language: xx] prefix convention), it is translated to English first,
    then restructured using the TARP framework (Time · Activity · Response · Progress).
    """
    if not text or not text.strip():
        return {"clinical": "", "detected_language": "en", "translated_from": None}

    # Extract [Input language: xx] prefix written by the frontend
    effective_language = source_language
    clean_text = text
    lang_prefix_match = re.match(r"^\[Input language: ([a-z]{2})\]\n", text)
    if lang_prefix_match:
        effective_language = lang_prefix_match.group(1)
        clean_text = text[lang_prefix_match.end():]

    # Translate non-English input to English before rewriting
    translated_from: str | None = None
    english_text = clean_text
    if effective_language not in ("auto", "en"):
        try:
            translation = await translate_to_english(clean_text, effective_language)
            english_text = translation["translated"] or clean_text
            translated_from = translation.get("detected_language") or effective_language
        except Exception as exc:
            logger.warning("Pre-rewrite translation failed, using original text: %s", exc)

    prompt = f"""You are a clinical documentation specialist for NDIS providers in Australia.

Convert the following spoken or informal text into structured NDIS-compliant clinical documentation using the TARP framework:

**Time**: When and how long the session occurred (use information from input; write "Not specified" if absent)
**Activity**: What activities and supports were delivered during the session
**Response**: How the participant responded, engaged, and their overall presentation
**Progress**: Measurable progress toward NDIS goals and recommended next steps

Guidelines:
- Remove filler words (um, uh, like, you know, so, basically)
- Use third-person clinical language ("Participant engaged..." not "I saw...")
- Use person-first language throughout ("person with disability", not "disabled person")
- Be factual and specific — do not add information not present in the input
- Preserve all clinical facts and observations
- Reference any NDIS goals mentioned in the input
- Standardise terminology (e.g. "ambulation" not "walking around")

Input: {english_text}

Respond with a JSON object:
{{
  "clinical": "the full TARP-structured clinical note with Time, Activity, Response, and Progress headings",
  "detected_language": "ISO 639-1 language code of the original input (e.g. en, fr, zh)"
}}"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": CARESCRIBE_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        max_tokens=800,
        temperature=0.2,
        response_format={"type": "json_object"},
    )
    result = json.loads(response.choices[0].message.content)
    return {
        "clinical": result.get("clinical", english_text),
        "detected_language": result.get("detected_language", effective_language if effective_language != "auto" else "en"),
        "translated_from": translated_from,
    }


# ---------------------------------------------------------------------------
# Real-time Note Assessment (4-criteria scoring matrix)
# ---------------------------------------------------------------------------

def has_measurable_progress_delta(raw: Any) -> bool:
    """True when progress_delta contains at least one measurable entry (CARECLIQV2-75)."""
    entries = parse_progress_delta(raw)
    if not entries:
        return False
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if (entry.get("delta_summary") or "").strip():
            return True
        if entry.get("prompt_level"):
            return True
        if entry.get("independence_rating") is not None:
            return True
        if (entry.get("skill_step") or "").strip():
            return True
    return False


async def assess_note(
    note_text: str,
    session_started: bool,
    goals: list[dict],
    progress_delta: Any = None,
) -> dict:
    """Score a clinical note entry against the NDIS compliance matrix.

    Criteria and weights (CARECLIQV2-75):
      • Timestamp/session check-in       +20
      • Semantic NDIS goal connection    +28
      • Documented support outcome       +20
      • Next-step/routine action         +12
      • Progress Evidence (progress_delta) +20

    Without measurable progress_delta the score is hard-capped at 80.
    is_ready_for_billing remains at score >= 75.
    """
    score_a = 20 if session_started else 0
    progress_pass = has_measurable_progress_delta(progress_delta)
    score_e = 20 if progress_pass else 0

    if len(note_text.strip()) < 15:
        total = min(score_a + score_e, 80) if not progress_pass else score_a + score_e
        return {
            "score": total,
            "is_ready_for_billing": total >= 75,
            "progress_capped": not progress_pass and total >= 80,
            "breakdown": {
                "checkin": {"score": score_a, "max": 20, "label": "Session active check-in", "pass": session_started},
                "goal": {"score": 0, "max": 28, "label": "Semantic NDIS goal connection", "pass": False},
                "outcome": {"score": 0, "max": 20, "label": "Documented support outcome", "pass": False},
                "nextstep": {"score": 0, "max": 12, "label": "Next-step / routine action", "pass": False},
                "progress_evidence": {
                    "score": score_e,
                    "max": 20,
                    "label": "Progress Evidence",
                    "pass": progress_pass,
                    "feedback": "Measurable progress evidence present." if progress_pass else "No measurable progress evidence in progress_delta.",
                },
            },
            "feedback": "Note is too short to assess — add more detail.",
        }

    goal_texts = "\n".join(
        f"- [{g.get('category','general')}] {g.get('description', g.get('title', ''))}"
        for g in goals[:10]
    ) or "No specific NDIS goals on file."

    prompt = f"""You are an NDIS compliance evaluator. Score the following clinical note entry against three criteria. Return JSON only.

PARTICIPANT NDIS GOALS:
{goal_texts}

CLINICAL NOTE:
\"\"\"{note_text}\"\"\"

SCORING CRITERIA:
1. "goal_score" (0-28): Does the note semantically reference or address any of the participant's NDIS goals? Award up to 28 based on specificity and clarity.
2. "outcome_score" (0-20): Does the note document a measurable or observable support outcome (e.g. what was achieved, participant's response)? Award up to 20.
3. "nextstep_score" (0-12): Does the note mention a follow-up action, next routine step, or plan for the next session? Award up to 12.

For each criterion also provide a one-sentence "feedback" explaining the score.

Respond with exactly:
{{
  "goal_score": <int 0-28>,
  "goal_feedback": "<sentence>",
  "outcome_score": <int 0-20>,
  "outcome_feedback": "<sentence>",
  "nextstep_score": <int 0-12>,
  "nextstep_feedback": "<sentence>"
}}"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": CARESCRIBE_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            max_tokens=400,
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        r = json.loads(response.choices[0].message.content)
    except Exception as exc:
        logger.warning("assess_note AI call failed: %s", exc)
        r = {"goal_score": 0, "goal_feedback": "", "outcome_score": 0, "outcome_feedback": "", "nextstep_score": 0, "nextstep_feedback": ""}

    score_b = max(0, min(28, int(r.get("goal_score", 0))))
    score_c = max(0, min(20, int(r.get("outcome_score", 0))))
    score_d = max(0, min(12, int(r.get("nextstep_score", 0))))
    total = score_a + score_b + score_c + score_d + score_e
    if not progress_pass:
        total = min(total, 80)

    return {
        "score": total,
        "is_ready_for_billing": total >= 75,
        "progress_capped": not progress_pass and (score_a + score_b + score_c + score_d) > 80,
        "breakdown": {
            "checkin": {
                "score": score_a,
                "max": 20,
                "label": "Session active check-in",
                "pass": session_started,
                "feedback": "Session is active — timestamp check passed." if session_started else "Session not yet started.",
            },
            "goal": {
                "score": score_b,
                "max": 28,
                "label": "Semantic NDIS goal connection",
                "pass": score_b >= 14,
                "feedback": r.get("goal_feedback", ""),
            },
            "outcome": {
                "score": score_c,
                "max": 20,
                "label": "Documented support outcome",
                "pass": score_c >= 10,
                "feedback": r.get("outcome_feedback", ""),
            },
            "nextstep": {
                "score": score_d,
                "max": 12,
                "label": "Next-step / routine action",
                "pass": score_d >= 6,
                "feedback": r.get("nextstep_feedback", ""),
            },
            "progress_evidence": {
                "score": score_e,
                "max": 20,
                "label": "Progress Evidence",
                "pass": progress_pass,
                "feedback": (
                    "Measurable progress evidence present in progress_delta."
                    if progress_pass
                    else "No measurable progress evidence — score capped at 80%."
                ),
            },
        },
        "feedback": "Ready for billing." if total >= 75 else f"Score {total}/100 — add goal references, outcomes, next steps, and progress evidence to reach billing threshold.",
    }


# ---------------------------------------------------------------------------
# Audio transcription
# ---------------------------------------------------------------------------

async def transcribe_audio(audio_bytes: bytes, filename: str) -> str:
    import tempfile
    import os as _os
    with tempfile.NamedTemporaryFile(suffix=_os.path.splitext(filename)[1], delete=False) as f:
        f.write(audio_bytes)
        temp_path = f.name

    try:
        with open(temp_path, "rb") as audio_file:
            transcript = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
            )
        return transcript.text
    finally:
        _os.unlink(temp_path)


# ---------------------------------------------------------------------------
# Incident compliance rewrite + scoring
# ---------------------------------------------------------------------------

async def comply_incident(
    incident_type: str,
    severity: str,
    title: str,
    description: str,
    worker_actions: str,
    participant_name: str = "the participant",
) -> dict:
    """Rewrite an incident report in NDIS-compliant clinical English and score it
    against 5 Practice Standard criteria. Returns the rewrite, per-criterion scores,
    flags, notification requirements, and suggested follow-up actions."""

    from ..schemas.incident import (
        PRACTICE_STANDARD_MAP,
        NDIS_NOTIFICATION_HOURS,
        is_ndis_reportable,
    )

    practice_standard = PRACTICE_STANDARD_MAP.get(incident_type, "Standard 2.3 — Incident management")
    notification_hours = NDIS_NOTIFICATION_HOURS.get(severity, 480)
    ndis_reportable = is_ndis_reportable(incident_type, severity)

    fallback = {
        "compliant_description": description,
        "compliant_worker_actions": worker_actions,
        "practice_standard": practice_standard,
        "ndis_reportable": ndis_reportable,
        "notification_hours": notification_hours,
        "compliance_score": 50,
        "compliance_criteria": {
            "factual_completeness": 50,
            "clinical_language": 50,
            "action_documented": 50,
            "ndis_standard_alignment": 50,
            "follow_up_indicators": 50,
        },
        "compliance_flags": ["AI rewrite unavailable — please review the report manually before submitting."],
        "reporting_requirements": (
            f"This incident must be reported to the NDIS Quality and Safeguards Commission within "
            f"{notification_hours} hours as it meets reportable incident criteria." if ndis_reportable else None
        ),
        "suggested_follow_up": None,
    }

    if not _openai_configured():
        return fallback

    prompt = f"""You are an NDIS compliance specialist preparing formal incident documentation for an Australian NDIS provider.

RAW INCIDENT DETAILS:
- Incident type: {incident_type}
- Severity: {severity}
- Title: {title}
- Participant referred to as: {participant_name}
- Raw description: {description}
- Raw worker actions: {worker_actions or "Not provided"}

Applicable NDIS Practice Standard: {practice_standard}
NDIS Reportable: {ndis_reportable}
Notification requirement: within {notification_hours} hours (if reportable)

YOUR TASKS:

1. Rewrite the description in formal, third-person, past-tense clinical English that meets NDIS audit standards. Include all factual elements present — do NOT fabricate new facts. Use person-first language. Remove first-person pronouns ("I", "we", "my"). Keep all times, locations, and factual details from the original.

2. Rewrite the worker_actions as a concise numbered list of actions actually taken, in past tense. If the original is empty, write: "No immediate actions documented."

3. Score each criterion from 0-100 (be strict — most real incident notes score 40-70):
   - factual_completeness: Does it answer who, what, when, where, how? Score 0 if any key element is completely missing.
   - clinical_language: Is it formal, third-person, no filler words, no first person? Deduct for every "I", "we", or informal phrase.
   - action_documented: Are the worker's actions specific and documented? Score 0 if no actions mentioned.
   - ndis_standard_alignment: Does the description address the relevant Practice Standard ({practice_standard})? Deduct if the standard's specific requirements are not addressed.
   - follow_up_indicators: Are next steps, follow-up care, or escalation clear? Score 0 if no follow-up mentioned.

4. List up to 4 specific compliance_flags — exact gaps in the current documentation (e.g. "Time of incident not recorded", "Witness details absent", "No mention of participant's injury assessment").

5. Write reporting_requirements as a single sentence if ndis_reportable is true, otherwise null.

6. Write suggested_follow_up as 2-3 concrete actions the support worker must take next (e.g., "Notify team leader within 2 hours", "Complete NDIS reportable incident form", "Document participant's current condition in progress notes").

Return ONLY valid JSON — no markdown, no explanation:
{{
  "compliant_description": "...",
  "compliant_worker_actions": "...",
  "compliance_criteria": {{
    "factual_completeness": 0-100,
    "clinical_language": 0-100,
    "action_documented": 0-100,
    "ndis_standard_alignment": 0-100,
    "follow_up_indicators": 0-100
  }},
  "compliance_flags": ["...", "..."],
  "reporting_requirements": "..." or null,
  "suggested_follow_up": "..."
}}"""

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": CARESCRIBE_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.15,
            max_tokens=900,
            response_format={"type": "json_object"},
        )
        raw = json.loads(resp.choices[0].message.content or "{}")
    except Exception as exc:
        logger.warning("comply_incident AI call failed: %s", exc)
        return fallback

    criteria = raw.get("compliance_criteria", {})
    compliance_score = (
        int(round(sum(criteria.values()) / len(criteria))) if criteria else 50
    )

    return {
        "compliant_description": raw.get("compliant_description") or description,
        "compliant_worker_actions": raw.get("compliant_worker_actions") or worker_actions,
        "practice_standard": practice_standard,
        "ndis_reportable": ndis_reportable,
        "notification_hours": notification_hours,
        "compliance_score": compliance_score,
        "compliance_criteria": criteria,
        "compliance_flags": raw.get("compliance_flags") or [],
        "reporting_requirements": raw.get("reporting_requirements"),
        "suggested_follow_up": raw.get("suggested_follow_up"),
    }


# ---------------------------------------------------------------------------
# Incident pattern recognition (CARECLIQV2-32)
# ---------------------------------------------------------------------------

async def analyze_incident_patterns(
    new_incident: dict,
    similar_incidents: list[dict],
) -> dict:
    """Use GPT-4o to analyse whether a pattern has been seen before and
    recommend de-escalation strategies and support-plan changes."""

    fallback = {
        "pattern_recognised": (
            "Unable to generate pattern analysis — AI service unavailable. "
            "Review the similar past incidents listed below manually."
        ),
        "past_strategies": "Refer to the worker actions and corrective actions in the matched incidents.",
        "recommendations": "Consult the coordinator to review the participant support plan based on matched incidents.",
    }

    if not similar_incidents:
        return fallback

    if not _openai_configured():
        return fallback

    import json as _json

    past_block = _json.dumps(similar_incidents, indent=2, default=str)
    new_block = _json.dumps(new_incident, indent=2, default=str)

    user_prompt = f"""Given this new incident and the following similar past incidents from this organisation, provide: (1) whether this pattern has been seen before, (2) what de-escalation strategies worked previously, (3) any recommended changes to the participant's support plan.

NEW INCIDENT:
{new_block}

SIMILAR PAST INCIDENTS:
{past_block}

Return ONLY valid JSON — no markdown:
{{
  "pattern_recognised": "2-4 sentences on whether this pattern has been seen before and how it compares to past incidents",
  "past_strategies": "2-4 sentences summarising de-escalation strategies that worked in past similar incidents",
  "recommendations": "2-4 sentences with recommended changes to the participant's support plan"
}}"""

    try:
        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": CARESCRIBE_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
            max_tokens=700,
            response_format={"type": "json_object"},
        )
        raw = _json.loads(resp.choices[0].message.content or "{}")
    except Exception as exc:
        logger.warning("analyze_incident_patterns AI call failed: %s", exc)
        return fallback

    return {
        "pattern_recognised": raw.get("pattern_recognised") or fallback["pattern_recognised"],
        "past_strategies": raw.get("past_strategies") or fallback["past_strategies"],
        "recommendations": raw.get("recommendations") or fallback["recommendations"],
    }


async def generate_task_suggestions(
    task_title: str,
    context: str,
    participant_name: str,
) -> dict:
    """Generate alternative task title suggestions using AI.
    
    Args:
        task_title: The task title entered by user
        context: Context like "for goal: X" or "for core support"
        participant_name: Name of the participant
        
    Returns:
        {"suggestions": [list of 3-5 alternative task titles]}
    """
    if not _openai_configured():
        return {"suggestions": []}
    
    user_prompt = f"""Generate 4 alternative, specific, and action-oriented task titles for supporting {participant_name}.
    
Current title: "{task_title}"
Context: {context}

Requirements:
- Each title should be clear, specific, and focus on what the worker will DO
- Titles should be suitable for NDIS support workers
- Start with action verbs like "Prompt", "Support", "Assist", "Help", "Guide", "Encourage"
- Between 3-8 words each
- Include specific details where relevant

Return ONLY valid JSON (no markdown):
{{
  "suggestions": ["Title 1", "Title 2", "Title 3", "Title 4"]
}}"""

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": CARESCRIBE_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.7,
            max_tokens=300,
            response_format={"type": "json_object"},
        )
        result = _json.loads(resp.choices[0].message.content or "{}")
        return result
    except Exception as exc:
        logger.warning("generate_task_suggestions AI call failed: %s", exc)
        return {"suggestions": []}


async def generate_task_instructions(
    task_title: str,
    task_purpose: str,
    goal_name: str = None,
    goal_description: str = None,
    participant_name: str = None,
) -> dict:
    """Generate instruction suggestions for a task using AI.
    
    Args:
        task_title: The task title
        task_purpose: Either "core" or "goal"
        goal_name: Name of linked goal (if purpose is "goal")
        goal_description: Description of linked goal
        participant_name: Name of participant
        
    Returns:
        {"suggestions": [list of 3-5 instruction options]}
    """
    if not _openai_configured():
        return {"suggestions": []}
    
    goal_context = ""
    if task_purpose == "goal" and goal_name:
        goal_context = f"\nLinked NDIS Goal: {goal_name}"
        if goal_description:
            goal_context += f"\nGoal details: {goal_description}"
    
    user_prompt = f"""Generate 3-4 specific, practical instruction options for support workers doing the following task for {participant_name}.
    
Task: "{task_title}"
Purpose: {"Supporting a linked NDIS goal" if task_purpose == "goal" else "Core support (not linked to a specific goal"}
{goal_context}

Requirements:
- Instructions should be specific and actionable
- Include WHO should do it (e.g., worker, participant)
- Include HOW to do it (step-by-step or techniques)
- Include WHY it matters for {participant_name}
- Be person-centered and strengths-based
- Suitable for training support workers
- 1-3 sentences per instruction

Return ONLY valid JSON (no markdown):
{{
  "suggestions": ["Instruction 1", "Instruction 2", "Instruction 3"]
}}"""

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": CARESCRIBE_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.7,
            max_tokens=500,
            response_format={"type": "json_object"},
        )
        result = _json.loads(resp.choices[0].message.content or "{}")
        return result
    except Exception as exc:
        logger.warning("generate_task_instructions AI call failed: %s", exc)
        return {"suggestions": []}
