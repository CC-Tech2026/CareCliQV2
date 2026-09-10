"""Auto-end shifts a worker never ended themselves, once a grace period past
the scheduled finish has passed.

The worker-facing end-shift flow lets a worker end early/with incomplete
documentation as long as they acknowledge the risk and give a reason
(shift_service.end_shift's force+reason path) - this pass is the backstop for
the case where they don't end it at all. A shift left running indefinitely
blocks the worker's app (an active shift takes over the UI) and leaves an
inaccurate record of care delivered, so GRACE_PERIOD_MINUTES after
scheduled_end, still clocked in, it's ended for them: force=True (skip the
mandatory-task gate - nobody's there to complete it), system_initiated=True
(skip the digital-signature requirement - nobody's there to sign), and a
fixed reason so this is never confused with the worker's own force-ended
shifts in the coordinator's shift-verification queue.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from . import audit_service, shift_service
from .notification_service import _org_coordinator_user_ids, notify_worker
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

GRACE_PERIOD_MINUTES = 30
AUTO_END_REASON = (
    f"Automatically ended by the system — worker did not end this shift within "
    f"{GRACE_PERIOD_MINUTES} minutes of the scheduled end time."
)


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return "does not exist" in err or "42703" in err or "pgrst" in err or "could not find" in err


async def run_overdue_shift_autoend_pass() -> int:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=GRACE_PERIOD_MINUTES)
    supabase = get_supabase_admin()

    try:
        resp = (
            supabase.table("shifts")
            .select(
                "id, organization_id, worker_id, participant_name, "
                "scheduled_start, scheduled_end, status, clocked_in_at, clocked_out_at"
            )
            .in_("status", ["in_progress", "clocked_in"])
            .is_("clocked_out_at", "null")
            .lt("scheduled_end", cutoff.isoformat())
            .execute()
        )
        rows: list[dict[str, Any]] = resp.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return 0
        logger.warning("Overdue shift auto-end query failed: %s", exc)
        return 0

    ended = 0
    for row in rows:
        shift_id = row["id"]
        org_id = row.get("organization_id")
        worker_id = row.get("worker_id")
        if not worker_id or not org_id:
            continue

        try:
            updated = shift_service.end_shift(
                shift_id,
                worker_id=worker_id,
                organization_id=org_id,
                force=True,
                reason=AUTO_END_REASON,
                system_initiated=True,
            )
        except ValueError as exc:
            # Already completed by the worker in the window between our query and
            # this update (or another concurrent pass) - not a real failure.
            logger.debug("Overdue shift auto-end skipped %s: %s", shift_id, exc)
            continue
        except Exception as exc:
            logger.warning("Overdue shift auto-end failed for %s: %s", shift_id, exc)
            continue
        if not updated:
            continue
        ended += 1

        try:
            await audit_service.log_action(
                action_type="system.shift.auto_ended_overdue",
                entity_type="shift",
                entity_id=shift_id,
                organization_id=org_id,
                before_state={"status": row.get("status")},
                after_state={"status": "completed", "auto_ended": True},
                details={
                    "scheduled_end": row.get("scheduled_end"),
                    "grace_period_minutes": GRACE_PERIOD_MINUTES,
                    "reason": AUTO_END_REASON,
                },
            )
        except Exception as exc:
            logger.warning("Overdue shift auto-end audit log failed for %s: %s", shift_id, exc)

        participant_name = row.get("participant_name") or "a participant"
        try:
            await notify_worker(
                user_id=worker_id,
                org_id=org_id,
                event="shift_auto_ended_overdue",
                title="Shift automatically ended",
                message=(
                    f"Your shift for {participant_name} ran {GRACE_PERIOD_MINUTES}+ minutes past its "
                    "scheduled end time and was automatically ended. Please contact your coordinator "
                    "if documentation still needs completing."
                ),
                reference_key=f"shift_auto_ended_overdue:{shift_id}",
                severity="high",
                alert_type="shift_auto_ended_overdue",
                shift_id=shift_id,
            )
        except Exception as exc:
            logger.warning("Overdue shift auto-end worker notify failed for %s: %s", shift_id, exc)

        for coord_id in _org_coordinator_user_ids(org_id):
            try:
                await notify_worker(
                    user_id=coord_id,
                    org_id=org_id,
                    event="shift_auto_ended_overdue",
                    title="A worker's shift was auto-ended",
                    message=(
                        f"A shift for {participant_name} ran {GRACE_PERIOD_MINUTES}+ minutes past its "
                        "scheduled end without the worker ending it, and was automatically ended. "
                        "Review it in the shift-verification queue."
                    ),
                    reference_key=f"shift_auto_ended_overdue:{shift_id}:{coord_id}",
                    severity="high",
                    alert_type="shift_auto_ended_overdue",
                    shift_id=shift_id,
                )
            except Exception as exc:
                logger.warning("Overdue shift auto-end coordinator notify failed for %s: %s", shift_id, exc)

    return ended
