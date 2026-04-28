from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime


class Plan(BaseModel):
    id: Optional[str] = None
    participant_id: str
    plan_number: Optional[str] = None
    start_date: date
    end_date: date
    total_budget: float
    used_budget: float = 0.0
    status: str = "active"
    support_categories: Optional[list] = []
    goals: Optional[list] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
