"""The super admin console's view of each provider: account health and what
needs CareCliQ's attention (backend/app/api/admin.py).

Same boundary as admin.py: business-account data only. Participant numbers
appear only as a count per organisation, never as records.

attention_for() is a pure function of one organisation's snapshot so the
rules are easy to read and test. Each item says what is wrong, why it
matters and what we can do about it from the console.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from ..core.access import PARTICIPANT_ROLES
from . import subscription_access
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

TRIAL_WARNING_DAYS = 7
OVERRIDE_WARNING_DAYS = 7
QUIET_DAYS = 14          # nobody signed in for this long
SETUP_GRACE_DAYS = 7     # time a new provider gets before "no participants yet"
HELD_STAFF_NUDGE_DAYS = 3

PAYMENT_TROUBLE = {"past_due", "unpaid", "incomplete"}

SEVERITY_ORDER = {"urgent": 0, "soon": 1, "info": 2}


def _parse(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _days_until(when: datetime, now: datetime) -> int:
    return max(0, (when - now + timedelta(hours=23, minutes=59)).days)


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def attention_for(org: dict[str, Any], now: Optional[datetime] = None) -> list[dict[str, str]]:
    """What needs looking at for one organisation snapshot (see snapshot()).
    Each item: code, severity (urgent/soon/info), title, detail, action."""
    now = now or datetime.now(timezone.utc)
    items: list[dict[str, str]] = []

    def add(code: str, severity: str, title: str, detail: str, action: str) -> None:
        items.append({"code": code, "severity": severity, "title": title, "detail": detail, "action": action})

    if org.get("status") == "suspended":
        add("suspended", "info", "Suspended",
            "Nobody in this organisation can sign in.", "Reactivate when the account is sorted")
        return items  # nothing else matters while access is cut off
    if org.get("status") == "offboarded":
        return items

    access = org.get("access") or {}
    sub_status = org.get("subscription_status")
    override_until = _parse(org.get("access_override_until"))
    override_active = bool(override_until and override_until > now)

    if not override_active:
        if access.get("state") == "read_only":
            add("read_only", "urgent", "Records are read-only",
                "The subscription lapsed and the grace period is over, so they can't add shifts, notes or invoices.",
                "Give free access while it's sorted, or help them choose a plan")
        elif access.get("state") == "grace":
            ends = _parse(access.get("grace_ends_at"))
            left = _days_until(ends, now) if ends else None
            add("grace", "urgent", "Subscription lapsed",
                f"Everything still works for {_plural(left, 'more day')}, then records go read-only."
                if left is not None else "Records go read-only when the grace period ends.",
                "Contact the managing director about billing")
        elif sub_status in PAYMENT_TROUBLE:
            add("payment", "urgent", "Payment failing",
                "Stripe couldn't take the last payment.", "Ask them to update their card under Settings, Billing")

    trial_ends = _parse(org.get("trial_ends_at"))
    if sub_status == "trialing" and trial_ends and now < trial_ends <= now + timedelta(days=TRIAL_WARNING_DAYS):
        add("trial_ending", "soon", f"Trial ends in {_plural(_days_until(trial_ends, now), 'day')}",
            "Their card is charged when the trial ends unless they cancel.", "Check in, or extend the trial")

    if override_active and override_until <= now + timedelta(days=OVERRIDE_WARNING_DAYS):
        add("override_ending", "soon", f"Free access ends in {_plural(_days_until(override_until, now), 'day')}",
            "After that their normal subscription status applies again.", "Extend it, or make sure billing is set up")

    created = _parse(org.get("created_at"))
    age_days = (now - created).days if created else 0

    if not org.get("md_signed_in") and age_days >= 2:
        add("md_never_signed_in", "soon", "Managing director hasn't signed in",
            "The account was set up but nobody has used it yet.", "Resend their setup email or give them a call")
    else:
        last = _parse(org.get("last_sign_in_at"))
        if last and (now - last).days >= QUIET_DAYS:
            add("quiet", "soon", f"Nobody has signed in for {(now - last).days} days",
                "They may be stuck or drifting away.", "Check in with the managing director")

    if age_days >= SETUP_GRACE_DAYS:
        if not org.get("participant_count"):
            add("no_participants", "info", "No participants yet",
                "Their client list hasn't come across.", "Offer to import it for them")
        if (org.get("active_user_count") or 0) <= 1 and not org.get("held_staff_count"):
            add("no_staff", "info", "Only one person on the team",
                "Their staff haven't been invited.", "Offer to import their staff")

    held = org.get("held_staff_count") or 0
    oldest_held = _parse(org.get("oldest_held_staff_at"))
    if held and oldest_held and (now - oldest_held).days >= HELD_STAFF_NUDGE_DAYS:
        add("held_staff", "info", f"{_plural(held, 'invitation')} waiting to be sent",
            "We imported their staff; the managing director hasn't sent the invitations yet.",
            "Remind them: Import records, Staff")

    items.sort(key=lambda i: SEVERITY_ORDER.get(i["severity"], 9))
    return items


def _rows(table: str, columns: str, org_ids: list[str]) -> list[dict[str, Any]]:
    """organization_id-scoped rows for many organisations, in chunks. A
    missing table (migration not applied yet) reads as no rows."""
    db = get_supabase_admin()
    out: list[dict[str, Any]] = []
    for start in range(0, len(org_ids), 100):
        chunk = org_ids[start:start + 100]
        try:
            out.extend(db.table(table).select(columns).in_("organization_id", chunk).execute().data or [])
        except Exception as exc:
            logger.warning("admin console: couldn't read %s (%s)", table, exc)
    return out


def snapshots(orgs: list[dict[str, Any]], now: Optional[datetime] = None) -> list[dict[str, Any]]:
    """Adds account health and attention items to raw organizations rows."""
    now = now or datetime.now(timezone.utc)
    org_ids = [o["organization_id"] for o in orgs if o.get("organization_id")]
    users = _rows("users", "organization_id, role, is_active, last_login", org_ids)
    participants = _rows("participants", "organization_id", org_ids)
    held = _rows("held_staff_invitations", "organization_id, created_at", org_ids)

    by_org: dict[str, dict[str, Any]] = {
        oid: {"user_count": 0, "active_user_count": 0, "last_sign_in_at": None, "md_signed_in": False,
              "participant_count": 0, "held_staff_count": 0, "oldest_held_staff_at": None}
        for oid in org_ids
    }
    for u in users:
        s = by_org.get(u.get("organization_id"))
        if s is None or u.get("role") in PARTICIPANT_ROLES:
            continue  # participant portal logins are clients, not the provider's team
        s["user_count"] += 1
        if u.get("is_active") is not False:
            s["active_user_count"] += 1
        last = u.get("last_login")
        if last and (not s["last_sign_in_at"] or str(last) > str(s["last_sign_in_at"])):
            s["last_sign_in_at"] = last
        if u.get("role") == "managing_director" and last:
            s["md_signed_in"] = True
    for p in participants:
        s = by_org.get(p.get("organization_id"))
        if s is not None:
            s["participant_count"] += 1
    for h in held:
        s = by_org.get(h.get("organization_id"))
        if s is not None:
            s["held_staff_count"] += 1
            created = h.get("created_at")
            if created and (not s["oldest_held_staff_at"] or str(created) < str(s["oldest_held_staff_at"])):
                s["oldest_held_staff_at"] = created

    result = []
    for o in orgs:
        snap = {
            **o,
            "display_name": o.get("organization_name") or o.get("name") or "Unnamed organisation",
            "status": o.get("status") or "active",
            "org_type": o.get("org_type"),
            **by_org.get(o.get("organization_id"), {}),
            "access": subscription_access.evaluate(o, now).as_dict(),
            "billing_label": billing_label(o, now),
        }
        snap["attention"] = attention_for(snap, now)
        result.append(snap)
    return result


def billing_label(org: dict[str, Any], now: Optional[datetime] = None) -> str:
    """One plain phrase for a subscription, for lists."""
    now = now or datetime.now(timezone.utc)
    override_until = _parse(org.get("access_override_until"))
    if override_until and override_until > now:
        return "Free access"
    status = org.get("subscription_status")
    if not (org.get("stripe_customer_id") or org.get("stripe_subscription_id")):
        return "Not billed through Stripe"
    return {
        "trialing": "Trial",
        "active": "Paying",
        "past_due": "Payment failing",
        "unpaid": "Unpaid",
        "canceled": "Cancelled",
        "incomplete": "Payment failing",
        "incomplete_expired": "Cancelled",
        "paused": "Paused",
    }.get(status or "", "No subscription")
