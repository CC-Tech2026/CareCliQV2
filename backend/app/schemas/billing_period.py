"""Pydantic schemas for billing period endpoints (CARECLIQV2-326)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

from ..models.billing_period import PlanManagementType


class BillingPeriodOut(BaseModel):
    id: str
    organization_id: str
    participant_id: str
    period_start: date
    period_end: date
    locked_plan_management_type: PlanManagementType
    status: Literal["open", "closed"]
    locked_at: datetime
    created_at: Optional[datetime] = None


class BillingPeriodCurrentOut(BaseModel):
    current_plan_management_type: Optional[PlanManagementType] = None
    open_period: Optional[BillingPeriodOut] = None
    type_differs_from_lock: bool = False
    message: Optional[str] = None


class BillingPeriodListOut(BaseModel):
    items: list[BillingPeriodOut] = Field(default_factory=list)
