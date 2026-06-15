#!/usr/bin/env python3
"""
CARECLIQV2-34 — Weekly cross-session pattern detection cron.

Run manually:
    python3 -m backend.scripts.pattern_detection_cron

Schedule via cron (Sunday 00:00 UTC):
    0 0 * * 0 cd /path/to/project && python3 -m backend.scripts.pattern_detection_cron >> /tmp/pattern_detection_cron.log 2>&1
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from dotenv import load_dotenv  # type: ignore

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("pattern_detection_cron")


def run() -> None:
    from backend.app.services.pattern_detection_service import run_pattern_detection_all_orgs

    logger.info("Pattern detection cron starting (CARECLIQV2-34)")
    summary = run_pattern_detection_all_orgs()
    logger.info(
        "Pattern detection complete — orgs=%s detected=%s created=%s",
        summary.get("organizations"),
        summary.get("total_detected"),
        summary.get("total_created"),
    )


if __name__ == "__main__":
    run()
