"""Background notification jobs — shift reminders, credentials, task alerts (CARECLIQV2-261/263)."""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from ..core.config import settings
from .notification_service import (
    get_reminder_offsets_minutes,
    notify_certification_expiry,
    notify_shift_reminder,
)
from .incident_notification_service import run_incident_notification_pass
from .medication_pattern_service import run_medication_pattern_pass
from .applicant_stage_reminder_service import run_applicant_stage_reminder_pass
from .medication_reminder_service import run_medication_reminder_pass, send_pending_dose_reminders
from .offer_letter_reminder_service import run_offer_letter_reminder_pass
from .onboarding_escalation_service import run_onboarding_escalation_pass
from .retention_service import run_retention_pass
from .screening_recheck_service import run_screening_recheck_pass
from .shift_offer_service import run_shift_offer_pass
from .supabase_client import get_supabase_admin
from .task_reminder_service import run_task_reminder_pass
from .unassigned_shift_expiry_service import run_unassigned_shift_expiry_pass

logger = logging.getLogger(__name__)

_scheduler_task: Optional[asyncio.Task] = None
_long_shift_task: Optional[asyncio.Task] = None
_random_checkin_task: Optional[asyncio.Task] = None


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return (
        "does not exist" in err
        or "42703" in err
        or "pgrst" in err
        or "could not find" in err
    )


async def _shifts_in_reminder_window(minutes_before: int) -> list[dict]:
    now = datetime.now(timezone.utc)
    target = now + timedelta(minutes=minutes_before)
    window_start = target - timedelta(minutes=7)
    window_end = target + timedelta(minutes=7)

    try:
        result = (
            get_supabase_admin()
            .table("shifts")
            .select(
                "id, organization_id, worker_id, participant_id, participant_name, "
                "scheduled_start, status, clocked_in_at"
            )
            .gte("scheduled_start", window_start.isoformat())
            .lt("scheduled_start", window_end.isoformat())
            .eq("status", "scheduled")
            .execute()
        )
        return result.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        logger.warning("Shift reminder query failed: %s", exc)
        return []


async def run_shift_reminder_pass() -> int:
    """Notify workers at configured offsets (default 60 and 30 minutes before start)."""
    sent = 0
    seen_workers: set[str] = set()

    for minutes_before in (
        settings.shift_reminder_minutes_first,
        settings.shift_reminder_minutes_second,
    ):
        rows = await _shifts_in_reminder_window(minutes_before)
        for shift in rows:
            worker_id = str(shift.get("worker_id") or "")
            if worker_id and worker_id not in seen_workers:
                first_m, second_m = get_reminder_offsets_minutes(worker_id)
                if minutes_before not in (first_m, second_m):
                    continue
            try:
                outcome = await notify_shift_reminder(shift=shift, minutes_before=minutes_before)
                if outcome and any(outcome.get(k) for k in ("in_app", "email", "push")):
                    sent += 1
                    if worker_id:
                        seen_workers.add(worker_id)
            except Exception as exc:
                logger.warning(
                    "Shift reminder failed for shift %s (%sm): %s",
                    shift.get("id"),
                    minutes_before,
                    exc,
                )
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
            if outcome.get("in_app") or outcome.get("email") or outcome.get("push"):
                sent += 1
        except Exception as exc:
            logger.warning("Credential expiry notify failed for %s: %s", row.get("id"), exc)
    return sent


