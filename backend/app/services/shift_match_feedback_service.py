"""Worker-Participant Matching Enhancement, Phase 3 (Feedback loop).

Records how a worker-participant pairing actually went, once a shift is
done. Coordinator and worker sides are recorded independently (either can
arrive first) - see migration 146's comment for why.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from .supabase_client import get_supabase_admin
from . import shift_service

TABLE = "shift_match_feedback"


def _existing_row(shift_id: str) -> Optional[dict[str, Any]]:
    supabase = get_supabase_admin()
    resp = supabase.table(TABLE).select("*").eq("shift_id", shift_id).limit(1).execute()
    rows = resp.data or []
    return rows[0] if rows else None


def get_feedback_for_shift(shift_id: str) -> Optional[dict[str, Any]]:
    return _existing_row(shift_id)


def record_coordinator_feedback(
    shift_id: str,
    organization_id: str,
    recorded_by_user_id: Optional[str],
    participant_response: Optional[str],
    outcome_rating: Optional[int],
    would_repeat: Optional[bool],
) -> dict[str, Any]:
    shift = shift_service.get_shift_by_id(shift_id)
    if not shift or str(shift.get("organization_id") or "") != organization_id:
        raise ValueError("Shift not found")
    if not shift.get("participant_id") or not shift.get("worker_id"):
        raise ValueError("Shift has no participant/worker to record feedback against")

    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "organization_id": organization_id,
        "shift_id": shift_id,
        "participant_id": shift["participant_id"],
        "worker_id": shift["worker_id"],
        "recorded_by_user_id": recorded_by_user_id,
        "recorded_at": now,
        "participant_response": participant_response,
        "outcome_rating": outcome_rating,
        "would_repeat": would_repeat,
        "updated_at": now,
    }
    supabase = get_supabase_admin()
    resp = supabase.table(TABLE).upsert(payload, on_conflict="shift_id").execute()
    return (resp.data or [payload])[0]


def record_worker_feedback(shift_id: str, worker_id: str, worker_feedback: str) -> dict[str, Any]:
    shift = shift_service.get_shift_by_id(shift_id)
    if not shift or str(shift.get("worker_id") or "") != worker_id:
        raise ValueError("Shift not found or not yours")
    if not shift.get("participant_id"):
        raise ValueError("Shift has no participant to record feedback against")

    now = datetime.now(timezone.utc).isoformat()
    existing = _existing_row(shift_id)
    payload = {
        "organization_id": shift.get("organization_id"),
        "shift_id": shift_id,
        "participant_id": shift["participant_id"],
        "worker_id": worker_id,
        "worker_feedback": worker_feedback,
        "worker_feedback_recorded_at": now,
        "updated_at": now,
    }
    if existing:
        # Upsert on shift_id would otherwise blank out any coordinator-side
        # fields already on the row (upsert replaces the whole row on most
        # PostgREST configs) - merge explicitly instead.
        payload = {**existing, **payload}
    supabase = get_supabase_admin()
    resp = supabase.table(TABLE).upsert(payload, on_conflict="shift_id").execute()
    return (resp.data or [payload])[0]


def has_do_not_repeat_flag(worker_id: str, participant_id: str, organization_id: str) -> bool:
    """True if a coordinator has ever recorded would_repeat=False for this
    exact worker-participant pair. Checked before scoring (see
    worker_match_scoring_service.score_candidates) - a documented "this
    pairing didn't work" is a deliberate, considered coordinator call, not
    something a low outcome_rating alone should imply."""
    supabase = get_supabase_admin()
    try:
        resp = (
            supabase.table(TABLE)
            .select("id")
            .eq("organization_id", organization_id)
            .eq("worker_id", worker_id)
            .eq("participant_id", participant_id)
            .eq("would_repeat", False)
            .limit(1)
            .execute()
        )
        return bool(resp.data)
    except Exception:
        return False


def rating_history_for_pair(worker_id: str, participant_id: str, organization_id: str) -> Optional[tuple[float, int]]:
    """(average_rating, count) across every shift this pair has feedback for,
    or None if there's no rated feedback yet at all."""
    supabase = get_supabase_admin()
    try:
        resp = (
            supabase.table(TABLE)
            .select("outcome_rating")
            .eq("organization_id", organization_id)
            .eq("worker_id", worker_id)
            .eq("participant_id", participant_id)
            .not_.is_("outcome_rating", "null")
            .execute()
        )
        ratings = [r["outcome_rating"] for r in (resp.data or []) if r.get("outcome_rating") is not None]
    except Exception:
        return None
    if not ratings:
        return None
    return sum(ratings) / len(ratings), len(ratings)
