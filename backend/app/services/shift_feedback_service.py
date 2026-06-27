"""Structured shift feedback — CARECLIQV2-287."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from ..core.config import settings
from .notification_service import notify_worker
from .push_service import send_push_to_user
from .shift_service import get_shift_by_id
from .supabase_client import get_supabase_admin
from .worker_shift_history_service import _coordinator_display_name

logger = logging.getLogger(__name__)


def _is_missing_schema(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg


def _validate_sections(strengths: str, improvements: str, actions: str) -> None:
    for label, value in (
        ("Strengths", strengths),
        ("Areas to improve", improvements),
        ("Action items", actions),
    ):
        if not (value or "").strip():
            raise HTTPException(status_code=422, detail=f"{label} is required.")


def list_feedback_tags(organization_id: str, category: str | None = None) -> list[dict[str, Any]]:
    try:
        query = (
            get_supabase_admin()
            .table("feedback_tags")
            .select("id, label, category")
            .eq("organization_id", organization_id)
            .eq("is_active", True)
        )
        if category:
            query = query.eq("category", category)
        resp = query.order("label").execute()
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


def ensure_default_tags(organization_id: str) -> None:
    defaults = [
        ("Thorough documentation", "strength"),
        ("Punctual", "strength"),
        ("Good participant rapport", "strength"),
        ("Time management", "improvement"),
        ("Documentation detail", "improvement"),
    ]
    rows = [
        {
            "id": str(uuid4()),
            "organization_id": organization_id,
            "label": label,
            "category": cat,
        }
        for label, cat in defaults
    ]
    try:
        get_supabase_admin().table("feedback_tags").upsert(
            rows,
            on_conflict="organization_id,label,category",
        ).execute()
    except Exception as exc:
        if not _is_missing_schema(exc):
            logger.debug("default tags seed failed: %s", exc)


async def submit_shift_feedback(
    *,
    coordinator_id: str,
    organization_id: str,
    shift_id: str,
    strengths: str,
    areas_to_improve: str,
    action_items: str,
    tag_ids: list[str] | None = None,
) -> dict[str, Any]:
    _validate_sections(strengths, areas_to_improve, action_items)
    shift = get_shift_by_id(shift_id)
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found.")
    if str(shift.get("organization_id") or "") != str(organization_id):
        raise HTTPException(status_code=403, detail="Shift not in your organisation.")
    if shift.get("status") != "completed":
        raise HTTPException(status_code=422, detail="Feedback can only be submitted for completed shifts.")

    worker_id = str(shift.get("worker_id") or "")
    if not worker_id:
        raise HTTPException(status_code=422, detail="Shift has no assigned worker.")

    ensure_default_tags(organization_id)
    feedback_id = str(uuid4())
    now = datetime.now(timezone.utc).isoformat()
    record = {
        "id": feedback_id,
        "shift_id": shift_id,
        "worker_id": worker_id,
        "coordinator_id": coordinator_id,
        "organization_id": organization_id,
        "strengths": strengths.strip(),
        "areas_to_improve": areas_to_improve.strip(),
        "action_items": action_items.strip(),
        "submitted_at": now,
    }

    try:
        get_supabase_admin().table("shift_feedback").insert(record).execute()
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Feedback service unavailable.") from exc
        raise

    if tag_ids:
        junction = [{"feedback_id": feedback_id, "tag_id": tid} for tid in tag_ids]
        try:
            get_supabase_admin().table("shift_feedback_tags").insert(junction).execute()
        except Exception as exc:
            logger.warning("feedback tags insert failed: %s", exc)

    coord_name = _coordinator_display_name(coordinator_id)
    shift_date = str(shift.get("scheduled_start") or "")[:10]
    message = f"New feedback from {coord_name} for your shift on {shift_date}."
    action_url = f"{settings.frontend_base_url.rstrip('/')}/worker/feedback/{feedback_id}"

    await notify_worker(
        user_id=worker_id,
        org_id=organization_id,
        event="shift_feedback_received",
        title="New shift feedback",
        message=message,
        reference_key=f"shift_feedback:{feedback_id}",
        severity="medium",
        shift_id=shift_id,
        action_url=action_url,
        email_subject="New feedback from your coordinator",
    )
    await send_push_to_user(
        worker_id,
        title="New shift feedback",
        body=message,
        data={"type": "shift_feedback", "feedback_id": feedback_id, "shift_id": shift_id},
    )

    get_supabase_admin().table("shift_feedback").update({
        "notification_sent_at": now,
    }).eq("id", feedback_id).execute()

    return {**record, "coordinator_name": coord_name, "tags": tag_ids or []}


def acknowledge_feedback(feedback_id: str, worker_id: str) -> dict[str, Any]:
    try:
        resp = (
            get_supabase_admin()
            .table("shift_feedback")
            .select("*")
            .eq("id", feedback_id)
            .eq("worker_id", worker_id)
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Feedback service unavailable.") from exc
        raise

    if not row:
        raise HTTPException(status_code=404, detail="Feedback not found.")
    if row.get("acknowledged_at"):
        return row

    now = datetime.now(timezone.utc).isoformat()
    get_supabase_admin().table("shift_feedback").update({
        "acknowledged_at": now,
    }).eq("id", feedback_id).execute()
    return {**row, "acknowledged_at": now}


def count_unacknowledged_feedback(worker_id: str) -> int:
    try:
        resp = (
            get_supabase_admin()
            .table("shift_feedback")
            .select("id", count="exact")
            .eq("worker_id", worker_id)
            .is_("acknowledged_at", "null")
            .execute()
        )
        return int(resp.count or 0)
    except Exception as exc:
        if _is_missing_schema(exc):
            return 0
        raise


def get_feedback_detail(feedback_id: str, user_id: str, *, as_coordinator: bool = False) -> dict[str, Any]:
    try:
        resp = (
            get_supabase_admin()
            .table("shift_feedback")
            .select("*")
            .eq("id", feedback_id)
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Feedback service unavailable.") from exc
        raise

    if not row:
        raise HTTPException(status_code=404, detail="Feedback not found.")
    if as_coordinator:
        if str(row.get("coordinator_id") or "") != str(user_id):
            raise HTTPException(status_code=403, detail="Not authorized.")
    elif str(row.get("worker_id") or "") != str(user_id):
        raise HTTPException(status_code=403, detail="Not authorized.")

    row["coordinator_name"] = _coordinator_display_name(str(row.get("coordinator_id") or ""))
    return row


def list_feedback_for_shift(shift_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("shift_feedback")
            .select("*")
            .eq("shift_id", shift_id)
            .order("submitted_at", desc=False)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise
    for row in rows:
        row["coordinator_name"] = _coordinator_display_name(str(row.get("coordinator_id") or ""))
    return rows


def coordinator_acknowledgement_rate(organization_id: str) -> dict[str, Any]:
    try:
        resp = (
            get_supabase_admin()
            .table("shift_feedback")
            .select("id, acknowledged_at")
            .eq("organization_id", organization_id)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return {"total": 0, "acknowledged": 0, "rate_percent": None}
        raise
    total = len(rows)
    acked = sum(1 for r in rows if r.get("acknowledged_at"))
    rate = round((acked / total) * 100, 1) if total else None
    return {"total": total, "acknowledged": acked, "rate_percent": rate}
