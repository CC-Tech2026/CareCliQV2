"""Support Worker Onboarding Journey, Phase 2: buddy pairing.

Pairs a new worker with an experienced, active worker before their first
shift. See migration 149's comment for the schema/design rationale.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from .notification_service import notify_worker
from .supabase_client import get_supabase_admin

TABLE = "worker_buddies"


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return "does not exist" in err or "42703" in err or "pgrst" in err or "could not find" in err


def suggest_buddies(new_worker_id: str, organization_id: str, limit: int = 3) -> list[dict[str, Any]]:
    """Simple starting heuristic: most-recently-active, same suburb where
    known, filtered to workers who've opted in to matching and are
    themselves fully onboarded (a worker still mid-onboarding shouldn't be
    suggested as someone else's buddy). Deliberately not the tag-based
    scoring service, since that's worker-to-participant shaped, not
    worker-to-worker, and the design spec's own Build Order says buddy
    suggestion doesn't need to wait for a proper scoring upgrade."""
    supabase = get_supabase_admin()
    try:
        new_worker_resp = (
            supabase.table("users")
            .select("id, suburb")
            .eq("id", new_worker_id)
            .eq("organization_id", organization_id)
            .maybe_single()
            .execute()
        )
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        raise
    new_worker = new_worker_resp.data if new_worker_resp else None
    if not new_worker:
        return []
    new_worker_suburb = (new_worker.get("suburb") or "").strip().lower()

    try:
        candidates_resp = (
            supabase.table("users")
            .select("id, full_name, suburb, last_login")
            .eq("organization_id", organization_id)
            .eq("role", "support_worker")
            .eq("is_active", True)
            .eq("onboarding_completed", True)
            .eq("matching_opt_in", True)
            .neq("id", new_worker_id)
            .order("last_login", desc=True, nullsfirst=False)
            .limit(50)
            .execute()
        )
        candidates = candidates_resp.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        raise

    def _same_suburb(c: dict[str, Any]) -> bool:
        return bool(new_worker_suburb) and (c.get("suburb") or "").strip().lower() == new_worker_suburb

    # Query already orders by last_login desc; stable-sort same-suburb
    # candidates ahead of it without disturbing relative recency otherwise.
    candidates.sort(key=lambda c: 0 if _same_suburb(c) else 1)

    return [
        {"id": c["id"], "full_name": c.get("full_name"), "same_suburb": _same_suburb(c)}
        for c in candidates[:limit]
    ]


def get_buddy(worker_id: str) -> Optional[dict[str, Any]]:
    """The currently-assigned buddy for this worker (as the new-worker side), if any."""
    supabase = get_supabase_admin()
    try:
        resp = (
            supabase.table(TABLE)
            .select("id, buddy_worker_id, status, assigned_at")
            .eq("new_worker_id", worker_id)
            .eq("status", "assigned")
            .limit(1)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        raise
    if not rows:
        return None
    row = rows[0]
    try:
        buddy_resp = (
            supabase.table("users")
            .select("full_name, email, phone")
            .eq("id", row["buddy_worker_id"])
            .maybe_single()
            .execute()
        )
        buddy_profile = buddy_resp.data if buddy_resp else {}
    except Exception:
        buddy_profile = {}
    return {**row, **(buddy_profile or {})}


async def assign_buddy(
    new_worker_id: str,
    buddy_worker_id: Optional[str],
    organization_id: str,
    assigned_by_user_id: Optional[str],
) -> Optional[dict[str, Any]]:
    """Assign (or clear, if buddy_worker_id is None) the new worker's buddy.
    Retires any previously-assigned row for this new worker first: only one
    buddy should be 'assigned' at a time, enforced here rather than as a DB
    constraint since it's a point-in-time state a coordinator can change."""
    supabase = get_supabase_admin()
    try:
        supabase.table(TABLE).update({"status": "completed"}).eq(
            "new_worker_id", new_worker_id
        ).eq("status", "assigned").execute()
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            raise

    if not buddy_worker_id:
        return None

    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "organization_id": organization_id,
        "new_worker_id": new_worker_id,
        "buddy_worker_id": buddy_worker_id,
        "status": "assigned",
        "assigned_by_user_id": assigned_by_user_id,
        "assigned_at": now,
    }
    resp = supabase.table(TABLE).upsert(payload, on_conflict="new_worker_id,buddy_worker_id").execute()
    row = (resp.data or [payload])[0]

    try:
        await notify_worker(
            user_id=new_worker_id,
            org_id=organization_id,
            event="buddy_assigned",
            title="You've been paired with a buddy",
            message="A buddy has been assigned to help you settle in. Check My Onboarding for their contact details.",
            reference_key=f"buddy_assigned:{row.get('id')}",
            severity="low",
            alert_type="buddy_assigned",
        )
    except Exception:
        pass

    return row
