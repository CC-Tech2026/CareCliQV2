"""Invitation system — create and accept staff invitations.

Flow:
  1. Admin/coordinator calls POST /invitations/create with email + role.
  2. Backend stores invite record with a secure token; returns invite_url.
  3. Admin shares the invite URL with the staff member (copy/email).
  4. Staff member opens /accept-invite?token=X in browser.
  5. Frontend calls GET /invitations/validate/{token} to show org + role info.
  6. Staff member sets their name + password.
  7. Frontend calls POST /invitations/accept/{token} — backend creates the user,
     links them to the organization, and returns an access_token so they are
     immediately logged in.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.security import create_access_token, get_current_user
from ..services.supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/invitations", tags=["invitations"])

COORDINATOR_ROLES = frozenset({"support_coordinator", "admin"})
VALID_INVITE_ROLES = ("support_worker", "allied_health", "allied_health_pro", "support_coordinator", "admin", "auditor")

_INVITE_ROLE_TO_ACCOUNT_TYPE: dict[str, str] = {
    "support_worker":     "independent_worker",
    "allied_health":      "allied_health",
    "allied_health_pro":  "allied_health",
    "support_coordinator": "small_provider",
    "admin":              "small_provider",
    "auditor":            "independent_worker",
}


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class InviteCreateRequest(BaseModel):
    email: str
    role: str = "support_worker"


class InviteAcceptRequest(BaseModel):
    full_name: str
    password: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/create", status_code=201)
async def create_invite(
    body: InviteCreateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Create an invitation for a new staff member (admin/coordinator only)."""
    user_role = current_user.get("role", "")
    if user_role not in COORDINATOR_ROLES:
        raise HTTPException(status_code=403, detail="Only administrators can send invitations")

    org_id = current_user.get("organization_id")
    if not org_id:
        raise HTTPException(
            status_code=400,
            detail="You must belong to an organization to invite staff",
        )

    if body.role not in VALID_INVITE_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid role. Must be one of: {', '.join(VALID_INVITE_ROLES)}",
        )

    token = secrets.token_hex(32)
    expires_at = (_now_utc() + timedelta(days=7)).isoformat()
    email = body.email.lower().strip()

    try:
        supabase = get_supabase_admin()

        # Check for an existing pending invite for this email + org
        existing = (
            supabase.table("invitations")
            .select("id, accepted_at, expires_at")
            .eq("organization_id", org_id)
            .eq("email", email)
            .is_("accepted_at", "null")
            .execute()
        )
        if existing.data:
            ex = existing.data[0]
            ex_expires = _parse_iso(ex["expires_at"])
            if ex_expires > _now_utc():
                raise HTTPException(
                    status_code=409,
                    detail=f"A pending invitation for {email} already exists. Revoke it first or wait for it to expire.",
                )
            # Expired — delete and re-issue
            supabase.table("invitations").delete().eq("id", ex["id"]).execute()

        result = supabase.table("invitations").insert({
            "organization_id": org_id,
            "invited_by": current_user.get("sub"),
            "email": email,
            "role": body.role,
            "token": token,
            "expires_at": expires_at,
        }).execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create invitation")

        invite = result.data[0]
        logger.info(
            "Invite created: org=%s email=%s role=%s by=%s",
            org_id[:8], email, body.role, (current_user.get("sub") or "")[:8],
        )
        return {
            "id": invite["id"],
            "email": invite["email"],
            "role": invite["role"],
            "token": token,
            "expires_at": invite["expires_at"],
            "invite_url": f"/accept-invite?token={token}",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("create_invite error: %s", e)
        raise HTTPException(status_code=500, detail="Failed to create invitation")


@router.get("/list")
async def list_invites(current_user: dict = Depends(get_current_user)):
    """List all pending invitations for the current organization."""
    user_role = current_user.get("role", "")
    if user_role not in COORDINATOR_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")

    org_id = current_user.get("organization_id")
    if not org_id:
        return []

    try:
        supabase = get_supabase_admin()
        result = (
            supabase.table("invitations")
            .select("id, email, role, expires_at, accepted_at, created_at")
            .eq("organization_id", org_id)
            .order("created_at", desc=True)
            .execute()
        )
        return result.data or []
    except Exception as e:
        logger.error("list_invites error: %s", e)
        return []


@router.delete("/revoke/{invite_id}", status_code=204)
async def revoke_invite(invite_id: str, current_user: dict = Depends(get_current_user)):
    """Revoke (delete) a pending invitation."""
    user_role = current_user.get("role", "")
    if user_role not in COORDINATOR_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")

    org_id = current_user.get("organization_id")
    try:
        supabase = get_supabase_admin()
        supabase.table("invitations").delete().eq("id", invite_id).eq("organization_id", org_id).execute()
    except Exception as e:
        logger.error("revoke_invite error: %s", e)
        raise HTTPException(status_code=500, detail="Failed to revoke invitation")


@router.get("/validate/{token}")
async def validate_invite(token: str):
    """Public endpoint — validate an invite token and return preview info."""
    try:
        supabase = get_supabase_admin()
        result = (
            supabase.table("invitations")
            .select("id, email, role, expires_at, accepted_at, organization_id")
            .eq("token", token)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Invitation not found")

        invite = result.data[0]

        if invite.get("accepted_at"):
            raise HTTPException(status_code=410, detail="This invitation has already been accepted")

        if _parse_iso(invite["expires_at"]) < _now_utc():
            raise HTTPException(status_code=410, detail="This invitation has expired")

        # Fetch org name for display
        org_name = None
        try:
            org_res = (
                supabase.table("organizations")
                .select("organization_name")
                .eq("id", invite["organization_id"])
                .execute()
            )
            if org_res.data:
                org_name = org_res.data[0].get("organization_name")
        except Exception:
            pass

        return {
            "email": invite["email"],
            "role": invite["role"],
            "organization_id": invite["organization_id"],
            "organization_name": org_name,
            "expires_at": invite["expires_at"],
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("validate_invite error: %s", e)
        raise HTTPException(status_code=500, detail="Failed to validate invitation")


@router.get("/members")
async def list_members(current_user: dict = Depends(get_current_user)):
    """List all active members in the current organization."""
    org_id = current_user.get("organization_id")
    if not org_id:
        return []

    try:
        supabase = get_supabase_admin()
        result = (
            supabase.table("organization_members")
            .select("id, user_id, role, is_active, joined_at")
            .eq("organization_id", org_id)
            .eq("is_active", True)
            .execute()
        )
        members = result.data or []

        # Batch-fetch user names + emails
        user_ids = [m["user_id"] for m in members]
        if user_ids:
            users_res = (
                supabase.table("users")
                .select("id, full_name, email")
                .in_("id", user_ids)
                .execute()
            )
            user_map = {u["id"]: u for u in (users_res.data or [])}
            for m in members:
                u = user_map.get(m["user_id"], {})
                m["full_name"] = u.get("full_name", "")
                m["email"] = u.get("email", "")

        return members
    except Exception as e:
        logger.error("list_members error: %s", e)
        return []


@router.patch("/members/{member_id}/role", status_code=200)
async def update_member_role(
    member_id: str,
    body: dict,
    current_user: dict = Depends(get_current_user),
):
    """Update a member's role (admin only)."""
    if current_user.get("role") not in COORDINATOR_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")

    org_id = current_user.get("organization_id")
    new_role = (body or {}).get("role")
    if new_role not in VALID_INVITE_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role: {new_role}")

    try:
        supabase = get_supabase_admin()
        supabase.table("organization_members").update({"role": new_role}).eq("id", member_id).eq("organization_id", org_id).execute()
        return {"ok": True}
    except Exception as e:
        logger.error("update_member_role error: %s", e)
        raise HTTPException(status_code=500, detail="Failed to update role")


@router.delete("/members/{member_id}", status_code=204)
async def remove_member(member_id: str, current_user: dict = Depends(get_current_user)):
    """Deactivate an org member (does not delete their account)."""
    if current_user.get("role") not in COORDINATOR_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")

    org_id = current_user.get("organization_id")
    try:
        supabase = get_supabase_admin()
        supabase.table("organization_members").update({"is_active": False}).eq("id", member_id).eq("organization_id", org_id).execute()
    except Exception as e:
        logger.error("remove_member error: %s", e)
        raise HTTPException(status_code=500, detail="Failed to remove member")


@router.post("/accept/{token}", status_code=201)
async def accept_invite(token: str, body: InviteAcceptRequest):
    """Public endpoint — create a new user account from an invitation.

    On success returns an access_token so the invitee is immediately logged in.
    """
    supabase = get_supabase_admin()

    # ------------------------------------------------------------------
    # 1. Validate the token
    # ------------------------------------------------------------------
    result = (
        supabase.table("invitations")
        .select("id, email, role, expires_at, accepted_at, organization_id, invited_by")
        .eq("token", token)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Invitation not found")

    invite = result.data[0]

    if invite.get("accepted_at"):
        raise HTTPException(status_code=410, detail="This invitation has already been accepted")

    if _parse_iso(invite["expires_at"]) < _now_utc():
        raise HTTPException(status_code=410, detail="This invitation has expired")

    email = invite["email"]
    role  = invite["role"]
    org_id = invite["organization_id"]
    account_type = _INVITE_ROLE_TO_ACCOUNT_TYPE.get(role, "independent_worker")

    # ------------------------------------------------------------------
    # 2. Create the Supabase Auth user
    # ------------------------------------------------------------------
    try:
        create_result = supabase.auth.admin.create_user({
            "email": email,
            "password": body.password,
            "user_metadata": {"full_name": body.full_name},
            "email_confirm": True,
        })
        auth_user = create_result.user
        if not auth_user:
            raise HTTPException(status_code=400, detail="Failed to create account")
    except HTTPException:
        raise
    except Exception as e:
        err = str(e).lower()
        if "already" in err or "exists" in err:
            raise HTTPException(
                status_code=409,
                detail="An account with this email already exists. Please sign in and contact your administrator to link you to the organization.",
            )
        logger.error("accept_invite create_user error: %s", e)
        raise HTTPException(status_code=400, detail="Failed to create account — please try again")

    user_id = str(auth_user.id)

    # ------------------------------------------------------------------
    # 3. Create public.users profile row
    # ------------------------------------------------------------------
    try:
        from ..api.auth import _upsert_user_record
        await _upsert_user_record(
            user_id=user_id,
            email=email,
            role=role,
            full_name=body.full_name,
            account_type=account_type,
            onboarding_complete=True,
            organization_id=org_id,
        )
    except Exception as e:
        logger.error("accept_invite _upsert_user_record error: %s", e)

    # ------------------------------------------------------------------
    # 4. Link to organization via organization_members
    # ------------------------------------------------------------------
    try:
        supabase.table("organization_members").insert({
            "user_id": user_id,
            "organization_id": org_id,
            "role": role,
            "is_active": True,
            "invited_by": invite.get("invited_by"),
        }).execute()
    except Exception as e:
        logger.error("accept_invite organization_members insert error: %s", e)

    # ------------------------------------------------------------------
    # 5. Mark invite as accepted
    # ------------------------------------------------------------------
    try:
        supabase.table("invitations").update({
            "accepted_at": _now_utc().isoformat(),
            "accepted_by": user_id,
        }).eq("id", invite["id"]).execute()
    except Exception as e:
        logger.warning("accept_invite mark-accepted error (non-critical): %s", e)

    # ------------------------------------------------------------------
    # 6. Issue access token — invitee is immediately signed in
    # ------------------------------------------------------------------
    access_token = create_access_token({
        "sub": user_id,
        "email": email,
        "role": role,
        "account_type": account_type,
        "organization_id": org_id,
    })

    logger.info(
        "Invite accepted: user=%s role=%s org=%s",
        user_id[:8], role, org_id[:8],
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user_id,
            "email": email,
            "full_name": body.full_name,
            "role": role,
            "account_type": account_type,
            "organization_id": org_id,
            "onboarding_complete": True,
        },
    }
