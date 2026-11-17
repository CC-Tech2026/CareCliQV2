"""Regular schedules (shift series) for coordinators and managing directors.

GET    /coordinator/shift-series               the organisation's (or a participant's)
POST   /coordinator/shift-series               start one; makes the coming weeks' shifts
PATCH  /coordinator/shift-series/{id}          change it from a date
POST   /coordinator/shift-series/{id}/end      stop it from a date
"""

from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..core.access import get_user_id
from ..core.security import get_current_user
from ..services import shift_series_service as series_service
from ..services.supabase_client import get_supabase_admin
from .coordinator import _require_coordinator, _require_org_read

router = APIRouter(prefix="/coordinator/shift-series", tags=["coordinator"])


class SeriesBody(BaseModel):
    participant_id: str
    days_of_week: list[int] = Field(min_length=1)  # 0 = Monday ... 6 = Sunday
    start_time: str  # "HH:MM", the participant's branch
    end_time: str
    start_date: date
    end_date: Optional[date] = None  # None: ongoing
    interval_weeks: int = Field(default=1, ge=1, le=4)
    worker_id: Optional[str] = None  # None: open shifts
    shift_type: str = "standard_support"
    expected_price_item_code: Optional[str] = None
    service_agreement_support_id: Optional[str] = None
    selected_task_ids: Optional[list[str]] = None


class SeriesChangeBody(BaseModel):
    from_date: date
    days_of_week: Optional[list[int]] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    interval_weeks: Optional[int] = Field(default=None, ge=1, le=4)
    # Sent as null to make the shifts open; left out to keep the worker.
    worker_id: Optional[str] = None
    end_date: Optional[date] = None
    shift_type: Optional[str] = None


class SeriesEndBody(BaseModel):
    from_date: date


def _fail(exc: series_service.SeriesError):
    status = 404 if "not found" in str(exc).lower() else 422
    raise HTTPException(status_code=status, detail=str(exc)) from exc


@router.get("")
async def list_series(
    participant_id: Optional[str] = Query(default=None),
    include_ended: bool = Query(default=False),
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_org_read(current_user)
    return series_service.list_series(
        get_supabase_admin(), org_id, participant_id=participant_id, include_ended=include_ended,
    )


@router.post("", status_code=201)
async def create_series(body: SeriesBody, current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    try:
        return await series_service.create_series(
            get_supabase_admin(), org_id, get_user_id(current_user), body.model_dump(mode="json"),
        )
    except series_service.SeriesError as exc:
        _fail(exc)


@router.patch("/{series_id}")
async def change_series(series_id: str, body: SeriesChangeBody, current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    # Only what was sent changes; worker_id sent as null means "open shifts".
    changes = body.model_dump(mode="json", exclude_unset=True)
    changes.pop("from_date", None)
    try:
        return await series_service.change_series(
            get_supabase_admin(), org_id, series_id, body.from_date, changes, user_id=get_user_id(current_user),
        )
    except series_service.SeriesError as exc:
        _fail(exc)


@router.post("/{series_id}/end")
async def end_series(series_id: str, body: SeriesEndBody, current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    try:
        return await series_service.end_series(get_supabase_admin(), org_id, series_id, body.from_date)
    except series_service.SeriesError as exc:
        _fail(exc)
