"""Task management models — Pydantic schemas for task templates and instances."""

from datetime import time, datetime
from typing import Optional
from enum import Enum
from uuid import UUID
from pydantic import BaseModel, field_validator


class TaskCategory(str, Enum):
    PERSONAL_CARE = "personal_care"
    MEDICATION = "medication"
    DOMESTIC_ASSISTANCE = "domestic_assistance"
    COMMUNITY_ACCESS = "community_access"
    TRANSPORT = "transport"
    OTHER = "other"


class TaskPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ShiftType(str, Enum):
    MORNING = "morning"
    AFTERNOON = "afternoon"
    NIGHT = "night"
    ANYTIME = "anytime"


class RecurrenceType(str, Enum):
    ONE_OFF = "one_off"
    RECURRING = "recurring"


class RecurrenceFrequency(str, Enum):
    EVERY_MATCHING_SHIFT = "every_matching_shift"
    DAILY_REGARDLESS_OF_SHIFT = "daily_regardless_of_shift"
    SPECIFIC_WEEKDAYS = "specific_weekdays"


class RequirementLevel(str, Enum):
    MANDATORY = "mandatory"
    OPTIONAL = "optional"


class EvidenceRequired(str, Enum):
    NONE = "none"
    PHOTO = "photo"
    NOTES = "notes"
    PHOTO_AND_NOTES = "photo_and_notes"


class TaskTemplateStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    ARCHIVED = "archived"


class TaskInstanceStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    MISSED = "missed"
    CARRIED_OVER = "carried_over"


# ──────────────────────────────────────────────────────────────────────
# Task Template Models
# ──────────────────────────────────────────────────────────────────────

class TaskTemplateCreate(BaseModel):
    """Create a new task template."""
    
    participant_id: UUID
    title: str
    category: TaskCategory
    priority: TaskPriority = TaskPriority.MEDIUM
    
    # Shift binding — primary_shift_type is always required
    primary_shift_type: ShiftType

    # Recurrence (must precede additional_shift_types — validators read recurrence_type)
    recurrence_type: RecurrenceType = RecurrenceType.ONE_OFF
    recurrence_frequency: Optional[RecurrenceFrequency] = None
    recurrence_weekdays: Optional[list[int]] = None  # 0=Sunday, ..., 6=Saturday

    additional_shift_types: list[ShiftType] = []
    
    # Time windows
    due_window_start: Optional[time] = None
    due_window_end: Optional[time] = None
    
    # Assignment
    assigned_worker_id: Optional[UUID] = None
    linked_goal_id: Optional[UUID] = None
    
    # Configuration
    notes: Optional[str] = None
    requirement_level: RequirementLevel = RequirementLevel.MANDATORY
    evidence_required: EvidenceRequired = EvidenceRequired.NONE
    
    @field_validator("primary_shift_type", mode="before")
    @classmethod
    def primary_shift_required(cls, v):
        """Ensure primary_shift_type is always provided."""
        if v is None:
            raise ValueError("primary_shift_type is required — cannot default")
        return v
    
    @field_validator("recurrence_frequency")
    @classmethod
    def recurrence_frequency_required_if_recurring(cls, v, info):
        """If recurrence_type is recurring, frequency must be set."""
        if info.data.get("recurrence_type") == RecurrenceType.RECURRING and v is None:
            raise ValueError("recurrence_frequency required when recurrence_type is recurring")
        return v
    
    @field_validator("additional_shift_types")
    @classmethod
    def additional_only_if_recurring(cls, v, info):
        """additional_shift_types can only be set if recurrence_type is recurring."""
        if v and info.data.get("recurrence_type") == RecurrenceType.ONE_OFF:
            raise ValueError("additional_shift_types only allowed for recurring tasks")
        return v
    
    @field_validator("due_window_end")
    @classmethod
    def due_window_end_after_start(cls, v, info):
        """due_window_end must be after due_window_start if both set."""
        if v and info.data.get("due_window_start") and v <= info.data["due_window_start"]:
            raise ValueError("due_window_end must be after due_window_start")
        return v
    
    @field_validator("additional_shift_types")
    @classmethod
    def no_anytime_with_additional(cls, v, info):
        """Can't have primary_shift_type=anytime and also additional_shift_types."""
        if v and info.data.get("primary_shift_type") == ShiftType.ANYTIME:
            raise ValueError("anytime tasks cannot have additional_shift_types")
        return v


class TaskTemplateUpdate(BaseModel):
    """Update an existing task template."""
    
    title: Optional[str] = None
    category: Optional[TaskCategory] = None
    priority: Optional[TaskPriority] = None
    notes: Optional[str] = None
    requirement_level: Optional[RequirementLevel] = None
    evidence_required: Optional[EvidenceRequired] = None
    assigned_worker_id: Optional[UUID] = None
    linked_goal_id: Optional[UUID] = None
    due_window_start: Optional[time] = None
    due_window_end: Optional[time] = None
    status: Optional[TaskTemplateStatus] = None
    
    @field_validator("due_window_end")
    @classmethod
    def due_window_end_after_start(cls, v, info):
        """due_window_end must be after due_window_start if both set."""
        if v and info.data.get("due_window_start") and v <= info.data["due_window_start"]:
            raise ValueError("due_window_end must be after due_window_start")
        return v


class TaskTemplate(TaskTemplateCreate):
    """Full task template with database fields."""
    
    id: UUID
    status: TaskTemplateStatus = TaskTemplateStatus.ACTIVE
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


# ──────────────────────────────────────────────────────────────────────
# Task Instance Models
# ──────────────────────────────────────────────────────────────────────

class TaskInstanceCreate(BaseModel):
    """Create a task instance (normally done via generation logic, but also via direct API)."""
    
    task_template_id: Optional[UUID] = None
    shift_id: UUID
    participant_id: UUID
    due_window_start: Optional[time] = None
    due_window_end: Optional[time] = None
    carried_over_from_instance_id: Optional[UUID] = None


class TaskInstanceComplete(BaseModel):
    """Mark a task instance as completed with evidence."""
    
    completed_by: UUID  # worker_id
    completion_notes: Optional[str] = None
    evidence_photo_url: Optional[str] = None
    evidence_notes: Optional[str] = None


class TaskInstanceReassign(BaseModel):
    """Reassign a task instance to a different worker."""
    
    assigned_worker_id: Optional[UUID] = None


class TaskInstance(BaseModel):
    """Full task instance with database fields."""
    
    id: UUID
    task_template_id: Optional[UUID] = None
    shift_id: UUID
    participant_id: UUID
    status: TaskInstanceStatus = TaskInstanceStatus.PENDING
    due_window_start: Optional[time] = None
    due_window_end: Optional[time] = None
    completed_by: Optional[UUID] = None
    completed_at: Optional[datetime] = None
    evidence_photo_url: Optional[str] = None
    evidence_notes: Optional[str] = None
    completion_notes: Optional[str] = None
    carried_over_from_instance_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


# ──────────────────────────────────────────────────────────────────────
# Response Models
# ──────────────────────────────────────────────────────────────────────

class TaskSuggestion(BaseModel):
    """AI-assisted task suggestion (scoped, RAG-grounded)."""
    
    suggestion_text: Optional[str] = None
    evidence_recommendation: Optional[EvidenceRequired] = None
    sources: list[dict] = []  # [{type, id, shift_date, shift_type, snippet}, ...]


class GoalInsight(BaseModel):
    """Completion-rate insight for goal calibration."""
    
    completion_rate: float  # 0.0 to 1.0
    completed_count: int
    total_count: int
    lookback_days: int
    date_range_start: datetime
    date_range_end: datetime
