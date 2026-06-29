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
    """
    Nightly job: Generate task instances for next 7 days.
    
    Runs at midnight (00:00) every day.
    Calls POST /api/tasks/internal/generate-instances?lookhead_days=7
    """
    try:
        from ..services.task_management_service import get_task_management_service
        
        service = get_task_management_service()
        result = await service.generate_future_instances(lookhead_days=7)
        logger.info(f"Nightly task generation completed: {result}")
    except Exception as e:
        logger.error(f"Nightly task generation failed: {e}", exc_info=True)


def start_scheduler() -> None:
    """Start the background scheduler."""
    global _scheduler
    scheduler = get_scheduler()
    
    if scheduler.running:
        logger.warning("Scheduler already running")
        return
    
    # Schedule nightly task generation at 00:00 (midnight) every day
    scheduler.add_job(
        nightly_task_generation,
        CronTrigger(hour=0, minute=0),
        id="nightly_task_generation",
        name="Generate task instances for next 7 days",
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
