"""Auto-cancel shifts that stayed unassigned past their scheduled start, once
a grace period has passed with nobody acting on them.

coordinator.py's GET /shifts/overdue-unassigned already surfaces these the
moment scheduled_start passes (a persistent roster-board banner, independent
of whatever week/month range happens to be showing), so a coordinator gets a
real window to notice and either assign someone or cancel it themselves.
This pass is the safety net for the ones nobody acted on: EXPIRE_AFTER_HOURS
later, still unassigned, it gets auto-cancelled.

The record is never deleted or silently overwritten - NDIS Practice
Standards require accurate records of what support was and wasn't delivered
and why. status flips to 'cancelled' the same as any other cancellation
(existing shifts.status CHECK, no new value), with cancellation_reason set
so the history shows exactly why, an audit_service entry recording the
before/after state, and coordinators notified. Coordinators can still edit
or delete the record afterwards same as any other shift - this only closes
out ones nobody was going to act on.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from . import audit_service
from .notification_service import _org_coordinator_user_ids, notify_worker
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

EXPIRE_AFTER_HOURS = 24
CANCELLATION_REASON = "unassigned_shift_expired"

# Mirrors coordinator.py's UNASSIGNED_SHIFT_PLACEHOLDER_ID - RosterBoard writes
# this all-zeros id for a shift created without a worker rather than leaving
# worker_id null, so "unassigned" has to check for both.
UNASSIGNED_PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000"


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return "does not exist" in err or "42703" in err or "pgrst" in err or "could not find" in err


async def run_unassigned_shift_expiry_pass() -> int:
    now = datetime.now(timezone.utc)
    expire_cutoff = now - timedelta(hours=EXPIRE_AFTER_HOURS)
    supabase = get_supabase_admin()

    try:
        resp = (
            supabase.table("shifts")
            .select(
                "id, organization_id, participant_id, participant_name, "
                "worker_id, scheduled_start, scheduled_end, status"
            )
            .lt("scheduled_start", expire_cutoff.isoformat())
            .not_.in_("status", ["cancelled", "completed"])
            .execute()
        )
        rows: list[dict[str, Any]] = resp.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return 0
        logger.warning("Unassigned shift expiry query failed: %s", exc)
        return 0

    unassigned = [
        r for r in rows if not r.get("worker_id") or r["worker_id"] == UNASSIGNED_PLACEHOLDER_ID
    ]
    expired = 0

    for row in unassigned:
        shift_id = row["id"]
        org_id = row["organization_id"]
        try:
            result = (
                supabase.table("shifts")
                .update({
                    "status": "cancelled",
                    "cancellation_reason": CANCELLATION_REASON,
                    "updated_at": now.isoformat(),
                })
                .eq("id", shift_id)
                .not_.in_("status", ["cancelled", "completed"])
                .execute()
            )
        except Exception as exc:
            logger.warning("Unassigned shift auto-cancel failed for %s: %s", shift_id, exc)
            continue
        if not result.data:
            continue
        expired += 1

        try:
            await audit_service.log_action(
                action_type="system.shift.auto_cancelled_unassigned",
                entity_type="shift",
                entity_id=shift_id,
                organization_id=org_id,
                before_state={"status": row.get("status")},
                after_state={"status": "cancelled", "cancellation_reason": CANCELLATION_REASON},
                details={
                    "scheduled_start": row.get("scheduled_start"),
                    "scheduled_end": row.get("scheduled_end"),
                    "participant_id": row.get("participant_id"),
                    "grace_period_hours": EXPIRE_AFTER_HOURS,
                },
            )
        except Exception as exc:
            logger.warning("Unassigned shift audit log failed for %s: %s", shift_id, exc)

        participant_name = row.get("participant_name") or "a participant"
        for coord_id in _org_coordinator_user_ids(org_id):
            try:
                await notify_worker(
                    user_id=coord_id,
                    org_id=org_id,
                    event="shift_auto_cancelled_unassigned",
                    title="Unassigned shift auto-cancelled",
                    message=(
                        f"A shift for {participant_name} was never assigned a worker and has "
                        f"been automatically cancelled, {EXPIRE_AFTER_HOURS}h after its "
                        "scheduled start."
                    ),
                    reference_key=f"shift_auto_cancelled_unassigned:{shift_id}",
                    severity="high",
                    alert_type="shift_auto_cancelled_unassigned",
                )
            except Exception as exc:
                logger.warning("Unassigned shift cancel notify failed for %s: %s", shift_id, exc)

    return expired
