"""Participant complaints: raised by, or on behalf of, a participant, and
how each was handled. Recorded by coordinators and the managing director
(migration 242); the vault files each one, and the register, under Feedback
& Complaints Management."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from .supabase_client import get_supabase_admin

TABLE = "participant_complaints"
VALID_STATUSES = {"open", "in_review", "resolved"}

_SELECT = (
    "id, organization_id, participant_id, participant_name, raised_by, subject, description, "
    "status, resolution_notes, responded_at, responded_by, filed_at, created_by, created_at, updated_at"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _not_set_up(exc: Exception) -> bool:
    text = str(exc)
    return TABLE in text and ("does not exist" in text or "PGRST205" in text or "schema cache" in text)


def _unavailable() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail="Complaints aren't set up on this server yet. They will be after the next update.",
    )


def _participant_name(organization_id: str, participant_id: str) -> str:
    rows = (
        get_supabase_admin()
        .table("participants")
        .select("id, full_name")
        .eq("id", participant_id)
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    ).data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Participant not found.")
    return rows[0].get("full_name") or "Participant"


def list_complaints(organization_id: str, *, raise_if_missing: bool = True) -> list[dict[str, Any]]:
    try:
        return (
            get_supabase_admin()
            .table(TABLE)
            .select(_SELECT)
            .eq("organization_id", organization_id)
            .order("filed_at", desc=True)
            .limit(1000)
            .execute()
        ).data or []
    except Exception as exc:
        if _not_set_up(exc):
            if raise_if_missing:
                raise _unavailable() from exc
            return []
        raise


def get_complaint(organization_id: str, complaint_id: str) -> dict[str, Any] | None:
    try:
        rows = (
            get_supabase_admin()
            .table(TABLE)
            .select(_SELECT)
            .eq("id", complaint_id)
            .eq("organization_id", organization_id)
            .limit(1)
            .execute()
        ).data or []
    except Exception as exc:
        if _not_set_up(exc):
            return None
        raise
    return rows[0] if rows else None


def create_complaint(
    organization_id: str,
    user_id: str,
    *,
    subject: str,
    description: str,
    participant_id: str | None = None,
    participant_name: str | None = None,
    raised_by: str | None = None,
    filed_at: str | None = None,
) -> dict[str, Any]:
    subject = (subject or "").strip()
    description = (description or "").strip()
    if not subject or not description:
        raise HTTPException(status_code=422, detail="A subject and description are required.")
    name = _participant_name(organization_id, participant_id) if participant_id else (participant_name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Choose a participant or enter who the complaint is about.")
    now = _now_iso()
    payload = {
        "organization_id": organization_id,
        "participant_id": participant_id or None,
        "participant_name": name,
        "raised_by": (raised_by or "").strip() or None,
        "subject": subject,
        "description": description,
        "status": "open",
        "filed_at": filed_at or now,
        "created_by": user_id,
        "created_at": now,
        "updated_at": now,
    }
    try:
        return (get_supabase_admin().table(TABLE).insert(payload).execute()).data[0]
    except Exception as exc:
        if _not_set_up(exc):
            raise _unavailable() from exc
        raise


def update_complaint(
    organization_id: str,
    complaint_id: str,
    user_id: str,
    *,
    status: str,
    resolution_notes: str | None = None,
) -> dict[str, Any]:
    if status not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status.")
    notes = (resolution_notes or "").strip()
    if status == "resolved" and not notes:
        raise HTTPException(status_code=422, detail="Say what was done before marking a complaint resolved.")
    if not get_complaint(organization_id, complaint_id):
        raise HTTPException(status_code=404, detail="Complaint not found.")
    now = _now_iso()
    patch: dict[str, Any] = {"status": status, "responded_at": now, "responded_by": user_id, "updated_at": now}
    if notes:
        patch["resolution_notes"] = notes
    rows = (
        get_supabase_admin()
        .table(TABLE)
        .update(patch)
        .eq("id", complaint_id)
        .eq("organization_id", organization_id)
        .execute()
    ).data or []
    return rows[0] if rows else {**(get_complaint(organization_id, complaint_id) or {}), **patch}
