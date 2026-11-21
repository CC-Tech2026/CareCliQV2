"""Employment Hero Payroll: approved timesheets out. See
services/employment_hero_service.py. Managing directors connect and manage it;
timesheets go by themselves when coordinators approve them."""

from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..core.security import get_current_user
from ..services import employment_hero_service as eh

router = APIRouter(prefix="/integrations/employment-hero", tags=["integrations"])


class CallbackBody(BaseModel):
    code: str = Field(min_length=1, max_length=2000)
    state: str = Field(min_length=1, max_length=200)


class BusinessBody(BaseModel):
    business_id: int


class SettingsBody(BaseModel):
    auto_send: Optional[bool] = None
    send_approved: Optional[bool] = None
    send_from: Optional[date] = None
    sleepover_work_type_id: Optional[int] = None
    sleepover_work_type_name: Optional[str] = Field(default=None, max_length=200)
    # Expense categories approved travel is paid under (null clears).
    travel_km_category_id: Optional[int] = None
    travel_km_category_name: Optional[str] = Field(default=None, max_length=200)
    travel_fares_category_id: Optional[int] = None
    travel_fares_category_name: Optional[str] = Field(default=None, max_length=200)


class EmployeeBody(BaseModel):
    employee_id: int
    employee_name: Optional[str] = Field(default=None, max_length=200)


@router.get("")
async def status(current_user: dict = Depends(get_current_user)):
    """Whether Employment Hero is available and connected, and how sending is going."""
    return eh.get_status(current_user)


@router.post("/connect")
async def connect(current_user: dict = Depends(get_current_user)):
    """The Employment Hero sign-in address to send the director to."""
    return eh.create_connect_url(current_user)


@router.post("/callback")
async def callback(body: CallbackBody, current_user: dict = Depends(get_current_user)):
    """Back from signing in: finish connecting."""
    return await eh.complete_connection(current_user, body.code, body.state)


@router.put("/business")
async def business(body: BusinessBody, current_user: dict = Depends(get_current_user)):
    """Which payroll business is this organisation's (when the login sees several)."""
    return await eh.choose_business(current_user, body.business_id)


@router.delete("")
async def disconnect(current_user: dict = Depends(get_current_user)):
    return await eh.disconnect(current_user)


@router.put("/settings")
async def save_settings(body: SettingsBody, current_user: dict = Depends(get_current_user)):
    data = body.model_dump(exclude_unset=True)
    if data.get("send_from"):
        data["send_from"] = data["send_from"].isoformat()
    return eh.update_settings(current_user, data)


@router.get("/options")
async def options(current_user: dict = Depends(get_current_user)):
    """Work types and employees in the payroll business, to choose from."""
    return await eh.list_options(current_user)


@router.put("/workers/{worker_id}")
async def choose_employee(worker_id: str, body: EmployeeBody, current_user: dict = Depends(get_current_user)):
    """Who this worker is in Employment Hero, when it couldn't be worked out."""
    return await eh.choose_employee(current_user, worker_id, body.employee_id, body.employee_name)


@router.post("/sync")
async def sync(current_user: dict = Depends(get_current_user)):
    """Send waiting timesheets now."""
    return await eh.sync_now(current_user)


@router.post("/shifts/{shift_id}")
async def send_shift(shift_id: str, current_user: dict = Depends(get_current_user)):
    """Send one approved shift now, including one worked before the send-from date."""
    return await eh.send_shift_for_user(current_user, shift_id)
