from pydantic import BaseModel, field_validator
from typing import Optional, List, Literal
from datetime import date

VALID_BIOLOGICAL_SEX = ("male", "female", "unspecified")

VALID_GOAL_CATEGORIES = ("core", "capacity_building", "capital", "general")


class NDISGoalProgressEntry(BaseModel):
    date: str           # ISO date string e.g. "2025-05-15"
    percentage: int     # 0-100
    note: Optional[str] = None


class NDISGoal(BaseModel):
    id: str
    title: str
    status: str = "active"
    category: Optional[str] = "general"       # core | capacity_building | capital | general
    progress_percentage: Optional[int] = 0    # 0-100
    target_date: Optional[str] = None         # ISO date string
    progress_history: Optional[List[NDISGoalProgressEntry]] = []


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
    biological_sex: Optional[Literal["male", "female", "unspecified"]] = "unspecified"
    goals: Optional[List[NDISGoal]] = []


class ParticipantUpdate(BaseModel):
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
    biological_sex: Optional[Literal["male", "female", "unspecified"]] = None
    goals: Optional[List[NDISGoal]] = None


class NDISPlanCreate(BaseModel):
    plan_number: Optional[str] = None
    plan_start: date
    plan_end: date
    total_funding: float = 0.0
    status: str = "active"
    core_budget: Optional[float] = None
    capacity_budget: Optional[float] = None
    capital_budget: Optional[float] = None
