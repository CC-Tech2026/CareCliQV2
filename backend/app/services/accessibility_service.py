"""Accessibility preferences — CARECLIQV2-290."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

VALID_FONT_SIZES = frozenset({"small", "default", "large", "xl"})
VALID_THEME_MODES = frozenset({"system", "light", "dark"})
VALID_LANGUAGES = frozenset({"en", "vi", "ar", "zh-Hans"})

DEFAULT_PREFS = {
    "font_size": "default",
    "theme_mode": "system",
    "high_contrast": False,
    "dyslexia_font": False,
}


def _is_missing_schema(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg


def get_accessibility_preferences(user_id: str, device_id: str) -> dict[str, Any]:
    try:
        resp = (
            get_supabase_admin()
            .table("user_accessibility_preferences")
            .select("*")
            .eq("user_id", user_id)
            .eq("device_id", device_id)
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
        if row:
            return {
                "font_size": row.get("font_size") or "default",
                "theme_mode": row.get("theme_mode") or "system",
                "high_contrast": bool(row.get("high_contrast")),
                "dyslexia_font": bool(row.get("dyslexia_font")),
                "device_id": device_id,
            }
    except Exception as exc:
        if not _is_missing_schema(exc):
            logger.debug("accessibility prefs load: %s", exc)
    return {**DEFAULT_PREFS, "device_id": device_id}


def save_accessibility_preferences(
    user_id: str,
    device_id: str,
    *,
    font_size: str | None = None,
    theme_mode: str | None = None,
    high_contrast: bool | None = None,
    dyslexia_font: bool | None = None,
) -> dict[str, Any]:
    current = get_accessibility_preferences(user_id, device_id)
    if font_size is not None:
        if font_size not in VALID_FONT_SIZES:
            raise HTTPException(status_code=422, detail="Invalid font size.")
        current["font_size"] = font_size
    if theme_mode is not None:
        if theme_mode not in VALID_THEME_MODES:
            raise HTTPException(status_code=422, detail="Invalid theme mode.")
        current["theme_mode"] = theme_mode
    if high_contrast is not None:
        current["high_contrast"] = high_contrast
    if dyslexia_font is not None:
        current["dyslexia_font"] = dyslexia_font

    record = {
        "user_id": user_id,
        "device_id": device_id,
        "font_size": current["font_size"],
        "theme_mode": current["theme_mode"],
        "high_contrast": current["high_contrast"],
        "dyslexia_font": current["dyslexia_font"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        get_supabase_admin().table("user_accessibility_preferences").upsert(
            record,
            on_conflict="user_id,device_id",
        ).execute()
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Accessibility service unavailable.") from exc
        raise
    return current


def get_preferred_language(user_id: str) -> str:
    try:
        resp = (
            get_supabase_admin()
            .table("users")
            .select("preferred_language")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
        lang = str((row or {}).get("preferred_language") or "en")
        return lang if lang in VALID_LANGUAGES else "en"
    except Exception:
        return "en"


async def set_preferred_language(
    user_id: str,
    organization_id: str | None,
    language: str,
) -> dict[str, Any]:
    if language not in VALID_LANGUAGES:
        raise HTTPException(status_code=422, detail="Unsupported language.")

    previous = get_preferred_language(user_id)
    get_supabase_admin().table("users").update({
        "preferred_language": language,
    }).eq("id", user_id).execute()

    if organization_id and language != previous:
        try:
            from .notification_service import _org_coordinator_user_ids, notify_worker

            for coord_id in _org_coordinator_user_ids(organization_id):
                await notify_worker(
                    user_id=coord_id,
                    org_id=organization_id,
                    event="coordinator_message",
                    title="Worker language preference updated",
                    message=f"A support worker updated their preferred language to {language}.",
                    reference_key=f"lang-pref:{user_id}:{language}",
                    action_url="/team",
                )
        except Exception as exc:
            logger.debug("language change notification: %s", exc)

    return {"preferred_language": language, "previous": previous}
