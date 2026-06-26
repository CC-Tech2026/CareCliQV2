"""Public iCal feed — CARECLIQV2-281."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response

from ..services import worker_calendar_service

router = APIRouter(prefix="/public/calendar", tags=["calendar-feed"])


@router.get("/feed/{token}")
async def calendar_feed(token: str):
    raw = token.removesuffix(".ics") if token.endswith(".ics") else token
    user = worker_calendar_service.resolve_feed_user(raw)
    if not user:
        raise HTTPException(status_code=404, detail="Calendar feed not found.")
    ical = worker_calendar_service.build_ical_feed(
        str(user["user_id"]),
        str(user["organization_id"]),
    )
    return Response(
        content=ical,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": 'inline; filename="carecliq-shifts.ics"'},
    )
