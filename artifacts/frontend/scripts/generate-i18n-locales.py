#!/usr/bin/env python3
"""Generate complete vi/ar/zh-Hans locale files from en + hand-maintained overrides."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRANSLATIONS_TS = ROOT / "src/lib/i18n/translations.ts"
LOCALES_DIR = ROOT / "src/lib/i18n/locales"
OVERRIDES_JSON = ROOT / "src/lib/i18n/locale-overrides.json"


def parse_en(text: str) -> dict[str, str]:
    m = re.search(r"export const en: Dict = \{(.*)\n\};", text, re.S)
    if not m:
        raise SystemExit("Could not parse en dict")
    return dict(re.findall(r'"([^"]+)":\s*"((?:\\.|[^"\\])*)"', m.group(1)))


def ts_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def write_locale(var: str, data: dict[str, str]) -> None:
    lines = [
        'import type { Dict } from "../types";',
        "",
        f"export const {var}: Dict = {{",
    ]
    for key in sorted(data.keys()):
        lines.append(f'  "{key}": "{ts_escape(data[key])}",')
    lines.append("};")
    lines.append("")
    (LOCALES_DIR / f"{var}.ts").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    en = parse_en(TRANSLATIONS_TS.read_text(encoding="utf-8"))
    overrides = json.loads(OVERRIDES_JSON.read_text(encoding="utf-8"))
    LOCALES_DIR.mkdir(parents=True, exist_ok=True)

    for lang, var in [("vi", "vi"), ("ar", "ar"), ("zh-Hans", "zhHans")]:
        lang_overrides = overrides.get(lang, {})
        complete = {k: lang_overrides.get(k, en[k]) for k in en}
        missing = [k for k in en if k not in lang_overrides]
        if missing:
            print(f"  {lang}: {len(missing)} keys using English fallback")
        write_locale(var, complete)
        print(f"Wrote {var}.ts ({len(complete)} keys)")


if __name__ == "__main__":
    main()
