"""Induction checklist — a worker's one-time first-day items, distinct from
the ongoing/renewable training_modules system. Every active mandatory item
applies to every worker in the org (no per-item opt-in like training's
auto_assign_on_hire), and completions are a plain tick-off, not a
coordinator-reviewed submission — induction has no approval workflow.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from .supabase_client import get_supabase_admin


def _is_missing_schema(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def list_induction_items(organization_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("induction_items")
            .select("*")
            .eq("organization_id", organization_id)
            .eq("is_active", True)
            .order("sort_order")
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


def create_induction_item(
    organization_id: str,
    created_by: str,
    title: str,
    description: str | None,
    content_url: str | None,
    is_mandatory: bool,
    sort_order: int,
) -> dict[str, Any]:
    if not title.strip():
        raise HTTPException(status_code=422, detail="Title is required.")
    payload = {
        "id": str(uuid4()),
        "organization_id": organization_id,
        "title": title.strip(),
        "description": (description or "").strip() or None,
        "content_url": (content_url or "").strip() or None,
        "is_mandatory": is_mandatory,
        "sort_order": sort_order,
        "created_by": created_by,
        "is_active": True,
    }
    result = get_supabase_admin().table("induction_items").insert(payload).execute()
    return result.data[0] if result.data else payload


def update_induction_item(
    organization_id: str,
    item_id: str,
    updates: dict[str, Any],
) -> dict[str, Any]:
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update.")
    if "title" in updates:
        if not (updates["title"] or "").strip():
            raise HTTPException(status_code=422, detail="Title is required.")
        updates["title"] = updates["title"].strip()
    existing = (
        get_supabase_admin()
        .table("induction_items")
        .select("id")
        .eq("id", item_id)
        .eq("organization_id", organization_id)
        .maybe_single()
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Induction item not found.")
    updates["updated_at"] = _now()
    resp = (
        get_supabase_admin()
        .table("induction_items")
        .update(updates)
        .eq("id", item_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    return (resp.data or [{}])[0]


def get_my_induction_progress(worker_id: str, organization_id: str) -> dict[str, Any]:
    items = list_induction_items(organization_id)
    try:
        done = (
            get_supabase_admin()
            .table("worker_induction_completions")
            .select("item_id, completed_at")
            .eq("worker_id", worker_id)
            .execute()
        )
        completions = {row["item_id"]: row["completed_at"] for row in (done.data or [])}
    except Exception as exc:
        if _is_missing_schema(exc):
            completions = {}
        else:
            raise
    for item in items:
        item["completed_at"] = completions.get(item["id"])
    return {
        "items": items,
        "mandatory_total": sum(1 for i in items if i["is_mandatory"]),
        "mandatory_complete": sum(1 for i in items if i["is_mandatory"] and i.get("completed_at")),
    }


def complete_induction_item(worker_id: str, item_id: str, organization_id: str) -> dict[str, Any]:
    item = (
        get_supabase_admin()
        .table("induction_items")
        .select("id")
        .eq("id", item_id)
        .eq("organization_id", organization_id)
        .maybe_single()
        .execute()
    )
    if not item.data:
        raise HTTPException(status_code=404, detail="Induction item not found.")
    payload = {
        "id": str(uuid4()),
        "worker_id": worker_id,
        "item_id": item_id,
        "organization_id": organization_id,
        "completed_at": _now(),
    }
    result = (
        get_supabase_admin()
        .table("worker_induction_completions")
        .upsert(payload, on_conflict="worker_id,item_id")
        .execute()
    )
    return result.data[0] if result.data else payload


def is_induction_incomplete(worker_id: str, organization_id: str) -> bool:
    try:
        mandatory = (
            get_supabase_admin()
            .table("induction_items")
            .select("id")
            .eq("organization_id", organization_id)
            .eq("is_active", True)
            .eq("is_mandatory", True)
            .execute()
        )
        mandatory_ids = {row["id"] for row in (mandatory.data or [])}
        if not mandatory_ids:
            return False
        completions = (
            get_supabase_admin()
            .table("worker_induction_completions")
            .select("item_id")
            .eq("worker_id", worker_id)
            .in_("item_id", list(mandatory_ids))
            .execute()
        )
        completed_ids = {row["item_id"] for row in (completions.data or [])}
    except Exception as exc:
        if _is_missing_schema(exc):
            return False
        raise
    return bool(mandatory_ids - completed_ids)


def team_induction_incomplete_map(organization_id: str) -> dict[str, bool]:
    """Per-worker incomplete-induction flag for coordinator team views / roster gating."""
    try:
        mandatory = (
            get_supabase_admin()
            .table("induction_items")
            .select("id")
            .eq("organization_id", organization_id)
            .eq("is_active", True)
            .eq("is_mandatory", True)
            .execute()
        )
        mandatory_ids = {row["id"] for row in (mandatory.data or [])}
    except Exception as exc:
        if _is_missing_schema(exc):
            return {}
        raise
    if not mandatory_ids:
        return {}

    try:
        workers = (
            get_supabase_admin()
            .table("users")
            .select("id")
            .eq("organization_id", organization_id)
            .eq("role", "support_worker")
            .execute()
        )
        worker_ids = [row["id"] for row in (workers.data or [])]
    except Exception as exc:
        if _is_missing_schema(exc):
            return {}
        raise
    if not worker_ids:
        return {}

    try:
        completions = (
            get_supabase_admin()
            .table("worker_induction_completions")
            .select("worker_id, item_id")
            .in_("worker_id", worker_ids)
            .in_("item_id", list(mandatory_ids))
            .execute()
        )
    except Exception as exc:
        if _is_missing_schema(exc):
            return {}
        raise

    completed_by_worker: dict[str, set[str]] = {}
    for row in completions.data or []:
        completed_by_worker.setdefault(row["worker_id"], set()).add(row["item_id"])

    return {
        worker_id: bool(mandatory_ids - completed_by_worker.get(worker_id, set()))
        for worker_id in worker_ids
    }
