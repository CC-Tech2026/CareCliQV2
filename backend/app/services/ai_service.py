"""AI service — CareScribe compliance engine backed by OpenAI GPT-4o-mini.

The CareScribe system prompt (CARESCRIBE_SYSTEM_PROMPT) is injected as the
system role on every compliance-related call so every AI output is guaranteed
to be NDIS-compliant, person-centred, and audit-ready.
"""
from openai import OpenAI
from ..core.config import settings
import json
import os
import urllib.request
import logging

logger = logging.getLogger(__name__)

client = OpenAI(api_key=settings.openai_api_key)


class TranslationProviderUnavailable(RuntimeError):
    """Raised when no server-side translation provider is configured."""


class TranslationProviderFailure(RuntimeError):
    """Raised when a configured translation provider cannot translate."""


BLOCKING_TRANSLATION_STATUSES = {"failed", "unsupported", "pending"}
LEGAL_RECORD_REQUIRED_MESSAGE = "Compliance blocked: English legal record is missing or translation failed."


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
    """Return an Anthropic client if ANTHROPIC_API_KEY is configured, else None."""
    api_key = settings.anthropic_api_key
    if not api_key:
        return None
    try:
        import anthropic
        return anthropic.Anthropic(api_key=api_key)
    except Exception as e:
        logger.warning(f"Failed to create Anthropic client: {e}")
        return None


# ---------------------------------------------------------------------------
# LibreTranslate helper
# ---------------------------------------------------------------------------

_LIBRETRANSLATE_URL = os.getenv("LIBRETRANSLATE_URL", "").rstrip("/")


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
  "progress_trend": "improving | stable | declining"
}}

If structured_notes are already completed above, preserve them exactly (do not rewrite). Only generate them if fields are empty."""

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
        logger.info("LibreTranslate unavailable, using OpenAI translation: %s", libre_exc)

    if not (settings.openai_api_key or "").strip():
        raise TranslationProviderUnavailable(
            "Translation provider is not configured. Add OPENAI_API_KEY or LIBRETRANSLATE_URL on the backend."
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


async def clinical_rewrite(text: str) -> dict:
    """Rewrite dictated or informal text into structured NDIS clinical documentation."""
    if not text or not text.strip():
        return {"clinical": "", "translated": "", "detected_language": "en"}

    prompt = f"""You are a clinical documentation specialist for NDIS providers in Australia.

Convert the following spoken or informal text into professional clinical documentation:
- Remove filler words (um, uh, like, you know, so, basically)
- Use third-person clinical language ("Participant reports..." not "I said...")
- Standardise terminology (use "ambulation" not "walking around", "demonstrates" not "shows")
- Align with NDIS Active Support documentation standards
- Use person-first language throughout
- Be factual and specific — do not add information not present in the input
- Preserve all clinical facts and observations

Input: {text}

Respond with a JSON object:
{{
  "clinical": "the clinical rewrite in professional NDIS documentation style",
  "detected_language": "ISO 639-1 language code of the input (e.g. en, fr, zh)"
}}"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": CARESCRIBE_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        max_tokens=600,
        temperature=0.2,
        response_format={"type": "json_object"},
    )
    result = json.loads(response.choices[0].message.content)
    return {
        "clinical": result.get("clinical", text),
        "detected_language": result.get("detected_language", "en"),
    }


# ---------------------------------------------------------------------------
# Real-time Note Assessment (4-criteria scoring matrix)
# ---------------------------------------------------------------------------

async def assess_note(
    note_text: str,
    session_started: bool,
    goals: list[dict],
) -> dict:
    """Score a clinical note entry against the NDIS compliance matrix.

    Criteria and weights (spec §4):
      • Timestamp/session check-in  +25%  (heuristic — session started flag)
      • Semantic NDIS goal connection +35% (AI)
      • Documented support outcome   +25% (AI)
      • Next-step/routine action     +15% (AI)

    Returns:
      score (0-100), is_ready_for_billing (score >= 75),
      breakdown dict with per-criteria scores and labels.
    """
    # Criterion A — Timestamp / session check-in (heuristic, no AI needed)
    score_a = 25 if session_started else 0

    # Short-circuit: nothing useful to assess if the note is too short
    if len(note_text.strip()) < 15:
        return {
            "score": score_a,
            "is_ready_for_billing": False,
            "breakdown": {
                "checkin":  {"score": score_a, "max": 25, "label": "Session active check-in"},
                "goal":     {"score": 0, "max": 35, "label": "Semantic NDIS goal connection"},
                "outcome":  {"score": 0, "max": 25, "label": "Documented support outcome"},
                "nextstep": {"score": 0, "max": 15, "label": "Next-step / routine action"},
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
1. "goal_score" (0-35): Does the note semantically reference or address any of the participant's NDIS goals? Award up to 35 based on specificity and clarity.
2. "outcome_score" (0-25): Does the note document a measurable or observable support outcome (e.g. what was achieved, participant's response)? Award up to 25.
3. "nextstep_score" (0-15): Does the note mention a follow-up action, next routine step, or plan for the next session? Award up to 15.

For each criterion also provide a one-sentence "feedback" explaining the score.

Respond with exactly:
{{
  "goal_score": <int 0-35>,
  "goal_feedback": "<sentence>",
  "outcome_score": <int 0-25>,
  "outcome_feedback": "<sentence>",
  "nextstep_score": <int 0-15>,
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

    score_b = max(0, min(35, int(r.get("goal_score", 0))))
    score_c = max(0, min(25, int(r.get("outcome_score", 0))))
    score_d = max(0, min(15, int(r.get("nextstep_score", 0))))
    total   = score_a + score_b + score_c + score_d

    return {
        "score": total,
        "is_ready_for_billing": total >= 75,
        "breakdown": {
            "checkin":  {"score": score_a, "max": 25, "label": "Session active check-in",       "feedback": "Session is active — timestamp check passed." if session_started else "Session not yet started."},
            "goal":     {"score": score_b, "max": 35, "label": "Semantic NDIS goal connection",  "feedback": r.get("goal_feedback", "")},
            "outcome":  {"score": score_c, "max": 25, "label": "Documented support outcome",    "feedback": r.get("outcome_feedback", "")},
            "nextstep": {"score": score_d, "max": 15, "label": "Next-step / routine action",    "feedback": r.get("nextstep_feedback", "")},
        },
        "feedback": "Ready for billing." if total >= 75 else f"Score {total}/100 — add goal references, outcomes, and next steps to reach billing threshold.",
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
