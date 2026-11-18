"""Xero Payroll: approved hours to Xero as draft timesheets. See
services/xero_payroll_service.py. Directors set it up on the Xero page;
coordinators and directors send a pay period from the Payroll page."""

from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..core.security import get_current_user
from ..services import payroll_export_service, xero_service
from ..services import xero_payroll_service as svc

router = APIRouter(prefix="/integrations/xero/payroll", tags=["integrations"])


class PayrollSettings(BaseModel):
    enabled: Optional[bool] = None
    rates: Optional[dict[str, Optional[str]]] = None
    rate_names: Optional[dict[str, Optional[str]]] = None
    breaks_unpaid: Optional[bool] = None


class EmployeeLink(BaseModel):
    worker_id: str = Field(min_length=1, max_length=64)
    employee_id: Optional[str] = Field(default=None, max_length=64)


@router.get("")
async def payroll_status(current_user: dict = Depends(get_current_user)):
    return svc.get_status(current_user)


@router.post("/connect")
async def payroll_connect(current_user: dict = Depends(get_current_user)):
    """Sign in to Xero again, this time allowing payroll."""
    return xero_service.create_connect_url(current_user, payroll=True)


@router.get("/options")
async def payroll_options(current_user: dict = Depends(get_current_user)):
    return await svc.get_options(current_user)


@router.put("/settings")
async def payroll_settings(body: PayrollSettings, current_user: dict = Depends(get_current_user)):
    return svc.update_settings(current_user, body.model_dump(exclude_none=True))


@router.post("/employees")
async def payroll_link_employee(body: EmployeeLink, current_user: dict = Depends(get_current_user)):
    return svc.link_employee(current_user, body.worker_id, body.employee_id)


@router.post("/send")
async def payroll_send(
    start: date = Query(...),
    end: date = Query(...),
    current_user: dict = Depends(get_current_user),
):
    try:
        return await svc.send_period(current_user, start, end)
    except payroll_export_service.PeriodError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except xero_service.XeroError as exc:  # the connection lapsed mid-send
        raise HTTPException(status_code=502, detail=str(exc)) from exc
