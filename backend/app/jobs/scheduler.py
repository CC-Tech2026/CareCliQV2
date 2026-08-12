"""Background job scheduler for task management system."""

import logging
from datetime import datetime, time as datetime_time
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


def get_scheduler() -> AsyncIOScheduler:
    """Get or create the global scheduler instance."""
    global _scheduler
    if _scheduler is None:
        _scheduler = AsyncIOScheduler()
    return _scheduler


async def nightly_task_generation() -> None:
    """Retired CARECLIQV2-331: task_instances generation no longer runs.

    Shift task links are created on coordinator assign via shift_tasks.
    """
    logger.info(
        "Skipping retired nightly task_instances generation (CARECLIQV2-331)"
    )


def start_scheduler() -> None:
    """Start the background scheduler."""
    global _scheduler
    scheduler = get_scheduler()
    
    if scheduler.running:
        logger.warning("Scheduler already running")
        return
    
    # Job retained as a no-op for schedule compatibility; generation is retired.
    scheduler.add_job(
        nightly_task_generation,
        CronTrigger(hour=0, minute=0),
        id="nightly_task_generation",
        name="Retired task_instances generation (no-op)",
        replace_existing=True,
    )
    
    scheduler.start()
    logger.info("Background job scheduler started")


def stop_scheduler() -> None:
    """Stop the background scheduler gracefully."""
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=True)
        logger.info("Background job scheduler stopped")
