"""
Track B — chatbox RAG tool scoping.

search_session_notes / search_incident_history must restrict a support
worker to their own records and stay organisation-wide for a coordinator or
managing director, with the restriction applied via rag_service's
worker_ids param (query-level), never as a filter on already-fetched rows.
This is the check the spec calls "the one that matters most" — it must be
verified against the outgoing rag_service call, not just the returned data.
"""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.services.chatbox import tools as chatbox_tools


def _find_tool(tool_list, name):
    return next(t for t in tool_list if t.name == name)


def _make_user(role: str, org_id: str, user_id: str) -> dict:
    return {"id": user_id, "sub": user_id, "organization_id": org_id, "role": role}


@pytest.mark.asyncio
async def test_search_session_notes_support_worker_scoped_to_self():
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    user = _make_user("support_worker", org_id, user_id)

    with patch.object(chatbox_tools, "audit_service") as mock_audit:
        mock_audit.log_action = AsyncMock()
        tool = _find_tool(chatbox_tools.build_tools_for_user(user, "thread-1"), "search_session_notes")

        with patch.object(
            chatbox_tools.rag_service, "retrieve_similar_sessions", return_value=[]
        ) as mock_retrieve:
            result, _ = await tool.coroutine(query="community access")

    mock_retrieve.assert_called_once()
    assert mock_retrieve.call_args.kwargs["worker_ids"] == [user_id], \
        "a support worker's session-note search must be restricted to their own worker_id in the query itself"
    assert result["scope"] == "your own notes"


@pytest.mark.asyncio
async def test_search_session_notes_coordinator_org_wide():
    org_id = str(uuid.uuid4())
    user = _make_user("support_coordinator", org_id, str(uuid.uuid4()))

    with patch.object(chatbox_tools, "audit_service") as mock_audit:
        mock_audit.log_action = AsyncMock()
        tool = _find_tool(chatbox_tools.build_tools_for_user(user, "thread-1"), "search_session_notes")

        with patch.object(
            chatbox_tools.rag_service, "retrieve_similar_sessions", return_value=[]
        ) as mock_retrieve:
            result, _ = await tool.coroutine(query="community access")

    assert mock_retrieve.call_args.kwargs["worker_ids"] is None
    assert result["scope"] == "organisation-wide"


@pytest.mark.asyncio
async def test_search_incident_history_support_worker_scoped_to_self():
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    user = _make_user("support_worker", org_id, user_id)

    with patch.object(chatbox_tools, "audit_service") as mock_audit:
        mock_audit.log_action = AsyncMock()
        tool = _find_tool(chatbox_tools.build_tools_for_user(user, "thread-1"), "search_incident_history")

        with patch.object(
            chatbox_tools.rag_service, "retrieve_similar_incidents", return_value=[]
        ) as mock_retrieve:
            result, _ = await tool.coroutine(query="behaviour incident")

    assert mock_retrieve.call_args.kwargs["worker_ids"] == [user_id], \
        "a support worker's incident search must be restricted to reports they filed, in the query itself"
    assert result["scope"] == "your own reports"


@pytest.mark.asyncio
async def test_search_incident_history_managing_director_org_wide():
    org_id = str(uuid.uuid4())
    user = _make_user("managing_director", org_id, str(uuid.uuid4()))

    with patch.object(chatbox_tools, "audit_service") as mock_audit:
        mock_audit.log_action = AsyncMock()
        tool = _find_tool(chatbox_tools.build_tools_for_user(user, "thread-1"), "search_incident_history")

        with patch.object(
            chatbox_tools.rag_service, "retrieve_similar_incidents", return_value=[]
        ) as mock_retrieve:
            result, _ = await tool.coroutine(query="behaviour incident")

    assert mock_retrieve.call_args.kwargs["worker_ids"] is None
    assert result["scope"] == "organisation-wide"


@pytest.mark.asyncio
async def test_two_orgs_never_cross_worker_ids():
    """A support worker in Org A and a support worker in Org B must each be
    scoped to their own worker_id and their own org_id — neither call can
    leak the other's id into its query params."""
    org_a, org_b = str(uuid.uuid4()), str(uuid.uuid4())
    user_a_id, user_b_id = str(uuid.uuid4()), str(uuid.uuid4())
    user_a = _make_user("support_worker", org_a, user_a_id)
    user_b = _make_user("support_worker", org_b, user_b_id)

    with patch.object(chatbox_tools, "audit_service") as mock_audit:
        mock_audit.log_action = AsyncMock()

        tool_a = _find_tool(chatbox_tools.build_tools_for_user(user_a, "t-a"), "search_session_notes")
        with patch.object(
            chatbox_tools.rag_service, "retrieve_similar_sessions", return_value=[]
        ) as mock_a:
            await tool_a.coroutine(query="notes")

        tool_b = _find_tool(chatbox_tools.build_tools_for_user(user_b, "t-b"), "search_session_notes")
        with patch.object(
            chatbox_tools.rag_service, "retrieve_similar_sessions", return_value=[]
        ) as mock_b:
            await tool_b.coroutine(query="notes")

    assert mock_a.call_args.kwargs["org_id"] == org_a
    assert mock_a.call_args.kwargs["worker_ids"] == [user_a_id]
    assert mock_b.call_args.kwargs["org_id"] == org_b
    assert mock_b.call_args.kwargs["worker_ids"] == [user_b_id]
    assert mock_a.call_args.kwargs["org_id"] != mock_b.call_args.kwargs["org_id"]
    assert mock_a.call_args.kwargs["worker_ids"] != mock_b.call_args.kwargs["worker_ids"]
