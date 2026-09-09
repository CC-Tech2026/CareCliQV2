"""Improvements & Feedback — see backend/app/api/improvement_feedback.py for
the submission endpoint (managing director only, scoped to their own org)
and backend/app/api/admin.py for the Super Admin listing/status endpoints
that read across every org. Mirrors bug_report_service.py's shape."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from . import jira_service
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _organization_display_name(organization_id: str) -> str:
    """Jira's Reporter field only accepts a real Jira user account — it
    can't hold an org name as text, so instead the org goes at the front
    of the ticket title/description (see create_improvement_feedback
    below). Mirrors bug_report_service._organization_display_name."""
    try:
        result = (
            get_supabase_admin()
            .table("organizations")
            .select("organization_name, name")
            .eq("organization_id", organization_id)
            .maybe_single()
            .execute()
        )
        org = result.data if result else None
        return (org or {}).get("organization_name") or (org or {}).get("name") or "Unknown organisation"
    except Exception as exc:
        logger.warning("Could not resolve organisation name for %s: %s", organization_id, exc)
        return "Unknown organisation"


async def create_improvement_feedback(organization_id: str, submitted_by: str, description: str) -> dict[str, Any]:
    description = description.strip()
    now = _now_iso()
    resp = (
        get_supabase_admin()
        .table("improvement_feedback")
        .insert(
            {
                "organization_id": organization_id,
                "submitted_by": submitted_by,
                "description": description,
                "status": "open",
                "created_at": now,
                "updated_at": now,
            }
        )
        .execute()
    )
    row = resp.data[0]

    # Best-effort — Jira being unconfigured or unreachable must never fail
    # the submission itself, which has already been saved above.
    org_name = _organization_display_name(organization_id)
    issue_key = await jira_service.create_issue(
        summary=f"[{org_name}] {description[:80]}",
        description=f"Reported by organisation: {org_name}\n\n{description}",
    )
    if issue_key:
        # A real Jira ticket already exists at this point — saving its key
        # back to our row is itself best-effort, same reasoning as
        # bug_report_service.create_bug_report.
        try:
            update_resp = (
                get_supabase_admin()
                .table("improvement_feedback")
                .update({"jira_issue_key": issue_key})
                .eq("id", row["id"])
                .execute()
            )
            row = update_resp.data[0]
        except Exception as exc:
            logger.warning(
                "Could not save jira_issue_key=%s onto improvement_feedback %s: %s", issue_key, row["id"], exc
            )

    return row
