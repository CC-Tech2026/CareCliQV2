from pydantic import BaseModel
from typing import Optional, List
from datetime import date


class PlanCreate(BaseModel):
    participant_id: str
    plan_number: Optional[str] = None
    start_date: date
    end_date: date
    total_budget: float
    used_budget: float = 0.0
    status: str = "active"
    support_categories: Optional[List[dict]] = []
    goals: Optional[List[str]] = []


class PlanUpdate(BaseModel):
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    total_budget: Optional[float] = None
    used_budget: Optional[float] = None
    status: Optional[str] = None
    support_categories: Optional[List[dict]] = None
    goals: Optional[List[str]] = None
