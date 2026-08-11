#!/usr/bin/env python3
"""
Retention Cron — Archives Act 1983 (Australia)

Automatically de-identifies participant records that have exceeded
the 7-year NDIS record retention threshold (disposal_date has passed).

Run manually:
    cd /path/to/project && python3 -m backend.scripts.retention_cron

Schedule via cron (e.g. nightly at 02:00):
    0 2 * * * cd /home/runner/workspace && python3 -m backend.scripts.retention_cron >> /tmp/retention_cron.log 2>&1

What this script does:
1. Queries patients WHERE disposal_date < TODAY AND is_purged = FALSE
2. For each record: replaces PII with anonymised values (same logic as /purge)
3. Writes an audit log entry for every de-identification
4. Reports a summary to stdout

This logic also now runs automatically as part of the app's own background notification
scheduler (see backend/app/services/notification_scheduler.py) — this script remains as a
manual/external-cron entry point calling the same shared implementation
(backend/app/services/retention_service.py), so a manual run and a scheduled run can never
drift out of sync with each other.
"""
from __future__ import annotations

import asyncio
import sys
import logging
from pathlib import Path

# Allow running as `python3 -m backend.scripts.retention_cron` from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from dotenv import load_dotenv  # type: ignore
load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("retention_cron")


def run() -> None:
    from backend.app.services.retention_service import run_retention_pass

    logger.info("Retention cron starting.")
    purged = asyncio.run(run_retention_pass())
    logger.info("Retention cron complete. De-identified: %d", purged)


if __name__ == "__main__":
    run()
