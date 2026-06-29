"""Task management API — endpoints for task templates and instances."""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from uuid import UUID
from typing import Optional

from ..core.access import get_user_id
from ..core.security import get_current_user
from ..models.task_models import (
    TaskTemplateCreate,
    TaskTemplateUpdate,
    TaskTemplate,
    TaskInstance,
    TaskInstanceComplete,
    TaskInstanceReassign,
    TaskSuggestion,
    GoalInsight,
)
from ..services.task_management_service import get_task_management_service

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.post("/templates", response_model=TaskTemplate, status_code=201)
async def create_task_template(
    payload: TaskTemplateCreate,
    current_user: dict = Depends(get_current_user),
):
    """
    Create a new task template.
    
    Validation:
    - participant_id and title required
    - primary_shift_type is required (no default)
    - if recurrence_type is recurring, recurrence_frequency is required
    - additional_shift_types only allowed for recurring
    - due_window_end must be after due_window_start
    - cannot have anytime + additional_shift_types
    """
    service = get_task_management_service()
    user_id = get_user_id(current_user)
    
    template_dict = payload.model_dump(exclude_unset=True)
    result = await service.create_task_template(template_dict, user_id)
    
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    
    return result["template"]


@router.get("/templates/{template_id}", response_model=TaskTemplate)
async def get_task_template(
    template_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    """Get a task template by ID."""
    service = get_task_management_service()
    
    # RLS ensures user can only see their org's templates
    response = service.sb.table("task_templates").select("*").eq(
        "id", str(template_id)
    ).single().execute()
    
    if not response.data:
        raise HTTPException(status_code=404, detail="Template not found")
    
    return response.data


@router.patch("/templates/{template_id}", response_model=TaskTemplate)
async def update_task_template(
    template_id: UUID,
    payload: TaskTemplateUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Update a task template."""
    service = get_task_management_service()
    
    update_dict = payload.model_dump(exclude_unset=True)
    result = await service.update_task_template(template_id, update_dict)
    
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    
    return result["template"]


@router.post("/templates/{template_id}/pause", status_code=204)
async def pause_task_template(
    template_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    """Pause a task template (stops future generation)."""
    service = get_task_management_service()
    result = await service.pause_task_template(template_id)
    
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])


@router.post("/templates/{template_id}/archive", status_code=204)
async def archive_task_template(
    template_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    """Archive a task template."""
    service = get_task_management_service()
    result = await service.archive_task_template(template_id)
    
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])


@router.get("/templates/participant/{participant_id}", response_model=list[TaskTemplate])
async def get_participant_task_templates(
    participant_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    """Get all active task templates for a participant."""
    service = get_task_management_service()
    templates = await service.get_templates_for_participant(participant_id)
    return templates


# ──────────────────────────────────────────────────────────────────────
# Task Instance Endpoints
# ──────────────────────────────────────────────────────────────────────

@router.get("/shifts/{shift_id}/instances", response_model=list[TaskInstance])
async def get_shift_task_instances(
    shift_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    """Get all task instances for a shift."""
    service = get_task_management_service()
    instances = await service.get_shift_tasks(shift_id)
    return instances


@router.patch("/instances/{instance_id}/complete", response_model=TaskInstance, status_code=200)
async def complete_task_instance(
    instance_id: UUID,
    payload: TaskInstanceComplete,
    current_user: dict = Depends(get_current_user),
):
    """
    Mark a task instance as completed with evidence.
    
    Validation:
    - If template requires photo evidence, evidence_photo_url must be set
    - If template requires notes evidence, evidence_notes must be set
    
    Returns error if evidence requirements not met.
    """
    service = get_task_management_service()
    
    result = await service.complete_task_instance(
        instance_id,
        completed_by=payload.completed_by,
        completion_notes=payload.completion_notes,
        evidence_photo_url=payload.evidence_photo_url,
        evidence_notes=payload.evidence_notes,
    )
    
    if "error" in result:
        raise HTTPException(
            status_code=400,
            detail=result["error"],
            headers={"X-Missing-Evidence": ",".join(result.get("missing_evidence", []))},
        )
    
    return result["instance"]


@router.patch("/instances/{instance_id}/reassign", response_model=TaskInstance)
async def reassign_task_instance(
    instance_id: UUID,
    payload: TaskInstanceReassign,
    current_user: dict = Depends(get_current_user),
):
    """Reassign a task instance to a different worker."""
    service = get_task_management_service()
    
    update_dict = payload.model_dump(exclude_unset=True)
    result = await service.sb.table("task_instances").update(update_dict).eq(
        "id", str(instance_id)
    ).execute()
    
    if not result.data:
        raise HTTPException(status_code=404, detail="Instance not found")
    
    return result.data[0]


# ──────────────────────────────────────────────────────────────────────
# Internal Jobs
# ──────────────────────────────────────────────────────────────────────

@router.post("/internal/generate-instances", status_code=202)
async def generate_task_instances(
    shift_id: Optional[UUID] = Query(None),
    lookhead_days: int = Query(7),
):
    """
    Generate task instances.
    
    If shift_id provided: generate for that specific shift.
    Otherwise: run nightly job to generate for next N days.
    """
    service = get_task_management_service()
    
    if shift_id:
        instances = await service.generate_task_instances_for_shift(shift_id)
        return {"generated": len(instances), "instances": instances}
    else:
        result = await service.generate_future_instances(lookhead_days)
        return result


@router.post("/internal/process-handover", status_code=200)
async def process_shift_handover(
    shift_id: UUID,
):
    """
    Process handover when a shift ends.
    
    For each pending task:
    1. Mark as missed
    2. Create carried-over instance on next shift
    """
    service = get_task_management_service()
    result = await service.process_shift_handover(shift_id)
    return result


# ──────────────────────────────────────────────────────────────────────
# AI-Assisted Features
# ──────────────────────────────────────────────────────────────────────

@router.get("/ai/task-suggestion", response_model=TaskSuggestion)
async def get_task_suggestion(
    participant_id: UUID = Query(...),
    shift_type: str = Query(...),
    category: str = Query(...),
    lookback_days: int = Query(30),
    current_user: dict = Depends(get_current_user),
):
    """
    Get AI-assisted task suggestion (scoped, RAG-grounded).
    
    Query narrowed to:
    - This participant's task_instances, worker notes, incidents
    - Within lookback window (default 30 days)
    - Matching shift type and category
    
    Returns:
    - suggestion_text: specific, dated, grounded in participant history
    - evidence_recommendation: optional guidance (photo/notes)
    - sources: at least one citation (task_instance id, date, snippet)
    
    Returns null suggestion if retrieval comes back empty (never generic).
    """
    # This is a placeholder for the RAG integration
    # In production, this would:
    # 1. Query task_instances, incident records, worker notes for this participant
    # 2. Filter by shift_type and category
    # 3. Pass scoped context to RAG/LLM for suggestion
    # 4. Return only if sources are found
    
    return TaskSuggestion(
        suggestion_text=None,
        evidence_recommendation=None,
        sources=[],
    )


@router.get("/ai/goal-insight", response_model=GoalInsight)
async def get_goal_insight(
    participant_id: UUID = Query(...),
    goal_id: UUID = Query(...),
    lookback_days: int = Query(30),
    current_user: dict = Depends(get_current_user),
):
    """
    Get completion-rate insight for goal calibration.
    
    Returns:
    - completion_rate: X of Y tasks completed (0.0 to 1.0)
    - date_range: what window this is based on
    
    Helps coordinator set realistic targets rather than guessing.
    """
    # Placeholder for goal-linked task completion analysis
    return GoalInsight(
        completion_rate=0.0,
        completed_count=0,
        total_count=0,
        lookback_days=lookback_days,
        date_range_start="2026-06-01T00:00:00Z",
        date_range_end="2026-06-30T23:59:59Z",
    )