async def run_notification_pass() -> dict[str, int]:
    from .long_shift_service import run_long_shift_monitor_pass
    from .random_checkin_service import run_random_checkin_pass

    (
        shift_count, credential_count, task_count, long_shift_count,
        random_checkin_count, medication_count, incident_notification_count,
        medication_pattern_count, dose_reminder_count, retention_count,
        screening_recheck_count, onboarding_escalation_stats,
        offer_letter_stats, applicant_stage_reminder_count,
        shift_offer_stats, unassigned_shift_expiry_count,
    ) = await asyncio.gather(
        run_shift_reminder_pass(),
        run_credential_expiry_pass(),
        run_task_reminder_pass(),
        run_long_shift_monitor_pass(),
        run_random_checkin_pass(),
        run_medication_reminder_pass(),
        run_incident_notification_pass(),
        run_medication_pattern_pass(),
        send_pending_dose_reminders(),
        run_retention_pass(),
        run_screening_recheck_pass(),
        run_onboarding_escalation_pass(),
        run_offer_letter_reminder_pass(),
        run_applicant_stage_reminder_pass(),
        run_shift_offer_pass(),
        run_unassigned_shift_expiry_pass(),
    )
    return {
        "shift_reminders": shift_count,
        "credential_expiry": credential_count,
        "task_reminders": task_count,
        "long_shift_monitor": long_shift_count,
        "random_checkins": random_checkin_count,
        "medication_reminders": medication_count,
        "incident_notifications": incident_notification_count,
        "medication_pattern_signals": medication_pattern_count,
        "dose_reminders": dose_reminder_count,
        "retention_deidentified": retention_count,
        "screening_recheck_reminders": screening_recheck_count,
        "onboarding_stage_reminders": onboarding_escalation_stats["reminders"],
        "onboarding_stage_escalations": onboarding_escalation_stats["escalations"],
        "offer_letter_reminders": offer_letter_stats["reminders"],
        "offer_letter_expirations": offer_letter_stats["expirations"],
        "applicant_stage_reminders": applicant_stage_reminder_count,
        "shift_offers_expired": shift_offer_stats["expired"],
        "shift_offers_advanced": shift_offer_stats["advanced"],
        "shift_offers_exhausted": shift_offer_stats["exhausted"],
        "unassigned_shift_expirations": unassigned_shift_expiry_count,
    }


async def _scheduler_loop() -> None:
    interval = max(5, settings.notification_scheduler_interval_minutes) * 60
    logger.info(
        "Notification scheduler started (every %s min, shift reminders at %s/%s min)",
        settings.notification_scheduler_interval_minutes,
        settings.shift_reminder_minutes_first,
        settings.shift_reminder_minutes_second,
    )
    while True:
        try:
            stats = await run_notification_pass()
            if any(stats.values()):
                logger.info("Notification pass complete: %s", stats)
        except Exception as exc:
            logger.warning("Notification scheduler pass failed: %s", exc)
        await asyncio.sleep(interval)


def start_notification_scheduler() -> None:
    global _scheduler_task, _long_shift_task, _random_checkin_task
    if not settings.notification_scheduler_enabled:
        return
    if _scheduler_task and not _scheduler_task.done():
        return
    _scheduler_task = asyncio.create_task(_scheduler_loop())
    _long_shift_task = asyncio.create_task(_long_shift_monitor_loop())
    _random_checkin_task = asyncio.create_task(_random_checkin_loop())


async def _random_checkin_loop() -> None:
    """Minute pass for random compliance check-in prompts and missed handling."""
    from .random_checkin_service import run_random_checkin_pass

    logger.info("Random check-in monitor started (every 60 sec)")
    while True:
        try:
            count = await run_random_checkin_pass()
            if count:
                logger.info("Random check-in pass: %s action(s)", count)
        except Exception as exc:
            logger.warning("Random check-in loop failed: %s", exc)
        await asyncio.sleep(60)


async def _long_shift_monitor_loop() -> None:
    """Dedicated 5-minute pass for Check 16 live monitoring (addendum §4.6)."""
    from .long_shift_service import run_long_shift_monitor_pass

    logger.info("Long shift monitor loop started (every 5 min)")
    while True:
        try:
            count = await run_long_shift_monitor_pass()
            if count:
                logger.info("Long shift monitor: %s alert(s)", count)
        except Exception as exc:
            logger.warning("Long shift monitor loop failed: %s", exc)
        await asyncio.sleep(300)


async def stop_notification_scheduler() -> None:
    global _scheduler_task, _long_shift_task, _random_checkin_task
    for task in (_scheduler_task, _long_shift_task, _random_checkin_task):
        if not task:
            continue
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    _scheduler_task = None
    _long_shift_task = None
    _random_checkin_task = None
