"""Delegated access grants — a scoped, time-boxed exception on top of the
existing role system. Lets an MD hand a coordinator temporary access to one
specific MD-exclusive capability without a role change, without sharing
credentials, and without the access lingering past its window.

A grant is not a status. Whether it's currently active is computed on every
read (`revoked_at IS NULL AND expires_at > now()`), never stored — see
core/access.py::has_active_grant for the actual enforcement, which is the
only thing an MD-exclusive endpoint should trust. This module is the CRUD +
audit-logging surface around that table for the /md/access-grants and
/me/access-grants API.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException, status

from ..core.access import get_user_id, get_user_organization_id, is_managing_director
from . import audit_service
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

# The real, investigated MD-exclusive capability catalog (see the CareCliQ
# delegated-access spec this module implements). Each key is the exact
# `capability` value stored on an access_grants row and enforced by
# core/access.py::has_active_grant; each value is the human label for the MD
# grant-creation UI. One grant, one capability — never a bundle — so this
# stays a flat map, not a tree of sub-permissions.
CAPABILITIES: dict[str, str] = {
    "governance_vault": "Governance & policy document vault (md_vault.py)",
    "onboarding_program_design": "Staff onboarding program design (curriculum authoring + stage approval)",
    "executive_dashboard": "Executive dashboard",
    "delete_staff_account": "Delete a staff account",
    "reassign_coordinator": "Reassign a worker's coordinator",
    "lock_training_module": "Lock/unlock a training module",
    "hire_paperwork": "New-hire employment paperwork (offer letter/service agreement)",
    "applicant_offer_reject": "Extend an offer / reject an applicant",
    "staff_invitations": "Send a staff invitation",
    "org_branding": "Organisation branding",
    "platform_billing": "Platform subscription billing (Stripe)",
}

MAX_GRANT_DURATION_DAYS = 90


def _require_md(user: dict) -> tuple[str, str]:
    if not is_managing_director(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managing director access required.")
    org_id = get_user_organization_id(user)
    user_id = get_user_id(user)
    if not org_id or not user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required.")
    return org_id, user_id


def _validate_capability(capability: str) -> None:
    if capability not in CAPABILITIES:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown capability '{capability}'. Valid values: {sorted(CAPABILITIES)}",
        )


def _computed_status(row: dict[str, Any], *, now: Optional[datetime] = None) -> str:
    now = now or datetime.now(timezone.utc)
    if row.get("revoked_at"):
        return "revoked"
    expires_at = row.get("expires_at")
    if expires_at:
        try:
            expires_dt = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
            if expires_dt <= now:
                return "expired"
        except ValueError:
            pass
    return "active"


def _with_computed_status(row: dict[str, Any]) -> dict[str, Any]:
    return {**row, "status": _computed_status(row)}


async def create_grant(
    user: dict,
    *,
    granted_to_user_id: str,
    capability: str,
    expires_at: str,
    reason: Optional[str] = None,
) -> dict[str, Any]:
    org_id, md_user_id = _require_md(user)
    _validate_capability(capability)

    supabase = get_supabase_admin()

    try:
        expires_dt = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=422, detail="expires_at must be an ISO 8601 datetime.")
    now = datetime.now(timezone.utc)
    if expires_dt <= now:
        raise HTTPException(status_code=422, detail="expires_at must be in the future.")
    if expires_dt > now + timedelta(days=MAX_GRANT_DURATION_DAYS):
        raise HTTPException(
            status_code=422,
            detail=f"Grants can't exceed {MAX_GRANT_DURATION_DAYS} days — create a new one to extend instead of open-ending this one.",
        )

    target = (
        supabase.table("users")
        .select("id, role, organization_id, full_name")
        .eq("id", granted_to_user_id)
        .eq("organization_id", org_id)
        .maybe_single()
        .execute()
    )
    target_row = target.data if target and target.data else None
    if not target_row:
        raise HTTPException(status_code=404, detail="Target user not found in your organization.")
    if target_row.get("role") != "support_coordinator":
        raise HTTPException(
            status_code=422,
            detail="Access grants are for coordinators only — this user isn't a support coordinator.",
        )

    payload = {
        "organization_id": org_id,
        "granted_to_user_id": granted_to_user_id,
        "granted_by_user_id": md_user_id,
        "capability": capability,
        "expires_at": expires_dt.isoformat(),
        "reason": (reason or "").strip() or None,
    }
    result = supabase.table("access_grants").insert(payload).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Could not create the access grant.")
    grant = result.data[0]

    logged = await audit_service.log_action(
        action_type="access_grant.created",
        entity_type="access_grant",
        entity_id=str(grant["id"]),
        user_id=md_user_id,
        organization_id=org_id,
        after_state={
            "granted_to_user_id": granted_to_user_id,
            "capability": capability,
            "expires_at": payload["expires_at"],
            "reason": payload["reason"],
        },
        details={"granted_to_name": target_row.get("full_name")},
    )
    if not logged:
        logger.warning("access_grant.created audit log failed to write for grant %s", grant["id"])

    return _with_computed_status(grant)


async def list_org_grants(user: dict) -> list[dict[str, Any]]:
    """MD's org-wide view — every grant ever made in this org, current and past."""
    org_id, _md_user_id = _require_md(user)
    supabase = get_supabase_admin()
    result = (
        supabase.table("access_grants")
        .select("*")
        .eq("organization_id", org_id)
        .order("granted_at", desc=True)
        .execute()
    )
    rows = result.data or []
    return [_with_computed_status(row) for row in rows]


