"""Worker scheduling APIs — CARECLIQV2-281/283/284."""

from __future__ import annotations

import logging
from datetime import date
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from ..core.access import get_user_id, get_user_organization_id, is_support_worker
from ..core.security import get_current_user
from ..services import schedule_request_service, worker_availability_service, worker_calendar_service
from ..services.push_service import send_push_to_user

router = APIRouter(prefix="/worker", tags=["worker-scheduling"])
logger = logging.getLogger(__name__)


def _require_worker(user: dict) -> None:
    if not is_support_worker(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Support worker access required.")


# ── Calendar (281) ─────────────────────────────────────────────────────────────

@router.get("/shifts/calendar")
async def worker_shifts_calendar(
    start_date: date = Query(...),
    end_date: date = Query(...),
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date must be on or after start_date.")
    return worker_calendar_service.get_calendar_payload(
        get_user_id(current_user),
        get_user_organization_id(current_user),
        start_date,
        end_date,
    )


@router.post("/calendar/feed-token")
async def create_calendar_feed_token(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    try:
        result = worker_calendar_service.get_or_create_feed_token(
            get_user_id(current_user),
            get_user_organization_id(current_user),
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    token = result["token"]
    feed_path = f"/api/public/calendar/feed/{token}"
    return {"feed_path": feed_path, "token": token, "regenerated": result.get("regenerated", False)}


# ── Schedule requests (283) ───────────────────────────────────────────────────

class TimeOffRequestBody(BaseModel):
    start_date: date
    end_date: date
    reason_code: Literal["annual_leave", "personal_leave", "medical", "family_emergency", "other"]
    worker_notes: Optional[str] = None


class PreferredShiftRequestBody(BaseModel):
    participant_id: str
    preferred_days: list[int] = Field(min_length=1)
    worker_notes: Optional[str] = None


class ShiftSwapRequestBody(BaseModel):
    shift_id: str
    worker_notes: Optional[str] = None


@router.get("/schedule-requests")
async def list_schedule_requests(
    request_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    return {
        "requests": schedule_request_service.list_requests(
            user_id=get_user_id(current_user),
            organization_id=get_user_organization_id(current_user),
            request_type=request_type,
            status=status,
        )
    }


@router.get("/schedule-requests/{request_id}")
async def get_schedule_request(request_id: str, current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return schedule_request_service.get_request(
        request_id,
        user_id=get_user_id(current_user),
        organization_id=get_user_organization_id(current_user),
    )


@router.post("/schedule-requests/time-off", status_code=status.HTTP_201_CREATED)
async def create_time_off(body: TimeOffRequestBody, current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return schedule_request_service.create_time_off_request(
        get_user_id(current_user),
        get_user_organization_id(current_user),
        start_date=body.start_date,
        end_date=body.end_date,
        reason_code=body.reason_code,
        worker_notes=body.worker_notes,
    )


@router.post("/schedule-requests/preferred-shift", status_code=status.HTTP_201_CREATED)
async def create_preferred_shift(body: PreferredShiftRequestBody, current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return schedule_request_service.create_preferred_shift_request(
        get_user_id(current_user),
        get_user_organization_id(current_user),
        participant_id=body.participant_id,
        preferred_days=body.preferred_days,
        worker_notes=body.worker_notes,
    )


@router.post("/schedule-requests/shift-swap", status_code=status.HTTP_201_CREATED)
async def create_shift_swap(body: ShiftSwapRequestBody, current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return schedule_request_service.create_shift_swap_request(
        get_user_id(current_user),
        get_user_organization_id(current_user),
        shift_id=body.shift_id,
        worker_notes=body.worker_notes,
    )


# ── Availability (284) ──────────────────────────────────────────────────────

class SlotUpdate(BaseModel):
    day_of_week: int = Field(ge=1, le=7)
    time_slot: Literal["morning", "afternoon", "evening"]
    status: Literal["available", "unavailable", "preferred"]


class SlotsBody(BaseModel):
    slots: list[SlotUpdate]


class PreferencesBody(BaseModel):
    max_shifts_per_week: int = Field(ge=1, le=7)


class BlackoutBody(BaseModel):
    start_date: date
    end_date: date
    reason: Optional[str] = None


class BlackoutsBody(BaseModel):
    blackout_dates: list[BlackoutBody]


class EmergencyOverrideBody(BaseModel):
    target_date: date


@router.get("/availability")
async def get_worker_availability(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return worker_availability_service.get_availability(
        get_user_id(current_user),
        get_user_organization_id(current_user),
    )


@router.put("/availability/slots")
async def update_availability_slots(body: SlotsBody, current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return worker_availability_service.update_slots(
        get_user_id(current_user),
        get_user_organization_id(current_user),
        [s.model_dump() for s in body.slots],
    )


@router.put("/availability/preferences")
async def update_availability_preferences(body: PreferencesBody, current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return worker_availability_service.update_preferences(
        get_user_id(current_user),
        get_user_organization_id(current_user),
        max_shifts_per_week=body.max_shifts_per_week,
    )


@router.put("/availability/blackouts")
async def update_availability_blackouts(body: BlackoutsBody, current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return worker_availability_service.replace_blackouts(
        get_user_id(current_user),
        get_user_organization_id(current_user),
        [b.model_dump() for b in body.blackout_dates],
    )


@router.post("/availability/emergency-override")
async def emergency_availability_override(
    body: EmergencyOverrideBody,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    user_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    result = worker_availability_service.set_emergency_override(
        user_id, org_id, target_date=body.target_date,
    )
    schedule_request_service.insert_worker_notification(
        user_id,
        org_id,
        "emergency_availability",
        "Emergency availability signalled",
        f"You signalled availability for {body.target_date}. Coordinators have been notified.",
    )
    try:
        await send_push_to_user(
            user_id=user_id,
            title="Availability override active",
            body=f"You are available for extra work on {body.target_date}.",
        )
    except Exception:
        pass
    return result
