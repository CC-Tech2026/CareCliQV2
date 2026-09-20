"""
NDIS Task Management API Endpoints

Provides endpoints for:
- Managing task completion with evidence verification
- Scheduling recurring tasks with shift-based automation
- Resolving pricing for tasks based on shift type and date

Invoicing lives in billing.py/billing_service.py (the pipeline billing.tsx
and financial.tsx actually use) — this file previously duplicated a second,
unreachable invoice generation/PDF pipeline that has been removed.
"""

from __future__ import annotations
from typing import Optional
from datetime import date, datetime, timezone
from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException, Query

from ..core.security import get_current_user
from ..services.supabase_client import get_supabase_admin
from ..services.recurring_task_scheduler import (
    schedule_recurring_tasks_for_period,
    list_task_instances_for_date,
    assign_task_instance_to_worker,
    RecurringTaskSchedulerError,
)


router = APIRouter(prefix="/ndis-tasks", tags=["ndis-tasks"])


def _require_coordinator(current_user: dict) -> str:
    """Require coordinator role and return org_id."""
    if current_user.get("role") != "support_coordinator":
        raise HTTPException(status_code=403, detail="Coordinator role required")
    org_id = current_user.get("organization_id")
    if not org_id:
        raise HTTPException(status_code=400, detail="User has no organization")
    return org_id


def _get_user_id(current_user: dict) -> str:
    """Get user ID."""
    return current_user.get("id") or current_user.get("sub", "")


# ──────────────────────────────────────────────────────────────────────────────
# Task Completion & Evidence Verification
# ──────────────────────────────────────────────────────────────────────────────


class TaskCompletionPayload(BaseModel):
    """Record task completion with evidence."""
    task_id: str
    participant_id: str
    completion_date: str  # YYYY-MM-DD
    completion_time: Optional[str] = None  # HH:MM:SS
    duration_minutes: int = Field(default=60, ge=1)
    shift_id: Optional[str] = None
    evidence_type: str = Field(default="none")  # none, photo, notes, photo_and_notes
    evidence_photo_url: Optional[str] = None
    evidence_notes: Optional[str] = None


