"""Worker schedule requests — CARECLIQV2-283."""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

TIME_OFF_REASONS = frozenset({
    "annual_leave", "personal_leave", "medical", "family_emergency", "other",
})
REQUEST_TYPES = frozenset({"time_off", "preferred_shift", "shift_swap"})
REQUEST_STATUSES = frozenset({"pending", "approved", "declined"})


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return "does not exist" in err or "42703" in err or "pgrst" in err or "could not find" in err


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hydrate_request(row: dict[str, Any]) -> dict[str, Any]:
    rtype = row.get("request_type")
    if rtype == "time_off":
        detail = row.pop("worker_time_off_request_details", None)
        if isinstance(detail, list):
            detail = detail[0] if detail else None
        row["time_off"] = detail
    elif rtype == "preferred_shift":
        detail = row.pop("worker_preferred_shift_request_details", None)
        if isinstance(detail, list):
            detail = detail[0] if detail else None
        row["preferred_shift"] = detail
    elif rtype == "shift_swap":
        detail = row.pop("worker_shift_swap_request_details", None)
        if isinstance(detail, list):
            detail = detail[0] if detail else None
        row["shift_swap"] = detail
    return row


def _worker_participant_ids(worker_id: str, organization_id: str) -> set[str]:
    try:
        resp = (
            get_supabase_admin()
            .table("shifts")
            .select("participant_id")
            .eq("worker_id", worker_id)
            .eq("organization_id", organization_id)
            .not_.is_("participant_id", "null")
            .execute()
        )
        return {str(r["participant_id"]) for r in (resp.data or []) if r.get("participant_id")}
    except Exception:
        return set()


def create_time_off_request(
    user_id: str,
    organization_id: str,
    *,
    start_date: date,
    end_date: date,
    reason_code: str,
    worker_notes: Optional[str] = None,
) -> dict[str, Any]:
    if reason_code not in TIME_OFF_REASONS:
        raise HTTPException(status_code=422, detail="Invalid time-off reason.")
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date must be on or after start_date.")

    supabase = get_supabase_admin()
    now = _now()
    try:
        header = supabase.table("worker_schedule_requests").insert({
            "user_id": user_id,
            "organization_id": organization_id,
            "request_type": "time_off",
            "status": "pending",
            "worker_notes": worker_notes,
            "created_at": now,
            "updated_at": now,
        }).execute()
        req = (header.data or [None])[0]
        if not req:
            raise HTTPException(status_code=500, detail="Failed to create request.")
        supabase.table("worker_time_off_request_details").insert({
            "request_id": req["id"],
            "start_date": str(start_date),
            "end_date": str(end_date),
            "reason_code": reason_code,
        }).execute()
        return get_request(req["id"], user_id=user_id, organization_id=organization_id)
    except HTTPException:
        raise
    except Exception as exc:
        if _is_missing_schema_error(exc):
            raise HTTPException(status_code=503, detail="Schedule requests unavailable. Run migration 061.") from exc
        raise


def create_preferred_shift_request(
    user_id: str,
    organization_id: str,
    *,
    participant_id: str,
    preferred_days: list[int],
    worker_notes: Optional[str] = None,
) -> dict[str, Any]:
    if not preferred_days or not all(1 <= d <= 7 for d in preferred_days):
        raise HTTPException(status_code=422, detail="preferred_days must be integers 1–7 (Mon–Sun).")
    allowed = _worker_participant_ids(user_id, organization_id)
    if participant_id not in allowed:
        raise HTTPException(status_code=422, detail="Participant must be from your assigned shifts.")

    supabase = get_supabase_admin()
    now = _now()
    header = supabase.table("worker_schedule_requests").insert({
        "user_id": user_id,
        "organization_id": organization_id,
        "request_type": "preferred_shift",
        "status": "pending",
        "worker_notes": worker_notes,
        "created_at": now,
        "updated_at": now,
    }).execute()
    req = (header.data or [None])[0]
    if not req:
        raise HTTPException(status_code=500, detail="Failed to create request.")
    supabase.table("worker_preferred_shift_request_details").insert({
        "request_id": req["id"],
        "participant_id": participant_id,
        "preferred_days": sorted(set(preferred_days)),
    }).execute()
    return get_request(req["id"], user_id=user_id, organization_id=organization_id)


