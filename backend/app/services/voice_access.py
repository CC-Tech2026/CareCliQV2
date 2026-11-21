"""Whether an organisation may use voice recording (voice notes, and plan
meeting and meet-and-greet recordings).

The audio is sent to OpenAI (and Google Speech-to-Text if that fails) to be
turned into text, outside Australia, and audio can't have names or health
details removed first. Until the processing agreements and privacy notices
are in place, voice is on only for the demo organisations; every real
provider, including a new one that signs up, has it off. Typed notes,
translation and writing help are unaffected.

An organisation's managing director can switch it on for their own
organisation in Settings > Privacy, after agreeing that audio is sent
overseas to be transcribed (who agreed, when and to which wording is kept on
the organisation: migration 268). Until they do, it's off.

VOICE_NOTES_ORG_IDS overrides this without a code change:
  unset   the demo organisations below, plus any that switched it on
  "all"   every organisation
  "none"  no organisation, whatever they chose (a kill switch)
  a comma list of organisation ids: those, plus any that switched it on
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException, status

from ..core.config import settings

logger = logging.getLogger(__name__)

VOICE_OFF_DETAIL = (
    "Voice recording is switched off for your organisation. Please type your notes instead. "
    "Your managing director can switch it on in Settings > Privacy."
)

# What the director agrees to. Change the version when the wording changes,
# so who agreed to what stays clear.
TERMS_VERSION = "2026-11-21"
TERMS = (
    "Recordings are sent to OpenAI in the United States (and Google if that fails) to be turned into text. "
    "Audio can't have names or health details taken out first. CareCliQ doesn't keep the audio once it's "
    "turned into text (the text is saved in CareCliQ); OpenAI may keep it for up to 30 days to check for misuse. "
    "Your organisation is responsible for telling participants and staff, and for getting consent before "
    "recording anyone."
)
_CACHE_SECONDS = 60
_opt_in_cache: dict[str, tuple[float, bool]] = {}

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


def _org_opted_in(organization_id: str) -> bool:
    """Did this organisation's director switch voice on? Kept a minute."""
    key = organization_id.strip().lower()
    hit = _opt_in_cache.get(key)
    if hit and time.monotonic() - hit[0] < _CACHE_SECONDS:
        return hit[1]
    try:
        from .supabase_client import get_supabase_admin

        rows = (get_supabase_admin().table("organizations").select("voice_transcription_enabled")
                .eq("organization_id", organization_id).limit(1).execute().data) or []
        on = bool(rows and rows[0].get("voice_transcription_enabled"))
    except Exception as exc:  # migration 268 not applied, or the database is down: off
        logger.info("voice opt-in not read for %s: %s", organization_id, exc)
        on = False
    _opt_in_cache[key] = (time.monotonic(), on)
    return on


def forced(raw: Optional[str] = None) -> Optional[str]:
    """"on" or "off" when VOICE_NOTES_ORG_IDS decides for everyone."""
    value = (settings.voice_notes_org_ids if raw is None else raw).strip().lower()
    return "on" if value == "all" else "off" if value == "none" else None


def voice_notes_allowed(organization_id: Optional[str], raw: Optional[str] = None, *, check_opt_in: bool = True) -> bool:
    allowed = _allowed_ids(raw)
    if allowed is None:
        return True
    if not organization_id:
        return False
    if str(organization_id).strip().lower() in allowed:
        return True
    if forced(raw) == "off" or not check_opt_in:
        return False
    return _org_opted_in(str(organization_id))


def opt_in_status(organization_id: str) -> dict[str, Any]:
    """For Settings > Privacy: whether voice is on, who switched it on, and
    the wording they agreed to."""
    from .supabase_client import get_supabase_admin

    row: dict[str, Any] = {}
    try:
        row = ((get_supabase_admin().table("organizations")
                .select("voice_transcription_enabled, voice_transcription_agreed_by, voice_transcription_agreed_at, "
                        "voice_transcription_terms_version")
                .eq("organization_id", organization_id).limit(1).execute().data) or [{}])[0]
    except Exception as exc:
        logger.info("voice opt-in status not read: %s", exc)
    agreed_by_name = None
    if row.get("voice_transcription_agreed_by"):
        try:
            users = (get_supabase_admin().table("users").select("full_name")
                     .eq("id", row["voice_transcription_agreed_by"]).limit(1).execute().data) or []
            agreed_by_name = (users[0] if users else {}).get("full_name")
        except Exception:
            agreed_by_name = None
    return {
        "enabled": voice_notes_allowed(organization_id),
        "chosen": bool(row.get("voice_transcription_enabled")),
        "forced": forced(),
        "demo": str(organization_id).strip().lower() in (_allowed_ids() or set()),
        "agreed_by_name": agreed_by_name,
        "agreed_at": row.get("voice_transcription_agreed_at"),
        "terms_version": TERMS_VERSION,
        "agreed_terms_version": row.get("voice_transcription_terms_version"),
        "terms": TERMS,
    }


def set_opt_in(organization_id: str, user_id: str, enabled: bool, agreed: bool) -> dict[str, Any]:
    """The director switches voice on (having agreed to the terms) or off."""
    from .supabase_client import get_supabase_admin

    if enabled and not agreed:
        raise HTTPException(status_code=422, detail="Tick that you agree before switching voice recording on.")
    now = datetime.now(timezone.utc).isoformat()
    body: dict[str, Any] = {"voice_transcription_enabled": enabled, "voice_transcription_changed_at": now}
    if enabled:
        body.update(voice_transcription_agreed_by=user_id, voice_transcription_agreed_at=now,
                    voice_transcription_terms_version=TERMS_VERSION)
    try:
        get_supabase_admin().table("organizations").update(body).eq("organization_id", organization_id).execute()
    except Exception as exc:
        msg = str(exc).lower()
        if "does not exist" in msg or "schema cache" in msg:
            raise HTTPException(status_code=503, detail="This can't be switched on yet. Try again after the next update.") from exc
        raise
    _opt_in_cache.pop(organization_id.strip().lower(), None)
    return opt_in_status(organization_id)


def require_voice_notes(organization_id: Optional[str]) -> None:
    if not voice_notes_allowed(organization_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=VOICE_OFF_DETAIL)
