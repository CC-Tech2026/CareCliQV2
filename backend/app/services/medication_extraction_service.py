"""Extract structured medication fields from an uploaded prescription/script (image or PDF),
so a coordinator can review and confirm rather than typing everything by hand.

Images go straight to GPT-4o-mini vision. PDFs are text-extracted with pypdf first — a
scanned/image-only PDF yields no text, in which case we ask the coordinator to upload a
photo instead rather than silently failing or guessing.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from io import BytesIO
from typing import Any

from fastapi import HTTPException

from .ai_service import client

logger = logging.getLogger(__name__)

ALLOWED_TYPES = {
    "application/pdf": "pdf",
    "image/jpeg": "image",
    "image/png": "image",
    "image/webp": "image",
}
MAX_BYTES = 15 * 1024 * 1024

ROUTES = {"oral", "topical", "injection", "inhaled", "sublingual", "rectal", "other"}
FREQUENCY_TYPES = {"scheduled", "prn"}

EXTRACTION_PROMPT = """You are extracting structured medication data from a photo or scan of a \
prescription/medication script for an NDIS disability support worker app. Read it carefully and \
return ONLY fields you can actually confirm from the document — use null for anything not clearly \
present. Never guess or invent a value.

Respond with exactly this JSON shape:
{
  "name": "<medication name, or null>",
  "strength": "<e.g. '500mg', or null>",
  "dosage": "<e.g. '1 tablet', or null>",
  "route": "<one of: oral, topical, injection, inhaled, sublingual, rectal, other — or null>",
  "frequency_type": "<'scheduled' if taken at set times, 'prn' if as-needed, or null>",
  "scheduled_times": ["<HH:MM 24h times found or reasonably inferred from stated frequency; empty array if none or PRN>"],
  "prescriber_name": "<prescribing doctor's name, or null>",
  "prescriber_contact": "<phone or practice contact, or null>",
  "start_date": "<YYYY-MM-DD, or null>",
  "end_date": "<YYYY-MM-DD, or null>",
  "prn_max_per_day": "<integer max doses per day, only if explicitly stated for a PRN medication, else null>"
}"""


def _extract_sync(file_bytes: bytes, content_type: str) -> dict[str, Any]:
    kind = ALLOWED_TYPES[content_type]

    if kind == "image":
        b64 = base64.b64encode(file_bytes).decode()
        user_content: Any = [
            {"type": "text", "text": "Extract the medication fields from this prescription image."},
            {"type": "image_url", "image_url": {"url": f"data:{content_type};base64,{b64}"}},
        ]
    else:
        try:
            from pypdf import PdfReader

            reader = PdfReader(BytesIO(file_bytes))
            text = "\n".join((page.extract_text() or "") for page in reader.pages[:5]).strip()
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Could not read this PDF: {exc}") from exc
        if not text:
            raise HTTPException(
                status_code=422,
                detail="Could not find readable text in this PDF — it may be a scanned image. Try uploading a photo instead.",
            )
        user_content = f"Extract the medication fields from this prescription text:\n\n{text[:6000]}"

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
    """Drop anything the model returned outside the fields' actual constraints rather than
    let a bad enum value silently reach the create-medication form."""
    route = raw.get("route")
    if route not in ROUTES:
        route = None
    frequency_type = raw.get("frequency_type")
    if frequency_type not in FREQUENCY_TYPES:
        frequency_type = None
    scheduled_times = raw.get("scheduled_times")
    if not isinstance(scheduled_times, list):
        scheduled_times = []
    prn_max = raw.get("prn_max_per_day")
    try:
        prn_max = int(prn_max) if prn_max is not None else None
    except (TypeError, ValueError):
        prn_max = None

    return {
        "name": raw.get("name") or None,
        "strength": raw.get("strength") or None,
        "dosage": raw.get("dosage") or None,
        "route": route,
        "frequency_type": frequency_type,
        "scheduled_times": [t for t in scheduled_times if isinstance(t, str)],
        "prescriber_name": raw.get("prescriber_name") or None,
        "prescriber_contact": raw.get("prescriber_contact") or None,
        "start_date": raw.get("start_date") or None,
        "end_date": raw.get("end_date") or None,
        "prn_max_per_day": prn_max,
    }


async def extract_medication_fields(file_bytes: bytes, content_type: str) -> dict[str, Any]:
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=422, detail="Upload a PDF, JPEG, PNG, or WEBP file.")
    if len(file_bytes) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File must be 15MB or smaller.")

    try:
        raw = await asyncio.to_thread(_extract_sync, file_bytes, content_type)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Medication extraction failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Could not read this document. Please enter the medication details manually.",
        ) from exc

    return _sanitize(raw)
