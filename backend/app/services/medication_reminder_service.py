"""Medication escalation — overdue scheduled doses (Medication Management v1 step 5).

Mirrors task_reminder_service.py's pattern: evaluate each active shift on the periodic
notification pass, escalate to coordinators once per event via notify_worker's built-in
reference_key delivery dedup (no separate "already sent" bookkeeping table needed).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from . import medication_service
from .notification_service import _org_coordinator_user_ids, notify_worker
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return "does not exist" in err or "42703" in err or "pgrst" in err or "could not find" in err


async def _notify_coordinators_medication_alert(
    *,
    org_id: str,
    shift_id: str,
    reference_key: str,
    title: str,
    message: str,
    alert_type: str,
) -> int:
    sent = 0
    for coord_id in _org_coordinator_user_ids(org_id):
        try:
            outcome = await notify_worker(
                user_id=coord_id,
                org_id=org_id,
                event="medication_alert",
                alert_type=alert_type,
                title=title,
                message=message,
                reference_key=f"{reference_key}:{coord_id}",
                severity="high",
                shift_id=shift_id,
            )
            if outcome.get("in_app") or outcome.get("email") or outcome.get("push"):
                sent += 1
        except Exception as exc:
            logger.warning("Medication alert notify failed for coordinator %s: %s", coord_id, exc)
    return sent


async def evaluate_shift_medication_reminders(shift: dict[str, Any]) -> int:
    """Escalate overdue, unlogged scheduled doses for one active shift."""
    if shift.get("status") not in ("in_progress", "clocked_in") and not shift.get("clocked_in_at"):
        return 0
    shift_id = str(shift.get("id") or "")
    org_id = str(shift.get("organization_id") or "")
    if not shift_id or not org_id:
        return 0

    try:
        checklist = medication_service.build_shift_medication_checklist(shift, org_id)
    except Exception as exc:
        logger.warning("Medication checklist eval failed for shift %s: %s", shift_id, exc)
        return 0

    sent = 0
    for item in checklist:
        if item.get("due_status") != "overdue" or item.get("administration"):
            continue
        ref = f"medication:{shift_id}:{item['medication_id']}:{item['scheduled_time']}:overdue"
        sent += await _notify_coordinators_medication_alert(
            org_id=org_id,
            shift_id=shift_id,
            reference_key=ref,
            title=f"Overdue medication: {item['name']}",
            message=f"{item['name']} was due at {item['scheduled_time']} and has not been logged.",
            alert_type="medication_missed",
        )
    return sent


async def run_medication_reminder_pass() -> int:
    now = datetime.now(timezone.utc)
    window_start = (now - timedelta(hours=12)).isoformat()
    try:
        result = (
            get_supabase_admin()
            .table("shifts")
            .select("id, organization_id, worker_id, participant_id, scheduled_start, scheduled_end, clocked_in_at, status")
            .gte("scheduled_start", window_start)
            .in_("status", ["in_progress", "clocked_in"])
            .execute()
        )
        rows = result.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return 0
        logger.warning("Medication reminder query failed: %s", exc)
        return 0

    total = 0
    for shift in rows:
        try:
            total += await evaluate_shift_medication_reminders(shift)
        except Exception as exc:
            logger.warning("Medication reminder eval failed for %s: %s", shift.get("id"), exc)
    return total
