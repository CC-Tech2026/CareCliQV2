"""Pydantic schemas for participant (patient) endpoints."""

from __future__ import annotations

from typing import Annotated, List, Literal, Optional
from datetime import date

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Allowed literals — single source of truth referenced by validators
# ---------------------------------------------------------------------------

GoalStatus   = Literal["active", "archived"]
GoalCategory = Literal["core", "capacity_building", "capital", "general"]
BiologicalSex = Literal["male", "female", "unspecified"]

# Constrained int type for 0-100 percentage values
Percentage = Annotated[int, Field(ge=0, le=100)]


# ---------------------------------------------------------------------------
# NDIS Goal sub-models
# ---------------------------------------------------------------------------

class NDISGoalProgressEntry(BaseModel):
    """A single dated progress snapshot for an NDIS goal."""

    date: str       = Field(..., description="ISO-8601 date string, e.g. '2025-05-15'")
    percentage: Percentage
    note: Optional[str] = None

    @field_validator("date")
    @classmethod
    def _date_is_iso(cls, v: str) -> str:
        # Light sanity check — must look like YYYY-MM-DD
        if len(v) != 10 or v[4] != "-" or v[7] != "-":
            raise ValueError("date must be an ISO-8601 date string (YYYY-MM-DD)")
        return v


class NDISGoal(BaseModel):
    """An NDIS-funded support goal linked to a participant."""

    id: str
    title: str
    status: GoalStatus = "active"
    category: Optional[GoalCategory] = "general"
    progress_percentage: Optional[Percentage] = 0
    target_date: Optional[str] = None          # ISO-8601 date string or None
    progress_history: Optional[List[NDISGoalProgressEntry]] = Field(default_factory=list)

    @field_validator("target_date")
    @classmethod
    def _target_date_is_iso_or_none(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        if len(v) != 10 or v[4] != "-" or v[7] != "-":
            raise ValueError("target_date must be an ISO-8601 date string (YYYY-MM-DD) or null")
        return v


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class GoalsUpdateBody(BaseModel):
    goals: List[NDISGoal]


class ParticipantCreate(BaseModel):
    full_name: str
    ndis_number: str
    date_of_birth: date
    email: Optional[str] = None
    phone: Optional[str] = None
    plan_status: str = "active"
    plan_start_date: Optional[date] = None
    plan_end_date: Optional[date] = None
    total_budget: Optional[float] = 0.0
    used_budget: Optional[float] = 0.0
    primary_disability: Optional[str] = None
    allergies: Optional[str] = None
    communication_preferences: Optional[str] = None
    biological_sex: Optional[BiologicalSex] = "unspecified"
    goals: Optional[List[NDISGoal]] = Field(default_factory=list)


class ParticipantUpdate(BaseModel):
    """All fields optional — used for both PATCH (partial) and PUT (full replace)."""

    full_name: Optional[str] = None
    date_of_birth: Optional[date] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    plan_status: Optional[str] = None
    plan_start_date: Optional[date] = None
    plan_end_date: Optional[date] = None
    total_budget: Optional[float] = None
    used_budget: Optional[float] = None
    primary_disability: Optional[str] = None
    allergies: Optional[str] = None
    communication_preferences: Optional[str] = None
    biological_sex: Optional[BiologicalSex] = None
    goals: Optional[List[NDISGoal]] = None


# ---------------------------------------------------------------------------
# NDIS Plan
# ---------------------------------------------------------------------------

class NDISPlanCreate(BaseModel):
    plan_number: Optional[str] = None
    plan_start: date
    plan_end: date
    total_funding: float = 0.0
    status: Optional[str] = None          # auto-derived from dates if not supplied
    core_budget: Optional[float] = None
    capacity_budget: Optional[float] = None
    capital_budget: Optional[float] = None

    @field_validator("plan_end")
    @classmethod
    def _end_after_start(cls, v: date, info) -> date:
        start = (info.data or {}).get("plan_start")
        if start and v <= start:
            raise ValueError("plan_end must be after plan_start")
        return v


RiskLevel = Literal["low", "medium", "high"]


# ---------------------------------------------------------------------------
# Patient Goals (plan-linked, replaces JSONB goals on patients table)
# ---------------------------------------------------------------------------

GoalCategory2 = Literal["core", "capacity_building", "capital", "general"]


class PatientGoalCreate(BaseModel):
    description: str = Field(..., min_length=1)
    category: GoalCategory2 = "general"
    goal_code: Optional[str] = None
    target_date: Optional[date] = None


class PatientGoalUpdate(BaseModel):
    description: Optional[str] = None
    category: Optional[GoalCategory2] = None
    goal_code: Optional[str] = None
    target_date: Optional[date] = None
    is_achieved: Optional[bool] = None


# ---------------------------------------------------------------------------
# Practitioner Allocations
# ---------------------------------------------------------------------------

AllocatedRole = Literal["primary_ot", "support_worker", "supervisor"]


class PractitionerAllocationCreate(BaseModel):
    user_id: str
    allocated_role: AllocatedRole = "support_worker"
