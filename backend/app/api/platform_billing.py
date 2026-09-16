"""CareCliQ's own platform subscription billing (Stripe) — public signup plus
the existing-org billing settings page. Distinct from billing.py, which is
NDIS participant funding and never touches Stripe."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from ..core.access import has_active_grant
from ..core.config import settings
from ..core.security import get_current_user
from ..services import stripe_service
from ..services.supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/platform-billing", tags=["platform-billing"])


def _require_md(current_user: dict) -> str:
    if current_user.get("role") != "managing_director" and not has_active_grant(
        current_user, "platform_billing", get_supabase_admin()
    ):
        raise HTTPException(status_code=403, detail="Only a managing director can manage billing.")
    org_id = current_user.get("organization_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="Organization membership required.")
    return org_id


def _require_super_admin(current_user: dict) -> None:
    if current_user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Super admin access required.")


class SignupCheckoutBody(BaseModel):
    plan_tier: str


class CheckoutBody(BaseModel):
    plan_tier: str


@router.post("/signup/checkout")
async def create_signup_checkout(body: SignupCheckoutBody):
    """Public — no account exists yet. The marketing site's plan buttons link
    to the /get-started page in this app, which calls this to start Checkout."""
    if body.plan_tier not in stripe_service.PLAN_TIERS:
        raise HTTPException(status_code=400, detail=f"Invalid plan_tier. Must be one of: {', '.join(stripe_service.PLAN_TIERS)}")
    base = settings.frontend_base_url.rstrip("/")
    try:
        url = stripe_service.create_signup_checkout_session(
            plan_tier=body.plan_tier,
            success_url=f"{base}/get-started?checkout=success",
            cancel_url=f"{base}/get-started?checkout=canceled",
        )
    except Exception as exc:
        logger.error("create_signup_checkout failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not start checkout. Please try again.")
    return {"checkout_url": url}


class ResendInviteBody(BaseModel):
    email: str


@router.post("/signup/resend-invite")
async def resend_signup_invite(body: ResendInviteBody):
    """Public — re-sends a pending founding-MD invite. Always returns the
    same generic response whether or not a matching invite exists, and is
    rate-limited server-side (resend_signup_invite), so this can't be used
    to discover which emails have signed up."""
    try:
        stripe_service.resend_signup_invite(body.email)
    except Exception as exc:
        logger.error("resend_signup_invite failed: %s", exc)
    return {"message": "If that email has a pending invite, we've sent it again."}


@router.get("/signup/session-email")
async def get_signup_session_email(session_id: str):
    """Public — the email a signup Checkout session collected, so the
    post-payment 'Check your email' screen can offer a resend without
    asking the person to retype their address. Returns nothing beyond the
    email string."""
    email = stripe_service.get_signup_session_email(session_id)
    return {"email": email}


@router.get("/status")
async def get_status(current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    from ..services.supabase_client import get_supabase_admin

    resp = (
        get_supabase_admin()
        .table("organizations")
        .select("plan_tier, subscription_status, trial_ends_at, stripe_customer_id")
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Organization not found.")
    return rows[0]


@router.post("/checkout")
async def create_checkout(body: CheckoutBody, current_user: dict = Depends(get_current_user)):
    """Existing org starting or changing tier from the billing settings page."""
    org_id = _require_md(current_user)
    if body.plan_tier not in stripe_service.PLAN_TIERS:
        raise HTTPException(status_code=400, detail=f"Invalid plan_tier. Must be one of: {', '.join(stripe_service.PLAN_TIERS)}")
    base = settings.frontend_base_url.rstrip("/")
    try:
        url = stripe_service.create_checkout_session(
            organization_id=org_id,
            plan_tier=body.plan_tier,
            success_url=f"{base}/settings?billing=success",
            cancel_url=f"{base}/settings?billing=canceled",
        )
    except Exception as exc:
        logger.error("create_checkout failed for org %s: %s", org_id, exc)
        raise HTTPException(status_code=500, detail="Could not start checkout. Please try again.")
    return {"checkout_url": url}


@router.post("/portal")
async def create_portal(current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    base = settings.frontend_base_url.rstrip("/")
    try:
        url = stripe_service.create_portal_session(organization_id=org_id, return_url=f"{base}/settings")
    except Exception as exc:
        logger.error("create_portal failed for org %s: %s", org_id, exc)
        raise HTTPException(status_code=500, detail="Could not open the billing portal. Please try again.")
    return {"portal_url": url}


@router.get("/admin/orphaned-sessions")
async def list_orphaned_signup_sessions(current_user: dict = Depends(get_current_user)):
    """Signup Checkout sessions that completed payment with no matching
    organization - a missed/failed webhook delivery. Platform-level, not
    org-level, so gated to super_admin rather than _require_md."""
    _require_super_admin(current_user)
    try:
        return {"sessions": stripe_service.find_orphaned_signup_sessions()}
    except Exception as exc:
        logger.error("find_orphaned_signup_sessions failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not check for orphaned sessions.")


@router.post("/admin/reconcile/{checkout_session_id}")
async def reconcile_signup_session(checkout_session_id: str, current_user: dict = Depends(get_current_user)):
    """Manually replays org creation for one orphaned signup session - the
    support-runbook action for 'customer says they paid but got no email',
    made real instead of a written procedure."""
    _require_super_admin(current_user)
    try:
        ok = stripe_service.reconcile_signup_session(checkout_session_id)
    except Exception as exc:
        logger.error("reconcile_signup_session failed for %s: %s", checkout_session_id, exc)
        raise HTTPException(status_code=500, detail="Could not reconcile this session.")
    if not ok:
        raise HTTPException(status_code=400, detail="Not a completed signup session, or an organization already exists for it.")
    return {"reconciled": True}


@router.post("/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    try:
        stripe_service.handle_webhook_event(payload, sig_header)
    except Exception as exc:
        logger.warning("Stripe webhook rejected: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid webhook payload or signature.")
    return {"received": True}
