"""Inbound webhook — lets a status change made directly on a Jira ticket
flow back into our own bug_reports / improvement_feedback row, completing
the sync that admin.py's _update_feedback_status only does one way
(Master Portal -> Jira). Configured as a Jira Automation rule's "Send web
request" action (Jira has no notion of our JWTs, so this is authenticated
by a shared secret header instead — see settings.jira_webhook_secret)."""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel

from ..core.config import settings
from ..services import jira_webhook_service

router = APIRouter(prefix="/webhooks/jira", tags=["jira-webhook"])


class JiraStatusWebhook(BaseModel):
    issue_key: str
    status: str


@router.post("")
async def receive_jira_status_change(
    body: JiraStatusWebhook,
    x_webhook_secret: str | None = Header(default=None, alias="X-Webhook-Secret"),
):
    if not settings.jira_webhook_secret or x_webhook_secret != settings.jira_webhook_secret:
        # Same response either way — an unset secret must fail closed, not
        # accept every request just because nothing was configured to check.
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook secret.")
    updated = jira_webhook_service.apply_jira_status_change(body.issue_key, body.status)
    return {"ok": True, "updated": updated}