@router.post("/task-completions", status_code=201)
async def record_task_completion(
    body: TaskCompletionPayload,
    current_user: dict = Depends(get_current_user),
):
    """
    Record task completion with evidence.
    
    Coordinator logs when a worker completes a task and submits evidence
    (photo/notes) for NDIS audit compliance.
    """
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc).isoformat()
    
    # Verify task exists and belongs to this org
    task_resp = (
        supabase.table("participant_tasks")
        .select("id, price_item_code, shift_type, category, support_category")
        .eq("id", body.task_id)
        .eq("organization_id", org_id)
        .single()
        .execute()
    )
    
    if not task_resp.data:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task = task_resp.data
    
    # Lookup pricing for this task at completion date
    price_item_code = task.get("price_item_code")
    billed_amount = None
    
    if price_item_code:
        # Resolve effective price for date
        try:
            price_resp = supabase.rpc(
                "resolve_ndis_price",
                {
                    "p_item_code": price_item_code,
                    "p_org_id": org_id,
                    "p_as_of_date": body.completion_date,
                    # Hardcoded "national" — this org has no remote/very-remote
                    # participants; revisit if that ever changes.
                    "p_location_type": "national",
                }
            ).execute()
            
            if price_resp.data:
                price_item = price_resp.data[0] if isinstance(price_resp.data, list) else price_resp.data
                hourly_rate = float(price_item.get("effective_price", 0))
                duration_hours = body.duration_minutes / 60.0
                billed_amount = hourly_rate * duration_hours
        except Exception as e:
            # Log but continue - evidence still recorded
            print(f"Warning: Price lookup failed: {e}")
    
    # Create task completion record
    completion_payload = {
        "task_id": body.task_id,
        "participant_id": body.participant_id,
        "organization_id": org_id,
        "completed_by": _get_user_id(current_user),
        "completion_date": body.completion_date,
        "completion_time": body.completion_time,
        "duration_minutes": body.duration_minutes,
        "shift_id": body.shift_id,
        "evidence_type": body.evidence_type,
        "evidence_photo_url": body.evidence_photo_url,
        "evidence_notes": body.evidence_notes,
        "price_item_code": price_item_code,
        "billed_amount": billed_amount,
        "status": "submitted",  # Awaiting verification
        "created_at": now,
        "updated_at": now,
    }
    
    try:
        resp = supabase.table("task_completions").insert(completion_payload).execute()
        return (resp.data or [completion_payload])[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to record completion: {e}")


@router.post("/task-completions/{completion_id}/verify")
async def verify_task_completion(
    completion_id: str,
    approved: bool = True,
    notes: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """
    Verify/reject task completion evidence (supervisor function).
    
    Supervisor reviews evidence and approves/rejects for billing.
    Only verified completions can be included in invoices.
    """
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc).isoformat()

    # A verified completion feeds invoicing unconditionally - invoice_service
    # and billing_service both trust task_completions.status == "verified"
    # with no further check of their own. Without this gate, a completion
    # linked to a shift that's still scheduled, in progress, or even
    # cancelled could be approved here and billed for real money despite the
    # shift never actually having happened.
    existing_resp = (
        supabase.table("task_completions")
        .select("id, shift_id")
        .eq("id", completion_id)
        .eq("organization_id", org_id)
        .maybe_single()
        .execute()
    )
    existing = existing_resp.data if existing_resp else None
    if not existing:
        raise HTTPException(status_code=404, detail="Task completion not found")

    if approved and existing.get("shift_id"):
        shift_resp = (
            supabase.table("shifts")
            .select("status")
            .eq("id", existing["shift_id"])
            .maybe_single()
            .execute()
        )
        shift = shift_resp.data if shift_resp else None
        if not shift or shift.get("status") != "completed":
            raise HTTPException(
                status_code=400,
                detail="Cannot verify this completion - the linked shift has not been completed yet.",
            )

    # Update completion record
    new_status = "verified" if approved else "rejected"
    update_payload = {
        "status": new_status,
        "evidence_verified": approved,
        "verified_by": _get_user_id(current_user),
        "verified_at": now,
        "updated_at": now,
    }
    
    if notes:
        update_payload["evidence_notes"] = notes
    
    try:
        resp = (
            supabase.table("task_completions")
            .update(update_payload)
            .eq("id", completion_id)
            .execute()
        )
        return (resp.data or [update_payload])[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Verification failed: {e}")


@router.get("/task-completions")
async def list_task_completions(
    participant_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),  # pending, submitted, verified, rejected
    limit: int = Query(default=100, ge=1, le=1000),
    current_user: dict = Depends(get_current_user),
):
    """List task completions with filtering."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    
    q = (
        supabase.table("task_completions")
        .select("*, participant_tasks(name, category)")
        .eq("organization_id", org_id)
    )
    
    if participant_id:
        q = q.eq("participant_id", participant_id)
    if status:
        q = q.eq("status", status)
    
    try:
        resp = q.order("completion_date", desc=True).limit(limit).execute()
        return resp.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {e}")


# ──────────────────────────────────────────────────────────────────────────────
# Recurring Task Scheduling
# ──────────────────────────────────────────────────────────────────────────────


class ScheduleRecurringPayload(BaseModel):
    """Schedule recurring tasks for date range."""
    start_date: str  # YYYY-MM-DD
    end_date: str  # YYYY-MM-DD


@router.post("/schedule-recurring-tasks")
async def schedule_recurring_tasks(
    body: ScheduleRecurringPayload,
    current_user: dict = Depends(get_current_user),
):
    """
    Generate task instances from recurring task templates.
    
    Creates individual task instances for each day based on frequency pattern:
    - every_morning_shift: Morning only
    - every_afternoon_shift: Afternoon only
    - every_night_shift: Night only
    - daily_all_shifts: All shifts
    - specific_days_of_week: Custom days
    
    Each instance includes scheduled_time matching shift times.
    """
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    
    try:
        period_start = date.fromisoformat(body.start_date)
        period_end = date.fromisoformat(body.end_date)
        
        summary = await schedule_recurring_tasks_for_period(
            supabase,
            org_id,
            period_start,
            period_end,
        )
        
        return {
            "message": f"Scheduled recurring tasks for {org_id}",
            "period": {"start": body.start_date, "end": body.end_date},
            "summary": summary,
        }
    
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format (use YYYY-MM-DD)")
    except RecurringTaskSchedulerError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/task-instances")
async def list_task_instances(
    date_str: str = Query(..., alias="date"),  # YYYY-MM-DD
    shift_type: Optional[str] = Query(None),  # morning, afternoon, night, anytime, all
    current_user: dict = Depends(get_current_user),
):
    """
    List task instances for a specific date and optional shift.
    
    Used by:
    - Shift roster view (coordinator)
    - Worker mobile app (to-do list for shift)
    - Task assignment workflow
    """
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    
    try:
        scheduled_date = date.fromisoformat(date_str)
        instances = list_task_instances_for_date(
            supabase,
            org_id,
            scheduled_date,
            shift_type if shift_type != "all" else None,
        )
        
        return {
            "date": date_str,
            "shift_type": shift_type or "all",
            "instances": instances,
            "count": len(instances),
        }
    
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format (use YYYY-MM-DD)")
    except RecurringTaskSchedulerError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/task-instances/{instance_id}/assign")
async def assign_task_instance(
    instance_id: str,
    worker_id: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    """Assign task instance to specific worker."""
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    
    try:
        result = assign_task_instance_to_worker(
            supabase,
            instance_id,
            worker_id,
            org_id,
        )
        return result
    except RecurringTaskSchedulerError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
