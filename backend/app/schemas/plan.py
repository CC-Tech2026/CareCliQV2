from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import date


class PlanCreate(BaseModel):
    patient_id: Optional[str] = None  # Also accept participant_id for compatibility
    participant_id: Optional[str] = None
    plan_number: Optional[str] = None
    plan_start: Optional[date | str] = None
    plan_end: Optional[date | str] = None
    start_date: Optional[date | str] = None  # Legacy field name
    end_date: Optional[date | str] = None    # Legacy field name
    total_funding: Optional[float] = None
    total_budget: Optional[float] = None  # Legacy field name
    used_budget: Optional[float] = 0.0
    status: Optional[str] = "active"
    support_categories: Optional[List[dict]] = None
    goals: Optional[List[str]] = None

    @field_validator("plan_start", mode="before")
    @classmethod
    def _parse_plan_start(cls, v):
        if v is None:
            return None
        if isinstance(v, date):
            return v
        if isinstance(v, str):
            return date.fromisoformat(v.strip())
        raise ValueError("plan_start must be a date or ISO date string")

    @field_validator("plan_end", mode="before")
    @classmethod
    def _parse_plan_end(cls, v):
        if v is None:
            return None
        if isinstance(v, date):
            return v
        if isinstance(v, str):
            return date.fromisoformat(v.strip())
        raise ValueError("plan_end must be a date or ISO date string")


class PlanUpdate(BaseModel):
    plan_start: Optional[date | str] = None
    plan_end: Optional[date | str] = None
    start_date: Optional[date | str] = None
    end_date: Optional[date | str] = None
    total_funding: Optional[float] = None
    total_budget: Optional[float] = None
    used_budget: Optional[float] = None
    status: Optional[str] = None
    support_categories: Optional[List[dict]] = None
    goals: Optional[List[str]] = None

    @field_validator("plan_start", mode="before")
    @classmethod
    def _parse_plan_start(cls, v):
        if v is None:
            return None
        if isinstance(v, date):
            return v
        if isinstance(v, str):
            return date.fromisoformat(v.strip())
        raise ValueError("plan_start must be a date or ISO date string")

    @field_validator("plan_end", mode="before")
    @classmethod
    def _parse_plan_end(cls, v):
        if v is None:
            return None
        if isinstance(v, date):
            return v
        if isinstance(v, str):
            return date.fromisoformat(v.strip())
        raise ValueError("plan_end must be a date or ISO date string")
