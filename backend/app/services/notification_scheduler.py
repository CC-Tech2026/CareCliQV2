"""Background notification jobs — shift reminders and credential expiry (Phase 1)."""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from ..core.config import settings
from .notification_service import notify_certification_expiry, notify_shift_reminder
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

_scheduler_task: Optional[asyncio.Task] = None


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return (
        "does not exist" in err
        or "42703" in err
        or "pgrst" in err
        or "could not find" in err
    )


async def run_shift_reminder_pass() -> int:
    """Notify workers about shifts starting within the configured reminder window."""
    hours_ahead = max(1, settings.shift_reminder_hours_ahead)
    now = datetime.now(timezone.utc)
    window_start = now + timedelta(hours=hours_ahead - 1)
    window_end = now + timedelta(hours=hours_ahead + 1)

    try:
        result = (
            get_supabase_admin()
            .table("shifts")
            .select("id, organization_id, worker_id, participant_id, participant_name, scheduled_start, status")
            .gte("scheduled_start", window_start.isoformat())
            .lt("scheduled_start", window_end.isoformat())
            .eq("status", "scheduled")
            .execute()
        )
        rows = result.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return 0
        logger.warning("Shift reminder query failed: %s", exc)
        return 0

    sent = 0
    for shift in rows:
        try:
            outcome = await notify_shift_reminder(shift=shift)
            if outcome and (outcome.get("in_app") or outcome.get("email")):
                sent += 1
        except Exception as exc:
            logger.warning("Shift reminder failed for shift %s: %s", shift.get("id"), exc)
    return sent


async def run_credential_expiry_pass() -> int:
    """Notify workers when their own credentials are expiring or expired."""
    today = date.today()
    warn_until = today + timedelta(days=30)

    try:
        result = (
            get_supabase_admin()
            .table("credentials")
            .select("id, user_id, organization_id, title, credential_type, expiry_date, status")
            .in_("status", ["expiring", "expired", "valid"])
            .lte("expiry_date", warn_until.isoformat())
            .execute()
        )
        rows = result.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return 0
        logger.warning("Credential expiry query failed: %s", exc)
        return 0

    sent = 0
    for row in rows:
        user_id = str(row.get("user_id") or "")
        if not user_id:
            continue
        expiry_raw = row.get("expiry_date")
        if not expiry_raw:
            continue
        try:
            expiry_date = date.fromisoformat(str(expiry_raw)[:10])
        except ValueError:
            continue
        if expiry_date > warn_until:
            continue
        status = "expired" if expiry_date < today else "expiring"
        title = row.get("title") or row.get("credential_type") or "Credential"
        try:
            outcome = await notify_certification_expiry(
                user_id=user_id,
                org_id=str(row.get("organization_id") or "") or None,
                credential_title=str(title),
                expiry_date=expiry_date.isoformat(),
                status=status,
                credential_id=str(row.get("id") or title),
            )
            if outcome.get("in_app") or outcome.get("email"):
                sent += 1
        except Exception as exc:
            logger.warning("Credential expiry notify failed for %s: %s", row.get("id"), exc)
    return sent


async def run_notification_pass() -> dict[str, int]:
    shift_count, credential_count = await asyncio.gather(
        run_shift_reminder_pass(),
        run_credential_expiry_pass(),
    )
    return {"shift_reminders": shift_count, "credential_expiry": credential_count}


async def _scheduler_loop() -> None:
    interval = max(5, settings.notification_scheduler_interval_minutes) * 60
    logger.info(
        "Notification scheduler started (every %s min, shift reminder %sh ahead)",
        settings.notification_scheduler_interval_minutes,
        settings.shift_reminder_hours_ahead,
    )
    while True:
        try:
            stats = await run_notification_pass()
            if stats["shift_reminders"] or stats["credential_expiry"]:
                logger.info("Notification pass complete: %s", stats)
        except Exception as exc:
            logger.warning("Notification scheduler pass failed: %s", exc)
        await asyncio.sleep(interval)


def start_notification_scheduler() -> None:
    global _scheduler_task
    if not settings.notification_scheduler_enabled:
        return
    if _scheduler_task and not _scheduler_task.done():
        return
    _scheduler_task = asyncio.create_task(_scheduler_loop())


async def stop_notification_scheduler() -> None:
    global _scheduler_task
    if not _scheduler_task:
        return
    _scheduler_task.cancel()
    try:
        await _scheduler_task
    except asyncio.CancelledError:
        pass
    _scheduler_task = None
