"""Ranked, one-at-a-time shift offers — the notify-and-await-approval half of
shift reassignment (the other half, direct-assign, is coordinator.py's
existing assign_existing_shift). A coordinator starts a queue of ranked
candidates; only the head of the queue gets a live pending offer at any time.
Decline or timeout pops the next candidate and creates a fresh row rather
than mutating the old one — same remind-then-escalate, append-a-row shape as
offer_letter_reminder_service.py, so the full sequence stays auditable.

Never auto-assigns: accept_offer is the only path that ever writes a
worker_id onto the shift from this module.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from .notification_service import (
    notify_shift_offer,
    notify_shift_offer_exhausted,
    notify_worker_cannot_attend,
)
from .shift_service import get_shift_by_id
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

RESPONSE_WINDOW_MINUTES = 30


class ShiftOfferError(Exception):
    """Raised for caller-facing offer failures (bad state, race lost, etc.)."""


def _fetch_shift(shift_id: str) -> dict[str, Any]:
    shift = get_shift_by_id(shift_id)
    if not shift:
        raise ShiftOfferError("Shift not found")
    return shift


async def mark_cannot_attend(
    *, shift_id: str, worker_id: str, org_id: str, reason: Optional[str] = None
) -> dict[str, Any]:
    """Worker vacates a shift they're assigned to. Mirrors coordinator.py's
    unassign_existing_shift exactly (worker_id=None, status='unassigned'),
    but from the worker's own side and scoped to their own assignment."""
    shift = _fetch_shift(shift_id)
    if str(shift.get("organization_id") or "") != org_id:
        raise ShiftOfferError("Shift not found")
    if str(shift.get("worker_id") or "") != worker_id:
        raise ShiftOfferError("You are not assigned to this shift")

    reason = (reason or "").strip() or None
    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc).isoformat()
    result = (
        supabase.table("shifts")
        .update({
            "worker_id": None,
            "status": "unassigned",
            "cannot_attend_reason": reason,
            "updated_at": now,
        })
        .eq("id", shift_id)
        .eq("worker_id", worker_id)
        .execute()
    )
    if not result.data:
        raise ShiftOfferError("Shift was already reassigned")
    updated = result.data[0]

    await notify_worker_cannot_attend(shift={**shift, **updated}, reason=reason)
    return updated


async def send_offer(
    *,
    shift_id: str,
    worker_id: str,
    candidate_queue: list[str],
    offered_by: str,
    org_id: str,
) -> dict[str, Any]:
    """Start (or restart) a ranked offer queue at `worker_id`, with
    `candidate_queue` as the remaining ranked ids to try after them."""
    shift = _fetch_shift(shift_id)
    if str(shift.get("organization_id") or "") != org_id:
        raise ShiftOfferError("Shift not found")
    if shift.get("worker_id"):
        raise ShiftOfferError("Shift already has an assigned worker")

    supabase = get_supabase_admin()
    supabase.table("shift_offers").update({"status": "superseded"}).eq(
        "shift_id", shift_id
    ).eq("status", "pending").execute()

    return await _create_offer(
        shift=shift,
        org_id=org_id,
        offered_by=offered_by,
        worker_id=worker_id,
        candidate_queue=candidate_queue,
        rank=1,
    )


async def _create_offer(
    *,
    shift: dict[str, Any],
    org_id: str,
    offered_by: str,
    worker_id: str,
    candidate_queue: list[str],
    rank: int,
) -> dict[str, Any]:
    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc)
    responds_by = now + timedelta(minutes=RESPONSE_WINDOW_MINUTES)
    result = (
        supabase.table("shift_offers")
        .insert({
            "shift_id": shift["id"],
            "organization_id": org_id,
            "worker_id": worker_id,
            "rank": rank,
            "status": "pending",
            "candidate_queue": candidate_queue,
            "offered_by": offered_by,
            "offered_at": now.isoformat(),
            "responds_by": responds_by.isoformat(),
        })
        .execute()
    )
    if not result.data:
        raise ShiftOfferError("Failed to create shift offer")
    row = result.data[0]
    await notify_shift_offer(shift=shift, worker_id=worker_id, rank=rank)
    return row


async def _advance_or_close(
    *, shift: dict[str, Any], org_id: str, offered_by: str, prior: dict[str, Any]
) -> Optional[dict[str, Any]]:
    """Shared by decline_offer and the expiry pass: pop the next candidate
    off the queue, or notify coordinators the queue is exhausted."""
    queue: list[str] = list(prior.get("candidate_queue") or [])
    if not queue:
        await notify_shift_offer_exhausted(shift=shift, reason=prior.get("decline_reason"))
        return None

    next_worker_id, *rest = queue
    return await _create_offer(
        shift=shift,
        org_id=org_id,
        offered_by=offered_by,
        worker_id=next_worker_id,
        candidate_queue=rest,
        rank=int(prior.get("rank") or 0) + 1,
    )


