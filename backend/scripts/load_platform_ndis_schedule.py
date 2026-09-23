#!/usr/bin/env python3
"""
One-off / occasional entry point for loading a schedule into the platform
reference catalogue (platform_ndis_price_items) — see
backend/app/services/ndis_pricing_service.py:load_platform_price_schedule().

This calls the same service function the super_admin-gated
POST /ndis-pricing/platform-schedules/load endpoint uses, so a script run
and an API-triggered load can never drift out of sync with each other. It
bypasses HTTP auth entirely (there's no real user session for an ops
script), so it constructs a synthetic super_admin user with no real id —
loaded_by on the schedule row is left NULL rather than attributed to a
fabricated account.

Run manually:
    python -m backend.scripts.load_platform_ndis_schedule <path-to-schedule.json>

Requires the platform_ndis_price_items / platform_ndis_price_schedules
tables to already exist (backend/supabase/migrations/214_platform_ndis_price_catalogue.sql
applied) — this only calls the loader, it does not run migrations.
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from dotenv import load_dotenv  # type: ignore
load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("load_platform_ndis_schedule")

_SYSTEM_SUPER_ADMIN_USER = {"role": "super_admin"}


def run(source_path: str) -> None:
    from backend.app.services.ndis_pricing_service import load_platform_price_schedule

    with open(source_path, "r", encoding="utf-8") as f:
        source_json = json.load(f)

    logger.info("Loading platform schedule from %s", source_path)
    result = asyncio.run(
        load_platform_price_schedule(user=_SYSTEM_SUPER_ADMIN_USER, source_json=source_json)
    )
    logger.info(
        "Platform schedule loaded: schedule_id=%s financial_year=%s effective_date=%s items_loaded=%d",
        result["schedule_id"], result["financial_year"], result["effective_date"], result["items_loaded"],
    )
    if result.get("validation_errors"):
        logger.warning("Validation errors (items skipped, not fatal): %s", result["validation_errors"])


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: python -m backend.scripts.load_platform_ndis_schedule <path-to-schedule.json>", file=sys.stderr)
        sys.exit(1)
    run(sys.argv[1])
