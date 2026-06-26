"""Worker availability management — CARECLIQV2-284."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

SLOTS = ("morning", "afternoon", "evening")
SLOT_STATUSES = frozenset({"available", "unavailable", "preferred"})
SLOT_HOURS = {
    "morning": (6, 12),
    "afternoon": (12, 17),
    "evening": (17, 21),
}
MAX_BLACKOUTS = 12
STALE_DAYS = 90


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return "does not exist" in err or "42703" in err or "pgrst" in err or "could not find" in err


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_slots(user_id: str, organization_id: str) -> list[dict[str, Any]]:
    return [
        {
            "user_id": user_id,
            "organization_id": organization_id,
            "day_of_week": day,
            "time_slot": slot,
            "status": "available",
        }
        for day in range(1, 8)
        for slot in SLOTS
    ]


def slot_for_hour(hour: int) -> str:
    if hour < 12:
        return "morning"
    if hour < 17:
        return "afternoon"
    return "evening"


def get_availability(user_id: str, organization_id: str) -> dict[str, Any]:
    supabase = get_supabase_admin()
    try:
        slots_resp = (
            supabase.table("worker_weekly_availability_slots")
            .select("day_of_week, time_slot, status, updated_at")
            .eq("user_id", user_id)
            .order("day_of_week")
            .execute()
        )
        slots = slots_resp.data or []
        if not slots:
            defaults = _default_slots(user_id, organization_id)
            supabase.table("worker_weekly_availability_slots").upsert(
                defaults,
                on_conflict="user_id,day_of_week,time_slot",
            ).execute()
            slots = defaults

        prefs_resp = (
            supabase.table("worker_availability_preferences")
            .select("*")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        prefs = (prefs_resp.data or [None])[0]
        if not prefs:
            prefs = {
                "user_id": user_id,
                "organization_id": organization_id,
                "max_shifts_per_week": 5,
                "emergency_override_date": None,
                "emergency_override_expires_at": None,
                "updated_at": _now(),
            }
            supabase.table("worker_availability_preferences").upsert(
                prefs, on_conflict="user_id"
            ).execute()

        blackouts = (
            supabase.table("worker_blackout_dates")
            .select("id, start_date, end_date, reason")
            .eq("user_id", user_id)
            .gte("end_date", str(date.today()))
            .order("start_date")
            .execute()
        ).data or []

        _expire_emergency_override(user_id)

        prefs_resp2 = (
            supabase.table("worker_availability_preferences")
            .select("*")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        prefs = (prefs_resp2.data or [prefs])[0]

        updated_at = prefs.get("updated_at") or _now()
        days_since = _days_since(updated_at)

        return {
            "slots": slots,
            "preferences": {
                "max_shifts_per_week": prefs.get("max_shifts_per_week", 5),
                "emergency_override_date": prefs.get("emergency_override_date"),
                "emergency_override_expires_at": prefs.get("emergency_override_expires_at"),
                "updated_at": updated_at,
                "days_since_updated": days_since,
                "is_stale": days_since > STALE_DAYS,
            },
            "blackout_dates": blackouts,
        }
    except Exception as exc:
        if _is_missing_schema_error(exc):
            raise HTTPException(
                status_code=503,
                detail="Availability v2 unavailable. Run migration 062.",
            ) from exc
        raise


def _days_since(iso: str) -> int:
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return max(0, (datetime.now(timezone.utc) - dt).days)
    except ValueError:
        return 0


def _expire_emergency_override(user_id: str) -> None:
    supabase = get_supabase_admin()
    try:
        resp = (
            supabase.table("worker_availability_preferences")
            .select("emergency_override_expires_at")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
        if not row or not row.get("emergency_override_expires_at"):
            return
        expires = datetime.fromisoformat(str(row["emergency_override_expires_at"]).replace("Z", "+00:00"))
        if datetime.now(timezone.utc) >= expires:
            supabase.table("worker_availability_preferences").update({
                "emergency_override_date": None,
                "emergency_override_expires_at": None,
                "updated_at": _now(),
            }).eq("user_id", user_id).execute()
    except Exception:
        pass


def update_slots(
    user_id: str,
    organization_id: str,
    slots: list[dict[str, Any]],
) -> dict[str, Any]:
    if not slots:
        raise HTTPException(status_code=422, detail="slots required.")
    now = _now()
    rows = []
    for slot in slots:
        day = int(slot.get("day_of_week", 0))
        time_slot = slot.get("time_slot", "")
        status = slot.get("status", "available")
        if day < 1 or day > 7 or time_slot not in SLOTS or status not in SLOT_STATUSES:
            raise HTTPException(status_code=422, detail="Invalid slot entry.")
        rows.append({
            "user_id": user_id,
            "organization_id": organization_id,
            "day_of_week": day,
            "time_slot": time_slot,
            "status": status,
            "updated_at": now,
        })
    get_supabase_admin().table("worker_weekly_availability_slots").upsert(
        rows, on_conflict="user_id,day_of_week,time_slot"
    ).execute()
    get_supabase_admin().table("worker_availability_preferences").upsert({
        "user_id": user_id,
        "organization_id": organization_id,
        "updated_at": now,
    }, on_conflict="user_id").execute()
    return get_availability(user_id, organization_id)


def update_preferences(
    user_id: str,
    organization_id: str,
    *,
    max_shifts_per_week: int,
) -> dict[str, Any]:
    if max_shifts_per_week < 1 or max_shifts_per_week > 7:
        raise HTTPException(status_code=422, detail="max_shifts_per_week must be 1–7.")
    now = _now()
    get_supabase_admin().table("worker_availability_preferences").upsert({
        "user_id": user_id,
        "organization_id": organization_id,
        "max_shifts_per_week": max_shifts_per_week,
        "updated_at": now,
    }, on_conflict="user_id").execute()
    return get_availability(user_id, organization_id)


def replace_blackouts(
    user_id: str,
    organization_id: str,
    blackout_dates: list[dict[str, Any]],
) -> dict[str, Any]:
    today = date.today()
    future = [b for b in blackout_dates if b.get("end_date") and str(b["end_date"]) >= str(today)]
    if len(future) > MAX_BLACKOUTS:
        raise HTTPException(status_code=422, detail=f"Maximum {MAX_BLACKOUTS} future blackout ranges.")
    supabase = get_supabase_admin()
    supabase.table("worker_blackout_dates").delete().eq("user_id", user_id).execute()
    for bd in blackout_dates:
        if bd.get("start_date") and bd.get("end_date"):
            if str(bd["end_date"]) < str(bd["start_date"]):
                raise HTTPException(status_code=422, detail="Invalid blackout date range.")
            supabase.table("worker_blackout_dates").insert({
                "user_id": user_id,
                "organization_id": organization_id,
                "start_date": bd["start_date"],
                "end_date": bd["end_date"],
                "reason": bd.get("reason"),
                "source": "worker",
            }).execute()
    get_supabase_admin().table("worker_availability_preferences").upsert({
        "user_id": user_id,
        "organization_id": organization_id,
        "updated_at": _now(),
    }, on_conflict="user_id").execute()
    return get_availability(user_id, organization_id)


def set_emergency_override(
    user_id: str,
    organization_id: str,
    *,
    target_date: date,
) -> dict[str, Any]:
    today = date.today()
    tomorrow = today + timedelta(days=1)
    if target_date not in {today, tomorrow}:
        raise HTTPException(status_code=422, detail="Emergency override only for today or tomorrow.")
    expires = datetime.now(timezone.utc) + timedelta(hours=24)
    now = _now()
    get_supabase_admin().table("worker_availability_preferences").upsert({
        "user_id": user_id,
        "organization_id": organization_id,
        "emergency_override_date": str(target_date),
        "emergency_override_expires_at": expires.isoformat(),
        "updated_at": now,
    }, on_conflict="user_id").execute()
    return get_availability(user_id, organization_id)


def get_slot_status_for_shift(
    user_id: str,
    shift_start: datetime,
) -> Optional[str]:
    """Return slot status for a shift start time, considering emergency override."""
    avail = get_availability(user_id, "")
    prefs = avail.get("preferences") or {}
    override_date = prefs.get("emergency_override_date")
    if override_date and str(override_date) == shift_start.date().isoformat():
        if prefs.get("emergency_override_expires_at"):
            try:
                exp = datetime.fromisoformat(str(prefs["emergency_override_expires_at"]).replace("Z", "+00:00"))
                if datetime.now(timezone.utc) < exp:
                    return "available"
            except ValueError:
                pass

    dow = shift_start.isoweekday()
    slot = slot_for_hour(shift_start.hour)
    for s in avail.get("slots") or []:
        if s.get("day_of_week") == dow and s.get("time_slot") == slot:
            return s.get("status")
    return "available"
