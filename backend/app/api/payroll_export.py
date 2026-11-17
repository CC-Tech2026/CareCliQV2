"""Timesheets for payroll: a pay period's approved shifts, on screen and as a
CSV for any payroll system. See services/payroll_export_service.py.
Coordinators and managing directors, who approve the timesheets."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from ..core.access import get_user_id, get_user_organization_id, has_org_wide_access
from ..core.security import get_current_user
from ..services import audit_service
from ..services import payroll_export_service as svc

router = APIRouter(prefix="/payroll", tags=["payroll"])


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


@router.get("/timesheets")
async def payroll_timesheets(
    start: date = Query(...),
    end: date = Query(...),
    current_user: dict = Depends(get_current_user),
):
    return _period(_org(current_user), start, end)


@router.get("/timesheets.csv")
async def payroll_timesheets_csv(
    start: date = Query(...),
    end: date = Query(...),
    current_user: dict = Depends(get_current_user),
):
    org_id = _org(current_user)
    data = _period(org_id, start, end)
    try:
        await audit_service.log_action(
            action_type="payroll.timesheets_exported",
            entity_type="organization",
            entity_id=org_id,
            user_id=str(get_user_id(current_user)),
            organization_id=org_id,
            details={"start": start.isoformat(), "end": end.isoformat(), "shifts": data["totals"]["shifts"]},
        )
    except Exception:  # an audit hiccup never blocks the download
        pass
    filename = f"carecliq-timesheets-{start.isoformat()}-to-{end.isoformat()}.csv"
    return Response(
        content="﻿" + svc.to_csv(data),  # the BOM makes Excel read names with accents correctly
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )
