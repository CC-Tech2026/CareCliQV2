"""Inbound Jira status webhook (backend/app/api/jira_webhook.py,
backend/app/services/jira_webhook_service.py) — a status change made
directly on a Jira ticket flowing back to our own row. Mirrors the pattern
used in test_bug_reports.py: call the route/service functions directly
with a mocked supabase client, no HTTP layer."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.api import jira_webhook
from backend.app.services import jira_webhook_service


def _settings(secret: str = "shh-its-a-secret"):
    settings = MagicMock()
    settings.jira_webhook_secret = secret
    return settings


@pytest.mark.asyncio
async def test_webhook_rejects_missing_secret():
    with patch("backend.app.api.jira_webhook.settings", _settings()):
        with pytest.raises(HTTPException) as exc:
            await jira_webhook.receive_jira_status_change(
                body=jira_webhook.JiraStatusWebhook(issue_key="BRS-1", status="Done"),
                x_webhook_secret=None,
            )
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_webhook_rejects_wrong_secret():
    with patch("backend.app.api.jira_webhook.settings", _settings()):
        with pytest.raises(HTTPException) as exc:
            await jira_webhook.receive_jira_status_change(
                body=jira_webhook.JiraStatusWebhook(issue_key="BRS-1", status="Done"),
                x_webhook_secret="not-the-secret",
            )
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_webhook_rejects_everything_when_unconfigured():
    with patch("backend.app.api.jira_webhook.settings", _settings(secret="")):
        with pytest.raises(HTTPException) as exc:
            await jira_webhook.receive_jira_status_change(
                body=jira_webhook.JiraStatusWebhook(issue_key="BRS-1", status="Done"),
                x_webhook_secret="",
            )
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_webhook_applies_status_with_correct_secret():
    with patch("backend.app.api.jira_webhook.settings", _settings()), patch(
        "backend.app.api.jira_webhook.jira_webhook_service.apply_jira_status_change", return_value=True
    ) as apply_change:
        result = await jira_webhook.receive_jira_status_change(
            body=jira_webhook.JiraStatusWebhook(issue_key="BRS-1", status="Done"),
            x_webhook_secret="shh-its-a-secret",
        )
    apply_change.assert_called_once_with("BRS-1", "Done")
    assert result == {"ok": True, "updated": True}


def test_apply_jira_status_change_updates_bug_report():
    supabase = MagicMock()

    def _table(name: str):
        table = MagicMock()
        if name == "bug_reports":
            table.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[{"id": "r-1"}])
        elif name == "improvement_feedback":
            table.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
        else:
            raise AssertionError(f"Unexpected table requested: {name}")
        return table

    supabase.table.side_effect = _table

    with patch("backend.app.services.jira_webhook_service.get_supabase_admin", return_value=supabase):
        updated = jira_webhook_service.apply_jira_status_change("BRS-1", "Done")

    assert updated is True


def test_apply_jira_status_change_falls_back_to_improvement_feedback():
    supabase = MagicMock()

    def _table(name: str):
        table = MagicMock()
        if name == "bug_reports":
            table.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
        elif name == "improvement_feedback":
            table.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[{"id": "f-1"}])
        else:
            raise AssertionError(f"Unexpected table requested: {name}")
        return table

    supabase.table.side_effect = _table

    with patch("backend.app.services.jira_webhook_service.get_supabase_admin", return_value=supabase):
        updated = jira_webhook_service.apply_jira_status_change("BRS-2", "In Progress")

    assert updated is True


def test_apply_jira_status_change_false_when_issue_key_unknown():
    supabase = MagicMock()
    supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[])

    with patch("backend.app.services.jira_webhook_service.get_supabase_admin", return_value=supabase):
        updated = jira_webhook_service.apply_jira_status_change("BRS-999", "Done")

    assert updated is False


def test_apply_jira_status_change_false_for_unmapped_jira_status():
    supabase = MagicMock()
    with patch("backend.app.services.jira_webhook_service.get_supabase_admin", return_value=supabase):
        updated = jira_webhook_service.apply_jira_status_change("BRS-1", "Backlog")

    assert updated is False
    supabase.table.assert_not_called()


def test_apply_jira_status_change_false_for_empty_issue_key():
    with patch("backend.app.services.jira_webhook_service.get_supabase_admin"):
        assert jira_webhook_service.apply_jira_status_change("", "Done") is False
