"""Whether an organisation can still add records, from its CareCliQ
subscription.

  full       - subscribed or in its free trial, or never billed through
               Stripe at all (pilot and hand-set-up organisations)
  grace      - the trial ended unpaid, or the subscription was cancelled or
               keeps failing payment; everything still works for GRACE_DAYS
  read_only  - grace is over: everyone can sign in, view and export records,
               but new shifts, notes, invoices and other changes are paused
               (SubscriptionAccessMiddleware). Incident reports and
               complaints always stay open.

The lapse date is organizations.subscription_lapsed_at (migration 246, set
by the Stripe webhook). Until that column exists it falls back to the trial
end date, and if neither is known access stays full: billing trouble must
never lock a provider out by accident.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

GRACE_DAYS = 7
CACHE_SECONDS = 60
OK_STATUSES = {"active", "trialing"}
LAPSED_STATUSES = {"past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "paused"}

_cache: dict[str, tuple["Access", float]] = {}


@dataclass(frozen=True)
class Access:
    state: str
    subscription_status: Optional[str] = None
    grace_ends_at: Optional[datetime] = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "subscription_status": self.subscription_status,
            "grace_ends_at": self.grace_ends_at.isoformat() if self.grace_ends_at else None,
            "grace_days": GRACE_DAYS,
        }


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def evaluate(org: dict[str, Any], now: Optional[datetime] = None) -> Access:
    now = now or datetime.now(timezone.utc)
    status = org.get("subscription_status")
    if not (org.get("stripe_customer_id") or org.get("stripe_subscription_id")):
        return Access("full", status)
    if status not in LAPSED_STATUSES:
        return Access("full", status)
    lapsed_at = _parse(org.get("subscription_lapsed_at")) or _parse(org.get("trial_ends_at"))
    if not lapsed_at:
        return Access("full", status)
    grace_ends_at = lapsed_at + timedelta(days=GRACE_DAYS)
    return Access("read_only" if now >= grace_ends_at else "grace", status, grace_ends_at)


def _load_org(organization_id: str) -> Optional[dict[str, Any]]:
    base = "organization_id, stripe_customer_id, stripe_subscription_id, subscription_status, trial_ends_at"
    db = get_supabase_admin()
    for columns in (f"{base}, subscription_lapsed_at", base):
        try:
            rows = db.table("organizations").select(columns).eq("organization_id", organization_id).limit(1).execute().data
            return rows[0] if rows else None
        except Exception as exc:
            if "subscription_lapsed_at" in str(exc):
                continue  # migration 246 not applied yet
            raise
    return None


def get_access(organization_id: Optional[str], *, use_cache: bool = True) -> Access:
    if not organization_id:
        return Access("full")
    key = str(organization_id)
    cached = _cache.get(key)
    if use_cache and cached and cached[1] > time.monotonic():
        return cached[0]
    try:
        org = _load_org(key)
        access = evaluate(org) if org else Access("full")
    except Exception as exc:
        logger.warning("subscription access check failed for %s (allowing): %s", key, exc)
        access = Access("full")
    _cache[key] = (access, time.monotonic() + CACHE_SECONDS)
    return access


def forget(organization_id: Optional[str] = None) -> None:
    """Drop cached access (all, or one organisation) after a billing change."""
    if organization_id:
        _cache.pop(str(organization_id), None)
    else:
        _cache.clear()


def lapse_update(current: dict[str, Any], new_status: Optional[str]) -> dict[str, Any]:
    """The subscription_lapsed_at change for a status update: stamped when a
    subscription first lapses, cleared when it's healthy again."""
    if new_status in LAPSED_STATUSES:
        if not current.get("subscription_lapsed_at"):
            return {"subscription_lapsed_at": datetime.now(timezone.utc).isoformat()}
        return {}
    if new_status in OK_STATUSES and current.get("subscription_lapsed_at"):
        return {"subscription_lapsed_at": None}
    return {}
