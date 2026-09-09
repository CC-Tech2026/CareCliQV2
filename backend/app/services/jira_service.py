"""Jira auto-ticketing for bug reports and improvement feedback — see
backend/app/api/bug_reports.py, improvement_feedback.py, and admin.py's
shared _update_feedback_status. Every function here degrades gracefully:
an unconfigured or unreachable Jira never blocks the underlying report
from saving to our own database — it just means no Jira link this time.
"""

from __future__ import annotations

import base64
import logging
from typing import Optional

import httpx

from ..core.config import settings

logger = logging.getLogger(__name__)

# Maps our own status values to this Jira project's actual workflow status
# names — confirmed via GET /rest/api/3/project/{key}/statuses rather than
# assumed; this project's Bug workflow is To Do -> In Progress -> Done.
_STATUS_TO_JIRA_STATUS = {
    "open": "To Do",
    "in_progress": "In Progress",
    "resolved": "Done",
}

# The reverse of the above — used by the inbound Jira webhook (see
# jira_webhook_service.py) to translate a status someone set directly on
# the Jira ticket back into our own open/in_progress/resolved value.
_JIRA_STATUS_TO_STATUS = {v.lower(): k for k, v in _STATUS_TO_JIRA_STATUS.items()}

# Maps our own severity values to this Jira site's actual priority scheme
# — confirmed via GET /rest/api/3/priority rather than assumed; this site
# has the standard Highest/High/Medium/Low/Lowest set. "Urgent" (our most
# severe) maps to "Highest" since this site has no literal "Urgent" priority.
_SEVERITY_TO_JIRA_PRIORITY = {
    "low": "Low",
    "medium": "Medium",
    "urgent": "Highest",
}


def is_configured() -> bool:
    return bool(
        settings.jira_site_url and settings.jira_email and settings.jira_api_token and settings.jira_project_key
    )


def _auth_header() -> str:
    raw = f"{settings.jira_email}:{settings.jira_api_token}".encode()
    return "Basic " + base64.b64encode(raw).decode()


def _base_url() -> str:
    site = settings.jira_site_url.strip().removeprefix("https://").removeprefix("http://").rstrip("/")
    return f"https://{site}"


def _headers() -> dict[str, str]:
    return {
        "Authorization": _auth_header(),
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


async def create_issue(summary: str, description: str, severity: Optional[str] = None) -> Optional[str]:
    """Creates a Jira issue and returns its key (e.g. "BRS-142"), or None
    if Jira isn't configured or the request fails. Never raises — a Jira
    outage must never stop a bug report / feedback submission from saving.

    severity, when given and recognised, sets the ticket's Priority field
    (see _SEVERITY_TO_JIRA_PRIORITY) — an unrecognised value is silently
    left unset rather than failing the whole creation."""
    if not is_configured():
        return None
    fields: dict[str, object] = {
        "project": {"key": settings.jira_project_key},
        "summary": summary[:255],
        "description": {
            "type": "doc",
            "version": 1,
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": description}]}],
        },
        "issuetype": {"name": settings.jira_issue_type},
    }
    priority_name = _SEVERITY_TO_JIRA_PRIORITY.get(severity or "")
    if priority_name:
        fields["priority"] = {"name": priority_name}
    body = {"fields": fields}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(f"{_base_url()}/rest/api/3/issue", headers=_headers(), json=body)
            response.raise_for_status()
            return response.json().get("key")
    except Exception as exc:
        logger.warning("Jira issue creation failed: %s", exc)
        return None


async def transition_issue(issue_key: str, target_status: str) -> bool:
    """Moves a Jira issue to the workflow status matching our own
    open/in_progress/resolved status. Best-effort — returns False rather
    than raising if Jira isn't configured, the issue/transition can't be
    found, or the request fails."""
    if not is_configured() or not issue_key:
        return False
    target_name = _STATUS_TO_JIRA_STATUS.get(target_status)
    if not target_name:
        return False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            transitions_resp = await client.get(
                f"{_base_url()}/rest/api/3/issue/{issue_key}/transitions", headers=_headers()
            )
            transitions_resp.raise_for_status()
            transitions = transitions_resp.json().get("transitions", [])
            match = next(
                (t for t in transitions if t.get("to", {}).get("name", "").lower() == target_name.lower()),
                None,
            )
            if not match:
                logger.warning(
                    "Jira transition to '%s' not available for %s (available: %s)",
                    target_name,
                    issue_key,
                    [t.get("to", {}).get("name") for t in transitions],
                )
                return False
            transition_resp = await client.post(
                f"{_base_url()}/rest/api/3/issue/{issue_key}/transitions",
                headers=_headers(),
                json={"transition": {"id": match["id"]}},
            )
            transition_resp.raise_for_status()
            return True
    except Exception as exc:
        logger.warning("Jira transition failed for %s: %s", issue_key, exc)
        return False


def status_from_jira(jira_status_name: str) -> Optional[str]:
    """Reverse of _STATUS_TO_JIRA_STATUS — None when the given Jira status
    name doesn't correspond to one of our three statuses (e.g. a workflow
    status someone added in Jira that we don't know about)."""
    return _JIRA_STATUS_TO_STATUS.get((jira_status_name or "").strip().lower())


def issue_url(issue_key: str) -> Optional[str]:
    """Browser URL for a Jira issue, for linking out from the Master Portal."""
    if not settings.jira_site_url or not issue_key:
        return None
    return f"{_base_url()}/browse/{issue_key}"
