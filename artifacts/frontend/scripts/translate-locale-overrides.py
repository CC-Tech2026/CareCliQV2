#!/usr/bin/env python3
"""Batch-translate missing locale-overrides.json keys from English (no pip deps)."""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRANSLATIONS_TS = ROOT / "src/lib/i18n/translations.ts"
OVERRIDES_JSON = ROOT / "src/lib/i18n/locale-overrides.json"
CACHE_JSON = Path(__file__).resolve().parent / "translation-cache.json"

LANG_MAP = {
    "vi": "vi",
    "ar": "ar",
    "zh-Hans": "zh-CN",
}

PLACEHOLDER_RE = re.compile(r"\{[a-zA-Z0-9_]+\}")
UA = "Mozilla/5.0 (compatible; CareCliQ-i18n/1.0)"


def parse_en(text: str) -> dict[str, str]:
    m = re.search(r"const en: Dict = \{(.*?)\n\};", text, re.S)
    if not m:
        raise SystemExit("Could not parse en dict")
    return dict(re.findall(r'"([^"]+)":\s*"((?:\\.|[^"\\])*)"', m.group(1)))


def unescape_ts(value: str) -> str:
    return value.replace("\\n", "\n").replace('\\"', '"').replace("\\\\", "\\")


def protect_placeholders(text: str) -> tuple[str, list[str]]:
    placeholders: list[str] = []

    def repl(m: re.Match[str]) -> str:
        placeholders.append(m.group(0))
        return f"__PH{len(placeholders) - 1}__"

    return PLACEHOLDER_RE.sub(repl, text), placeholders


def restore_placeholders(text: str, placeholders: list[str]) -> str:
    for i, ph in enumerate(placeholders):
        for variant in (f"__PH{i}__", f"__ PH{i}__", f"__PH {i}__", f"__ PH {i} __"):
            text = text.replace(variant, ph)
    return text


def google_translate(text: str, target: str, source: str = "en", retries: int = 4) -> str:
    if not text.strip():
        return text
    protected, placeholders = protect_placeholders(text)
    if re.fullmatch(r"(__PH\d+__\s*)+", protected):
        return text

    params = urllib.parse.urlencode(
        {"client": "gtx", "sl": source, "tl": target, "dt": "t", "q": protected},
    )
    url = f"https://translate.googleapis.com/translate_a/single?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})

    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
            translated = "".join(part[0] for part in data[0] if part[0])
            return restore_placeholders(translated, placeholders)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            wait = 1.5 * (attempt + 1)
            print(f"  retry {attempt + 1}/{retries} ({target}): {exc!r}")
            time.sleep(wait)
    return text


def save_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    en = {k: unescape_ts(v) for k, v in parse_en(TRANSLATIONS_TS.read_text(encoding="utf-8")).items()}
    overrides = json.loads(OVERRIDES_JSON.read_text(encoding="utf-8"))
    cache: dict[str, dict[str, str]] = (
        json.loads(CACHE_JSON.read_text(encoding="utf-8")) if CACHE_JSON.exists() else {}
    )

    for lang, google_lang in LANG_MAP.items():
        lang_overrides = overrides.setdefault(lang, {})
        missing = [k for k in en if k not in lang_overrides]
        print(f"\n=== {lang}: {len(missing)} keys to translate ===")
        lang_cache = cache.setdefault(lang, {})

        for i, key in enumerate(missing, 1):
            if key in lang_cache:
                lang_overrides[key] = lang_cache[key]
            else:
                translated = google_translate(en[key], google_lang)
                lang_overrides[key] = translated
                lang_cache[key] = translated
                if i % 20 == 0:
                    save_json(CACHE_JSON, cache)
                    save_json(OVERRIDES_JSON, overrides)
                    print(f"  {i}/{len(missing)} …")
                time.sleep(0.08)

        save_json(CACHE_JSON, cache)
        print(f"  done: {len(missing)} keys for {lang}")

    save_json(OVERRIDES_JSON, overrides)
    print(f"\nWrote {OVERRIDES_JSON} ({len(overrides['vi'])} keys per language)")


if __name__ == "__main__":
    main()
