"""MyShift — shift lookup helpers (CARECLIQV2-87 / CARECLIQV2-35)."""

from __future__ import annotations

import logging
from typing import Any, Optional

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return (
        "does not exist" in err
        or "42703" in err
        or "pgrst" in err
        or "could not find" in err
    )


def get_shift_by_id(shift_id: str) -> Optional[dict[str, Any]]:
    """Return a shift row by primary key, or None if missing / table absent."""
    if not shift_id:
        return None
    try:
        resp = (
            get_supabase_admin()
            .table("shifts")
            .select("*")
            .eq("id", shift_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None
    except Exception as exc:
        if _is_missing_schema_error(exc):
            logger.debug("shifts table unavailable: %s", exc)
            return None
        raise


def get_shift_for_session(session: dict) -> Optional[dict[str, Any]]:
    """Resolve shift for compliance duration checks.

    Prefers sessions.shift_id (CARECLIQV2-35). Falls back to shifts.session_id link.
    """
    shift_id = session.get("shift_id")
    if shift_id:
        return get_shift_by_id(str(shift_id))

    session_id = session.get("id")
    if not session_id:
        return None

    try:
        resp = (
            get_supabase_admin()
            .table("shifts")
            .select("*")
            .eq("session_id", str(session_id))
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None
    except Exception as exc:
        if _is_missing_schema_error(exc):
            logger.debug("shifts table unavailable: %s", exc)
            return None
        raise


def build_duration_consistency_context(session: dict) -> Optional[dict[str, Any]]:
    """Build context for check_duration_consistency when session.shift_id is set."""
    if not session.get("shift_id"):
        return None

    shift = get_shift_by_id(str(session["shift_id"]))
    if not shift:
        return None

    session_mins = int(session.get("duration_minutes") or 0)
    shift_mins = int(shift.get("duration_minutes") or 0)

    return {
        "shift_id": shift.get("id"),
        "session_duration_minutes": session_mins,
        "shift_duration_minutes": shift_mins,
        "deviation_minutes": abs(session_mins - shift_mins),
    }