def create_shift_swap_request(
    user_id: str,
    organization_id: str,
    *,
    shift_id: str,
    worker_notes: Optional[str] = None,
) -> dict[str, Any]:
    supabase = get_supabase_admin()
    shift_resp = (
        supabase.table("shifts")
        .select("id, worker_id, organization_id, status, scheduled_start")
        .eq("id", shift_id)
        .limit(1)
        .execute()
    )
    shift = (shift_resp.data or [None])[0]
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found.")
    if str(shift.get("worker_id")) != user_id:
        raise HTTPException(status_code=403, detail="You can only offer your own shifts.")
    if str(shift.get("organization_id")) != organization_id:
        raise HTTPException(status_code=403, detail="Shift not in your organisation.")
    if (shift.get("status") or "").lower() in {"completed", "cancelled", "in_progress"}:
        raise HTTPException(status_code=422, detail="Cannot swap this shift.")

    now = _now()
    header = supabase.table("worker_schedule_requests").insert({
        "user_id": user_id,
        "organization_id": organization_id,
        "request_type": "shift_swap",
        "status": "pending",
        "worker_notes": worker_notes,
        "created_at": now,
        "updated_at": now,
    }).execute()
    req = (header.data or [None])[0]
    if not req:
        raise HTTPException(status_code=500, detail="Failed to create request.")
    supabase.table("worker_shift_swap_request_details").insert({
        "request_id": req["id"],
        "shift_id": shift_id,
    }).execute()
    return get_request(req["id"], user_id=user_id, organization_id=organization_id)


def list_requests(
    *,
    user_id: Optional[str] = None,
    organization_id: Optional[str] = None,
    request_type: Optional[str] = None,
    status: Optional[str] = None,
    coordinator: bool = False,
) -> list[dict[str, Any]]:
    supabase = get_supabase_admin()
    select = (
        "*, worker_time_off_request_details(*), "
        "worker_preferred_shift_request_details(*), "
        "worker_shift_swap_request_details(shift_id)"
    )
    query = supabase.table("worker_schedule_requests").select(select)
    if user_id:
        query = query.eq("user_id", user_id)
    if organization_id:
        query = query.eq("organization_id", organization_id)
    if request_type and request_type in REQUEST_TYPES:
        query = query.eq("request_type", request_type)
    if status and status in REQUEST_STATUSES:
        query = query.eq("status", status)
    if coordinator:
        query = query.order("created_at", desc=False)
    else:
        query = query.order("created_at", desc=False)
    try:
        resp = query.execute()
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        raise
    rows = [_hydrate_request(dict(r)) for r in (resp.data or [])]
    if not coordinator:
        rows.sort(key=lambda r: (r.get("request_type", ""), r.get("created_at", "")))
    return rows


def get_request(
    request_id: str,
    *,
    user_id: Optional[str] = None,
    organization_id: Optional[str] = None,
) -> dict[str, Any]:
    supabase = get_supabase_admin()
    select = (
        "*, worker_time_off_request_details(*), "
        "worker_preferred_shift_request_details(*, patients(full_name)), "
        "worker_shift_swap_request_details(shift_id, shifts(scheduled_start, scheduled_end, participant_name))"
    )
    resp = (
        supabase.table("worker_schedule_requests")
        .select(select)
        .eq("id", request_id)
        .limit(1)
        .execute()
    )
    row = (resp.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail="Request not found.")
    if user_id and str(row.get("user_id")) != user_id:
        raise HTTPException(status_code=403, detail="Access denied.")
    if organization_id and str(row.get("organization_id")) != organization_id:
        raise HTTPException(status_code=403, detail="Access denied.")
    hydrated = _hydrate_request(dict(row))
    if hydrated.get("request_type") == "shift_swap" and hydrated.get("shift_swap"):
        swap = hydrated["shift_swap"]
        if isinstance(swap, dict) and "shifts" in swap:
            swap["shift"] = swap.pop("shifts")
    return hydrated


def resolve_request(
    request_id: str,
    organization_id: str,
    coordinator_id: str,
    *,
    status: str,
    coordinator_notes: Optional[str] = None,
) -> dict[str, Any]:
    if status not in {"approved", "declined"}:
        raise HTTPException(status_code=422, detail="status must be approved or declined.")
    if status == "declined" and not (coordinator_notes or "").strip():
        raise HTTPException(status_code=422, detail="Coordinator note is required when declining.")

    existing = get_request(request_id, organization_id=organization_id)
    if existing.get("status") != "pending":
        raise HTTPException(status_code=422, detail="Request is already resolved.")

    now = _now()
    supabase = get_supabase_admin()
    supabase.table("worker_schedule_requests").update({
        "status": status,
        "coordinator_notes": coordinator_notes,
        "resolved_at": now,
        "resolved_by": coordinator_id,
        "updated_at": now,
    }).eq("id", request_id).execute()

    return get_request(request_id, organization_id=organization_id)


def insert_worker_notification(
    user_id: str,
    organization_id: str,
    notif_type: str,
    title: str,
    body: str,
    shift_id: Optional[str] = None,
) -> None:
    try:
        get_supabase_admin().table("worker_notifications").insert({
            "user_id": user_id,
            "organization_id": organization_id,
            "type": notif_type,
            "shift_id": shift_id,
            "title": title,
            "body": body,
        }).execute()
    except Exception as exc:
        logger.warning("worker notification insert failed: %s", exc)
