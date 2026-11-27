"""Quill credits: what each answer costs, who pays for it, and the ceilings
that stop CareCliQ being billed more than the plans bring in.

How it works
------------
* Every answer records its token use and real provider cost (US dollars),
  and is charged in credits. **One credit is US$0.001 of model use at the
  standard rate** (gpt-4o-mini). Measured on 2026-11-27: an ordinary
  question is about 1 credit (OpenAI caches the long instructions, so most
  of each request is billed at half price), a brief across several areas
  1 to 2, and a drafted report or template 2 to 5.
* Each Quill user (support coordinators and managing directors) gets a
  monthly allowance that renews on the 1st of the month. The whole
  organisation's included use is also capped, by plan, so a provider with
  many coordinators can't draw more than its plan was priced for.
* When the allowance is gone, a person can buy a pack (1,500 credits for
  A$5 + GST) through Stripe. Bought credits are theirs, are used only after
  the monthly allowance, and last 12 months.
* Two hard ceilings on real cost, whatever the credits say: per
  organisation per month, and across all of CareCliQ per month. These catch
  the expensive fallback model (Claude Opus 5.5 is ~27 times the price of
  gpt-4o-mini) running for a long stretch while OpenAI is down.

People are always charged at the standard rate, even when the fallback
model answered, because a provider outage isn't their doing. The real cost
is still recorded and counts toward both ceilings.

Every figure can be changed with an environment variable (see _settings).
"""
from __future__ import annotations

import logging
import math
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Optional

from fastapi import HTTPException, status

from ..core.timezone import APP_TIMEZONE
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

# US dollars per million tokens: (uncached input, cached input read,
# cache write, output). Checked 2026-11-27.
MODEL_PRICES_USD: dict[str, tuple[float, float, float, float]] = {
    "gpt-4o-mini": (0.15, 0.075, 0.15, 0.60),
    "claude-opus-5-5": (4.00, 0.20, 5.00, 20.00),
}
STANDARD_MODEL = "gpt-4o-mini"
# Anything unknown is priced as the dearest model we use, so a model
# swapped in without a price is over-counted rather than given away.
_UNKNOWN_PRICE = MODEL_PRICES_USD["claude-opus-5-5"]

PACK_CREDITS_DEFAULT = 1_500
PACK_PRICE_CENTS_DEFAULT = 500  # A$5.00, GST added at checkout
TOPUP_LIFETIME_DAYS = 365

# Monthly allowance per Quill user, and the organisation's included total.
_PLAN_ALLOWANCES = {
    "micro": (1_000, 3_000),
    "small": (1_000, 8_000),
    "medium": (1_000, 20_000),
}
# The real-cost ceiling per organisation, as a multiple of what its included
# credits are worth: room for the dearer fallback model, never open-ended.
_ORG_COST_CAP_MULTIPLE = 2.5
_DEFAULT_PLAN = "small"


def _env_number(name: str, default: float) -> float:
    try:
        value = float((os.environ.get(name) or "").strip() or default)
    except ValueError:
        return default
    return max(value, 0.0)


@dataclass(frozen=True)
class CreditSettings:
    credit_usd: float
    pack_credits: int
    pack_price_cents: int
    max_packs_per_month: int
    org_monthly_cost_cap_usd: float
    global_monthly_cost_cap_usd: float


def _settings() -> CreditSettings:
    return CreditSettings(
        credit_usd=_env_number("QUILL_CREDIT_USD", 0.001) or 0.001,
        pack_credits=int(_env_number("QUILL_PACK_CREDITS", PACK_CREDITS_DEFAULT)) or PACK_CREDITS_DEFAULT,
        pack_price_cents=int(_env_number("QUILL_PACK_PRICE_CENTS", PACK_PRICE_CENTS_DEFAULT)) or PACK_PRICE_CENTS_DEFAULT,
        max_packs_per_month=int(_env_number("QUILL_MAX_PACKS_PER_MONTH", 5)),
        # 0 means "work it out from the plan" (see org_cost_cap_usd).
        org_monthly_cost_cap_usd=_env_number("QUILL_ORG_MONTHLY_COST_CAP_USD", 0),
        global_monthly_cost_cap_usd=_env_number("QUILL_GLOBAL_MONTHLY_COST_CAP_USD", 300),
    )


