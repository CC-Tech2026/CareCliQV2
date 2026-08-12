"""Worker training & certification — CARECLIQV2-289."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from .notification_service import _notify_office_staff, notify_worker
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

EXPIRING_DAYS = 60


def _is_missing_schema(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg


def credential_display_status(expiry_date: str | None, stored: str | None = None) -> str:
    if stored in {"pending_review", "rejected"}:
        return stored
    if not expiry_date:
        return stored or "valid"
    expiry = date.fromisoformat(str(expiry_date)[:10])
    today = date.today()
    if expiry < today:
        return "expired"
    if (expiry - today).days <= EXPIRING_DAYS:
        return "expiring"
    return "valid"


def list_worker_certifications(user_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("credentials")
            .select("*")
            .eq("user_id", user_id)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise

    enriched = []
    for row in rows:
        status = credential_display_status(row.get("expiry_date"), row.get("status"))
        enriched.append({**row, "display_status": status})

    def sort_key(item: dict[str, Any]) -> tuple:
        status = item.get("display_status")
        expiry = item.get("expiry_date") or "9999-12-31"
        priority = 0 if status == "expired" else 1
        return (priority, expiry)

    enriched.sort(key=sort_key)
    return enriched


def list_training_modules(organization_id: str) -> list[dict[str, Any]]:
    try:
        mod_resp = (
            get_supabase_admin()
            .table("training_modules")
            .select("*")
            .eq("organization_id", organization_id)
            .eq("is_active", True)
            .order("title")
            .execute()
        )
        modules = mod_resp.data or []
        if not modules:
            return []
        ids = [m["id"] for m in modules]
        res_resp = (
            get_supabase_admin()
            .table("training_resources")
            .select("*")
            .in_("module_id", ids)
            .order("sort_order")
            .execute()
        )
        by_module: dict[str, list] = {}
        for res in res_resp.data or []:
            by_module.setdefault(str(res["module_id"]), []).append(res)
        for mod in modules:
            mod["resources"] = by_module.get(str(mod["id"]), [])
        return modules
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


def mark_training_complete(
    worker_id: str,
    organization_id: str,
    module_id: str,
    completed_at: date,
    note: str | None = None,
) -> dict[str, Any]:
    record = {
        "id": str(uuid4()),
        "worker_id": worker_id,
        "module_id": module_id,
        "organization_id": organization_id,
        "completed_at": completed_at.isoformat(),
        "note": note,
        "status": "awaiting_confirmation",
    }
    try:
        get_supabase_admin().table("worker_training_completions").upsert(
            record,
            on_conflict="worker_id,module_id",
        ).execute()
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Training service unavailable.") from exc
        raise

    import asyncio

    async def _notify():
        await _notify_office_staff(
            org_id=organization_id,
            title="Training completion to review",
            message=f"A worker marked a training module complete on {completed_at.isoformat()}.",
            reference_key=f"training_completion:{record['id']}",
            event="training_completion_review",
        )

    try:
        asyncio.get_event_loop().create_task(_notify())
    except Exception:
        pass
    return record


def create_training_request(
    worker_id: str,
    organization_id: str,
    request_text: str,
    reason: str,
    urgent: bool = False,
) -> dict[str, Any]:
    if not request_text.strip() or not reason.strip():
        raise HTTPException(status_code=422, detail="Request and reason are required.")
    record = {
        "id": str(uuid4()),
        "worker_id": worker_id,
        "organization_id": organization_id,
        "request_text": request_text.strip(),
        "reason": reason.strip(),
        "urgent": urgent,
        "status": "pending",
    }
    try:
        get_supabase_admin().table("worker_training_requests").insert(record).execute()
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Training service unavailable.") from exc
        raise

    import asyncio

    async def _notify():
        await _notify_office_staff(
            org_id=organization_id,
            title="Training request" + (" (urgent)" if urgent else ""),
            message=request_text.strip(),
            reference_key=f"training_request:{record['id']}",
            severity="high" if urgent else "medium",
            event="training_request",
        )

    try:
        asyncio.get_event_loop().create_task(_notify())
    except Exception:
        pass
    return record


def list_training_requests(worker_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("worker_training_requests")
            .select("*")
            .eq("worker_id", worker_id)
            .order("created_at", desc=True)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


def list_training_history(worker_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("worker_training_completions")
            .select("*, training_modules(title)")
            .eq("worker_id", worker_id)
            .order("completed_at", desc=True)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


async def review_training_completion(
    completion_id: str,
    coordinator_id: str,
    organization_id: str,
    *,
    approved: bool,
    rejection_reason: str | None = None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    status = "confirmed" if approved else "rejected"
    try:
        resp = (
            get_supabase_admin()
            .table("worker_training_completions")
            .select("*")
            .eq("id", completion_id)
            .eq("organization_id", organization_id)
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Training service unavailable.") from exc
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Completion not found.")

    get_supabase_admin().table("worker_training_completions").update({
        "status": status,
        "reviewed_by": coordinator_id,
        "reviewed_at": now,
        "rejection_reason": rejection_reason if not approved else None,
    }).eq("id", completion_id).execute()

    await notify_worker(
        user_id=str(row["worker_id"]),
        org_id=organization_id,
        event="training_request_update",
        title="Training completion reviewed",
        message="Your training completion was confirmed." if approved else (
            f"Your training completion was declined. {rejection_reason or ''}".strip()
        ),
        reference_key=f"training_completion_review:{completion_id}",
        severity="medium",
    )
    return {**row, "status": status, "reviewed_at": now}


def create_training_module(
    organization_id: str,
    created_by: str,
    title: str,
    description: str | None = None,
    linked_credential_type: str | None = None,
    requires_certification: bool = False,
) -> dict[str, Any]:
    if not title.strip():
        raise HTTPException(status_code=422, detail="Title is required.")
    record = {
        "id": str(uuid4()),
        "organization_id": organization_id,
        "title": title.strip(),
        "description": description,
        "linked_credential_type": linked_credential_type,
        "requires_certification": requires_certification,
        "created_by": created_by,
        "is_active": True,
    }
    try:
        get_supabase_admin().table("training_modules").insert(record).execute()
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Training service unavailable.") from exc
        raise
    record["resources"] = []
    return record


def recommend_training_module(
    worker_id: str,
    coordinator_id: str,
    organization_id: str,
    training_module_id: str,
    title: str,
) -> dict[str, Any]:
    record = {
        "id": str(uuid4()),
        "worker_id": worker_id,
        "coordinator_id": coordinator_id,
        "organization_id": organization_id,
        "training_module_id": training_module_id,
        "title": title,
    }
    try:
        get_supabase_admin().table("worker_training_recommendations").insert(record).execute()
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Training service unavailable.") from exc
        raise

    import asyncio

    async def _notify():
        await notify_worker(
            user_id=worker_id,
            org_id=organization_id,
            event="training_recommended",
            title="New training assigned",
            message=f'Your coordinator assigned you training: "{title}".',
            reference_key=f"training_recommendation:{record['id']}",
            severity="medium",
        )

    try:
        asyncio.get_event_loop().create_task(_notify())
    except Exception:
        pass
    return record


def dismiss_training_recommendation(recommendation_id: str, organization_id: str) -> None:
    get_supabase_admin().table("worker_training_recommendations").update({
        "dismissed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", recommendation_id).eq("organization_id", organization_id).execute()


def list_worker_recommendations(worker_id: str, organization_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("worker_training_recommendations")
            .select("*")
            .eq("worker_id", worker_id)
            .eq("organization_id", organization_id)
            .is_("dismissed_at", "null")
            .order("recommended_at", desc=True)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


def list_pending_completions(organization_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("worker_training_completions")
            .select("*, training_modules(title), users!worker_training_completions_worker_id_fkey(full_name)")
            .eq("organization_id", organization_id)
            .eq("status", "awaiting_confirmation")
            .order("completed_at", desc=True)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


def team_training_summary(organization_id: str) -> dict[str, dict[str, int]]:
    """Per-worker counts: assigned (active recs), completed (confirmed), pending (awaiting review)."""
    summary: dict[str, dict[str, int]] = {}

    def bump(worker_id: str, key: str):
        entry = summary.setdefault(str(worker_id), {"assigned": 0, "completed": 0, "pending_review": 0})
        entry[key] += 1

    try:
        recs = (
            get_supabase_admin()
            .table("worker_training_recommendations")
            .select("worker_id")
            .eq("organization_id", organization_id)
            .is_("dismissed_at", "null")
            .execute()
        )
        for r in recs.data or []:
            bump(r["worker_id"], "assigned")
    except Exception as exc:
        if not _is_missing_schema(exc):
            raise

    try:
        completions = (
            get_supabase_admin()
            .table("worker_training_completions")
            .select("worker_id, status")
            .eq("organization_id", organization_id)
            .execute()
        )
        for c in completions.data or []:
            if c.get("status") == "confirmed":
                bump(c["worker_id"], "completed")
            elif c.get("status") == "awaiting_confirmation":
                bump(c["worker_id"], "pending_review")
    except Exception as exc:
        if not _is_missing_schema(exc):
            raise

    return summary


async def action_training_request(
    request_id: str,
    coordinator_id: str,
    organization_id: str,
    *,
    approved: bool,
    response: str | None = None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    status = "approved" if approved else "declined"
    try:
        resp = (
            get_supabase_admin()
            .table("worker_training_requests")
            .select("*")
            .eq("id", request_id)
            .eq("organization_id", organization_id)
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Training service unavailable.") from exc
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Request not found.")

    get_supabase_admin().table("worker_training_requests").update({
        "status": status,
        "coordinator_response": response,
        "actioned_at": now,
        "actioned_by": coordinator_id,
    }).eq("id", request_id).execute()

    await notify_worker(
        user_id=str(row["worker_id"]),
        org_id=organization_id,
        event="training_request_update",
        title=f"Training request {status}",
        message=response or f"Your training request was {status}.",
        reference_key=f"training_request:{request_id}:{status}",
        severity="medium",
    )
    return {**row, "status": status, "actioned_at": now}
