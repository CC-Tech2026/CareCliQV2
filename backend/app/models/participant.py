from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime


class Participant(BaseModel):
    id: Optional[str] = None
    full_name: str
    ndis_number: str
    date_of_birth: Optional[date] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    plan_status: str = "active"
    plan_start_date: Optional[date] = None
    plan_end_date: Optional[date] = None
    total_budget: Optional[float] = None
    primary_disability: Optional[str] = None
    allergies: Optional[str] = None
    communication_preferences: Optional[str] = None
    goals: Optional[list] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