def plan_allowance(plan_tier: Optional[str]) -> tuple[int, int]:
    """(credits per person per month, organisation total per month)."""
    tier = (plan_tier or "").strip().lower()
    person, org = _PLAN_ALLOWANCES.get(tier, _PLAN_ALLOWANCES[_DEFAULT_PLAN])
    env = tier.upper() or _DEFAULT_PLAN.upper()
    return (
        int(_env_number(f"QUILL_{env}_PERSON_CREDITS", person)),
        int(_env_number(f"QUILL_{env}_ORG_CREDITS", org)),
    )


def org_cost_cap_usd(org_total_credits: int) -> float:
    s = _settings()
    if s.org_monthly_cost_cap_usd:
        return s.org_monthly_cost_cap_usd
    return max(5.0, org_total_credits * s.credit_usd * _ORG_COST_CAP_MULTIPLE)


def period_start(now: Optional[datetime] = None) -> date:
    """The first of this month, in CareCliQ's home time zone, so everyone's
    allowance renews at the same moment."""
    local = (now or datetime.now(timezone.utc)).astimezone(APP_TIMEZONE)
    return local.date().replace(day=1)


def next_renewal(start: date) -> date:
    return (start.replace(day=28) + timedelta(days=4)).replace(day=1)


# ── Cost of one answer ───────────────────────────────────────────────────────

@dataclass
class ModelUsage:
    model: str
    input_tokens: int = 0         # everything sent, cached or not
    cached_input_tokens: int = 0  # the part read from cache
    cache_write_tokens: int = 0
    output_tokens: int = 0


def _price(model: str) -> tuple[float, float, float, float]:
    name = (model or "").lower()
    for known, price in MODEL_PRICES_USD.items():
        if name.startswith(known):
            return price
    return _UNKNOWN_PRICE


def cost_usd(usage: ModelUsage, model: Optional[str] = None) -> float:
    inp, cached, write, out = _price(model or usage.model)
    uncached = max(usage.input_tokens - usage.cached_input_tokens - usage.cache_write_tokens, 0)
    return (
        uncached * inp
        + usage.cached_input_tokens * cached
        + usage.cache_write_tokens * write
        + usage.output_tokens * out
    ) / 1_000_000


