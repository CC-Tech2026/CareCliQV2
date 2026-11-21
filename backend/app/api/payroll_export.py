"""Timesheets for payroll: a pay period's approved shifts, on screen and as a
download (Excel, or CSV for payroll software). See
services/payroll_export_service.py. Coordinators and managing directors, who
approve the timesheets."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

from ..core.access import get_user_id, get_user_organization_id, has_org_wide_access
from ..core.security import get_current_user
from ..services import audit_service
from ..services import payroll_export_service as svc

router = APIRouter(prefix="/payroll", tags=["payroll"])

XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _org(user: dict) -> str:
    if not has_org_wide_access(user):
        raise HTTPException(status_code=403, detail="Coordinator or managing director access required.")
    org_id = get_user_organization_id(user)
    if not org_id:
        raise HTTPException(status_code=403, detail="Organisation membership required.")
    return str(org_id)


def _period(org_id: str, start: date, end: date) -> dict:
    try:
        return svc.period(org_id, start, end)
    except svc.PeriodError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


async def _download(user: dict, start: date, end: date, kind: str) -> Response:
    org_id = _org(user)
    data = _period(org_id, start, end)
    try:
        await audit_service.log_action(
            action_type="payroll.timesheets_exported",
            entity_type="organization",
            entity_id=org_id,
            user_id=str(get_user_id(user)),
            organization_id=org_id,
            details={"start": start.isoformat(), "end": end.isoformat(), "shifts": data["totals"]["shifts"], "format": kind},
        )
    except Exception:  # an audit hiccup never blocks the download
        pass
    name = f"carecliq-hours-{start.isoformat()}-to-{end.isoformat()}.{kind}"
    headers = {"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"}
    if kind == "xlsx":
        return Response(content=svc.to_xlsx(data), media_type=XLSX_TYPE, headers=headers)
    # The BOM makes Excel read names with accents correctly.
    return Response(content="﻿" + svc.to_csv(data), media_type="text/csv; charset=utf-8", headers=headers)


@router.get("/timesheets")
async def payroll_timesheets(
    start: date = Query(...),
    end: date = Query(...),
    current_user: dict = Depends(get_current_user),
):
    return _period(_org(current_user), start, end)


@router.get("/timesheets.xlsx")
async def payroll_timesheets_xlsx(
    start: date = Query(...),
    end: date = Query(...),
    current_user: dict = Depends(get_current_user),
):
    return await _download(current_user, start, end, "xlsx")


@router.get("/timesheets.csv")
async def payroll_timesheets_csv(
    start: date = Query(...),
    end: date = Query(...),
    current_user: dict = Depends(get_current_user),
):
    return await _download(current_user, start, end, "csv")


class TravelPaidBody(BaseModel):
    start: date
    end: date


@router.post("/travel/mark-paid")
async def payroll_travel_mark_paid(body: TravelPaidBody, current_user: dict = Depends(get_current_user)):
    """The pay run is done: the approved travel on this period's approved
    shifts was paid with wages (from the export)."""
    from ..services import travel_pay_service

    org_id = _org(current_user)
    data = _period(org_id, body.start, body.end)
    count = travel_pay_service.mark_paid(org_id, travel_pay_service.claims_in(data["shifts"]), "payroll_export",
                                         f"Pay period {body.start.isoformat()} to {body.end.isoformat()}")
    try:
        await audit_service.log_action(
            action_type="payroll.travel_marked_paid", entity_type="organization", entity_id=org_id,
            user_id=str(get_user_id(current_user)), organization_id=org_id,
            details={"start": body.start.isoformat(), "end": body.end.isoformat(), "claims": count},
        )
    except Exception:
        pass
    return {"marked_paid": count}
