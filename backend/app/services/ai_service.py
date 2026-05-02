from openai import OpenAI
from ..core.config import settings
import json
import os
import urllib.request
import urllib.error

client = OpenAI(api_key=settings.openai_api_key)

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
    return {
        "translated": data.get("translatedText", text),
        "detected_language": detected or "en",
        "confidence": data.get("detectedLanguage", {}).get("confidence", 0.9),
    }


async def generate_patient_summary(participant_data: dict, sessions: list) -> str:
    sessions_text = "\n".join([
        f"- {s.get('session_date', 'Unknown date')}: {s.get('session_type', 'Session')} "
        f"({s.get('duration_minutes', 0)} min) — {s.get('notes', 'No notes')[:200]}"
        for s in sessions[-5:]
    ])

    prompt = f"""You are a clinical assistant for an NDIS (National Disability Insurance Scheme) provider in Australia.

Participant: {participant_data.get('full_name', 'Unknown')}
NDIS Number: {participant_data.get('ndis_number', 'N/A')}
Primary Disability: {participant_data.get('primary_disability', 'Not specified')}
Plan Status: {participant_data.get('plan_status', 'active')}
Goals: {', '.join(participant_data.get('goals', [])) or 'None specified'}

Recent Sessions:
{sessions_text or 'No sessions recorded yet'}

Write a concise clinical summary (3-4 sentences) covering:
1. Current functional status and progress toward NDIS goals
2. Key achievements or areas of concern observed
3. Recommended focus areas for next session

Be professional, factual, person-centred, and aligned with NDIS Active Support principles."""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=300,
        temperature=0.3
    )
    return response.choices[0].message.content


async def generate_clinical_insights(session_data: dict, participant_data: dict) -> dict:
    prompt = f"""You are a clinical assistant for an NDIS provider in Australia. Analyse this session and provide structured insights.

Participant: {participant_data.get('full_name', 'Unknown')}
Primary Disability: {participant_data.get('primary_disability', 'Not specified')}
Session Type: {session_data.get('session_type', 'Unknown')}
Duration: {session_data.get('duration_minutes', 0)} minutes
Session Notes: {session_data.get('notes', 'No notes provided')}
Tags: {', '.join(session_data.get('tags', []))}
Goals Addressed: {', '.join(session_data.get('goals_addressed', []))}

Provide a JSON response with:
{{
  "summary": "2-3 sentence clinical summary focused on functional outcomes",
  "key_observations": ["specific observation 1", "specific observation 2"],
  "progress_indicators": ["positive indicator linked to NDIS goals"],
  "concerns": ["clinical concern if any — leave empty array if none"],
  "next_session_recommendations": ["specific recommendation 1", "specific recommendation 2"],
  "progress_trend": "improving|stable|declining"
}}"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=600,
        temperature=0.3,
        response_format={"type": "json_object"}
    )
    return json.loads(response.choices[0].message.content)


async def check_compliance(session_data: dict) -> dict:
    checks = {
        "notes_present": bool(session_data.get("notes") and len(session_data.get("notes", "")) > 50),
        "duration_recorded": bool(session_data.get("duration_minutes") and session_data.get("duration_minutes", 0) > 0),
        "goals_linked": bool(session_data.get("goals_addressed") and len(session_data.get("goals_addressed", [])) > 0),
        "session_type_set": bool(session_data.get("session_type")),
        "outcome_described": bool(
            session_data.get("notes") and
            any(kw in (session_data.get("notes") or "").lower() for kw in [
                "achieved", "improved", "able to", "completed", "progressed",
                "demonstrated", "engaged", "participated", "worked on", "practiced",
                "outcome", "result", "progress", "goal"
            ])
        ),
    }

    passed = sum(checks.values())
    total = len(checks)
    score = round((passed / total) * 100)

    prompt = f"""You are an NDIS compliance specialist auditing session documentation.

Session Details:
- Notes length: {len(session_data.get('notes', ''))} characters
- Notes preview: {(session_data.get('notes') or '')[:300]}
- Duration: {session_data.get('duration_minutes', 'Not recorded')} minutes
- Goals Addressed: {', '.join(session_data.get('goals_addressed', [])) or 'None linked'}
- Session Type: {session_data.get('session_type', 'Not specified')}
- Tags: {', '.join(session_data.get('tags', []))}
- Compliance checks passed: {passed}/{total}

