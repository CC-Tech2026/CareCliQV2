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
"""
from __future__ import annotations

import sys
import os
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Allow running as `python3 -m backend.scripts.retention_cron` from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from dotenv import load_dotenv  # type: ignore
load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("retention_cron")


def run() -> None:
    from backend.app.services.supabase_client import get_supabase_admin
    from backend.app.services.pii_service import deidentify_participant

    supabase = get_supabase_admin()
    today = datetime.now(timezone.utc).date().isoformat()

    logger.info("Retention cron starting — scanning for records past disposal_date (%s)", today)

    # Fetch candidates
    try:
        result = supabase.table("patients") \
            .select("id, full_name, external_pseudonym, disposal_date") \
            .lte("disposal_date", today) \
            .eq("is_purged", False) \
            .execute()
        candidates = result.data or []
    except Exception as exc:
        logger.error("Failed to query candidates: %s", exc)
        return

    if not candidates:
        logger.info("No records past retention threshold. Nothing to do.")
        return

    logger.info("Found %d record(s) past disposal_date.", len(candidates))
    purged, failed = 0, 0

    for record in candidates:
        pid = record["id"]
        try:
            deidentified = deidentify_participant(record)
            # Update in-place
            supabase.table("patients").update(deidentified).eq("id", pid).execute()

            # Write immutable audit log
            supabase.table("audit_logs").insert({
                "action_type": "participant.auto_deidentified",
                "action": "participant.auto_deidentified",
                "entity_type": "participant",
                "resource_type": "participant",
                "entity_id": str(pid),
                "resource_id": str(pid),
                "details": {
                    "reason": "7-year retention threshold exceeded (Archives Act 1983)",
                    "disposal_date": record.get("disposal_date"),
                    "pseudonym": deidentified["external_pseudonym"],
                },
            }).execute()

            logger.info("De-identified participant %s → pseudonym %s", pid, deidentified["external_pseudonym"])
            purged += 1
        except Exception as exc:
            logger.error("Failed to de-identify participant %s: %s", pid, exc)
            failed += 1

    logger.info("Retention cron complete. De-identified: %d, Failed: %d", purged, failed)


if __name__ == "__main__":
    run()
