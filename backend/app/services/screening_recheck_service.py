"""NDIS Worker Screening recheck reminders.

There is no public NDIS Commission API to verify a screening number against, so
approving a credential in CareCliQ only confirms the uploaded document was
reviewed here — it does not confirm the worker is still cleared on the NDIS
Commission's own Worker Screening Database. This nudges coordinators to go
check that directly, on a cadence, and records when they last did (see
credentials.last_checked_against_nwsd).

Mirrors medication_reminder_service.py's dose-reminder shape: one upserted row
per pending recheck (ndis_screening_recheck_reminders), reminder_sent_at
stamped once sent so repeated scheduler passes don't re-send.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

from .notification_service import _org_coordinator_user_ids, notify_worker
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

# Same 60-day expiring window already used for credential status elsewhere
# (backend/app/api/credentials.py:_status_for) — no new cadence constant.
RECHECK_LEAD_DAYS = 60


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return "does not exist" in err or "42703" in err or "pgrst" in err or "could not find" in err


def upsert_recheck_reminders() -> int:
    """One row per ndis_screening credential with an expiry_date, due_at =
    expiry_date - RECHECK_LEAD_DAYS. Upserted on credential_id so this stays
    idempotent across repeated passes."""
    try:
        result = (
            get_supabase_admin()
            .table("credentials")
            .select("id, expiry_date")
            .eq("credential_type", "ndis_screening")
            .not_.is_("expiry_date", "null")
            .in_("status", ["valid", "expiring", "pending_review"])
            .execute()
        )
        rows = result.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return 0
        logger.warning("Screening recheck credential query failed: %s", exc)
        return 0

    upserts: list[dict[str, Any]] = []
    for row in rows:
        expiry = date.fromisoformat(str(row["expiry_date"])[:10])
        due_at = expiry - timedelta(days=RECHECK_LEAD_DAYS)
        upserts.append({
            "credential_id": row["id"],
            "due_at": datetime.combine(due_at, datetime.min.time(), tzinfo=timezone.utc).isoformat(),
        })
    if not upserts:
        return 0
    try:
        get_supabase_admin().table("ndis_screening_recheck_reminders").upsert(
            upserts, on_conflict="credential_id",
        ).execute()
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return 0
        logger.warning("Screening recheck reminder upsert failed: %s", exc)
    return len(upserts)


async def send_pending_screening_recheck_reminders() -> int:
    now = datetime.now(timezone.utc)
    try:
        result = (
            get_supabase_admin()
            .table("ndis_screening_recheck_reminders")
            .select("id, credential_id, due_at, credentials(user_id, organization_id, title)")
            .is_("reminder_sent_at", "null")
            .lte("due_at", now.isoformat())
            .execute()
        )
        rows = result.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return 0
        logger.warning("Screening recheck reminder query failed: %s", exc)
        return 0

    sent = 0
    for row in rows:
        credential = row.get("credentials") or {}
        org_id = credential.get("organization_id")
        title = credential.get("title") or "NDIS Worker Screening Check"
        if not org_id:
            continue

        for coord_id in _org_coordinator_user_ids(org_id):
            try:
                outcome = await notify_worker(
                    user_id=coord_id,
                    org_id=org_id,
                    event="ndis_screening_recheck_due",
                    title="NDIS Worker Screening recheck due",
                    message=(
                        f"\"{title}\" is nearing expiry — please confirm this worker's status "
                        "directly on the NDIS Commission portal and record the check."
                    ),
                    reference_key=f"screening_recheck:{row['id']}:{coord_id}",
                    severity="medium",
                    alert_type="ndis_screening_recheck",
                )
                if outcome.get("in_app") or outcome.get("email") or outcome.get("push"):
                    sent += 1
            except Exception as exc:
                logger.warning("Screening recheck notify failed for coordinator %s: %s", coord_id, exc)

        try:
            get_supabase_admin().table("ndis_screening_recheck_reminders").update(
                {"reminder_sent_at": now.isoformat()}
            ).eq("id", row["id"]).execute()
        except Exception as exc:
            logger.warning("Screening recheck stamp failed for %s: %s", row.get("id"), exc)

    return sent


async def run_screening_recheck_pass() -> int:
    upsert_recheck_reminders()
    return await send_pending_screening_recheck_reminders()