Provide a brief compliance assessment (2-3 sentences) for NDIS audit purposes:
1. State whether this session meets NDIS documentation standards
2. Name any specific gaps that could cause issues at audit
3. Give one concrete improvement suggestion

Be concise, specific, and use NDIS terminology."""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=250,
        temperature=0.2
    )

    return {
        "score": score,
        "checks": checks,
        "passed": passed,
        "total": total,
        "assessment": response.choices[0].message.content
    }


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

    has_critical = any(r.get("severity") in ("critical", "high") or r.get("status") == "fail" for r in failed_rules)

    prompt = f"""You are an NDIS compliance specialist helping a support worker improve their session documentation.

Session Notes (excerpt): {session_notes[:500] if session_notes else "No notes provided"}

Compliance Issues Found:
{rules_text}

Respond with a JSON object:
{{
  "explanation": "Start with 'This session may not meet NDIS requirements because...' then explain specifically what is missing and why it matters for NDIS audits. 2-3 sentences.",
  "fix_suggestion": "Start with 'To improve compliance, consider:' then give 2-4 specific, practical actions using bullet points (•). Each bullet should be a concrete action the worker can take right now.",
  "priority": "{('critical' if has_critical else 'warning')}"
}}

Write in plain English. Be specific about what information is actually missing. Avoid jargon."""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=450,
        temperature=0.2,
        response_format={"type": "json_object"}
    )
    result = json.loads(response.choices[0].message.content)
    result["priority"] = "critical" if has_critical else "warning"
    return result


async def translate_to_english(text: str, source_language: str = "auto") -> dict:
    """Translate text into fluent English. Tries LibreTranslate first, falls back to OpenAI."""
    if not text or not text.strip():
        return {"translated": "", "detected_language": "en", "confidence": 1.0}

    # Try LibreTranslate if configured
    try:
        return _libretranslate_sync(text)
    except Exception:
        pass  # fall through to OpenAI

    lang_hint = f"The source language is {source_language}." if source_language != "auto" else "Detect the source language automatically."

    prompt = f"""You are a multilingual clinical translator.
{lang_hint}

Translate the following text into fluent, natural English. Preserve clinical and medical meaning exactly. Do not paraphrase — only translate.

Input: {text}

Respond with a JSON object:
{{
  "translated": "the English translation",
  "detected_language": "ISO 639-1 language code of the source text (e.g. fr, es, zh)"
}}"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=500,
        temperature=0.1,
        response_format={"type": "json_object"}
    )
    result = json.loads(response.choices[0].message.content)
    return {
        "translated": result.get("translated", text),
        "detected_language": result.get("detected_language", "en"),
        "confidence": 0.95
    }


async def clinical_rewrite(text: str) -> dict:
    """Rewrite dictated or informal text into structured NDIS clinical documentation."""
    if not text or not text.strip():
        return {"clinical": "", "translated": "", "detected_language": "en"}

    prompt = f"""You are a clinical documentation specialist for NDIS (National Disability Insurance Scheme) providers in Australia.

Convert the following spoken or informal text into professional clinical documentation. Apply these rules:
- Remove filler words (um, uh, like, you know, so, basically)
- Use third-person clinical language (e.g. "Participant reports..." not "I said...")
- Standardise terminology (use "ambulation" not "walking around", "demonstrates" not "shows", etc.)
- Align with NDIS Active Support documentation standards
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
        messages=[{"role": "user", "content": prompt}],
        max_tokens=600,
        temperature=0.2,
        response_format={"type": "json_object"}
    )
    result = json.loads(response.choices[0].message.content)
    return {
        "clinical": result.get("clinical", text),
        "detected_language": result.get("detected_language", "en"),
    }


async def transcribe_audio(audio_bytes: bytes, filename: str) -> str:
    import tempfile
    import os
    with tempfile.NamedTemporaryFile(suffix=os.path.splitext(filename)[1], delete=False) as f:
        f.write(audio_bytes)
        temp_path = f.name

    try:
        with open(temp_path, "rb") as audio_file:
            transcript = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file
            )
        return transcript.text
    finally:
        os.unlink(temp_path)
