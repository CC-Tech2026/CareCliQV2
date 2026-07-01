"""Task management API — endpoints for task templates and instances."""

import logging
from fastapi import APIRouter, Depends, HTTPException, status, Query
from uuid import UUID
from typing import Optional
from datetime import datetime, timedelta

from ..core.access import get_user_id, get_user_organization_id
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
from ..services.task_ai_service import (
    suggest_task_description,
    suggest_task_metadata,
    suggest_goal_description,
    suggest_goal_insight_recommendation,
    suggest_goal_full_suggestions,
    suggest_task_full_suggestions,
)
from ..services.supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

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
    Get AI-assisted task suggestion based on participant history.
    
    Uses RAG to retrieve relevant past tasks/sessions, then calls GPT-4o-mini
    to generate:
    - Task description suggestions
    - Evidence recommendations
    - Priority suggestions
    
    Returns null values if no history found or AI unavailable.
    """
    org_id = get_user_organization_id(current_user)
    
    try:
        task_description, task_sources = await suggest_task_description(
            participant_id=str(participant_id),
            shift_type=shift_type,
            category=category,
            organisation_id=org_id,
            lookback_days=lookback_days,
        )

        metadata = await suggest_task_metadata(
            participant_id=str(participant_id),
            shift_type=shift_type,
            category=category,
            organisation_id=org_id,
        )

        return TaskSuggestion(
            suggestion_text=task_description,
            evidence_recommendation=metadata.get("evidence_required"),
            sources=task_sources,
        )

    except Exception as e:
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
    Get completion-rate insight and AI recommendations for goal calibration.
    
    Returns:
    - completion_rate: X of Y goal-linked tasks completed (0.0 to 1.0)
    - completed_count: Number of completed tasks
    - total_count: Total tasks linked to goal
    - date_range: Window analyzed
    - ai_recommendation: AI-generated recommendation based on completion patterns
    
    Helps coordinator set realistic targets and understand achievement patterns.
    """
    org_id = get_user_organization_id(current_user)
    supabase = get_supabase_admin()
    
    try:
        # Calculate date range
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=lookback_days)
        
        goal = await supabase.table("ndis_goals").select("name,description").eq(
            "id", str(goal_id)
        ).single().execute()

        goal_title = (goal.data or {}).get("name") or "Goal"

        instances = await supabase.table("task_instances").select(
            "id,status,created_at"
        ).eq("participant_id", str(participant_id)).eq(
            "linked_goal_id", str(goal_id)
        ).gte("created_at", start_date.isoformat()).lte(
            "created_at", end_date.isoformat()
        ).execute()

        if not instances.data:
            return GoalInsight(
                completion_rate=0.0,
                completed_count=0,
                total_count=0,
                lookback_days=lookback_days,
                date_range_start=start_date.isoformat(),
                date_range_end=end_date.isoformat(),
                ai_recommendation="No tasks completed yet for this goal.",
            )

        completed = sum(1 for inst in instances.data if inst.get("status") == "completed")
        total = len(instances.data)
        completion_rate = completed / total if total > 0 else 0.0

        ai_rec = await suggest_goal_insight_recommendation(
            participant_id=str(participant_id),
            goal_title=goal_title,
            completion_rate=completion_rate,
            completed=completed,
            total=total,
            organisation_id=org_id,
        )

        return GoalInsight(
            completion_rate=completion_rate,
            completed_count=completed,
            total_count=total,
            lookback_days=lookback_days,
            date_range_start=start_date.isoformat(),
            date_range_end=end_date.isoformat(),
            ai_recommendation=ai_rec,
        )
        
    except Exception as e:
        logger.error(f"Goal insight calculation failed: {e}")
        return GoalInsight(
            completion_rate=0.0,
            completed_count=0,
            total_count=0,
            lookback_days=lookback_days,
            date_range_start=(datetime.utcnow() - timedelta(days=lookback_days)).isoformat(),
            date_range_end=datetime.utcnow().isoformat(),
            ai_recommendation="Unable to calculate insights.",
        )


@router.post("/ai/task-title-suggestion")
async def get_task_title_suggestion(
    participant_id: UUID = Query(...),
    shift_type: str = Query(...),
    category: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    """
    Get AI-suggested task titles based on participant history.
    
    Quick endpoint for generating task title ideas to speed up task creation
    from 5 steps to 3 (select shift type → get title suggestion → add details).
    
    Returns:
    - suggestion: Suggested task title/description
    """
    org_id = get_user_organization_id(current_user)
    
    try:
        suggestion, _ = await suggest_task_description(
            participant_id=str(participant_id),
            shift_type=shift_type,
            category=category,
            organisation_id=org_id,
        )
        return {
            "suggestion": suggestion,
            "category": category,
            "shift_type": shift_type,
        }
    except Exception as e:
        logger.error(f"Task title suggestion failed: {e}")
        return {
            "suggestion": None,
            "category": category,
            "shift_type": shift_type,
        }


@router.post("/ai/goal-description-suggestion")
async def get_goal_description_suggestion(
    participant_id: UUID = Query(...),
    goal_title: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    """
    Get AI-suggested goal descriptions based on participant history.
    
    Helps coordinators create goals faster by pre-filling descriptions with
    NDIS-compliant language based on participant's past goals and progress.
    
    Returns:
    - suggestion: Suggested goal description
    """
    org_id = get_user_organization_id(current_user)
    
    try:
        suggestion, _ = await suggest_goal_description(
            participant_id=str(participant_id),
            goal_title=goal_title,
            organisation_id=org_id,
        )
        return {
            "suggestion": suggestion,
            "goal_title": goal_title,
        }
    except Exception as e:
        logger.error(f"Goal description suggestion failed: {e}")
        return {
            "suggestion": None,
            "goal_title": goal_title,
        }


@router.post("/ai/goal-full-suggestions")
async def get_goal_full_suggestions(
    participant_id: UUID = Query(...),
    goal_area: str = Query(default="daily_living"),
    current_title: str = Query(default=""),
    current_user: dict = Depends(get_current_user),
):
    """
    Get multiple AI suggestions for goal name, description, and success criteria.
    Returns up to 3 options for each field, grounded in participant history when available.
    """
    org_id = get_user_organization_id(current_user)
    try:
        result = await suggest_goal_full_suggestions(
            participant_id=str(participant_id),
            goal_area=goal_area,
            organisation_id=org_id,
            current_title=current_title,
        )
        return result
    except Exception as e:
        logger.error(f"Goal full suggestions error: {e}")
        return {"names": [], "descriptions": [], "success_criteria": []}


@router.post("/ai/task-full-suggestions")
async def get_task_full_suggestions(
    participant_id: UUID = Query(...),
    task_purpose: str = Query(default="core"),
    goal_name: str = Query(default=""),
    goal_description: str = Query(default=""),
    current_user: dict = Depends(get_current_user),
):
    """
    Get multiple AI suggestions for task name, worker instructions, category and priority.
    When linked to a goal, grounded in that goal context + participant history.
    """
    org_id = get_user_organization_id(current_user)
    try:
        result = await suggest_task_full_suggestions(
            participant_id=str(participant_id),
            task_purpose=task_purpose,
            organisation_id=org_id,
            goal_name=goal_name,
            goal_description=goal_description[:500] if goal_description else "",
        )
        return result
    except Exception as e:
        logger.error(f"Task full suggestions error: {e}")
        return {"names": [], "instructions": [], "category": None, "priority": None}
