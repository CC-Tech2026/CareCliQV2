"""Applicants Board stage reminders — a card stuck in Applied or Interview
for 3+ days gets a one-time nudge to the org's coordinators/MD (there's no
applicant account to notify). Same reminder shape as
offer_letter_reminder_service.py and onboarding_escalation_service.py,
reusing the scheduler rather than a new timer. Tracking lives directly on
applicants (stage_entered_at / stage_reminder_sent_at) for the same reason
offer_letter_reminder_service.py can't use a shared reminders table — an
applicant has no worker_id/user account.

Unlike the Offer-extended stage (which auto-expires after 14 days, per
offer_letter_reminder_service.py), a stuck Applied/Interview card is only
ever reminded, never auto-rejected — rejecting a candidate is a
consequential, MD-gated decision that shouldn't happen automatically. The
3-day cadence mirrors every other reminder pass in this project; the
14-day escalation tier used elsewhere doesn't apply here since there's no
automatic action to escalate to.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from .notification_service import _org_coordinator_user_ids, notify_worker
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

REMINDER_AFTER_DAYS = 3

_STAGE_LABEL = {"applied": "Applied", "interview": "Interview"}


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return "does not exist" in err or "42703" in err or "pgrst" in err or "could not find" in err


async def run_applicant_stage_reminder_pass() -> int:
    now = datetime.now(timezone.utc)
    reminder_cutoff = now - timedelta(days=REMINDER_AFTER_DAYS)

    try:
        result = (
            get_supabase_admin()
            .table("applicants")
            .select("id, organization_id, full_name, stage, stage_entered_at, stage_reminder_sent_at")
            .in_("stage", ["applied", "interview"])
            .lte("stage_entered_at", reminder_cutoff.isoformat())
            .execute()
        )
        rows = result.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return 0
        logger.warning("Applicant stage reminder query failed: %s", exc)
        return 0

    reminded = 0
    for row in rows:
        if row.get("stage_reminder_sent_at"):
            continue
        applicant_id = row["id"]
        org_id = row["organization_id"]
        stage_label = _STAGE_LABEL.get(row["stage"], row["stage"])
        try:
            for coord_id in _org_coordinator_user_ids(org_id):
                await notify_worker(
                    user_id=coord_id,
                    org_id=org_id,
                    event="applicant_stage_stuck",
                    title="Applicant stuck in pipeline",
                    message=(
                        f"{row.get('full_name') or 'A candidate'} has been in {stage_label} for "
                        f"{REMINDER_AFTER_DAYS}+ days — worth a follow-up."
                    ),
                    reference_key=f"applicant_stage_reminder:{applicant_id}",
                    severity="low",
                    alert_type="applicant_stage_reminder",
                )
            get_supabase_admin().table("applicants").update(
                {"stage_reminder_sent_at": now.isoformat()}
            ).eq("id", applicant_id).execute()
            reminded += 1
        except Exception as exc:
            logger.warning("Applicant stage reminder failed for %s: %s", applicant_id, exc)

    return reminded