def _get_pending_offer(*, shift_id: str, worker_id: str) -> dict[str, Any]:
    supabase = get_supabase_admin()
    result = (
        supabase.table("shift_offers")
        .select("*")
        .eq("shift_id", shift_id)
        .eq("worker_id", worker_id)
        .eq("status", "pending")
        .order("offered_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    if not rows:
        raise ShiftOfferError("No pending offer found for this shift")
    return rows[0]


async def decline_offer(
    *, shift_id: str, worker_id: str, org_id: str, reason: Optional[str] = None
) -> None:
    offer = _get_pending_offer(shift_id=shift_id, worker_id=worker_id)
    reason = (reason or "").strip() or None
    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc).isoformat()
    result = (
        supabase.table("shift_offers")
        .update({"status": "declined", "decline_reason": reason, "responded_at": now})
        .eq("id", offer["id"])
        .eq("status", "pending")
        .execute()
    )
    if not result.data:
        raise ShiftOfferError("Offer already responded to")
    declined = result.data[0]

    shift = _fetch_shift(shift_id)
    await _advance_or_close(shift=shift, org_id=org_id, offered_by=offer["offered_by"], prior=declined)


async def accept_offer(*, shift_id: str, worker_id: str, org_id: str) -> dict[str, Any]:
    offer = _get_pending_offer(shift_id=shift_id, worker_id=worker_id)
    shift = _fetch_shift(shift_id)
    if str(shift.get("organization_id") or "") != org_id:
        raise ShiftOfferError("Shift not found")
    if shift.get("worker_id"):
        raise ShiftOfferError("Shift was already assigned to someone else")

    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc).isoformat()

    accepted = (
        supabase.table("shift_offers")
        .update({"status": "accepted", "responded_at": now})
        .eq("id", offer["id"])
        .eq("status", "pending")
        .execute()
    )
    if not accepted.data:
        raise ShiftOfferError("Offer already responded to")

    assigned = (
        supabase.table("shifts")
        .update({
            "worker_id": worker_id,
            "status": "scheduled",
            "cannot_attend_reason": None,
            "updated_at": now,
        })
        .eq("id", shift_id)
        .is_("worker_id", "null")
        .execute()
    )
    if not assigned.data:
        # Lost the race to someone else assigning it directly — roll the offer back.
        supabase.table("shift_offers").update({"status": "pending", "responded_at": None}).eq(
            "id", offer["id"]
        ).execute()
        raise ShiftOfferError("Shift was already assigned to someone else")

    supabase.table("shift_offers").update({"status": "superseded"}).eq(
        "shift_id", shift_id
    ).eq("status", "pending").execute()

    return assigned.data[0]


async def run_shift_offer_pass() -> dict[str, int]:
    """Expire timed-out pending offers and auto-advance to the next
    candidate. Wired into notification_scheduler's existing 15-min pass."""
    now = datetime.now(timezone.utc)
    supabase = get_supabase_admin()
    try:
        result = (
            supabase.table("shift_offers")
            .select("*")
            .eq("status", "pending")
            .lt("responds_by", now.isoformat())
            .execute()
        )
        rows: list[dict[str, Any]] = result.data or []
    except Exception as exc:
        logger.warning("Shift offer expiry query failed: %s", exc)
        return {"expired": 0, "advanced": 0, "exhausted": 0}

    expired = 0
    advanced = 0
    exhausted = 0

    for offer in rows:
        try:
            updated = (
                supabase.table("shift_offers")
                .update({"status": "expired", "responded_at": now.isoformat()})
                .eq("id", offer["id"])
                .eq("status", "pending")
                .execute()
            )
            if not updated.data:
                continue
            expired += 1

            shift = get_shift_by_id(offer["shift_id"])
            if not shift or shift.get("worker_id"):
                continue

            next_offer = await _advance_or_close(
                shift=shift,
                org_id=offer["organization_id"],
                offered_by=offer["offered_by"],
                prior=offer,
            )
            if next_offer:
                advanced += 1
            else:
                exhausted += 1
        except Exception as exc:
            logger.warning("Shift offer expiry failed for %s: %s", offer.get("id"), exc)

    return {"expired": expired, "advanced": advanced, "exhausted": exhausted}
