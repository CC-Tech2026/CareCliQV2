"""
Recurring Task Scheduler Service

Automatically creates task instances from recurring task templates based on shift patterns.
Supports time-based scheduling (morning/afternoon/night) with NDIS compliance tracking.
"""

from __future__ import annotations
from typing import Any, Dict, List, Optional
from datetime import date, datetime, time, timedelta, timezone
import logging

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)


# Shift time windows (default, can be customized per organization)
DEFAULT_SHIFT_TIMES = {
    "morning": {"start": time(6, 0), "end": time(12, 0)},
    "afternoon": {"start": time(12, 0), "end": time(17, 0)},
    "night": {"start": time(17, 0), "end": time(6, 0)},  # Crosses midnight
}


class RecurringTaskSchedulerError(Exception):
    """Recurring task scheduler error."""
    pass


def get_shift_type_for_time(scheduled_time: Optional[time]) -> str:
    """
    Determine shift type from time of day.
    
    Args:
        scheduled_time: Time of day (or None for all-day)
    
    Returns:
        Shift type: 'morning', 'afternoon', 'night', or 'anytime'
    """
    if not scheduled_time:
        return "anytime"
    
    if DEFAULT_SHIFT_TIMES["morning"]["start"] <= scheduled_time < DEFAULT_SHIFT_TIMES["morning"]["end"]:
        return "morning"
    elif DEFAULT_SHIFT_TIMES["afternoon"]["start"] <= scheduled_time < DEFAULT_SHIFT_TIMES["afternoon"]["end"]:
        return "afternoon"
    else:
        return "night"


