"""Flag a shift whose documentation_due_at (24h from clock-in) has passed
while documentation is still incomplete.

end_shift's force path (a worker acknowledging incomplete mandatory tasks, or
the overdue-shift auto-end backstop) sets shifts.documentation_pending +
documentation_due_at rather than blocking the shift from ending - the worker
still owes real documentation, they just get a 24h window from clock-in to
come back and finish it (update_shift_tasks clears the flag the moment
mandatory tasks are actually complete). This pass is what happens if that
window closes with nothing done: never silently drop it, and never re-fire
for the same shift every 5 minutes forever - flag it once
(documentation_escalated_at), audit it, and let the worker and their
coordinator both know. The shift stays fully editable after this; nothing
here locks it - overdue is a compliance signal, not a dead end.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from . import audit_service
from .notification_service import _org_coordinator_user_ids, notify_worker
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return "does not exist" in err or "42703" in err or "pgrst" in err or "could not find" in err


async def run_overdue_documentation_escalation_pass() -> int:
    now = datetime.now(timezone.utc)
    supabase = get_supabase_admin()

    try:
        resp = (
            supabase.table("shifts")
            .select("id, organization_id, worker_id, participant_name, documentation_due_at")
            .eq("documentation_pending", True)
            .is_("documentation_escalated_at", "null")
            .lt("documentation_due_at", now.isoformat())
            .execute()
        )
        rows: list[dict[str, Any]] = resp.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return 0
        logger.warning("Overdue documentation query failed: %s", exc)
        return 0

    escalated = 0
    for row in rows:
        shift_id = row["id"]
        org_id = row.get("organization_id")
        worker_id = row.get("worker_id")
        if not worker_id or not org_id:
            continue

        try:
            result = (
                supabase.table("shifts")
                .update({"documentation_escalated_at": now.isoformat()})
                .eq("id", shift_id)
                .eq("documentation_pending", True)
                .is_("documentation_escalated_at", "null")
                .execute()
            )
        except Exception as exc:
            logger.warning("Overdue documentation escalation update failed for %s: %s", shift_id, exc)
            continue
        if not result.data:
            # Already escalated by a concurrent pass, or finished (documentation_pending
            # flipped false) in the gap between our query and this update - not an error.
            continue
        escalated += 1

        try:
            await audit_service.log_action(
                action_type="system.shift.documentation_overdue",
                entity_type="shift",
                entity_id=shift_id,
                organization_id=org_id,
                before_state={"documentation_pending": True, "documentation_escalated_at": None},
                after_state={"documentation_pending": True, "documentation_escalated_at": now.isoformat()},
                details={"documentation_due_at": row.get("documentation_due_at")},
            )
        except Exception as exc:
            logger.warning("Overdue documentation audit log failed for %s: %s", shift_id, exc)

        participant_name = row.get("participant_name") or "a participant"
        try:
            await notify_worker(
                user_id=worker_id,
                org_id=org_id,
                event="shift_documentation_overdue",
                title="Documentation overdue",
                message=(
                    f"Your documentation for the {participant_name} shift you ended early is now "
                    "overdue. Please finish the remaining task notes as soon as possible."
                ),
                reference_key=f"shift_documentation_overdue:{shift_id}",
                severity="high",
                alert_type="shift_documentation_overdue",
                shift_id=shift_id,
            )
        except Exception as exc:
            logger.warning("Overdue documentation worker notify failed for %s: %s", shift_id, exc)

        for coord_id in _org_coordinator_user_ids(org_id):
            try:
                await notify_worker(
                    user_id=coord_id,
                    org_id=org_id,
                    event="shift_documentation_overdue",
                    title="Worker documentation overdue",
                    message=(
                        f"A worker's documentation for a {participant_name} shift is now more than "
                        "24h overdue. Review it in the shift-verification queue."
                    ),
                    reference_key=f"shift_documentation_overdue:{shift_id}:{coord_id}",
                    severity="high",
                    alert_type="shift_documentation_overdue",
                    shift_id=shift_id,
                )
            except Exception as exc:
                logger.warning("Overdue documentation coordinator notify failed for %s: %s", shift_id, exc)

    return escalated
