"""Shift Content Synchronization spec — append-only audit trail for live medication
resolution at the three checkpoints closest to the point of care. Kept as its own small
module (rather than folded into shift_service.py or medication_service.py) so both can call
it without adding a dependency on each other.
"""

from __future__ import annotations

import logging
from typing import Any

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

CHECKPOINTS = {"pre_shift_briefing", "action_time", "mid_shift_change"}


def _is_missing_schema(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg


def log_shift_content_resolution(
    *,
    shift_id: str,
    participant_id: str | None,
    organization_id: str,
    checkpoint: str,
    resolved_medication_ids: list[str] | None = None,
    excluded_medications: list[dict[str, Any]] | None = None,
    resolved_for_user_id: str | None = None,
) -> None:
    """Best-effort, fire-and-forget from the caller's perspective — a logging failure must
    never block the actual resolution/administration it's recording."""
    if checkpoint not in CHECKPOINTS:
        logger.warning("Unknown shift content resolution checkpoint: %s", checkpoint)
        return
    if not shift_id or not organization_id:
        return
    try:
        get_supabase_admin().table("shift_content_resolution_log").insert({
            "shift_id": shift_id,
            "participant_id": participant_id,
            "organization_id": organization_id,
            "checkpoint": checkpoint,
            "resolved_medication_ids": resolved_medication_ids or [],
            "excluded_medications": excluded_medications or [],
            "resolved_for_user_id": resolved_for_user_id,
        }).execute()
    except Exception as exc:
        if not _is_missing_schema(exc):
            logger.warning("Could not write shift content resolution log for shift %s: %s", shift_id, exc)
