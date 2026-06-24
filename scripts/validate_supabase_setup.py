#!/usr/bin/env python3
"""Validate Supabase Sydney region before deployment or migrations."""

from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

load_dotenv(ROOT / ".env")

from app.core.config import settings  # noqa: E402
from app.core.supabase_region import (  # noqa: E402
    REQUIRED_SUPABASE_REGION,
    REQUIRED_SUPABASE_REGION_LABEL,
    SupabaseRegionError,
    validate_supabase_region,
)


def main() -> int:
    try:
        validate_supabase_region(
            supabase_url=settings.supabase_url,
            declared_region=settings.supabase_region or None,
            access_token=settings.supabase_access_token or None,
            region_check_mode=settings.supabase_region_check,
        )
    except SupabaseRegionError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(
        f"OK: Supabase region validation passed ({REQUIRED_SUPABASE_REGION} / "
        f"{REQUIRED_SUPABASE_REGION_LABEL})."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
