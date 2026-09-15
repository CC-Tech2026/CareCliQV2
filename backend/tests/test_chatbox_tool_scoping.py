"""
Chatbox ("Quill") tool scoping — the 16 tools beyond the two RAG ones
already covered by test_chatbox_rag_scoping.py.

The direct queries in tools.py run as the read-only ``quill_agent``
Postgres role (see db.py / migration 197), so the *organisation* boundary
has an RLS backstop. The coordinator *team* boundary does not — it is
Python-only — and the helpers Quill borrows from incident_service /
rag_service / dashboards still run on the service-role key. So these
role/team checks, written by hand inside each tool, remain the real
boundary for those cases, and a regression here fails silently unless a
test catches it.

This file covers the three distinct scoping shapes used across the 18
tools, with representative tools for each rather than all 16 individually:

  - Shape A (team-vs-org, via the shared _resolve_team_or_org_scope helper
    added to remove eight hand-duplicated copies of this logic):
    get_participant_count, get_active_worker_count.
  - Shape B (org-wide for both coordinator and managing_director, simple
    either-role gate, no team narrowing exists for this data anywhere in
    the app): get_incident_summary.
  - Shape D (managing_director only): get_retention_rate.
"""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.app.services.chatbox import db as chatbox_db
from backend.app.services.chatbox import tools as chatbox_tools


@pytest.fixture(autouse=True)
def _quill_jwt_secret():
    """tools.py mints a quill_agent JWT before any query (see db.py). CI has
    no SUPABASE_JWT_SECRET, and db.py deliberately fails closed without one,
    so give every test here a dummy secret — the client is never executed
    against a real database in this file."""
    with patch.object(chatbox_db.settings, "supabase_jwt_secret", "test-jwt-secret-" + "x" * 40):
        yield


def _find_tool(tool_list, name):
    return next(t for t in tool_list if t.name == name)


def _make_user(role: str, org_id: str, user_id: str) -> dict:
    return {"id": user_id, "sub": user_id, "organization_id": org_id, "role": role}


# ── _resolve_team_or_org_scope — the shared helper itself ──────────────────

def test_scope_helper_managing_director_is_org_wide_with_no_team_filter():
    user = _make_user("managing_director", str(uuid.uuid4()), str(uuid.uuid4()))
    result = chatbox_tools._resolve_team_or_org_scope(user)
    assert result == ("organisation-wide", None)


def test_scope_helper_coordinator_is_scoped_to_their_own_team():
    org_id = str(uuid.uuid4())
    user = _make_user("support_coordinator", org_id, str(uuid.uuid4()))
    team_ids = {str(uuid.uuid4()), str(uuid.uuid4())}

    with patch.object(chatbox_tools, "get_coordinator_team_ids", return_value=team_ids):
        scope, worker_ids = chatbox_tools._resolve_team_or_org_scope(user)

    assert scope == "your team"
    assert worker_ids == team_ids


def test_scope_helper_rejects_a_role_that_is_neither():
    user = _make_user("support_worker", str(uuid.uuid4()), str(uuid.uuid4()))
    assert chatbox_tools._resolve_team_or_org_scope(user) is None


def test_scope_helper_never_mixes_up_two_coordinators_teams():
    """Two different coordinators, two different orgs — resolving one's
    scope must never leak into the other's team ids."""
    org_a, org_b = str(uuid.uuid4()), str(uuid.uuid4())
    coordinator_a = _make_user("support_coordinator", org_a, str(uuid.uuid4()))
    coordinator_b = _make_user("support_coordinator", org_b, str(uuid.uuid4()))
    team_a = {str(uuid.uuid4())}
    team_b = {str(uuid.uuid4())}

    def _team_ids_for(user, _supabase):
        return team_a if user is coordinator_a else team_b

    with patch.object(chatbox_tools, "get_coordinator_team_ids", side_effect=_team_ids_for):
        _, worker_ids_a = chatbox_tools._resolve_team_or_org_scope(coordinator_a)
        _, worker_ids_b = chatbox_tools._resolve_team_or_org_scope(coordinator_b)

    assert worker_ids_a == team_a
    assert worker_ids_b == team_b
    assert worker_ids_a.isdisjoint(worker_ids_b)


# ── Shape A: get_participant_count (team-vs-org, via the shared helper) ────

@pytest.mark.asyncio
async def test_participant_count_coordinator_only_sees_their_team():
    org_id = str(uuid.uuid4())
    coordinator = _make_user("support_coordinator", org_id, str(uuid.uuid4()))
    my_worker_id = str(uuid.uuid4())
    other_worker_id = str(uuid.uuid4())
    participants = [
        {"id": "p1", "assigned_worker_id": my_worker_id},
        {"id": "p2", "assigned_worker_id": other_worker_id},  # not on this coordinator's team
    ]

    with patch.object(chatbox_tools, "audit_service") as mock_audit, \
         patch.object(chatbox_tools, "get_coordinator_team_ids", return_value={my_worker_id}), \
         patch.object(chatbox_tools.participant_service, "get_participants_list_light", AsyncMock(return_value=participants)):
        mock_audit.log_action = AsyncMock()
        tool = _find_tool(chatbox_tools.build_tools_for_user(coordinator, "thread-1"), "get_participant_count")
        result, _ = await tool.coroutine()

    assert result["scope"] == "your team"
    assert result["participant_count"] == 1, "must not count the other worker's participant"


