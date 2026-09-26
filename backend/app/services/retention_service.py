"""Data retention / disposal — Archives Act 1983 (Australia), 7-year NDIS record threshold.

De-identifies participant records once their disposal_date has passed. This used to only
exist as a standalone script (backend/scripts/retention_cron.py) that was never actually
wired into anything — the logic worked, nothing ever called it. Extracted here so both the
standalone script (manual/external cron use) and the app's own background scheduler share
one implementation.

Idempotent by construction: the query filters on is_purged = False, and de-identification
sets is_purged = True, so a record naturally drops out of the candidate set after its first
successful pass — safe to call as often as the scheduler ticks, no separate cooldown needed.
"""

from __future__ import annotations

import logging

from .pii_service import deidentify_participant
from .supabase_client import get_supabase_admin
from zoneinfo import ZoneInfo

from ..core.timezone import AUSTRALIAN_TIMEZONES, app_today, participant_timezone

logger = logging.getLogger(__name__)


async def run_retention_pass() -> int:
    supabase = get_supabase_admin()
    # Cron has no request context. Pull everything due by the latest
    # Australian calendar day, then confirm each record against its own
    # branch's day so nothing is purged a few hours early in a western zone.
    latest_today = max(app_today(ZoneInfo(name)) for name in AUSTRALIAN_TIMEZONES).isoformat()

    try:
        result = (
            supabase.table("participants")
            .select("id, full_name, external_pseudonym, disposal_date, branch_id, organization_id")
            .lte("disposal_date", latest_today)
            .eq("is_purged", False)
            .execute()
        )
        candidates = [
            r for r in (result.data or [])
            if str(r.get("disposal_date") or "")[:10] <= app_today(participant_timezone(r)).isoformat()
        ]
    except Exception as exc:
        logger.warning("Retention pass query failed: %s", exc)
        return 0

    purged = 0
    for record in candidates:
        pid = record["id"]
        try:
            deidentified = deidentify_participant(record)
            supabase.table("participants").update(deidentified).eq("id", pid).execute()
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
            logger.info("De-identified participant %s -> pseudonym %s", pid, deidentified["external_pseudonym"])
            purged += 1
        except Exception as exc:
            logger.error("Failed to de-identify participant %s: %s", pid, exc)

    return purged