async def revoke_grant(user: dict, grant_id: str) -> dict[str, Any]:
    org_id, md_user_id = _require_md(user)
    supabase = get_supabase_admin()

    existing = (
        supabase.table("access_grants")
        .select("*")
        .eq("id", grant_id)
        .eq("organization_id", org_id)
        .maybe_single()
        .execute()
    )
    grant = existing.data if existing and existing.data else None
    if not grant:
        raise HTTPException(status_code=404, detail="Access grant not found.")
    if grant.get("revoked_at"):
        raise HTTPException(status_code=409, detail="This grant was already revoked.")

    now_iso = datetime.now(timezone.utc).isoformat()
    update_result = (
        supabase.table("access_grants")
        .update({"revoked_at": now_iso, "revoked_by_user_id": md_user_id})
        .eq("id", grant_id)
        .execute()
    )
    updated = update_result.data[0] if update_result.data else {**grant, "revoked_at": now_iso, "revoked_by_user_id": md_user_id}

    logged = await audit_service.log_action(
        action_type="access_grant.revoked",
        entity_type="access_grant",
        entity_id=str(grant_id),
        user_id=md_user_id,
        organization_id=org_id,
        before_state={"revoked_at": None, "expires_at": grant.get("expires_at")},
        after_state={"revoked_at": now_iso},
        details={
            "granted_to_user_id": grant.get("granted_to_user_id"),
            "capability": grant.get("capability"),
        },
    )
    if not logged:
        logger.warning("access_grant.revoked audit log failed to write for grant %s", grant_id)

    return _with_computed_status(updated)


async def list_my_grants(user: dict) -> list[dict[str, Any]]:
    """Coordinator's own view — their currently active grants (not past/expired
    history; this powers "you have temporary access" UI, not an audit view)."""
    user_id = get_user_id(user)
    org_id = get_user_organization_id(user)
    if not user_id or not org_id:
        return []
    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc).isoformat()
    result = (
        supabase.table("access_grants")
        .select("*")
        .eq("granted_to_user_id", user_id)
        .eq("organization_id", org_id)
        .is_("revoked_at", "null")
        .gt("expires_at", now)
        .order("expires_at", desc=False)
        .execute()
    )
    rows = result.data or []
    return [_with_computed_status(row) for row in rows]
