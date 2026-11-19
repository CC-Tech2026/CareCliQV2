"""Whether an organisation may use voice recording (voice notes, and plan
meeting and meet-and-greet recordings).

The audio is sent to OpenAI (and Google Speech-to-Text if that fails) to be
turned into text, outside Australia, and audio can't have names or health
details removed first. Until the processing agreements and privacy notices
are in place, voice is on only for the demo organisations; every real
provider, including a new one that signs up, has it off. Typed notes,
translation and writing help are unaffected.

VOICE_NOTES_ORG_IDS overrides the built-in list without a code change:
  unset   the demo organisations below (the default)
  "all"   every organisation (how it was before this switch)
  "none"  no organisation
  a comma list of organisation ids: only those
"""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status

from ..core.config import settings

VOICE_OFF_DETAIL = "Voice recording is switched off for your organisation for now. Please type your notes instead."

# The Harbourside Community Care demo organisation: on the production
# database (used for demos) and on the separate demo database.
DEMO_ORGANISATION_IDS = frozenset({
    "78f88e07-757b-402e-bf62-f3d40ff6033d",
    "93d13ce5-4607-4150-930b-1528dbc9f91c",
})


def _allowed_ids(raw: Optional[str] = None) -> Optional[set[str]]:
    """None means every organisation."""
    value = (settings.voice_notes_org_ids if raw is None else raw).strip()
    if not value:
        return set(DEMO_ORGANISATION_IDS)
    if value.lower() == "all":
        return None
    if value.lower() == "none":
        return set()
    return {part.strip().lower() for part in value.split(",") if part.strip()}


def voice_notes_allowed(organization_id: Optional[str], raw: Optional[str] = None) -> bool:
    allowed = _allowed_ids(raw)
    if allowed is None:
        return True
    return bool(organization_id) and str(organization_id).strip().lower() in allowed


def require_voice_notes(organization_id: Optional[str]) -> None:
    if not voice_notes_allowed(organization_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=VOICE_OFF_DETAIL)
