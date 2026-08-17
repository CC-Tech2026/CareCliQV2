"""Extract a short candidate profile (summary, skills, experience) from an
uploaded resume/CV, so the Applicants Board doesn't just store the file —
it builds a real profile that carries onto the worker's record on hire and
can be reused later for rostering/participant skill-matching.

Same shape as medication_extraction_service.py: images go straight to
GPT-4o-mini vision, PDFs are text-extracted with pypdf first. A scanned
PDF with no extractable text just skips extraction rather than guessing.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from datetime import datetime, timezone
from io import BytesIO
from typing import Any

from .ai_service import client
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

ALLOWED_TYPES = {
    "application/pdf": "pdf",
    "image/jpeg": "image",
    "image/png": "image",
}

EXTRACTION_PROMPT = """You are extracting a short professional profile from a support worker or \
support coordinator candidate's resume/CV, for an NDIS disability support work platform. This \
profile will be shown to a hiring manager and later used to help match the worker to participants \
with compatible support needs. Read it carefully and return ONLY what you can actually confirm \
from the document — use null (or an empty array for skills) for anything not clearly present. \
Never guess or invent a value, and never include the candidate's name, contact details, or anything \
not related to their work profile.

Respond with exactly this JSON shape:
{
  "summary": "<a neutral, factual 1-3 sentence professional summary based on their work history, or null>",
  "skills": ["<specific skills, competencies, or certifications actually mentioned, e.g. 'Manual handling', 'Medication administration', 'Autism support experience' — plain strings, no invented ones>"],
  "years_experience": "<a short phrase describing their relevant experience, e.g. '5 years', 'Recently graduated, no prior experience', or null if not determinable>"
}"""


def _extract_sync(file_bytes: bytes, content_type: str) -> dict[str, Any] | None:
    kind = ALLOWED_TYPES[content_type]

    if kind == "image":
        b64 = base64.b64encode(file_bytes).decode()
        user_content: Any = [
            {"type": "text", "text": "Extract the candidate profile fields from this resume/CV image."},
            {"type": "image_url", "image_url": {"url": f"data:{content_type};base64,{b64}"}},
        ]
    else:
        from pypdf import PdfReader

        reader = PdfReader(BytesIO(file_bytes))
        text = "\n".join((page.extract_text() or "") for page in reader.pages[:8]).strip()
        if not text:
            # Scanned/image-only PDF — nothing to extract from, not an error.
            return None
        user_content = f"Extract the candidate profile fields from this resume/CV text:\n\n{text[:8000]}"

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": EXTRACTION_PROMPT},
            {"role": "user", "content": user_content},
        ],
        max_tokens=500,
        temperature=0,
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)


def _sanitize(raw: dict[str, Any]) -> dict[str, Any]:
    skills = raw.get("skills")
    if not isinstance(skills, list):
        skills = []
    skills = [s.strip() for s in skills if isinstance(s, str) and s.strip()][:20]

    return {
        "resume_summary": (raw.get("summary") or "").strip() or None,
        "resume_skills": skills,
        "resume_experience_years": (raw.get("years_experience") or "").strip() or None,
    }


async def extract_and_save_applicant_profile(
    applicant_id: str,
    organization_id: str,
    file_bytes: bytes,
    content_type: str,
) -> dict[str, Any] | None:
    """Best-effort: extraction failures never block the document upload itself —
    the resume file is already saved regardless of whether this succeeds."""
    if content_type not in ALLOWED_TYPES:
        return None

    try:
        raw = await asyncio.to_thread(_extract_sync, file_bytes, content_type)
    except Exception as exc:
        logger.warning("Resume extraction failed for applicant %s: %s", applicant_id, exc)
        return None

    if raw is None:
        return None

    fields = _sanitize(raw)
    if not fields["resume_summary"] and not fields["resume_skills"] and not fields["resume_experience_years"]:
        return None

    fields["resume_extracted_at"] = datetime.now(timezone.utc).isoformat()

    try:
        resp = (
            get_supabase_admin()
            .table("applicants")
            .update(fields)
            .eq("id", applicant_id)
            .eq("organization_id", organization_id)
            .execute()
        )
        return (resp.data or [None])[0]
    except Exception as exc:
        logger.warning("Could not save extracted resume profile for applicant %s: %s", applicant_id, exc)
        return None


def migrate_profile_to_worker(onboarding_id: str, worker_id: str, organization_id: str) -> None:
    """Carries the resume-derived profile (summary, experience, skills) from the
    applicant record onto the newly-created worker on invite acceptance — same
    handoff point as migrate_documents_to_worker, so the profile isn't lost once
    onboarding is done and stays around for rostering/participant matching.

    Skills land in worker_skills as unverified (is_certified=False) since they're
    self-reported from a resume, not confirmed by a coordinator.
    """
    supabase = get_supabase_admin()
    try:
        applicant_resp = (
            supabase.table("applicants")
            .select("resume_summary, resume_skills, resume_experience_years")
            .eq("employee_onboarding_id", onboarding_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.warning("Could not look up applicant profile for onboarding %s: %s", onboarding_id, exc)
        return

    rows = applicant_resp.data or []
    if not rows:
        return
    applicant = rows[0]

    profile_update = {}
    if applicant.get("resume_summary"):
        profile_update["profile_summary"] = applicant["resume_summary"]
    if applicant.get("resume_experience_years"):
        profile_update["profile_experience_years"] = applicant["resume_experience_years"]
    if profile_update:
        try:
            supabase.table("users").update(profile_update).eq("id", worker_id).execute()
        except Exception as exc:
            logger.warning("Could not migrate profile summary to worker %s: %s", worker_id, exc)

    skills = applicant.get("resume_skills") or []
    for skill in skills:
        try:
            supabase.table("worker_skills").upsert({
                "user_id": worker_id,
                "organization_id": organization_id,
                "skill": skill,
                "is_certified": False,
            }, on_conflict="user_id,skill").execute()
        except Exception as exc:
            logger.warning("Could not migrate skill %r to worker %s: %s", skill, worker_id, exc)
