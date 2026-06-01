"""Normalize session documentation into the English legal/compliance record."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from . import ai_service
from .supported_languages import (
    SUPPORTED_LANGUAGES,
    is_supported_language,
    normalize_language_code,
)


BLOCKING_STATUSES = {"failed", "unsupported", "pending"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty_result(source_text: str, error: str) -> dict[str, Any]:
    return {
        "original_language_input": source_text,
        "detected_language": None,
        "translated_english_note": None,
        "compliance_input_text": None,
        "translation_status": "failed",
        "translation_provider": "none",
        "translation_confidence": 0.0,
        "translation_metadata": {
            "source_language": None,
            "provider": "none",
            "model": None,
            "created_at": _now_iso(),
            "fallback_used": False,
            "warnings": [error],
        },
        "translation_error": error,
    }


def _looks_english(text: str) -> bool:
    if not text:
        return False
    ascii_chars = sum(1 for ch in text if ord(ch) < 128)
    letters = sum(1 for ch in text if ch.isalpha())
    common_words = {
        "the", "and", "participant", "support", "with", "was", "were",
        "session", "goal", "goals", "assisted", "completed", "progress",
    }
    tokens = {
        token.strip(".,;:!?()[]{}\"'").lower()
        for token in text.split()
    }
    word_hits = len(common_words & tokens)
    return ascii_chars / max(len(text), 1) > 0.92 and (word_hits > 0 or letters < 20)


def _script_language_hint(text: str) -> str | None:
    for ch in text:
        code = ord(ch)
        if 0x0600 <= code <= 0x06FF:
            return "ar"
        if 0x4E00 <= code <= 0x9FFF:
            return "zh-CN"
        if 0x0900 <= code <= 0x097F:
            return "hi"
        if 0x0A00 <= code <= 0x0A7F:
            return "pa"
    return None


def _base_metadata(
    *,
    source_language: str | None,
    provider: str,
    model: str | None,
    fallback_used: bool = False,
    warnings: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "source_language": source_language,
        "source_language_name": SUPPORTED_LANGUAGES.get(source_language or ""),
        "provider": provider,
        "model": model,
        "created_at": _now_iso(),
        "fallback_used": fallback_used,
        "warnings": warnings or [],
    }


async def normalize_documentation_for_legal_record(
    source_text: str,
    requested_language: str | None = None,
    user: dict | None = None,
    session_id: str | None = None,
) -> dict[str, Any]:
    """Return official English legal-record fields for a session.

    Original input is retained for audit only. Compliance must use
    ``compliance_input_text`` from this return value.
    """
    text = (source_text or "").strip()
    if not text:
        return _empty_result(source_text or "", "Source documentation is empty.")

    requested_code = normalize_language_code(requested_language)
    if requested_code == "auto":
        requested_code = None
    if requested_code and not is_supported_language(requested_code):
        return {
            **_empty_result(text, f"Unsupported source language: {requested_code}."),
            "detected_language": requested_code,
            "translation_status": "unsupported",
            "translation_metadata": _base_metadata(
                source_language=requested_code,
                provider="none",
                model=None,
                warnings=["Unsupported source language."],
            ),
        }

    script_hint = _script_language_hint(text)
    if _looks_english(text) and requested_code in (None, "en"):
        return {
            "original_language_input": text,
            "detected_language": "en",
            "translated_english_note": text,
            "compliance_input_text": text,
            "translation_status": "not_required",
            "translation_provider": "none",
            "translation_confidence": 1.0,
            "translation_metadata": _base_metadata(
                source_language="en",
                provider="none",
                model=None,
            ),
            "translation_error": None,
        }

    source_hint = requested_code or script_hint or "auto"

    try:
        translated = await ai_service.translate_to_english(text, source_hint)
    except ai_service.UnsupportedTranslationLanguage as exc:
        detected_code = normalize_language_code(getattr(exc, "language_code", None)) or requested_code or script_hint
        return {
            **_empty_result(text, f"Unsupported source language: {detected_code}."),
            "detected_language": detected_code,
            "translation_status": "unsupported",
            "translation_metadata": _base_metadata(
                source_language=detected_code,
                provider="google_cloud_translate",
                model="google-cloud-translate-v3",
                warnings=["Unsupported source language."],
            ),
        }
    except Exception as exc:
        return {
            **_empty_result(text, "Translation provider failed."),
            "detected_language": requested_code or script_hint,
            "translation_error": str(exc),
        }

    detected = normalize_language_code(
        translated.get("detected_language") or requested_code or script_hint
    )
    if not detected:
        return _empty_result(text, "Translation provider did not return a detected language.")

    if not is_supported_language(detected):
        return {
            **_empty_result(text, f"Unsupported source language: {detected}."),
            "detected_language": detected,
            "translation_status": "unsupported",
            "translation_metadata": _base_metadata(
                source_language=detected,
                provider=translated.get("provider") or "google_cloud_translate",
                model=translated.get("model"),
                warnings=["Unsupported source language."],
            ),
        }

    english_text = (translated.get("translated") or "").strip()
    if not english_text:
        return _empty_result(text, "Translation provider returned empty English text.")

    provider = translated.get("provider") or "google_cloud_translate"
    confidence = float(translated.get("confidence") or 0.95)
    model = translated.get("model")
    status = "not_required" if detected == "en" and english_text == text else "translated"

    provider_metadata = translated.get("metadata") if isinstance(translated.get("metadata"), dict) else {}
    metadata = _base_metadata(
        source_language=detected,
        provider=provider,
        model=model,
        fallback_used=bool(translated.get("fallback_used", False)),
        warnings=list(translated.get("warnings") or []),
    )
    metadata.update(provider_metadata)
    metadata["source_language"] = detected

    return {
        "original_language_input": text,
        "detected_language": detected,
        "translated_english_note": english_text,
        "compliance_input_text": english_text,
        "translation_status": status,
        "translation_provider": provider,
        "translation_confidence": max(0.0, min(1.0, confidence)),
        "translation_metadata": metadata,
        "translation_error": None,
    }
