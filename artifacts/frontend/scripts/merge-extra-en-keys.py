#!/usr/bin/env python3
"""Merge extra-en-keys.json into translations.ts en dict."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRANSLATIONS_TS = ROOT / "src/lib/i18n/translations.ts"
EXTRA = Path(__file__).resolve().parent / "extra-en-keys.json"


def main() -> None:
    extra = json.loads(EXTRA.read_text(encoding="utf-8"))
    text = TRANSLATIONS_TS.read_text(encoding="utf-8")
    m = re.search(r"(const en: Dict = \{.*?)(\n\};)", text, re.S)
    if not m:
        raise SystemExit("Could not find en dict")

    body = m.group(1)
    existing = set(re.findall(r'"([^"]+)":', body))
    lines = []
    for key, value in sorted(extra.items()):
        if key in existing:
            continue
        esc = value.replace("\\", "\\\\").replace('"', '\\"')
        lines.append(f'  "{key}": "{esc}",')

    if not lines:
        print("No new keys to add")
        return

    insert = "\n  // Extended worker & shared UI\n" + "\n".join(lines)
    new_text = text[: m.end(1)] + insert + m.group(2) + text[m.end() :]
    TRANSLATIONS_TS.write_text(new_text, encoding="utf-8")
    print(f"Added {len(lines)} keys to translations.ts")


if __name__ == "__main__":
    main()
