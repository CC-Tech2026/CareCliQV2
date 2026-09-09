"""Improvements & Feedback — see backend/app/api/improvement_feedback.py for
the submission endpoint (managing director only, scoped to their own org)
and backend/app/api/admin.py for the Super Admin listing/status endpoints
that read across every org.

Deliberately has no Jira integration (unlike bug_report_service.py, which
this otherwise mirrors) — a feedback submission is meant to read as a
plain internal comment to CareCliQ, not spin up an external ticket."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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
    return resp.data[0]
