"""Single registry of languages supported for legal-record translation."""

from __future__ import annotations


SUPPORTED_LANGUAGES: dict[str, str] = {
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "ar": "Arabic",
    "sw": "Swahili",
    "zh": "Chinese",
    "hi": "Hindi",
    "pt": "Portuguese",
    "de": "German",
    "it": "Italian",
    "ja": "Japanese",
    "ko": "Korean",
    "vi": "Vietnamese",
    "tl": "Tagalog",
    "ur": "Urdu",
    "fa": "Persian",
    "ru": "Russian",
    "uk": "Ukrainian",
    "nl": "Dutch",
    "tr": "Turkish",
    "id": "Indonesian",
    "ms": "Malay",
    "th": "Thai",
    "pl": "Polish",
    "ro": "Romanian",
    "el": "Greek",
}


def normalize_language_code(value: str | None) -> str | None:
    if not value:
        return None
    code = value.strip().lower().replace("_", "-").split("-")[0]
    return code or None


def is_supported_language(value: str | None) -> bool:
    code = normalize_language_code(value)
    return bool(code and code in SUPPORTED_LANGUAGES)


def language_name(value: str | None) -> str | None:
    code = normalize_language_code(value)
    return SUPPORTED_LANGUAGES.get(code or "")
