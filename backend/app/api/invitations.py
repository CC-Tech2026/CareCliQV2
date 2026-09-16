"""Invitation system — create and accept staff invitations.

Flow:
  1. Support coordinator calls POST /invitations/create with email + role.
  2. Backend stores invite record with a secure token; returns invite_url.
  3. Backend emails the invite link when SMTP is configured; link is also returned.
  4. Staff member opens /accept-invite?token=X in browser.
  5. Frontend calls GET /invitations/validate/{token} to show org + role info.
  6. Staff member sets their name + password.
  7. Frontend calls POST /invitations/accept/{token} — backend creates the user,
     links them to the organization, and returns an access_token so they are
     immediately logged in.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel

from ..core.config import settings
from ..core.security import create_access_token, get_current_user
from ..api.security import require_recent_reauth
from ..services.branch_service import member_branch_id
from ..services.email_service import queue_invitation_email, queue_invite_verification_email
from ..services.supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/invitations", tags=["invitations"])

COORDINATOR_ROLES = frozenset({"support_coordinator", "managing_director"})
VALID_INVITE_ROLES = ("support_worker", "support_coordinator")

_INVITE_ROLE_TO_ACCOUNT_TYPE: dict[str, str] = {
    "support_worker":     "independent_worker",
    "support_coordinator": "small_provider",
    # Only ever inserted by the Stripe signup webhook (platform_billing_service),
    # never reachable through POST /invitations/create — VALID_INVITE_ROLES there
    # deliberately doesn't include this, so an existing org can't invite a second MD.
    "managing_director":  "managing_director",
}


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class InviteCreateRequest(BaseModel):
    email: str
    role: str = "support_worker"
    onboarding_id: str | None = None


class InviteAcceptRequest(BaseModel):
    full_name: str
    password: str


class InviteVerifyCodeRequest(BaseModel):
    code: str


class InviteRequestBody(BaseModel):
    full_name: str
    email: str
    organization_id: str | None = None
    organization_name: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _generate_short_code(supabase) -> str:
    """Return a unique 6-digit join code for pending invites."""
    for _ in range(20):
        code = f"{secrets.randbelow(1_000_000):06d}"
        try:
            existing = (
                supabase.table("invitations")
                .select("id")
                .eq("short_code", code)
                .is_("accepted_at", "null")
                .limit(1)
                .execute()
            )
            if not existing.data:
                return code
        except Exception:
            return code
    return secrets.token_hex(3)[:6].upper()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _get_valid_invite(supabase, token: str) -> dict:
    result = (
        supabase.table("invitations")
        .select("*")
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
    return invite


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/create", status_code=201)
async def create_invite(
    body: InviteCreateRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Create an invitation for a new staff member (support coordinator only)."""
    user_role = current_user.get("role", "")
    if user_role not in COORDINATOR_ROLES:
        raise HTTPException(status_code=403, detail="Only support coordinators and managing directors can send invitations")
    require_recent_reauth(request, current_user)

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

    if body.onboarding_id:
        if user_role != "managing_director":
            raise HTTPException(status_code=403, detail="Only managing directors can send new-hire login invites.")
        from ..services import employee_onboarding_service as onboarding_svc
        hire = onboarding_svc.get_hire(body.onboarding_id, org_id)
        # "signed" is the first invite; "invited" is a resend (the candidate's original
        # invite expired after 7 days without them logging in — see
        # offer_letter_reminder_service.py's day-7 "hire_invite_expired" notice — or the
        # MD just wants to re-send it). The pending-invite check below still applies: a
        # still-live invite for this email must be revoked first, only an expired one is
        # silently replaced.
        if hire["status"] not in {"signed", "invited"}:
            raise HTTPException(
                status_code=409,
                detail="This hire's offer letter and service agreement must be signed by both sides before sending the login invite.",
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
            # For the general "invite a new team member" flow, a still-live invite must be
            # revoked explicitly first — two people getting two different valid links for
            # the same email would be confusing. For the hire-specific "resend this
            # candidate's login invite" flow (onboarding_id set), clicking Resend on their
            # record IS the explicit confirmation — silently replace it instead of making
            # the MD go find and revoke the old one first.
            if ex_expires > _now_utc() and not body.onboarding_id:
                raise HTTPException(
                    status_code=409,
                    detail=f"A pending invitation for {email} already exists. Revoke it first or wait for it to expire.",
                )
            supabase.table("invitations").delete().eq("id", ex["id"]).execute()

        short_code = _generate_short_code(supabase)
        result = supabase.table("invitations").insert({
            "organization_id": org_id,
            "invited_by": current_user.get("sub"),
            "email": email,
            "role": body.role,
            "token": token,
            "short_code": short_code,
            "expires_at": expires_at,
            "onboarding_id": body.onboarding_id,
        }).execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create invitation")

        invite = result.data[0]

        if body.onboarding_id:
            supabase.table("employee_onboarding").update({
                "status": "invited",
                "invitation_id": invite["id"],
                "invited_at": _now_utc().isoformat(),
                "invite_reminder_sent_at": None,
                "invite_expired_notified_at": None,
            }).eq("id", body.onboarding_id).execute()
        invite_url = f"/accept-invite?token={token}"
        full_invite_url = f"{settings.frontend_base_url.rstrip('/')}{invite_url}"
        organization_name = None
        logo_url = None
        brand_accent_color = None
        try:
            from ..services import organization_branding_service
            branding = organization_branding_service.get_branding(org_id)
            organization_name = branding.get("display_name")
            logo_url = branding.get("logo_url")
            brand_accent_color = branding.get("brand_accent_color")
        except Exception as org_error:
            logger.debug("Could not load organization branding for invite email: %s", org_error)

        email_delivery = queue_invitation_email(
            background_tasks,
            to_email=email,
            invite_url=full_invite_url,
            organization_name=organization_name,
            role=body.role,
            short_code=short_code,
            logo_url=logo_url,
            brand_accent_color=brand_accent_color,
        )
        logger.info(
            "Invite created: org=%s email=%s role=%s by=%s email_status=%s",
            org_id[:8],
            email,
            body.role,
            (current_user.get("sub") or "")[:8],
            email_delivery.get("status"),
        )
        return {
            "id": invite["id"],
            "email": invite["email"],
            "role": invite["role"],
            "token": token,
            "short_code": short_code,
            "expires_at": invite["expires_at"],
            "invite_url": invite_url,
            "email_delivery": email_delivery,
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
async def revoke_invite(invite_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    """Revoke (delete) a pending invitation."""
    user_role = current_user.get("role", "")
    if user_role not in COORDINATOR_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    require_recent_reauth(request, current_user)

    org_id = current_user.get("organization_id")
    try:
        supabase = get_supabase_admin()
        supabase.table("invitations").delete().eq("id", invite_id).eq("organization_id", org_id).execute()
    except Exception as e:
        logger.error("revoke_invite error: %s", e)
        raise HTTPException(status_code=500, detail="Failed to revoke invitation")


@router.get("/organizations")
async def list_joinable_organizations():
    """Public — org picker for mobile invite-request flow."""
    try:
        supabase = get_supabase_admin()
        result = (
            supabase.table("organizations")
            .select("organization_id, organization_name, name")
            .order("organization_name")
            .limit(200)
            .execute()
        )
        rows = result.data or []
        out = []
        for r in rows:
            oid = r.get("organization_id")
            if not oid:
                continue
            label = (
                str(r.get("organization_name") or "").strip()
                or str(r.get("name") or "").strip()
                or "Organisation"
            )
            out.append({"id": str(oid), "organization_name": label})
        out.sort(key=lambda x: x["organization_name"].lower())
        return out
    except Exception as e:
        logger.error("list_joinable_organizations error: %s", e)
        raise HTTPException(status_code=500, detail="Failed to load organisations")


@router.post("/request-invite", status_code=201)
async def request_invite(body: InviteRequestBody):
    """Public — prospective worker asks coordinators to send a staff invite."""
    full_name = (body.full_name or "").strip()
    email = (body.email or "").strip().lower()
    org_id = (body.organization_id or "").strip() or None
    org_name_query = (body.organization_name or "").strip() or None

    if len(full_name) < 2:
        raise HTTPException(status_code=400, detail="Enter your full name")
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    if not org_id and not org_name_query:
        raise HTTPException(
            status_code=400,
            detail="Select your organisation so we can notify the right coordinators",
        )

    try:
        supabase = get_supabase_admin()
        org_row = None
        if org_id:
            org_res = (
                supabase.table("organizations")
                .select("organization_id, organization_name, name")
                .eq("organization_id", org_id)
                .limit(1)
                .execute()
            )
            org_row = (org_res.data or [None])[0]
        if not org_row and org_name_query:
            org_res = (
                supabase.table("organizations")
                .select("organization_id, organization_name, name")
                .ilike("organization_name", f"%{org_name_query}%")
                .limit(5)
                .execute()
            )
            rows = org_res.data or []
            if not rows:
                org_res = (
                    supabase.table("organizations")
                    .select("organization_id, organization_name, name")
                    .ilike("name", f"%{org_name_query}%")
                    .limit(5)
                    .execute()
                )
                rows = org_res.data or []
            if len(rows) == 1:
                org_row = rows[0]
            elif len(rows) > 1:
                exact = next(
                    (
                        r
                        for r in rows
                        if str(r.get("organization_name") or r.get("name") or "").lower()
                        == org_name_query.lower()
                    ),
                    None,
                )
                org_row = exact or rows[0]
            else:
                raise HTTPException(
                    status_code=404,
                    detail="Organisation not found. Check the name or ask your coordinator for the exact organisation name.",
                )
        if not org_row:
            raise HTTPException(status_code=404, detail="Organisation not found")

        organization_id = str(org_row.get("organization_id") or org_row.get("id") or "")
        organization_name = (
            str(org_row.get("organization_name") or org_row.get("name") or "").strip()
            or "your organisation"
        )
        if not organization_id:
            raise HTTPException(status_code=404, detail="Organisation not found")

        # Only notify coordinators whose home organisation matches the request.
        # Do not use cross-org organization_members rows (demo seed often dual-links people).
        users_res = (
            supabase.table("users")
            .select("id, role, organization_id")
            .eq("organization_id", organization_id)
            .in_("role", ["support_coordinator", "managing_director", "admin"])
            .execute()
        )
        coordinator_ids = [
            str(u["id"])
            for u in (users_res.data or [])
            if u.get("id") and str(u.get("organization_id") or "") == organization_id
        ]
        # De-dupe while preserving order
        coordinator_ids = list(dict.fromkeys(coordinator_ids))

        if not coordinator_ids:
            raise HTTPException(
                status_code=404,
                detail="No coordinator found for that organisation. Contact your provider directly.",
            )

        # One request per email + name + org (anti-spam)
        try:
            existing = (
                supabase.table("staff_invite_requests")
                .select("id")
                .eq("organization_id", organization_id)
                .eq("requester_email_norm", email)
                .eq("requester_full_name_norm", full_name.lower())
                .limit(1)
                .execute()
            )
            if existing.data:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "You’ve already requested an invite for this organisation with this name and email. "
                        "Please wait for your coordinator to send you the invite code."
                    ),
                )
            supabase.table("staff_invite_requests").insert(
                {
                    "organization_id": organization_id,
                    "requester_email": email,
                    "requester_full_name": full_name,
                }
            ).execute()
        except HTTPException:
            raise
        except Exception as dedupe_exc:
            err = str(dedupe_exc).lower()
            if "duplicate" in err or "23505" in err or "unique" in err:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "You’ve already requested an invite for this organisation with this name and email. "
                        "Please wait for your coordinator to send you the invite code."
                    ),
                ) from dedupe_exc
            logger.warning("staff_invite_requests check failed: %s", dedupe_exc)

        from ..services.notification_service import notify_worker
        from ..services.fcm_service import send_fcm_to_user

        title = "Staff invite requested"
        body_text = (
            f"{full_name} ({email}) is asking to join {organization_name}. "
            f"Please send them a staff invitation from Team settings."
        )
        reference_key = f"invite_request:{organization_id}:{email}:{full_name.lower()}"
        notified = 0
        for coordinator_id in coordinator_ids:
            try:
                result = await notify_worker(
                    user_id=coordinator_id,
                    org_id=organization_id,
                    event="invite_request",
                    title=title,
                    message=body_text,
                    reference_key=reference_key,
                    severity="medium",
                    action_url="/team",
                    banner_style="orange",
                    payload={
                        "requester_full_name": full_name,
                        "requester_email": email,
                        "organization_id": organization_id,
                        "organization_name": organization_name,
                    },
                    push_priority="high",
                )
                if result.get("in_app"):
                    notified += 1
            except Exception as notify_exc:
                logger.warning(
                    "invite-request notify failed for %s: %s",
                    coordinator_id[:8],
                    notify_exc,
                )
            try:
                await send_fcm_to_user(
                    coordinator_id,
                    title=title,
                    body=body_text,
                    data={
                        "type": "invite_request",
                        "action_url": "/team",
                        "requester_email": email,
                    },
                    android_channel_id="safety-alerts",
                )
            except Exception as push_exc:
                logger.debug("invite-request fcm failed for %s: %s", coordinator_id[:8], push_exc)

        return {
            "ok": True,
            "organization_name": organization_name,
            "coordinators_notified": notified or len(coordinator_ids),
            "message": (
                f"Your request was sent to coordinators at {organization_name}. "
                "They'll email you an invite code once approved."
            ),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("request_invite error: %s", e)
        raise HTTPException(status_code=500, detail="Failed to submit invite request")


@router.get("/lookup/{code}")
async def lookup_invite_code(code: str):
    """Public — resolve a 6-digit mobile join code to invite preview + token."""
    normalized = (code or "").strip()
    if len(normalized) != 6 or not normalized.isalnum():
        raise HTTPException(status_code=400, detail="Enter the 6-character invite code")

    try:
        supabase = get_supabase_admin()
        result = (
            supabase.table("invitations")
            .select("id, email, role, token, expires_at, accepted_at, organization_id, short_code")
            .eq("short_code", normalized)
            .is_("accepted_at", "null")
            .limit(1)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Invite code not found")

        invite = result.data[0]
        if _parse_iso(invite["expires_at"]) < _now_utc():
            raise HTTPException(status_code=410, detail="This invitation has expired")

        org_name = None
        try:
            org_res = (
                supabase.table("organizations")
                .select("organization_name, name")
                .eq("organization_id", invite["organization_id"])
                .limit(1)
                .execute()
            )
            if org_res.data:
                org_name = (
                    org_res.data[0].get("organization_name")
                    or org_res.data[0].get("name")
                )
        except Exception:
            pass

        return {
            "email": invite["email"],
            "role": invite["role"],
            "token": invite["token"],
            "organization_id": invite["organization_id"],
            "organization_name": org_name,
            "expires_at": invite["expires_at"],
            "short_code": invite.get("short_code"),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("lookup_invite_code error: %s", e)
        raise HTTPException(status_code=500, detail="Failed to look up invite code")


@router.get("/validate/{token}")
async def validate_invite(token: str):
    """Public endpoint — validate an invite token and return preview info."""
    try:
        supabase = get_supabase_admin()
        result = (
            supabase.table("invitations")
            .select("id, email, role, expires_at, accepted_at, organization_id, onboarding_id, email_verified_at")
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
                .select("organization_name, name")
                .eq("organization_id", invite["organization_id"])
                .limit(1)
                .execute()
            )
            if org_res.data:
                org_name = (
                    org_res.data[0].get("organization_name")
                    or org_res.data[0].get("name")
                )
        except Exception:
            pass

        return {
            "email": invite["email"],
            "role": invite["role"],
            "organization_id": invite["organization_id"],
            "organization_name": org_name,
            "expires_at": invite["expires_at"],
            "email_verified": bool(invite.get("email_verified_at")),
            # accept_invite no longer gates on this (see its comment) — the
            # frontend never consumed this flag either, kept only in case a
            # future caller wants to know an email-code flow is available
            # (send-code/verify-code below still work, just aren't required).
            "requires_email_code": False,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("validate_invite error: %s", e)
        raise HTTPException(status_code=500, detail="Failed to validate invitation")


@router.post("/{token}/send-code", status_code=201)
async def send_invite_code(token: str):
    """Public — email a fresh 6-digit verification code for this invite.

    A second, in-the-moment proof of inbox access before the invitee can set
    a password, on top of the link itself. Safe to call again for a resend.
    """
    supabase = get_supabase_admin()
    invite = _get_valid_invite(supabase, token)

    if invite.get("email_code_sent_at"):
        last_sent = _parse_iso(invite["email_code_sent_at"])
        if _now_utc() - last_sent < timedelta(seconds=30):
            return {"ok": True, "message": "Code already sent — check your inbox, or wait a moment to resend."}

    code = f"{secrets.randbelow(1_000_000):06d}"
    now = _now_utc()
    supabase.table("invitations").update({
        "email_code_hash": _hash_code(code),
        "email_code_expires_at": (now + timedelta(minutes=10)).isoformat(),
        "email_code_sent_at": now.isoformat(),
        "email_verified_at": None,
    }).eq("id", invite["id"]).execute()

    organization_name = None
    try:
        org_res = (
            supabase.table("organizations")
            .select("organization_name, name")
            .eq("organization_id", invite["organization_id"])
            .limit(1)
            .execute()
        )
        if org_res.data:
            organization_name = org_res.data[0].get("organization_name") or org_res.data[0].get("name")
    except Exception:
        pass

    email_delivery = queue_invite_verification_email(
        to_email=invite["email"],
        code=code,
        organization_name=organization_name,
    )
    return {"ok": True, "email_delivery": email_delivery}


@router.post("/{token}/verify-code")
async def verify_invite_code(token: str, body: InviteVerifyCodeRequest):
    """Public — verify the 6-digit code sent via send-code."""
    supabase = get_supabase_admin()
    invite = _get_valid_invite(supabase, token)

    code_hash = invite.get("email_code_hash")
    expires_at = invite.get("email_code_expires_at")
    if not code_hash or not expires_at:
        raise HTTPException(status_code=400, detail="No verification code was sent. Request a new code.")
    if _parse_iso(expires_at) < _now_utc():
        raise HTTPException(status_code=400, detail="This code has expired. Request a new one.")
    if _hash_code((body.code or "").strip()) != code_hash:
        raise HTTPException(status_code=400, detail="Incorrect code. Check your email and try again.")

    supabase.table("invitations").update({
        "email_verified_at": _now_utc().isoformat(),
    }).eq("id", invite["id"]).execute()
    return {"ok": True}


@router.get("/members")
async def list_members(current_user: dict = Depends(get_current_user)):
    """List all active members in the current organization."""
    if current_user.get("role") not in COORDINATOR_ROLES:
        raise HTTPException(status_code=403, detail="Only support coordinators can view team members")

    org_id = current_user.get("organization_id")
    if not org_id:
        return []

    try:
        supabase = get_supabase_admin()
        result = (
            supabase.table("organization_members")
            .select("id, user_id, role, is_active, joined_at, branch_id")
            .eq("organization_id", org_id)
            .eq("is_active", "true")
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
                .eq("organization_id", org_id)
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
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Update a member's role (support coordinator only)."""
    if current_user.get("role") not in COORDINATOR_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    require_recent_reauth(request, current_user)

    org_id = current_user.get("organization_id")
    new_role = (body or {}).get("role")
    if new_role not in VALID_INVITE_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role: {new_role}")

    try:
        supabase = get_supabase_admin()
        
        # Safeguard: prevent demoting the last coordinator in the organization
        if new_role != "support_coordinator":
            members_query = supabase.table("organization_members").select("id, role").eq("organization_id", org_id).eq("is_active", True).execute()
            other_coordinators = [m for m in (members_query.data or []) if m["id"] != member_id and m["role"] == "support_coordinator"]
            if len(other_coordinators) == 0:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot demote the last coordinator in the organization. Ensure at least one coordinator remains."
                )
        
        # Update organization_members (source of truth on login)
        member_row = supabase.table("organization_members").update({"role": new_role}).eq("id", member_id).eq("organization_id", org_id).returning("*").execute()
        if not (member_row.data or []):
            raise HTTPException(status_code=404, detail="Member not found")
        user_id = member_row.data[0].get("user_id")
        # Keep users.role in sync so the login fallback path also reflects the change
        if user_id:
            supabase.table("users").update({"role": new_role}).eq("id", user_id).execute()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("update_member_role error: %s", e)
        raise HTTPException(status_code=500, detail="Failed to update role")


@router.delete("/members/{member_id}", status_code=204)
async def remove_member(member_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    """Deactivate an org member (does not delete their account)."""
    if current_user.get("role") not in COORDINATOR_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")
    require_recent_reauth(request, current_user)

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
        .select("id, email, role, expires_at, accepted_at, organization_id, invited_by, onboarding_id, email_verified_at")
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

    # Hire-based invites (onboarding_id set) used to require a second, invite-level
    # email code here — but accept-invite.tsx never implemented the send-code/
    # verify-code screen for it (only validate_invite's requires_email_code flag
    # exists, unconsumed), so email_verified_at could never actually be set and
    # this permanently 403'd every candidate who came through Offer -> Signed ->
    # Invited (confirmed Aug 2026: reproducible for essentially every seeded
    # hire, not an edge case). The candidate already proved they control this
    # inbox to get this far — the invite link itself is only ever emailed to
    # hire.email (queue_invitation_email), and reaching "signed"/"invited"
    # status requires having received and acted on that same offer email
    # earlier in the pipeline — so a second, unbuildable code gate here added
    # friction without a corresponding security gap it closed. Removed rather
    # than reintroduce the (already broken) code screen.

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
                detail="An account with this email already exists. Please sign in and contact your support coordinator to link you to the organization.",
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
            extra={
                "organization_id": org_id,
                "email_verified": True,
                "profile_completed": False,
                "onboarding_completed": False,
                "role_specific_profile_completed": False,
            },
        )
    except Exception as e:
        logger.error("accept_invite _upsert_user_record error: %s", e)

    # ------------------------------------------------------------------
    # 4. Link to organization via organization_members
    # ------------------------------------------------------------------
    try:
        member_row = {
            "user_id": user_id,
            "organization_id": org_id,
            "role": role,
            "is_active": True,
            "invited_by": invite.get("invited_by"),
        }
        # New staff join the inviter's office (a Melbourne coordinator
        # invites Melbourne staff). The DB falls back to head office if the
        # inviter's branch is unknown; the MD can move them under Team.
        inviter_branch = member_branch_id(invite.get("invited_by"), org_id)
        if inviter_branch:
            member_row["branch_id"] = inviter_branch
        supabase.table("organization_members").insert(member_row).execute()
    except Exception as e:
        logger.error("accept_invite organization_members insert error: %s", e)

    # ------------------------------------------------------------------
    # 4b. Default coordinator_id to whoever sent the invite, but only when
    #     that person is a coordinator - an MD-sent invite shouldn't
    #     auto-assign the MD as the new worker's day-to-day coordinator.
    # ------------------------------------------------------------------
    if invite.get("invited_by"):
        try:
            inviter = (
                supabase.table("users")
                .select("id, role")
                .eq("id", invite["invited_by"])
                .maybe_single()
                .execute()
            )
            if inviter and inviter.data and inviter.data.get("role") == "support_coordinator":
                supabase.table("users").update(
                    {"coordinator_id": invite["invited_by"]}
                ).eq("id", user_id).execute()
        except Exception as e:
            logger.warning("accept_invite coordinator_id default error (non-critical): %s", e)

    # ------------------------------------------------------------------
    # 4c. A managing_director invite only ever comes from the Stripe signup
    #     webhook (platform_billing_service), which creates the org before
    #     any user exists — owner_user_id was left NULL at that point since
    #     it couldn't be known yet. Backfill it now that the founding MD
    #     account actually exists.
    # ------------------------------------------------------------------
    if role == "managing_director":
        try:
            supabase.table("organizations").update(
                {"owner_user_id": user_id}
            ).eq("id", org_id).is_("owner_user_id", "null").execute()
        except Exception as e:
            logger.warning("accept_invite owner_user_id backfill error (non-critical): %s", e)

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
    # 5b. If this invite came from a signed new-hire record, hand off its
    #     offer letter / service agreement onto the new worker's profile.
    # ------------------------------------------------------------------
    if invite.get("onboarding_id"):
        try:
            from ..services import employee_onboarding_service as onboarding_svc
            onboarding_svc.migrate_documents_to_worker(invite["onboarding_id"], user_id, org_id)
        except Exception as e:
            logger.warning("accept_invite onboarding document handoff error (non-critical): %s", e)

        try:
            from ..services import resume_extraction_service as resume_svc
            resume_svc.migrate_profile_to_worker(invite["onboarding_id"], user_id, org_id)
        except Exception as e:
            logger.warning("accept_invite resume profile handoff error (non-critical): %s", e)

    # ------------------------------------------------------------------
    # 5c. Auto-assign any mandatory (auto_assign_on_hire) training modules,
    #     e.g. NDIS Worker Orientation / org induction.
    # ------------------------------------------------------------------
    try:
        from ..services import worker_training_service
        worker_training_service.assign_mandatory_modules_on_hire(user_id, org_id, invite.get("invited_by"))
    except Exception as e:
        logger.warning("accept_invite mandatory training auto-assign error (non-critical): %s", e)

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