@pytest.mark.asyncio
async def test_participant_count_managing_director_sees_everyone():
    org_id = str(uuid.uuid4())
    md = _make_user("managing_director", org_id, str(uuid.uuid4()))
    participants = [{"id": "p1"}, {"id": "p2"}, {"id": "p3"}]

    with patch.object(chatbox_tools, "audit_service") as mock_audit, \
         patch.object(chatbox_tools.participant_service, "get_participants_list_light", AsyncMock(return_value=participants)):
        mock_audit.log_action = AsyncMock()
        tool = _find_tool(chatbox_tools.build_tools_for_user(md, "thread-1"), "get_participant_count")
        result, _ = await tool.coroutine()

    assert result["scope"] == "organisation-wide"
    assert result["participant_count"] == 3


@pytest.mark.asyncio
async def test_participant_count_rejects_a_support_worker():
    worker = _make_user("support_worker", str(uuid.uuid4()), str(uuid.uuid4()))

    with patch.object(chatbox_tools, "audit_service") as mock_audit:
        mock_audit.log_action = AsyncMock()
        tool = _find_tool(chatbox_tools.build_tools_for_user(worker, "thread-1"), "get_participant_count")
        result, _ = await tool.coroutine()

    assert "error" in result


# ── Shape A again: get_active_worker_count (team fetch, not a data filter) ─

@pytest.mark.asyncio
async def test_active_worker_count_coordinator_gets_only_their_team_size():
    org_id = str(uuid.uuid4())
    coordinator = _make_user("support_coordinator", org_id, str(uuid.uuid4()))
    team_ids = {str(uuid.uuid4())}
    team_members = [{"id": next(iter(team_ids)), "role": "support_worker", "is_active": True}]

    with patch.object(chatbox_tools, "audit_service") as mock_audit, \
         patch.object(chatbox_tools, "get_coordinator_team_ids", return_value=team_ids), \
         patch.object(chatbox_tools, "_team_members", AsyncMock(return_value=team_members)) as mock_team_members:
        mock_audit.log_action = AsyncMock()
        tool = _find_tool(chatbox_tools.build_tools_for_user(coordinator, "thread-1"), "get_active_worker_count")
        result, _ = await tool.coroutine()

    mock_team_members.assert_awaited_once_with(org_id, team_ids)
    assert result["scope"] == "your team"
    assert result["active_worker_count"] == 1


# ── Shape B: get_incident_summary — org-wide for both roles ────────────────

@pytest.mark.asyncio
async def test_incident_summary_available_to_coordinator_and_md_alike():
    org_id = str(uuid.uuid4())
    stats = {"total": 4, "open": 2, "overdue": 1, "critical": 0}

    for role in ("support_coordinator", "managing_director"):
        user = _make_user(role, org_id, str(uuid.uuid4()))
        with patch.object(chatbox_tools, "audit_service") as mock_audit, \
             patch.object(chatbox_tools, "incident_service") as mock_incident_service:
            mock_audit.log_action = AsyncMock()
            mock_incident_service.get_incident_stats = AsyncMock(return_value=stats)
            tool = _find_tool(chatbox_tools.build_tools_for_user(user, "thread-1"), "get_incident_summary")
            result, _ = await tool.coroutine()

        assert result["scope"] == "organisation-wide", f"failed for role={role}"
        assert result["total"] == 4, f"failed for role={role}"


@pytest.mark.asyncio
async def test_incident_summary_rejects_a_support_worker():
    worker = _make_user("support_worker", str(uuid.uuid4()), str(uuid.uuid4()))

    with patch.object(chatbox_tools, "audit_service") as mock_audit:
        mock_audit.log_action = AsyncMock()
        tool = _find_tool(chatbox_tools.build_tools_for_user(worker, "thread-1"), "get_incident_summary")
        result, _ = await tool.coroutine()

    assert "error" in result


# ── Shape D: get_retention_rate — managing_director only ───────────────────

@pytest.mark.asyncio
async def test_retention_rate_rejects_a_coordinator():
    coordinator = _make_user("support_coordinator", str(uuid.uuid4()), str(uuid.uuid4()))

    with patch.object(chatbox_tools, "audit_service") as mock_audit:
        mock_audit.log_action = AsyncMock()
        tool = _find_tool(chatbox_tools.build_tools_for_user(coordinator, "thread-1"), "get_retention_rate")
        result, _ = await tool.coroutine()

    assert "error" in result


@pytest.mark.asyncio
async def test_retention_rate_computed_for_managing_director():
    org_id = str(uuid.uuid4())
    md = _make_user("managing_director", org_id, str(uuid.uuid4()))

    mock_result = MagicMock(count=10, data=[{"is_active": False}, {"is_active": False}])
    mock_supabase = MagicMock()
    mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = mock_result

    with patch.object(chatbox_tools, "audit_service") as mock_audit, \
         patch.object(chatbox_tools, "quill_client", return_value=mock_supabase):
        mock_audit.log_action = AsyncMock()
        tool = _find_tool(chatbox_tools.build_tools_for_user(md, "thread-1"), "get_retention_rate")
        result, _ = await tool.coroutine()

    mock_supabase.table.return_value.select.return_value.eq.assert_called_with("organization_id", org_id)
    assert result["scope"] == "organisation-wide"
    assert result["retention_rate_pct"] == 80.0