def parse_frequency_pattern(
    pattern: str,
    frequency_metadata: Optional[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Parse frequency pattern and metadata into schedule rules.
    
    Args:
        pattern: Pattern type (every_morning_shift, every_afternoon_shift, etc.)
        frequency_metadata: Additional metadata (days_of_week, custom schedule, etc.)
    
    Returns:
        List of schedule rules: [{"day_of_week": 0-6, "shift_type": "morning", ...}, ...]
    """
    rules: List[Dict[str, Any]] = []
    metadata = frequency_metadata or {}
    
    if pattern == "every_morning_shift":
        # Every day, morning shift only
        rules = [{"day_of_week": i, "shift_type": "morning"} for i in range(7)]
    
    elif pattern == "every_afternoon_shift":
        # Every day, afternoon shift only
        rules = [{"day_of_week": i, "shift_type": "afternoon"} for i in range(7)]
    
    elif pattern == "every_night_shift":
        # Every day, night shift only
        rules = [{"day_of_week": i, "shift_type": "night"} for i in range(7)]
    
    elif pattern == "daily_all_shifts":
        # Every day, all shift times (or morning if no specific times)
        rules = [{"day_of_week": i, "shift_type": "anytime"} for i in range(7)]
    
    elif pattern == "specific_days_of_week":
        # Specific days (0=Monday, 6=Sunday)
        days = metadata.get("days_of_week", [])
        shift = metadata.get("shift_type", "anytime")
        rules = [{"day_of_week": day, "shift_type": shift} for day in days]
    
    elif pattern == "custom":
        # Custom schedule from metadata
        rules = metadata.get("schedule_rules", [])
    
    return rules


def generate_task_instances_for_range(
    supabase: Any,
    task_id: str,
    participant_id: str,
    organization_id: str,
    start_date: date,
    end_date: date,
    frequency_pattern: str,
    frequency_metadata: Optional[Dict[str, Any]],
    scheduled_time: Optional[time] = None
) -> List[str]:
    """
    Generate task instances for date range based on frequency pattern.
    
    Args:
        task_id: Template task ID
        participant_id: Participant for instances
        organization_id: Organization ID
        start_date: Generation start date
        end_date: Generation end date
        frequency_pattern: Recurrence pattern
        frequency_metadata: Pattern configuration
        scheduled_time: Default time for task (derived from shift_type if not provided)
    
    Returns:
        List of created task instance IDs
    """
    try:
        # Parse frequency into schedule rules
        rules = parse_frequency_pattern(frequency_pattern, frequency_metadata)
        
        if not rules:
            logger.warning(f"No rules generated for pattern {frequency_pattern}")
            return []
        
        # Generate instances for each day in range
        current = start_date
        instances_to_create: List[Dict[str, Any]] = []
        
        while current <= end_date:
            day_of_week = current.weekday()  # 0=Monday, 6=Sunday
            
            # Check if this day matches any rule
            for rule in rules:
                if rule.get("day_of_week") == day_of_week:
                    shift_type = rule.get("shift_type", "anytime")
                    
                    # Determine scheduled time based on shift
                    instance_time = scheduled_time
                    if not instance_time and shift_type != "anytime":
                        shift_config = DEFAULT_SHIFT_TIMES.get(shift_type, {})
                        instance_time = shift_config.get("start")
                    
                    instances_to_create.append({
                        "task_template_id": task_id,
                        "participant_id": participant_id,
                        "organization_id": organization_id,
                        "scheduled_date": current.isoformat(),
                        "scheduled_time": instance_time.isoformat() if instance_time else None,
                        "shift_type": shift_type,
                        "status": "pending",
                        "created_at": datetime.now(timezone.utc).isoformat(),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    })
            
            current += timedelta(days=1)
        
        # Batch insert instances
        if instances_to_create:
            resp = supabase.table("task_instances").insert(instances_to_create).execute()
            created_ids = [item.get("id") for item in (resp.data or []) if item.get("id")]
            
            # Update task with count of instances created
            total_created = len(created_ids)
            supabase.table("participant_tasks").update({
                "recurrence_instances_created": total_created,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", task_id).execute()
            
            logger.info(f"Created {total_created} instances for task {task_id}")
            return created_ids
        
        return []
    
    except Exception as e:
        logger.error(f"Instance generation failed: {e}")
        raise RecurringTaskSchedulerError(f"Failed to generate instances: {e}")


async def schedule_recurring_tasks_for_period(
    supabase: Any,
    organization_id: str,
    start_date: date,
    end_date: date
) -> Dict[str, Any]:
    """
    Process all active recurring tasks and generate instances for period.
    Called daily or on-demand to create upcoming task assignments.
    
    Args:
        organization_id: Organization whose tasks to schedule
        start_date: Period start (typically today)
        end_date: Period end (e.g., 30 days out)
    
    Returns:
        Summary of created instances by shift type
    """
    try:
        # Get all active recurring tasks for organization
        resp = (
            supabase.table("participant_tasks")
            .select("*")
            .eq("organization_id", organization_id)
            .eq("is_recurring", True)
            .eq("status", "active")
            .gte("recurrence_start_date", start_date.isoformat())
            .execute()
        )
        
        recurring_tasks = resp.data or []
        logger.info(f"Processing {len(recurring_tasks)} recurring tasks for {organization_id}")
        
        summary = {
            "total_processed": len(recurring_tasks),
            "total_instances_created": 0,
            "by_shift_type": {"morning": 0, "afternoon": 0, "night": 0, "anytime": 0},
            "errors": [],
        }
        
        for task in recurring_tasks:
            try:
                task_id = task.get("id")
                participant_id = task.get("participant_id")
                participant_id = task.get("participant_id")
                
                # Respect recurrence date boundaries if set
                gen_start = start_date
                gen_end = end_date
                
                if task.get("recurrence_start_date"):
                    gen_start = max(
                        gen_start,
                        datetime.fromisoformat(task["recurrence_start_date"]).date()
                    )
                
                if task.get("recurrence_end_date"):
                    gen_end = min(
                        gen_end,
                        datetime.fromisoformat(task["recurrence_end_date"]).date()
                    )
                
                # Skip if date range doesn't overlap
                if gen_start > gen_end:
                    continue
                
                # Generate instances
                created_ids = generate_task_instances_for_range(
                    supabase=supabase,
                    task_id=task_id,
                    participant_id=participant_id,
                    organization_id=organization_id,
                    start_date=gen_start,
                    end_date=gen_end,
                    frequency_pattern=task.get("frequency_pattern", "daily_all_shifts"),
                    frequency_metadata=task.get("frequency_metadata"),
                )
                
                summary["total_instances_created"] += len(created_ids)
                
                # Count by shift type
                instances_resp = supabase.table("task_instances").select(
                    "shift_type"
                ).in_("id", created_ids).execute() if created_ids else None
                
                if instances_resp and instances_resp.data:
                    for instance in instances_resp.data:
                        shift = instance.get("shift_type", "anytime")
                        summary["by_shift_type"][shift] = summary["by_shift_type"].get(shift, 0) + 1
            
            except Exception as e:
                logger.error(f"Failed to schedule task {task.get('id')}: {e}")
                summary["errors"].append({
                    "task_id": task.get("id"),
                    "error": str(e)
                })
        
        return summary
    
    except Exception as e:
        logger.error(f"Recurring task scheduling failed: {e}")
        raise RecurringTaskSchedulerError(f"Scheduling failed: {e}")


def assign_task_instance_to_worker(
    supabase: Any,
    task_instance_id: str,
    worker_id: str,
    organization_id: str,
) -> Dict[str, Any]:
    """
    Assign a specific task instance to a worker (coordinator function).
    """
    try:
        now = datetime.now(timezone.utc).isoformat()
        resp = (
            supabase.table("task_instances")
            .update({
                "assigned_worker_id": worker_id,
                "status": "assigned",
                "updated_at": now,
            })
            .eq("id", task_instance_id)
            .execute()
        )
        return (resp.data or [{}])[0]
    except Exception as e:
        logger.error(f"Assignment failed: {e}")
        raise RecurringTaskSchedulerError(f"Assignment failed: {e}")


def list_task_instances_for_date(
    supabase: Any,
    organization_id: str,
    scheduled_date: date,
    shift_type: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Get all task instances for a specific date, optionally filtered by shift.
    Used by shift roster view and worker app.
    """
    try:
        q = (
            supabase.table("task_instances")
            .select("*, participant_tasks(name, category, priority)")
            .eq("organization_id", organization_id)
            .eq("scheduled_date", scheduled_date.isoformat())
        )
        
        if shift_type and shift_type != "all":
            q = q.eq("shift_type", shift_type)
        
        resp = q.order("scheduled_time", desc=False).execute()
        return resp.data or []
    
    except Exception as e:
        logger.error(f"Instance listing failed: {e}")
        raise RecurringTaskSchedulerError(f"Listing failed: {e}")
