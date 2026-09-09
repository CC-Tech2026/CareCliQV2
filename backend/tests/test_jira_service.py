"""Jira auto-ticketing (backend/app/services/jira_service.py). Every
function must degrade gracefully — an unconfigured or unreachable Jira
should never raise, since a bug report / feedback submission has already
been saved to our own database by the time these run."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.app.services import jira_service


def _configured_settings(**overrides):
    base = {
        "jira_site_url": "example.atlassian.net",
        "jira_email": "admin@example.com",
        "jira_api_token": "fake-token",
        "jira_project_key": "BRS",
        "jira_issue_type": "Bug",
    }
    base.update(overrides)
    settings = MagicMock()
    for k, v in base.items():
        setattr(settings, k, v)
    return settings


def test_is_configured_false_when_any_value_missing():
    with patch("backend.app.services.jira_service.settings", _configured_settings(jira_api_token="")):
        assert jira_service.is_configured() is False


def test_is_configured_true_when_all_values_set():
    with patch("backend.app.services.jira_service.settings", _configured_settings()):
        assert jira_service.is_configured() is True


@pytest.mark.asyncio
async def test_create_issue_returns_none_when_not_configured():
    with patch("backend.app.services.jira_service.settings", _configured_settings(jira_project_key="")):
        result = await jira_service.create_issue("summary", "description")
    assert result is None


@pytest.mark.asyncio
async def test_create_issue_returns_key_on_success():
    mock_response = MagicMock()
    mock_response.json.return_value = {"key": "BRS-142"}
    mock_response.raise_for_status = MagicMock()

    mock_client = AsyncMock()
    mock_client.post.return_value = mock_response
    mock_client.__aenter__.return_value = mock_client

    with patch("backend.app.services.jira_service.settings", _configured_settings()), patch(
        "backend.app.services.jira_service.httpx.AsyncClient", return_value=mock_client
    ):
        result = await jira_service.create_issue("A bug", "It broke")

    assert result == "BRS-142"


@pytest.mark.asyncio
async def test_create_issue_maps_severity_to_priority():
    mock_response = MagicMock()
    mock_response.json.return_value = {"key": "BRS-142"}
    mock_response.raise_for_status = MagicMock()

    mock_client = AsyncMock()
    mock_client.post.return_value = mock_response
    mock_client.__aenter__.return_value = mock_client

    with patch("backend.app.services.jira_service.settings", _configured_settings()), patch(
        "backend.app.services.jira_service.httpx.AsyncClient", return_value=mock_client
    ):
        await jira_service.create_issue("A bug", "It broke", severity="urgent")

    posted_body = mock_client.post.call_args.kwargs["json"]
    # This site has no literal "Urgent" priority — urgent maps to "Highest".
    assert posted_body["fields"]["priority"] == {"name": "Highest"}


@pytest.mark.asyncio
async def test_create_issue_omits_priority_when_severity_not_given():
    mock_response = MagicMock()
    mock_response.json.return_value = {"key": "BRS-142"}
    mock_response.raise_for_status = MagicMock()

    mock_client = AsyncMock()
    mock_client.post.return_value = mock_response
    mock_client.__aenter__.return_value = mock_client

    with patch("backend.app.services.jira_service.settings", _configured_settings()), patch(
        "backend.app.services.jira_service.httpx.AsyncClient", return_value=mock_client
    ):
        await jira_service.create_issue("A bug", "It broke")

    posted_body = mock_client.post.call_args.kwargs["json"]
    assert "priority" not in posted_body["fields"]


@pytest.mark.asyncio
async def test_create_issue_returns_none_on_request_failure():
    mock_client = AsyncMock()
    mock_client.post.side_effect = RuntimeError("network down")
    mock_client.__aenter__.return_value = mock_client

    with patch("backend.app.services.jira_service.settings", _configured_settings()), patch(
        "backend.app.services.jira_service.httpx.AsyncClient", return_value=mock_client
    ):
        result = await jira_service.create_issue("A bug", "It broke")

    assert result is None


@pytest.mark.asyncio
async def test_transition_issue_false_when_not_configured():
    with patch("backend.app.services.jira_service.settings", _configured_settings(jira_email="")):
        result = await jira_service.transition_issue("BRS-1", "resolved")
    assert result is False


@pytest.mark.asyncio
async def test_transition_issue_false_for_unmapped_status():
    with patch("backend.app.services.jira_service.settings", _configured_settings()):
        result = await jira_service.transition_issue("BRS-1", "not_a_real_status")
    assert result is False


@pytest.mark.asyncio
async def test_transition_issue_posts_matching_transition_id():
    transitions_response = MagicMock()
    transitions_response.json.return_value = {
        "transitions": [
            {"id": "11", "to": {"name": "To Do"}},
            {"id": "21", "to": {"name": "In Progress"}},
            {"id": "31", "to": {"name": "Done"}},
        ]
    }
    transitions_response.raise_for_status = MagicMock()
    post_response = MagicMock()
    post_response.raise_for_status = MagicMock()

    mock_client = AsyncMock()
    mock_client.get.return_value = transitions_response
    mock_client.post.return_value = post_response
    mock_client.__aenter__.return_value = mock_client

    with patch("backend.app.services.jira_service.settings", _configured_settings()), patch(
        "backend.app.services.jira_service.httpx.AsyncClient", return_value=mock_client
    ):
        result = await jira_service.transition_issue("BRS-1", "resolved")

    assert result is True
    posted_body = mock_client.post.call_args.kwargs["json"]
    assert posted_body == {"transition": {"id": "31"}}


@pytest.mark.asyncio
async def test_transition_issue_false_when_target_not_in_workflow():
    transitions_response = MagicMock()
    transitions_response.json.return_value = {"transitions": [{"id": "11", "to": {"name": "To Do"}}]}
    transitions_response.raise_for_status = MagicMock()

    mock_client = AsyncMock()
    mock_client.get.return_value = transitions_response
    mock_client.__aenter__.return_value = mock_client

    with patch("backend.app.services.jira_service.settings", _configured_settings()), patch(
        "backend.app.services.jira_service.httpx.AsyncClient", return_value=mock_client
    ):
        result = await jira_service.transition_issue("BRS-1", "resolved")

    assert result is False
    mock_client.post.assert_not_called()


@pytest.mark.parametrize(
    "jira_status,expected",
    [("To Do", "open"), ("in progress", "in_progress"), ("DONE", "resolved"), ("Backlog", None), ("", None)],
)
def test_status_from_jira_maps_known_statuses_case_insensitively(jira_status, expected):
    assert jira_service.status_from_jira(jira_status) == expected


def test_issue_url_builds_browse_link():
    with patch("backend.app.services.jira_service.settings", _configured_settings()):
        assert jira_service.issue_url("BRS-142") == "https://example.atlassian.net/browse/BRS-142"


def test_issue_url_none_when_site_not_configured():
    with patch("backend.app.services.jira_service.settings", _configured_settings(jira_site_url="")):
        assert jira_service.issue_url("BRS-142") is None
