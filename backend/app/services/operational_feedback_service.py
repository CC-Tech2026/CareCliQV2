"""Staff operational feedback/complaints — any staff member can flag something
that isn't working or file a report about an operational issue. Deliberately
separate from incident reporting (backend/app/services/incident_service.py),
which is participant-safety-focused and has its own immutable-record
workflow; this is a lightweight, editable-status queue for coordinators and
the managing director to triage."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from .supabase_client import get_supabase_admin

VALID_CATEGORIES = {"process", "equipment", "scheduling", "communication", "safety_non_incident", "other"}
VALID_STATUSES = {"open", "in_review", "resolved"}

_SELECT_COLUMNS = (
    "id, organization_id, reporter_id, category, title, description, "
    "status, resolution_notes, resolved_by, resolved_at, created_at, updated_at"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _attach_names(rows: list[dict[str, Any]], organization_id: str) -> list[dict[str, Any]]:
    """Attach reporter_name/resolved_by_name, scoped to this org so a
    cross-org id (shouldn't happen given FK + org filtering, but keep the
    same defensive pattern used elsewhere) never leaks another org's PII."""
    user_ids = {r["reporter_id"] for r in rows if r.get("reporter_id")}
    user_ids |= {r["resolved_by"] for r in rows if r.get("resolved_by")}
    if not user_ids:
        return rows
    profiles = (
        get_supabase_admin()
        .table("users")
        .select("id, full_name, email")
        .in_("id", list(user_ids))
        .eq("organization_id", organization_id)
        .execute()
    )
    by_id = {p["id"]: (p.get("full_name") or p.get("email") or "Staff member") for p in (profiles.data or [])}
    for r in rows:
        r["reporter_name"] = by_id.get(r.get("reporter_id"), "Staff member")
        r["resolved_by_name"] = by_id.get(r["resolved_by"]) if r.get("resolved_by") else None
    return rows


def create_feedback(organization_id: str, reporter_id: str, category: str, title: str, description: str) -> dict[str, Any]:
    if category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid category.")
    title = title.strip()
    description = description.strip()
    if not title or not description:
        raise HTTPException(status_code=400, detail="Title and description are required.")

    now = _now_iso()
    resp = (
        get_supabase_admin()
        .table("operational_feedback")
        .insert({
            "organization_id": organization_id,
            "reporter_id": reporter_id,
            "category": category,
            "title": title,
            "description": description,
            "status": "open",
            "created_at": now,
            "updated_at": now,
        })
        .execute()
    )
    row = resp.data[0]
    return _attach_names([row], organization_id)[0]


def list_feedback(organization_id: str, status: str | None = None) -> list[dict[str, Any]]:
    query = (
        get_supabase_admin()
        .table("operational_feedback")
        .select(_SELECT_COLUMNS)
        .eq("organization_id", organization_id)
        .order("created_at", desc=True)
    )
    if status:
        if status not in VALID_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status filter.")
        query = query.eq("status", status)
    rows = query.execute().data or []
    return _attach_names(rows, organization_id)


def list_feedback_for_reporter(organization_id: str, reporter_id: str) -> list[dict[str, Any]]:
    rows = (
        get_supabase_admin()
        .table("operational_feedback")
        .select(_SELECT_COLUMNS)
        .eq("organization_id", organization_id)
        .eq("reporter_id", reporter_id)
        .order("created_at", desc=True)
        .execute()
    ).data or []
    return _attach_names(rows, organization_id)


def update_status(
    organization_id: str,
    feedback_id: str,
    resolver_id: str,
    status: str,
    resolution_notes: str | None,
) -> dict[str, Any]:
    if status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status.")
    existing = (
        get_supabase_admin()
        .table("operational_feedback")
        .select("id")
        .eq("id", feedback_id)
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Report not found.")

    patch: dict[str, Any] = {"status": status, "updated_at": _now_iso()}
    if status == "resolved":
        if not resolution_notes or not resolution_notes.strip():
            raise HTTPException(status_code=400, detail="Resolution notes are required to mark a report resolved.")
        patch["resolution_notes"] = resolution_notes.strip()
        patch["resolved_by"] = resolver_id
        patch["resolved_at"] = _now_iso()
    elif resolution_notes is not None:
        patch["resolution_notes"] = resolution_notes.strip() or None

    resp = (
        get_supabase_admin()
        .table("operational_feedback")
        .update(patch)
        .eq("id", feedback_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    return _attach_names([resp.data[0]], organization_id)[0]
