"""Branches (offices) — see 198_branches.sql.

A branch is the source of truth for timezone: staff and participants belong
to one, and everything about them (shift times, pay, billing, "today") is
read on that branch's clock. This module is the thin CRUD layer the MD
settings screen uses; timezone *resolution* lives in core/timezone.py.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import HTTPException, status

from ..core.timezone import AUSTRALIAN_STATE_TIMEZONES, clear_timezone_caches
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

BRANCH_COLUMNS = "id, organization_id, name, state, timezone, is_head_office, created_at, updated_at"
AUSTRALIAN_STATES = tuple(AUSTRALIAN_STATE_TIMEZONES.keys())


def _normalise_state(state: Any) -> str:
    value = str(state or "").strip().upper()
    if value not in AUSTRALIAN_STATE_TIMEZONES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"state must be one of {', '.join(AUSTRALIAN_STATES)}.",
        )
    return value


def list_branches(organization_id: str) -> list[dict]:
    supabase = get_supabase_admin()
    rows = (
        supabase.table("branches")
        .select(BRANCH_COLUMNS)
        .eq("organization_id", organization_id)
        .order("is_head_office", desc=True)
        .order("name")
        .execute()
        .data
    ) or []
    if not rows:
        return rows
    # Member / participant counts so the settings list can show them and
    # block deleting a branch that still has people in it.
    ids = [str(r["id"]) for r in rows]
    members = (
        supabase.table("organization_members")
        .select("branch_id")
        .eq("organization_id", organization_id)
        .in_("branch_id", ids)
        .execute()
        .data
    ) or []
    participants = (
        supabase.table("participants")
        .select("branch_id")
        .eq("organization_id", organization_id)
        .in_("branch_id", ids)
        .execute()
        .data
    ) or []
    member_counts: dict[str, int] = {}
    participant_counts: dict[str, int] = {}
    for m in members:
        member_counts[str(m.get("branch_id"))] = member_counts.get(str(m.get("branch_id")), 0) + 1
    for p in participants:
        participant_counts[str(p.get("branch_id"))] = participant_counts.get(str(p.get("branch_id")), 0) + 1
    for r in rows:
        r["member_count"] = member_counts.get(str(r["id"]), 0)
        r["participant_count"] = participant_counts.get(str(r["id"]), 0)
    return rows


def get_branch(organization_id: str, branch_id: str) -> dict:
    rows = (
        get_supabase_admin()
        .table("branches")
        .select(BRANCH_COLUMNS)
        .eq("organization_id", organization_id)
        .eq("id", branch_id)
        .limit(1)
        .execute()
        .data
    ) or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found.")
    return rows[0]


def create_branch(organization_id: str, *, name: str, state: str) -> dict:
    name = str(name or "").strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="name is required.")
    payload = {
        "organization_id": organization_id,
        "name": name,
        "state": _normalise_state(state),
        # timezone is derived from state by the DB trigger; sent so the
        # NOT NULL constraint is satisfied before the trigger runs.
        "timezone": AUSTRALIAN_STATE_TIMEZONES[_normalise_state(state)],
    }
    try:
        rows = get_supabase_admin().table("branches").insert(payload).execute().data or []
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "23505" in str(exc):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A branch with that name already exists.")
        logger.exception("create_branch failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not create branch.")
    return rows[0]


def update_branch(organization_id: str, branch_id: str, *, name: Optional[str] = None, state: Optional[str] = None) -> dict:
    get_branch(organization_id, branch_id)
    payload: dict[str, Any] = {}
    if name is not None:
        name = str(name).strip()
        if not name:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="name cannot be empty.")
        payload["name"] = name
    if state is not None:
        payload["state"] = _normalise_state(state)
        payload["timezone"] = AUSTRALIAN_STATE_TIMEZONES[payload["state"]]
    if not payload:
        return get_branch(organization_id, branch_id)
    try:
        rows = (
            get_supabase_admin()
            .table("branches")
            .update(payload)
            .eq("organization_id", organization_id)
            .eq("id", branch_id)
            .execute()
            .data
        ) or []
    except Exception as exc:
        if "duplicate" in str(exc).lower() or "23505" in str(exc):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A branch with that name already exists.")
        logger.exception("update_branch failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not update branch.")
    # A state change moves everyone in the branch to a new clock.
    clear_timezone_caches()
    return rows[0] if rows else get_branch(organization_id, branch_id)


def delete_branch(organization_id: str, branch_id: str) -> None:
    branch = get_branch(organization_id, branch_id)
    if branch.get("is_head_office"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The head office cannot be deleted.")
    counts = next((b for b in list_branches(organization_id) if str(b["id"]) == str(branch_id)), {})
    if counts.get("member_count") or counts.get("participant_count"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Move this branch's staff and participants to another branch first.",
        )
    get_supabase_admin().table("branches").delete().eq("organization_id", organization_id).eq("id", branch_id).execute()
    clear_timezone_caches()


def member_branch_id(user_id: Optional[str], organization_id: Optional[str]) -> Optional[str]:
    """Branch a staff member belongs to, or None if unknown."""
    if not user_id or not organization_id:
        return None
    try:
        rows = (
            get_supabase_admin()
            .table("organization_members")
            .select("branch_id")
            .eq("user_id", str(user_id))
            .eq("organization_id", str(organization_id))
            .limit(1)
            .execute()
            .data
        ) or []
    except Exception:
        return None
    return str(rows[0]["branch_id"]) if rows and rows[0].get("branch_id") else None


def set_member_branch(organization_id: str, user_id: str, branch_id: str) -> dict:
    get_branch(organization_id, branch_id)
    rows = (
        get_supabase_admin()
        .table("organization_members")
        .update({"branch_id": branch_id})
        .eq("organization_id", organization_id)
        .eq("user_id", user_id)
        .execute()
        .data
    ) or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team member not found.")
    clear_timezone_caches()
    return rows[0]


def set_participant_branch(organization_id: str, participant_id: str, branch_id: str) -> dict:
    get_branch(organization_id, branch_id)
    rows = (
        get_supabase_admin()
        .table("participants")
        .update({"branch_id": branch_id})
        .eq("organization_id", organization_id)
        .eq("id", participant_id)
        .execute()
        .data
    ) or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participant not found.")
    clear_timezone_caches()
    return {"id": rows[0].get("id"), "branch_id": rows[0].get("branch_id")}
