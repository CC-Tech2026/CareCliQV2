"""Inbound half of the Jira status sync — see backend/app/api/jira_webhook.py
for the endpoint Jira Automation calls, and admin.py's _update_feedback_status
for the outbound half (Master Portal -> Jira). A ticket's jira_issue_key can
belong to either bug_reports or improvement_feedback, so this checks both
rather than assuming which table a given webhook call is about."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from . import jira_service
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

# (table, not_found_label) — checked in this order for a matching
# jira_issue_key. Same two tables admin.py's shared helpers already read.
_TABLES: tuple[str, ...] = ("bug_reports", "improvement_feedback")


def apply_jira_status_change(issue_key: str, jira_status_name: str) -> bool:
    """Finds whichever of our tables holds this Jira issue key and applies
    the matching internal status. Returns True if a row was found and
    updated, False if the issue key is unknown to us or the Jira status
    name doesn't map to one of our three statuses — never raises, since a
    webhook retrying on failure could otherwise hammer Jira/us pointlessly."""
    issue_key = (issue_key or "").strip()
    if not issue_key:
        return False
    new_status = jira_service.status_from_jira(jira_status_name)
    if not new_status:
        logger.info("Jira webhook: unmapped status '%s' for %s, ignoring", jira_status_name, issue_key)
        return False

    supabase = get_supabase_admin()
    for table in _TABLES:
        try:
            result = (
                supabase.table(table)
                .update({"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()})
                .eq("jira_issue_key", issue_key)
                .execute()
            )
        except Exception as exc:
            logger.warning("Jira webhook: could not update %s for %s: %s", table, issue_key, exc)
            continue
        if result.data:
            return True
    logger.info("Jira webhook: no bug report or feedback row linked to %s", issue_key)
    return False
