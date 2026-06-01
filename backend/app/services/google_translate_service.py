"""Google Cloud Translation v3 provider for legal-record translation."""

from __future__ import annotations

import asyncio
import html
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..core.config import settings
from .supported_languages import SUPPORTED_LANGUAGES, normalize_language_code


class TranslationProviderUnavailable(RuntimeError):
    """Raised when Google Cloud Translation is not configured."""


class TranslationProviderFailure(RuntimeError):
    """Raised when Google Cloud Translation cannot produce a valid result."""


class UnsupportedTranslationLanguage(RuntimeError):
    """Raised when the source language is outside CareScribe's supported set."""

    def __init__(self, language_code: str):
        self.language_code = language_code
        super().__init__(f"Unsupported source language: {language_code}.")


GOOGLE_PROVIDER = "google_cloud_translate"
GOOGLE_MODEL = "google-cloud-translate-v3"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _configured_project_id() -> str:
    return (settings.google_cloud_project_id or os.environ.get("GOOGLE_CLOUD_PROJECT_ID") or "").strip()


def _configured_location() -> str:
    return (settings.google_translate_location or os.environ.get("GOOGLE_TRANSLATE_LOCATION") or "global").strip()


def _configured_credentials_path() -> str:
    return (
        settings.google_application_credentials
        or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        or ""
    ).strip()


def _validate_configuration() -> tuple[str, str]:
    project_id = _configured_project_id()
    if not project_id:
        raise TranslationProviderUnavailable(
            "Google Cloud Translate is not configured on the backend. Set GOOGLE_CLOUD_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS, then restart the backend."
        )

    credentials_path = _configured_credentials_path()
    if credentials_path and not Path(credentials_path).expanduser().exists():
        raise TranslationProviderUnavailable(
            "Google Cloud Translate credentials file was not found. Check GOOGLE_APPLICATION_CREDENTIALS."
        )

    return project_id, _configured_location()


def _source_code_or_none(source_language: str | None) -> str | None:
    code = normalize_language_code(source_language)
    if code in (None, "", "auto"):
        return None
    if code not in SUPPORTED_LANGUAGES:
        raise UnsupportedTranslationLanguage(code)
    return code


def _translation_metadata(
    *,
    requested_source_language: str | None,
    detected_language: str,
    project_id: str,
    location: str,
    response_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "source_language": requested_source_language or "auto",
        "target_language": "en",
        "detected_language": detected_language,
        "provider": GOOGLE_PROVIDER,
        "model": GOOGLE_MODEL,
        "location": location,
        "translated_at": _now_iso(),
        "created_at": _now_iso(),
        "project_configured": bool(project_id),
        "google": response_metadata or {},
    }


def _translate_with_google_sync(text: str, source_code: str | None, project_id: str, location: str) -> dict[str, Any]:
    try:
        from google.cloud import translate_v3 as translate
    except Exception as exc:  # pragma: no cover - exercised when dependency is absent in deployment
        raise TranslationProviderUnavailable(
            "Google Cloud Translate dependency is not installed. Install google-cloud-translate and restart the backend."
        ) from exc

    client = translate.TranslationServiceClient()
    parent = f"projects/{project_id}/locations/{location}"
    request: dict[str, Any] = {
        "parent": parent,
        "contents": [text],
        "mime_type": "text/plain",
        "target_language_code": "en",
    }
    if source_code:
        request["source_language_code"] = source_code

    response = client.translate_text(request=request)
    translations = list(getattr(response, "translations", []) or [])
    if not translations:
        raise TranslationProviderFailure("Google Cloud Translate returned no translation.")

    first = translations[0]
    translated = html.unescape((getattr(first, "translated_text", "") or "").strip())
    detected = normalize_language_code(getattr(first, "detected_language_code", "") or source_code or "en")
    return {
        "translated": translated,
        "detected_language": detected,
        "response_metadata": {
            "glossary_configured": bool(getattr(first, "glossary_config", None)),
        },
    }


async def translate_to_english(text: str, source_language: str = "auto") -> dict:
    """Translate text into English using Google Cloud Translation only."""

    source_text = (text or "").strip()
    if not source_text:
        return {
            "translated": "",
            "detected_language": "en",
            "confidence": 1.0,
            "provider": GOOGLE_PROVIDER,
            "model": GOOGLE_MODEL,
            "fallback_used": False,
            "metadata": {
                "source_language": "en",
                "target_language": "en",
                "provider": GOOGLE_PROVIDER,
                "model": GOOGLE_MODEL,
                "translated_at": _now_iso(),
                "created_at": _now_iso(),
            },
        }

    project_id, location = _validate_configuration()
    source_code = _source_code_or_none(source_language)

    result = await asyncio.to_thread(
        _translate_with_google_sync,
        source_text,
        source_code,
        project_id,
        location,
    )

    translated = (result.get("translated") or "").strip()
    detected = normalize_language_code(result.get("detected_language") or source_code or "en")
    if not translated:
        raise TranslationProviderFailure("Google Cloud Translate returned empty translation.")
    if not detected or detected == "auto":
        raise TranslationProviderFailure("Google Cloud Translate did not return a detected language.")
    if detected not in SUPPORTED_LANGUAGES:
        raise UnsupportedTranslationLanguage(detected)

    return {
        "translated": translated,
        "detected_language": detected,
        "confidence": 0.95,
        "provider": GOOGLE_PROVIDER,
        "model": GOOGLE_MODEL,
        "fallback_used": False,
        "metadata": _translation_metadata(
            requested_source_language=source_code,
            detected_language=detected,
            project_id=project_id,
            location=location,
            response_metadata=result.get("response_metadata") or {},
        ),
    }