def credits_for(usages: list[ModelUsage]) -> Decimal:
    """Credits for one answer, always at the standard model's rate."""
    standard = sum(cost_usd(u, STANDARD_MODEL) for u in usages)
    credits = Decimal(str(standard / _settings().credit_usd)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    # An answer that got as far as a model call is never free.
    return max(credits, Decimal("0.25")) if usages else Decimal("0")


# ── Balances ────────────────────────────────────────────────────────────────

@dataclass
class CreditStatus:
    period_start: date
    renews_on: date
    allowance: int
    allowance_used: float
    allowance_left: float
    org_allowance: int
    org_used: float
    topup_balance: float
    remaining: float
    packs_bought_this_month: int
    paused_reason: Optional[str]

    def as_dict(self) -> dict[str, Any]:
        s = _settings()
        return {
            "period_start": self.period_start.isoformat(),
            "renews_on": self.renews_on.isoformat(),
            "allowance": self.allowance,
            "allowance_used": round(self.allowance_used, 1),
            "allowance_left": math.floor(self.allowance_left),
            "org_allowance": self.org_allowance,
            "org_used": round(self.org_used, 1),
            "topup_balance": math.floor(self.topup_balance),
            "remaining": math.floor(self.remaining),
            "can_ask": self.remaining > 0 and self.paused_reason is None,
            "paused_reason": self.paused_reason,
            "pack": {
                "credits": s.pack_credits,
                "price_cents": s.pack_price_cents,
                "currency": "aud",
                "gst_added": True,
            },
            "packs_left_this_month": max(s.max_packs_per_month - self.packs_bought_this_month, 0),
        }


def _org_plan_tier(organization_id: str) -> Optional[str]:
    try:
        rows = (
            get_supabase_admin().table("organizations").select("plan_tier")
            .eq("organization_id", organization_id).limit(1).execute()
        ).data or []
        return rows[0].get("plan_tier") if rows else None
    except Exception as exc:
        logger.warning("Could not read plan tier for org %s: %s", organization_id, exc)
        return None


def _active_topups(user_id: str, now: datetime) -> list[dict]:
    return (
        get_supabase_admin().table("quill_credit_topups")
        .select("credits, created_at, expires_at")
        .eq("user_id", user_id)
        .gt("expires_at", now.isoformat())
        .order("created_at")
        .limit(200)
        .execute()
    ).data or []


def credit_status(user_id: str, organization_id: str, now: Optional[datetime] = None) -> CreditStatus:
    now = now or datetime.now(timezone.utc)
    start = period_start(now)
    s = _settings()
    person, org_total = plan_allowance(_org_plan_tier(organization_id))

    topups = _active_topups(user_id, now)
    topup_since = topups[0]["created_at"] if topups else None
    totals = (
        get_supabase_admin().rpc("quill_credit_totals", {
            "p_user_id": user_id,
            "p_org_id": organization_id,
            "p_period": start.isoformat(),
            "p_topup_since": topup_since,
        }).execute()
    ).data or [{}]
    t = totals[0] if isinstance(totals, list) else totals
    user_included = float(t.get("user_included") or 0)
    org_included = float(t.get("org_included") or 0)
    org_cost = float(t.get("org_cost_usd") or 0)
    global_cost = float(t.get("global_cost_usd") or 0)
    topup_used = float(t.get("user_topup_used") or 0)

    allowance_left = max(min(person - user_included, org_total - org_included), 0.0)
    topup_balance = max(sum(int(r["credits"]) for r in topups) - topup_used, 0.0)
    month_start_utc = datetime.combine(start, datetime.min.time(), APP_TIMEZONE).astimezone(timezone.utc)
    packs_this_month = sum(1 for r in topups if _parse(r["created_at"]) >= month_start_utc)

    paused = None
    if s.global_monthly_cost_cap_usd and global_cost >= s.global_monthly_cost_cap_usd:
        logger.error("Quill paused: CareCliQ-wide monthly AI cost US$%.2f reached the cap", global_cost)
        paused = "Quill is paused for everyone until the 1st while we look into unusually high use."
    elif org_cost >= org_cost_cap_usd(org_total):
        logger.error("Quill paused for org %s: monthly AI cost US$%.2f reached the cap", organization_id, org_cost)
        paused = "Your organisation has reached this month's Quill limit. It renews on the 1st."

    return CreditStatus(
        period_start=start,
        renews_on=next_renewal(start),
        allowance=person,
        allowance_used=user_included,
        allowance_left=allowance_left,
        org_allowance=org_total,
        org_used=org_included,
        topup_balance=topup_balance,
        remaining=allowance_left + topup_balance,
        packs_bought_this_month=packs_this_month,
        paused_reason=paused,
    )


def _parse(value: Any) -> datetime:
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class OutOfCredits(HTTPException):
    """402: the person has no credits left (or Quill is paused). The detail
    carries their balance so the panel can offer a top-up straight away."""

    def __init__(self, status_dict: dict[str, Any], message: str):
        super().__init__(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={"message": message, "credits": status_dict},
        )


def ensure_can_ask(user_id: str, organization_id: str) -> Optional[CreditStatus]:
    """Raises OutOfCredits when the person can't ask. Returns None (and lets
    the question through) only if the credit tables can't be read, so a
    database hiccup doesn't take Quill down; the rate limits still apply."""
    try:
        st = credit_status(user_id, organization_id)
    except Exception as exc:
        logger.warning("Quill credit check skipped for user %s: %s", user_id, exc)
        return None
    if st.paused_reason:
        raise OutOfCredits(st.as_dict(), st.paused_reason)
    if st.remaining <= 0:
        renews = f"{st.renews_on.day} {st.renews_on.strftime('%B')}"
        raise OutOfCredits(
            st.as_dict(),
            f"You've used this month's Quill credits. They renew on {renews}, or you can add more now.",
        )
    return st


def record_usage(
    *, user_id: str, organization_id: str, thread_id: Optional[str],
    provider: Optional[str], usages: list[ModelUsage], before: Optional[CreditStatus],
) -> Optional[dict[str, Any]]:
    """Saves what an answer cost and returns the person's balance after it."""
    if not usages:
        return before.as_dict() if before else None
    credits = credits_for(usages)
    real_cost = sum(cost_usd(u) for u in usages)
    allowance_left = Decimal(str(before.allowance_left)) if before else credits
    from_allowance = min(credits, max(allowance_left, Decimal("0")))
    from_topup = credits - from_allowance
    model = usages[-1].model
    try:
        get_supabase_admin().table("quill_credit_usage").insert({
            "organization_id": organization_id,
            "user_id": user_id,
            "thread_id": thread_id,
            "period_start": period_start().isoformat(),
            "provider": provider,
            "model": model,
            "model_calls": len(usages),
            "input_tokens": sum(u.input_tokens for u in usages),
            "cached_input_tokens": sum(u.cached_input_tokens for u in usages),
            "output_tokens": sum(u.output_tokens for u in usages),
            "cost_usd": round(real_cost, 6),
            "credits": str(credits),
            "from_topup": str(from_topup),
        }).execute()
    except Exception as exc:
        logger.error("Could not record Quill usage for user %s (%.4f USD): %s", user_id, real_cost, exc)
        return before.as_dict() if before else None
    try:
        return credit_status(user_id, organization_id).as_dict()
    except Exception:
        return None


# ── Top-ups ─────────────────────────────────────────────────────────────────

def apply_topup(session: dict[str, Any]) -> None:
    """Called from the Stripe webhook when a credit-pack Checkout is paid.
    The session id is unique in the table, so a repeated delivery is a no-op."""
    meta = session.get("metadata") or {}
    if session.get("payment_status") != "paid":
        logger.info("Quill top-up %s not paid yet (%s)", session.get("id"), session.get("payment_status"))
        return
    try:
        credits = int(meta.get("credits") or 0)
    except ValueError:
        credits = 0
    if not (meta.get("user_id") and meta.get("organization_id") and credits > 0):
        logger.error("Quill top-up %s is missing its user, organisation or credits", session.get("id"))
        return
    now = datetime.now(timezone.utc)
    try:
        get_supabase_admin().table("quill_credit_topups").insert({
            "organization_id": meta["organization_id"],
            "user_id": meta["user_id"],
            "credits": credits,
            "amount_cents": int(session.get("amount_subtotal") or session.get("amount_total") or 0),
            "currency": session.get("currency") or "aud",
            "stripe_checkout_session_id": session["id"],
            "stripe_payment_intent_id": session.get("payment_intent"),
            "expires_at": (now + timedelta(days=TOPUP_LIFETIME_DAYS)).isoformat(),
        }).execute()
    except Exception as exc:
        if "duplicate key" in str(exc).lower() or "23505" in str(exc):
            logger.info("Quill top-up %s already applied", session.get("id"))
            return
        raise
    logger.info("Quill top-up applied: %s credits for user %s", credits, meta["user_id"])


def can_buy_pack(st: CreditStatus) -> bool:
    return st.packs_bought_this_month < _settings().max_packs_per_month


def pack() -> tuple[int, int]:
    s = _settings()
    return s.pack_credits, s.pack_price_cents
