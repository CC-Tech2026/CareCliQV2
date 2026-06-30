"""In-shift task and time reminder evaluation (CARECLIQV2-263)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from .notification_service import notify_task_alert, notify_worker
from .supabase_client import get_supabase_admin
from .shift_validation_service import _is_mandatory

logger = logging.getLogger(__name__)


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return (
        "does not exist" in err
        or "42703" in err
        or "pgrst" in err
        or "could not find" in err
    )


def _parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _optional_silenced(shift_id: str) -> bool:
    try:
        result = (
            get_supabase_admin()
            .table("shift_reminder_settings")
            .select("silence_optional_reminders")
            .eq("shift_id", shift_id)
            .maybe_single()
            .execute()
        )
        row = result.data if result else None
        return bool(row and row.get("silence_optional_reminders"))
    except Exception:
        return False


def _incomplete_tasks(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [t for t in tasks if not t.get("completed") and not t.get("marked_na")]


def _mandatory_incomplete(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [t for t in _incomplete_tasks(tasks) if _is_mandatory(t)]


def _instances_to_tasks(instances: list[dict], shift_start: Optional[datetime]) -> list[dict]:
    """Convert task_instances rows into the reminder-evaluation task format."""
    tasks = []
    for inst in instances:
        template = inst.get("task_templates") or {}
        label = template.get("title") or inst.get("id", "")[:8]
        is_mandatory = template.get("requirement_level", "mandatory") == "mandatory"

        scheduled_at = None
        due_end = inst.get("due_window_end")
        if due_end and shift_start is not None:
            try:
                parts = str(due_end).split(":")
                scheduled_at = shift_start.replace(
                    hour=int(parts[0]),
                    minute=int(parts[1]) if len(parts) > 1 else 0,
                    second=0,
                    microsecond=0,
                )
            except (ValueError, IndexError, TypeError):
                pass

        tasks.append({
            "task_id": inst.get("id", ""),
            "label": label,
            "completed": inst.get("status") in ("completed", "missed", "carried_over"),
            "marked_na": False,
            "scheduled_at": scheduled_at.isoformat() if scheduled_at else None,
            "reminder_minutes": 15,
            "mandatory": is_mandatory,
        })
    return tasks


def _fetch_instances_for_shift(shift_id: str, shift_start: Optional[datetime]) -> list[dict]:
    try:
        result = (
            get_supabase_admin()
            .table("task_instances")
            .select("id, status, due_window_start, due_window_end, task_templates(title, requirement_level)")
            .eq("shift_id", shift_id)
            .execute()
        )
        return _instances_to_tasks(result.data or [], shift_start)
    except Exception as exc:
        logger.warning("Failed to fetch task instances for shift %s: %s", shift_id, exc)
        return []


async def evaluate_shift_task_reminders(shift: dict[str, Any]) -> int:
    """Evaluate one active shift; returns count of alerts sent."""
    if shift.get("status") not in ("in_progress", "clocked_in") and not shift.get("clocked_in_at"):
        return 0

    shift_id = str(shift.get("id") or "")
    worker_id = str(shift.get("worker_id") or "")
    org_id = str(shift.get("organization_id") or "")
    if not shift_id or not worker_id:
        return 0

    now = datetime.now(timezone.utc)
    silence_optional = _optional_silenced(shift_id)
    sent = 0

    shift_start = _parse_dt(shift.get("clocked_in_at") or shift.get("scheduled_start"))
    shift_end = _parse_dt(shift.get("scheduled_end"))

    tasks = shift.get("tasks") or _fetch_instances_for_shift(shift_id, shift_start)

    for task in tasks:
        task_id = str(task.get("task_id") or task.get("label") or "")
        scheduled_at = _parse_dt(task.get("scheduled_at"))
        if not scheduled_at and shift_start is not None:
            offset = task.get("scheduled_offset_minutes")
            if offset is not None:
                try:
                    scheduled_at = shift_start + timedelta(minutes=int(offset))
                except (TypeError, ValueError):
                    scheduled_at = None

        if not scheduled_at:
            continue

        reminder_min = int(task.get("reminder_minutes") or 5)
        reminder_at = scheduled_at - timedelta(minutes=reminder_min)
        mandatory = _is_mandatory(task)

        if mandatory or not silence_optional:
            snoozed_until = _parse_dt(task.get("snoozed_until"))
            if snoozed_until and now < snoozed_until:
                continue

            if reminder_at <= now < scheduled_at and not task.get("reminder_sent_at"):
                label = task.get("label") or "Task"
                ref = f"shift:{shift_id}:task:{task_id}:reminder"
                await notify_task_alert(
                    user_id=worker_id,
                    org_id=org_id,
                    shift_id=shift_id,
                    title=f"Task reminder: {label}",
                    message=f"{label} is scheduled in {reminder_min} minutes.",
                    reference_key=ref,
                    banner_style="yellow" if not mandatory else None,
                    task_id=task_id,
                )
                task["reminder_sent_at"] = now.isoformat()
                sent += 1

        if mandatory and not task.get("started_at") and not task.get("completed"):
            overdue_threshold = scheduled_at + timedelta(minutes=30)
            if now >= overdue_threshold and not task.get("overdue_alert_sent_at"):
                label = task.get("label") or "Task"
                ref = f"shift:{shift_id}:task:{task_id}:overdue"
                await notify_task_alert(
                    user_id=worker_id,
                    org_id=org_id,
                    shift_id=shift_id,
                    title=f"Overdue task: {label}",
                    message=f"Mandatory task \"{label}\" was not started within 30 minutes of scheduled time.",
                    reference_key=ref,
                    banner_style="red",
                    task_id=task_id,
                    notify_coordinator=True,
                )
                task["overdue_alert_sent_at"] = now.isoformat()
                sent += 1

    if shift_end:
        remaining = (shift_end - now).total_seconds() / 60
        incomplete = _incomplete_tasks(tasks)
        mandatory_left = _mandatory_incomplete(tasks)
        if 0 < remaining <= 15 and incomplete and not shift.get("ending_soon_alert_sent_at"):
            ref = f"shift:{shift_id}:ending_soon"
            await notify_task_alert(
                user_id=worker_id,
                org_id=org_id,
                shift_id=shift_id,
                title="Shift ending soon",
                message=f"{len(incomplete)} task(s) still incomplete. Tap to open checklist.",
                reference_key=ref,
                banner_style="orange",
            )
            sent += 1
            if len(mandatory_left) > 2:
                await _notify_coordinators_task_escalation(
                    org_id=org_id,
                    shift_id=shift_id,
                    message=f"Worker has {len(mandatory_left)} mandatory tasks incomplete with 15 minutes left on shift.",
                )

    return sent


async def _notify_coordinators_task_escalation(
    *,
    org_id: str,
    shift_id: str,
    message: str,
) -> None:
    from .notification_service import _org_coordinator_user_ids

    ref_base = f"shift:{shift_id}:coord_escalation"
    for coord_id in _org_coordinator_user_ids(org_id):
        await notify_worker(
            user_id=coord_id,
            org_id=org_id,
            event="coordinator_message",
            title="Shift task escalation",
            message=message,
            reference_key=f"{ref_base}:{coord_id}",
            severity="high",
            shift_id=shift_id,
        )


async def run_task_reminder_pass() -> int:
    now = datetime.now(timezone.utc)
    window_start = (now - timedelta(hours=12)).isoformat()
    try:
        result = (
            get_supabase_admin()
            .table("shifts")
            .select(
                "id, organization_id, worker_id, scheduled_start, scheduled_end, "
                "clocked_in_at, status"
            )
            .gte("scheduled_start", window_start)
            .in_("status", ["in_progress", "clocked_in"])
            .execute()
        )
        rows = result.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return 0
        logger.warning("Task reminder query failed: %s", exc)
        return 0

    total = 0
    for shift in rows:
        try:
            total += await evaluate_shift_task_reminders(shift)
        except Exception as exc:
            logger.warning("Task reminder eval failed for %s: %s", shift.get("id"), exc)
    return total
