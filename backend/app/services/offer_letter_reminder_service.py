"""Offer-letter signature reminder + auto-expiry, plus the same shape for
the "invited" stage right after it.

Per "From Offer to First Day at Work" (Aug 2026): a hire sent for signature
gets a day-3 reminder, then expires after 14 days with no response — the
same remind-then-escalate shape as onboarding_escalation_service.py and
screening_recheck_service.py, reusing this scheduler rather than a new
timer mechanism.

Tracking lives directly on employee_onboarding (offer_reminder_sent_at)
rather than a separate per-item table: a hire pending signature has no
worker_id yet — there's no user account until the invite is accepted after
signing — so it can't reuse onboarding_stage_reminders (FK'd to users) and
there's no candidate-facing in-app notification target either. The day-3
reminder re-sends the same sign-offer email the candidate already got;
expiry only notifies coordinators, since that's the only side with an
account to notify.

The "invited" stage (signed, login invite sent, candidate hasn't logged in
yet) previously had no reminder/escalation at all — invited_at wasn't even
tracked, so nothing could measure how long someone had been sitting there.
Mirrors the same remind-then-flag shape, but at day-3/day-7 instead of
day-3/day-14: the invite token itself already expires after 7 days
(invitations.py), so there's nothing left to "expire" past that point —
day-7 here just makes sure a coordinator notices and sends a fresh one,
rather than the candidate silently falling through a dead link.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from .email_service import queue_onboarding_sign_email
from .notification_service import _org_coordinator_user_ids, notify_worker
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

REMINDER_AFTER_DAYS = 3
EXPIRE_AFTER_DAYS = 14

INVITE_REMINDER_AFTER_DAYS = 3
INVITE_EXPIRE_AFTER_DAYS = 7  # matches the invite token's own TTL in invitations.py


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return "does not exist" in err or "42703" in err or "pgrst" in err or "could not find" in err




async def run_offer_letter_reminder_pass() -> dict[str, int]:
    now = datetime.now(timezone.utc)
    reminder_cutoff = now - timedelta(days=REMINDER_AFTER_DAYS)
    expire_cutoff = now - timedelta(days=EXPIRE_AFTER_DAYS)

    try:
        result = (
            get_supabase_admin()
            .table("employee_onboarding")
            .select(
                "id, organization_id, full_name, email, sign_token, "
                "employer_signed_at, offer_reminder_sent_at"
            )
            .eq("status", "awaiting_signatures")
            .execute()
        )
        rows: list[dict[str, Any]] = result.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return {"reminders": 0, "expirations": 0}
        logger.warning("Offer letter reminder query failed: %s", exc)
        return {"reminders": 0, "expirations": 0}

    reminded = 0
    expired = 0
    supabase = get_supabase_admin()

    for row in rows:
        sent_at_raw = row.get("employer_signed_at")
        if not sent_at_raw:
            continue
        try:
            sent_at = datetime.fromisoformat(str(sent_at_raw).replace("Z", "+00:00"))
        except ValueError:
            continue

        hire_id = row["id"]
        org_id = row["organization_id"]

        if sent_at <= expire_cutoff:
            try:
                updated = (
                    supabase.table("employee_onboarding")
                    .update({"status": "expired", "updated_at": now.isoformat()})
                    .eq("id", hire_id)
                    .eq("status", "awaiting_signatures")
                    .execute()
                )
                if updated.data:
                    expired += 1
                    for coord_id in _org_coordinator_user_ids(org_id):
                        await notify_worker(
                            user_id=coord_id,
                            org_id=org_id,
                            event="offer_letter_expired",
                            title="Offer letter expired",
                            message=(
                                f"{row.get('full_name') or 'A candidate'}'s offer expired after "
                                f"{EXPIRE_AFTER_DAYS} days without a signature."
                            ),
                            reference_key=f"offer_letter_expired:{hire_id}",
                            severity="medium",
                            alert_type="offer_letter_expired",
                        )
            except Exception as exc:
                logger.warning("Offer letter expiry failed for %s: %s", hire_id, exc)
            continue

        if sent_at <= reminder_cutoff and not row.get("offer_reminder_sent_at") and row.get("sign_token"):
            try:
                from ..core.config import settings

                sign_url = f"{settings.frontend_base_url.rstrip('/')}/onboarding-sign?token={row['sign_token']}"
                docs = (
                    supabase.table("employee_onboarding_documents")
                    .select("title")
                    .eq("onboarding_id", hire_id)
                    .execute()
                )
                from . import organization_branding_service
                branding = organization_branding_service.get_branding(org_id)
                queue_onboarding_sign_email(
                    to_email=row["email"],
                    full_name=row["full_name"],
                    sign_url=sign_url,
                    organization_name=branding.get("display_name"),
                    document_titles=[d["title"] for d in (docs.data or [])],
                    logo_url=branding.get("logo_url"),
                    brand_accent_color=branding.get("brand_accent_color"),
                )
                supabase.table("employee_onboarding").update(
                    {"offer_reminder_sent_at": now.isoformat()}
                ).eq("id", hire_id).execute()
                reminded += 1
            except Exception as exc:
                logger.warning("Offer letter reminder failed for %s: %s", hire_id, exc)

    invite_stats = await _process_invited_reminders()

    return {
        "reminders": reminded,
        "expirations": expired,
        "invite_reminders": invite_stats["reminders"],
        "invite_expired_flags": invite_stats["expired_flags"],
    }


async def _process_invited_reminders() -> dict[str, int]:
    """Day-3: notify coordinators the candidate hasn't logged in yet. Day-7
    (the invite token's own expiry): notify coordinators it's dead and needs
    a fresh one sent — no auto-action on the hire itself, since there's no
    user account yet to deactivate and re-sending a fresh invite is a real
    decision that should stay with a coordinator, not happen silently."""
    now = datetime.now(timezone.utc)
    reminder_cutoff = now - timedelta(days=INVITE_REMINDER_AFTER_DAYS)
    expire_cutoff = now - timedelta(days=INVITE_EXPIRE_AFTER_DAYS)

    try:
        result = (
            get_supabase_admin()
            .table("employee_onboarding")
            .select(
                "id, organization_id, full_name, invited_at, "
                "invite_reminder_sent_at, invite_expired_notified_at"
            )
            .eq("status", "invited")
            .execute()
        )
        rows: list[dict[str, Any]] = result.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return {"reminders": 0, "expired_flags": 0}
        logger.warning("Invite reminder query failed: %s", exc)
        return {"reminders": 0, "expired_flags": 0}

    reminded = 0
    flagged = 0
    supabase = get_supabase_admin()

    for row in rows:
        invited_at_raw = row.get("invited_at")
        if not invited_at_raw:
            continue
        try:
            invited_at = datetime.fromisoformat(str(invited_at_raw).replace("Z", "+00:00"))
        except ValueError:
            continue

        hire_id = row["id"]
        org_id = row["organization_id"]
        name = row.get("full_name") or "A candidate"

        if invited_at <= expire_cutoff and not row.get("invite_expired_notified_at"):
            try:
                supabase.table("employee_onboarding").update(
                    {"invite_expired_notified_at": now.isoformat()}
                ).eq("id", hire_id).execute()
                flagged += 1
                for coord_id in _org_coordinator_user_ids(org_id):
                    await notify_worker(
                        user_id=coord_id,
                        org_id=org_id,
                        event="hire_invite_expired",
                        title="Login invite expired",
                        message=(
                            f"{name} never logged in — their invite from {INVITE_EXPIRE_AFTER_DAYS} days ago "
                            "has expired. Send a fresh one from their hire record."
                        ),
                        reference_key=f"hire_invite_expired:{hire_id}",
                        severity="medium",
                        alert_type="hire_invite_expired",
                    )
            except Exception as exc:
                logger.warning("Invite expiry flag failed for %s: %s", hire_id, exc)
            continue

        if invited_at <= reminder_cutoff and not row.get("invite_reminder_sent_at"):
            try:
                supabase.table("employee_onboarding").update(
                    {"invite_reminder_sent_at": now.isoformat()}
                ).eq("id", hire_id).execute()
                reminded += 1
                for coord_id in _org_coordinator_user_ids(org_id):
                    await notify_worker(
                        user_id=coord_id,
                        org_id=org_id,
                        event="hire_invite_pending",
                        title="New hire hasn't logged in yet",
                        message=f"{name} was invited {INVITE_REMINDER_AFTER_DAYS}+ days ago and hasn't logged in yet.",
                        reference_key=f"hire_invite_pending:{hire_id}",
                        severity="low",
                        alert_type="hire_invite_pending",
                    )
            except Exception as exc:
                logger.warning("Invite reminder failed for %s: %s", hire_id, exc)

    return {"reminders": reminded, "expired_flags": flagged}
