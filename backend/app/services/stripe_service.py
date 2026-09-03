"""CareCliQ's own platform subscription billing via Stripe.

Distinct from backend/app/api/billing.py, which is NDIS participant funding
(revenue reports, billing periods, NDIS price catalog) and never touches
Stripe — this module is CareCliQ charging the provider organizations that
use the platform.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import stripe

from ..core.config import settings
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

stripe.api_key = settings.stripe_secret_key

PLAN_TIERS = ("micro", "small", "medium")
SIGNUP_TRIAL_DAYS = 30

_LOOKUP_KEY_BY_TIER = {tier: f"{tier}_monthly" for tier in PLAN_TIERS}
_TIER_BY_LOOKUP_KEY = {v: k for k, v in _LOOKUP_KEY_BY_TIER.items()}


def _price_id_for_tier(plan_tier: str) -> str:
    if plan_tier not in PLAN_TIERS:
        raise ValueError(f"Unknown plan tier: {plan_tier}")
    lookup_key = _LOOKUP_KEY_BY_TIER[plan_tier]
    prices = stripe.Price.list(lookup_keys=[lookup_key], active=True, limit=1)
    if not prices.data:
        raise ValueError(f"No active Stripe price for tier '{plan_tier}' (lookup_key={lookup_key})")
    return prices.data[0].id


def _tier_for_price(price_id: str) -> Optional[str]:
    # stripe-python 15.x resource objects (Price, Subscription, Session, ...)
    # are no longer dict subclasses - .get() raises on them. .to_dict()
    # converts (recursively) to plain dicts/lists so the rest of this module
    # can keep using ordinary dict access throughout.
    price = stripe.Price.retrieve(price_id).to_dict()
    lookup_key = price.get("lookup_key")
    return _TIER_BY_LOOKUP_KEY.get(lookup_key) if lookup_key else None


# ---------------------------------------------------------------------------
# New-customer signup (no organization exists yet)
# ---------------------------------------------------------------------------

def create_signup_checkout_session(
    *, plan_tier: str, success_url: str, cancel_url: str
) -> str:
    """Public /signup flow. Collects company name via a Checkout custom field
    and email via Checkout's own built-in field — no org or user account is
    created here. handle_webhook_event() does that once checkout.session.completed
    confirms payment, so no half-signed-up org/user rows pile up from
    abandoned checkouts."""
    price_id = _price_id_for_tier(plan_tier)
    session = stripe.checkout.Session.create(
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        subscription_data={
            "trial_period_days": SIGNUP_TRIAL_DAYS,
            "metadata": {"plan_tier": plan_tier, "signup": "true"},
        },
        custom_fields=[{
            "key": "organization_name",
            "label": {"type": "custom", "custom": "Organisation name"},
            "type": "text",
        }],
        # A tax registration alone doesn't calculate anything - Checkout only
        # applies GST/VAT when a session explicitly opts in. Requires a
        # billing address to determine jurisdiction, so Checkout collects one.
        automatic_tax={"enabled": True},
        billing_address_collection="required",
        metadata={"plan_tier": plan_tier, "signup": "true"},
        success_url=success_url,
        cancel_url=cancel_url,
    )
    if not session.url:
        raise RuntimeError("Stripe did not return a Checkout URL")
    return session.url


# ---------------------------------------------------------------------------
# Existing-org subscription management (billing settings page)
# ---------------------------------------------------------------------------

def get_or_create_customer(organization_id: str) -> str:
    supabase = get_supabase_admin()
    resp = (
        supabase.table("organizations")
        .select("organization_id, organization_name, email, stripe_customer_id")
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise ValueError("Organization not found")
    org = rows[0]
    if org.get("stripe_customer_id"):
        return org["stripe_customer_id"]

    customer = stripe.Customer.create(
        name=org.get("organization_name") or "CareCliQ organisation",
        email=org.get("email") or None,
        metadata={"organization_id": organization_id},
    )
    supabase.table("organizations").update(
        {"stripe_customer_id": customer.id}
    ).eq("organization_id", organization_id).execute()
    return customer.id


def create_checkout_session(
    *, organization_id: str, plan_tier: str, success_url: str, cancel_url: str
) -> str:
    """Existing org starting/changing a paid tier from the billing settings page."""
    customer_id = get_or_create_customer(organization_id)
    price_id = _price_id_for_tier(plan_tier)
    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": price_id, "quantity": 1}],
        client_reference_id=organization_id,
        automatic_tax={"enabled": True},
        customer_update={"address": "auto"},
        metadata={"organization_id": organization_id, "plan_tier": plan_tier},
        success_url=success_url,
        cancel_url=cancel_url,
    )
    if not session.url:
        raise RuntimeError("Stripe did not return a Checkout URL")
    return session.url


def create_portal_session(*, organization_id: str, return_url: str) -> str:
    customer_id = get_or_create_customer(organization_id)
    session = stripe.billing_portal.Session.create(customer=customer_id, return_url=return_url)
    return session.url


# ---------------------------------------------------------------------------
# Webhook
# ---------------------------------------------------------------------------

def handle_webhook_event(payload: bytes, sig_header: str) -> None:
    event = stripe.Webhook.construct_event(payload, sig_header, settings.stripe_webhook_secret)
    event_type = event["type"]
    # .to_dict() up front, once - stripe-python 15.x's Session/Subscription/
    # Invoice resource objects don't support .get() (they're no longer dict
    # subclasses), but every handler below relies on plain dict access.
    data = event["data"]["object"].to_dict()
    logger.info("Stripe webhook received: %s", event_type)

    if event_type == "checkout.session.completed":
        _handle_checkout_completed(data)
    elif event_type == "customer.subscription.updated":
        _sync_subscription(data)
    elif event_type == "customer.subscription.deleted":
        _sync_subscription(data, canceled=True)
    elif event_type == "invoice.payment_failed":
        _set_status_by_customer(data.get("customer"), "past_due")
    elif event_type == "invoice.paid":
        _sync_from_customer(data.get("customer"))


def _handle_checkout_completed(session: dict[str, Any]) -> None:
    is_signup = (session.get("metadata") or {}).get("signup") == "true"
    if is_signup:
        _create_org_from_signup(session)
        return

    organization_id = (session.get("metadata") or {}).get("organization_id") or session.get("client_reference_id")
    if not organization_id:
        logger.warning("checkout.session.completed with no organization_id/signup marker — ignoring")
        return
    _sync_from_customer(session.get("customer"), organization_id=organization_id)


def _create_org_from_signup(session: dict[str, Any]) -> None:
    plan_tier = (session.get("metadata") or {}).get("plan_tier")
    customer_id = session.get("customer")
    subscription_id = session.get("subscription")
    if not (plan_tier and customer_id and subscription_id):
        logger.error("Signup checkout.session.completed missing plan_tier/customer/subscription: %s", session.get("id"))
        return

    customer_details = session.get("customer_details") or {}
    email = (customer_details.get("email") or "").strip().lower()
    if not email:
        logger.error("Signup checkout.session.completed has no customer email: %s", session.get("id"))
        return

    organization_name = "New CareCliQ organisation"
    for field in session.get("custom_fields") or []:
        if field.get("key") == "organization_name":
            text = (field.get("text") or {}).get("value")
            if text:
                organization_name = text
            break

    subscription = stripe.Subscription.retrieve(subscription_id).to_dict()
    trial_ends_at = (
        datetime.fromtimestamp(subscription["trial_end"], tz=timezone.utc).isoformat()
        if subscription.get("trial_end")
        else None
    )

    supabase = get_supabase_admin()

    # A retried/duplicated webhook delivery for the same checkout must not
    # create a second organization — Stripe customer ids are unique per org.
    existing = (
        supabase.table("organizations")
        .select("organization_id")
        .eq("stripe_customer_id", customer_id)
        .limit(1)
        .execute()
    )
    if existing.data:
        logger.info("Signup webhook replay for existing org (customer=%s) — skipping org creation", customer_id)
        return

    org_resp = supabase.table("organizations").insert({
        # "name" is a separate legacy NOT NULL column alongside
        # organization_name (see admin.py's organization_name-or-name
        # display fallback) - both need the same value on insert.
        "name": organization_name,
        "organization_name": organization_name,
        "owner_user_id": None,
        "plan_tier": plan_tier,
        "stripe_customer_id": customer_id,
        "stripe_subscription_id": subscription_id,
        "subscription_status": subscription.get("status") or "trialing",
        "trial_ends_at": trial_ends_at,
        "email": email,
    }).execute()
    if not org_resp.data:
        logger.error("Failed to create organization for signup checkout %s", session.get("id"))
        return
    org_id = org_resp.data[0]["organization_id"]

    _send_founding_md_invite(org_id=org_id, email=email, organization_name=organization_name)


def _send_founding_md_invite(*, org_id: str, email: str, organization_name: str) -> None:
    import secrets as _secrets

    from ..api.invitations import _generate_short_code
    from .email_service import queue_invitation_email

    supabase = get_supabase_admin()
    token = _secrets.token_hex(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    short_code = _generate_short_code(supabase)

    supabase.table("invitations").insert({
        "organization_id": org_id,
        "invited_by": None,
        "email": email,
        "role": "managing_director",
        "token": token,
        "short_code": short_code,
        "expires_at": expires_at,
    }).execute()

    invite_url = f"{settings.frontend_base_url.rstrip('/')}/accept-invite?token={token}"
    queue_invitation_email(
        None,
        to_email=email,
        invite_url=invite_url,
        organization_name=organization_name,
        role="managing_director",
        short_code=short_code,
    )
    logger.info("Founding managing_director invite sent for new org %s to %s", org_id, email)


def _sync_subscription(subscription: dict[str, Any], *, canceled: bool = False) -> None:
    customer_id = subscription.get("customer")
    status = "canceled" if canceled else (subscription.get("status") or "active")
    plan_tier = None
    items = ((subscription.get("items") or {}).get("data") or [])
    if items:
        price = items[0].get("price") or {}
        price_id = price.get("id")
        if price_id:
            plan_tier = _tier_for_price(price_id)
    trial_ends_at = (
        datetime.fromtimestamp(subscription["trial_end"], tz=timezone.utc).isoformat()
        if subscription.get("trial_end")
        else None
    )
    _set_status_by_customer(
        customer_id,
        status,
        subscription_id=subscription.get("id"),
        plan_tier=plan_tier,
        trial_ends_at=trial_ends_at,
    )


def _sync_from_customer(customer_id: Optional[str], *, organization_id: Optional[str] = None) -> None:
    if not customer_id:
        return
    subs = stripe.Subscription.list(customer=customer_id, limit=1, status="all")
    if not subs.data:
        return
    subscription = subs.data[0].to_dict()
    plan_tier = None
    items = ((subscription.get("items") or {}).get("data") or [])
    if items:
        price = items[0].get("price") or {}
        price_id = price.get("id")
        if price_id:
            plan_tier = _tier_for_price(price_id)

    update: dict[str, Any] = {
        "stripe_subscription_id": subscription.get("id"),
        "subscription_status": subscription.get("status"),
    }
    if plan_tier:
        update["plan_tier"] = plan_tier

    supabase = get_supabase_admin()
    query = supabase.table("organizations").update(update)
    if organization_id:
        query.eq("organization_id", organization_id).execute()
    else:
        query.eq("stripe_customer_id", customer_id).execute()


def _set_status_by_customer(
    customer_id: Optional[str],
    status: str,
    *,
    subscription_id: Optional[str] = None,
    plan_tier: Optional[str] = None,
    trial_ends_at: Optional[str] = None,
) -> None:
    if not customer_id:
        return
    update: dict[str, Any] = {"subscription_status": status}
    if subscription_id:
        update["stripe_subscription_id"] = subscription_id
    if plan_tier:
        update["plan_tier"] = plan_tier
    if trial_ends_at is not None:
        update["trial_ends_at"] = trial_ends_at
    get_supabase_admin().table("organizations").update(update).eq(
        "stripe_customer_id", customer_id
    ).execute()
