"""Worker help, FAQ, known issues, tutorial progress — CARECLIQV2-273."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException

from .supabase_client import get_supabase_admin

TUTORIAL_STEPS = (
    "shift_list",
    "open_shift",
    "shift_overview",
    "risk_acknowledgement",
    "clock_in",
    "clock_in_modal",
    "start_session",
    "task_evidence",
    "evidence_attach",
    "session_notes",
    "end_shift",
    "end_shift_review",
    "shift_signature",
    "notifications",
)


def _is_missing_table(exc: Exception) -> bool:
    err = str(exc).lower()
    return "does not exist" in err or "pgrst205" in err or "42p01" in err


def get_support_config() -> dict[str, Any]:
    try:
        resp = (
            get_supabase_admin()
            .table("app_support_config")
            .select("*")
            .order("updated_at", desc=True)
            .limit(1)
            .maybe_single()
            .execute()
        )
        if resp and resp.data:
            return resp.data
    except Exception as exc:
        if not _is_missing_table(exc):
            raise
    return {
        "support_phone": "1800 000 000",
        "support_email": "support@carecliq.com.au",
        "business_hours_json": {
            "timezone": "Australia/Sydney",
            "weekdays": "Mon–Fri 9:00–17:00 AEST",
        },
        "outside_hours_message": (
            "Our support team is available Mon–Fri 9:00–17:00 AEST. "
            "We will respond on the next business day."
        ),
        "intercom_app_id": None,
    }


def list_faq_articles(search: Optional[str] = None) -> list[dict[str, Any]]:
    try:
        query = (
            get_supabase_admin()
            .table("support_faq_articles")
            .select("slug, title, body_markdown, tags, sort_order")
            .eq("is_published", True)
            .order("sort_order")
        )
        resp = query.execute()
        rows = resp.data or []
    except Exception as exc:
        if _is_missing_table(exc):
            return []
        raise

    if not search:
        return rows

    term = search.strip().lower()
    if not term:
        return rows

    def matches(row: dict[str, Any]) -> bool:
        hay = " ".join(
            [
                str(row.get("title") or ""),
                str(row.get("body_markdown") or ""),
                " ".join(row.get("tags") or []),
            ]
        ).lower()
        return term in hay

    return [row for row in rows if matches(row)]


def list_known_issues() -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("support_known_issues")
            .select(
                "id, title, description, affected_version, workaround, expected_fix_date, updated_at"
            )
            .eq("is_active", True)
            .order("expected_fix_date")
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_table(exc):
            return []
        raise


def get_tutorial_progress(user_id: str) -> dict[str, Any]:
    progress: dict[str, Any] = {step: None for step in TUTORIAL_STEPS}
    try:
        resp = (
            get_supabase_admin()
            .table("worker_tutorial_progress")
            .select("step_key, completed_at, skipped")
            .eq("user_id", user_id)
            .execute()
        )
        for row in resp.data or []:
            key = row.get("step_key")
            if key in progress:
                progress[key] = {
                    "completed_at": row.get("completed_at"),
                    "skipped": bool(row.get("skipped")),
                }
    except Exception as exc:
        if not _is_missing_table(exc):
            raise

    completed = all(progress[step] is not None for step in TUTORIAL_STEPS)
    return {"steps": progress, "completed": completed}


def upsert_tutorial_step(
    user_id: str,
    step_key: str,
    *,
    skipped: bool = False,
) -> dict[str, Any]:
    if step_key not in TUTORIAL_STEPS:
        raise HTTPException(status_code=422, detail="Unknown tutorial step.")

    payload = {
        "user_id": user_id,
        "step_key": step_key,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "skipped": skipped,
    }
    try:
        get_supabase_admin().table("worker_tutorial_progress").upsert(
            payload,
            on_conflict="user_id,step_key",
        ).execute()
    except Exception as exc:
        if _is_missing_table(exc):
            raise HTTPException(
                status_code=503,
                detail="Tutorial progress unavailable. Run migration 059_worker_help_support.sql",
            ) from exc
        raise
    return get_tutorial_progress(user_id)


def reset_tutorial_progress(user_id: str) -> dict[str, Any]:
    try:
        get_supabase_admin().table("worker_tutorial_progress").delete().eq(
            "user_id", user_id
        ).execute()
    except Exception as exc:
        if _is_missing_table(exc):
            raise HTTPException(
                status_code=503,
                detail="Tutorial progress unavailable. Run migration 059_worker_help_support.sql",
            ) from exc
        raise
    return get_tutorial_progress(user_id)
