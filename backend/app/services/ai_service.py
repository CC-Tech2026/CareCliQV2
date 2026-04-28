from openai import OpenAI
from ..core.config import settings
import json

client = OpenAI(api_key=settings.openai_api_key)


async def generate_patient_summary(participant_data: dict, sessions: list) -> str:
    sessions_text = "\n".join([
        f"- {s.get('session_date', 'Unknown date')}: {s.get('session_type', 'Session')} "
        f"({s.get('duration_minutes', 0)} min) — {s.get('notes', 'No notes')[:200]}"
        for s in sessions[-5:]
    ])

    prompt = f"""You are a clinical assistant for an NDIS provider.

Participant: {participant_data.get('full_name', 'Unknown')}
NDIS Number: {participant_data.get('ndis_number', 'N/A')}
Primary Disability: {participant_data.get('primary_disability', 'Not specified')}
Plan Status: {participant_data.get('plan_status', 'active')}
Goals: {', '.join(participant_data.get('goals', [])) or 'None specified'}

Recent Sessions:
{sessions_text or 'No sessions recorded yet'}

Write a concise clinical summary (3-4 sentences) covering:
1. Current functional status and progress
2. Key achievements or concerns
3. Recommended focus for next session

Be professional, factual, and person-centred."""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=300,
        temperature=0.3
    )
    return response.choices[0].message.content


async def generate_clinical_insights(session_data: dict, participant_data: dict) -> dict:
    prompt = f"""You are a clinical assistant for an NDIS provider. Analyse this session and provide insights.

Participant: {participant_data.get('full_name', 'Unknown')}
Session Type: {session_data.get('session_type', 'Unknown')}
Duration: {session_data.get('duration_minutes', 0)} minutes
Session Notes: {session_data.get('notes', 'No notes provided')}
Tags: {', '.join(session_data.get('tags', []))}
Goals Addressed: {', '.join(session_data.get('goals_addressed', []))}

Provide a JSON response with:
{{
  "summary": "2-3 sentence clinical summary",
  "key_observations": ["observation 1", "observation 2"],
  "progress_indicators": ["positive indicator 1"],
  "concerns": ["concern 1 if any"],
  "next_session_recommendations": ["recommendation 1", "recommendation 2"],
  "progress_trend": "improving|stable|declining"
}}"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=500,
        temperature=0.3,
        response_format={"type": "json_object"}
    )
    return json.loads(response.choices[0].message.content)


async def check_compliance(session_data: dict) -> dict:
    checks = {
        "notes_present": bool(session_data.get("notes") and len(session_data.get("notes", "")) > 20),
        "duration_recorded": bool(session_data.get("duration_minutes") and session_data.get("duration_minutes", 0) > 0),
        "goals_linked": bool(session_data.get("goals_addressed") and len(session_data.get("goals_addressed", [])) > 0),
        "session_type_set": bool(session_data.get("session_type")),
    }

    passed = sum(checks.values())
    total = len(checks)
    score = round((passed / total) * 100)

    prompt = f"""You are an NDIS compliance checker.

Session Data:
- Notes: {'Present (' + str(len(session_data.get('notes', ''))) + ' chars)' if session_data.get('notes') else 'Missing'}
- Duration: {session_data.get('duration_minutes', 'Not recorded')} minutes
- Goals Addressed: {', '.join(session_data.get('goals_addressed', [])) or 'None linked'}
- Session Type: {session_data.get('session_type', 'Not specified')}
- Tags: {', '.join(session_data.get('tags', []))}

Compliance score: {score}%

Provide a brief compliance assessment (2-3 sentences) and list any critical gaps for NDIS audit purposes. Be concise and actionable."""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=200,
        temperature=0.2
    )

    return {
        "score": score,
        "checks": checks,
        "passed": passed,
        "total": total,
        "assessment": response.choices[0].message.content
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
