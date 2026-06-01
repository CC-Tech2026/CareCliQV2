"""Single registry of languages supported for legal-record translation."""

from __future__ import annotations


SUPPORTED_LANGUAGES: dict[str, str] = {
    "en": "English",
    "hi": "Hindi",
    "tl": "Tagalog",
    "ne": "Nepali",
    "ar": "Arabic",
    "sw": "Swahili",
    "zh-CN": "Mandarin",
    "vi": "Vietnamese",
    "pa": "Punjabi",
}

LANGUAGE_ALIASES: dict[str, str] = {
    "auto": "auto",
    "detect": "auto",
    "auto-detect": "auto",
    "autodetect": "auto",
    "english": "en",
    "hindi": "hi",
    "tagalog": "tl",
    "fil": "tl",
    "filipino": "tl",
    "nepali": "ne",
    "arabic": "ar",
    "swahili": "sw",
    "zh": "zh-CN",
    "zh-cn": "zh-CN",
    "zh_cn": "zh-CN",
    "cmn": "zh-CN",
    "mandarin": "zh-CN",
    "chinese": "zh-CN",
    "vietnamese": "vi",
    "punjabi": "pa",
    "panjabi": "pa",
}


def normalize_language_code(value: str | None) -> str | None:
    if not value:
        return None

    raw = value.strip()
    if not raw:
        return None

    alias_key = raw.lower().replace("_", "-")
    if alias_key in LANGUAGE_ALIASES:
        return LANGUAGE_ALIASES[alias_key]

    if alias_key.startswith("zh-"):
        return "zh-CN"

    base = alias_key.split("-")[0]
    return LANGUAGE_ALIASES.get(base, base)


def is_supported_language(value: str | None) -> bool:
    code = normalize_language_code(value)
    return bool(code and code in SUPPORTED_LANGUAGES)


def language_name(value: str | None) -> str | None:
    code = normalize_language_code(value)
    return SUPPORTED_LANGUAGES.get(code or "")
