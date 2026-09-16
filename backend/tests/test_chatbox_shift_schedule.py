"""
get_shift_schedule — Quill's plain-scheduling tool.

Before this tool existed, the only date-aware shift lookups
(get_shift_progress_note and the three progress-note ZIP exports) all
hardcoded status_filter="completed", because they exist to fetch a
progress-note PDF, which only gets written once a shift is finished.
That meant a plain scheduling question ("what shifts does X have
tomorrow?", "what was on the roster last Tuesday?") always failed —
future shifts can never be "completed", and a past shift left in
"scheduled" status (worker never closed it out) matched nothing either,
even though the shift genuinely happened.

get_shift_schedule has no status filter: it returns every shift in a
date range regardless of status, so it can actually answer those
questions. These tests pin its scoping (team-vs-org, shared with the
other tools via _resolve_team_or_org_scope), its participant/worker name
filtering, and that it surfaces scheduled/cancelled shifts the
progress-note tools would silently miss.
"""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

import pytest

from backend.app.core import timezone as app_tz
from backend.app.services.chatbox import blocks as chatbox_blocks
from backend.app.services.chatbox import db as chatbox_db
from backend.app.services.chatbox import tools as chatbox_tools

ADELAIDE = ZoneInfo("Australia/Adelaide")


@pytest.fixture(autouse=True)
def _fixed_timezone():
    with patch.object(app_tz, "APP_TIMEZONE", ADELAIDE), \
         patch.object(chatbox_tools, "participant_timezone", lambda *a, **k: ADELAIDE), \
         patch.object(chatbox_tools, "user_timezone", lambda *a, **k: ADELAIDE), \
         patch.object(chatbox_db.settings, "supabase_jwt_secret", "test-jwt-secret-" + "x" * 40):
        yield


def _find_tool(tool_list, name):
    return next(t for t in tool_list if t.name == name)


def _make_user(role: str, org_id: str, user_id: str) -> dict:
    return {"id": user_id, "sub": user_id, "organization_id": org_id, "role": role}


def _call(user, **kwargs):
    with patch.object(chatbox_tools, "audit_service") as mock_audit, \
         patch.object(chatbox_tools, "quill_client", return_value=None):
        mock_audit.log_action = AsyncMock()
        tool = _find_tool(chatbox_tools.build_tools_for_user(user, "thread-1"), "get_shift_schedule")
        return tool, mock_audit


# ── Finds shifts the progress-note tools can't ─────────────────────────


@pytest.mark.asyncio
async def test_returns_a_future_scheduled_shift_with_no_progress_note_yet():
    """The whole point of this tool: get_shift_progress_note would say
    'no completed shift found' for this row — it's still 'scheduled'."""
    org_id = str(uuid.uuid4())
    md = _make_user("managing_director", org_id, str(uuid.uuid4()))
    participant = {"id": "p1", "full_name": "Amara Participant"}
    rows = [{
        "id": "s1", "worker_id": "w1", "participant_id": "p1",
        "status": "scheduled",
        "scheduled_start": "2026-09-20T00:00:00+00:00",
        "scheduled_end": "2026-09-20T04:00:00+00:00",
    }]

    tool, _ = _call(md)
    with patch.object(chatbox_tools.participant_service, "get_participants_list_light", AsyncMock(return_value=[participant])), \
         patch.object(chatbox_tools, "_team_members", AsyncMock(return_value=[{"id": "w1", "full_name": "Wanjiru Worker"}])), \
         patch.object(chatbox_tools, "_execute_shift_query_with_legacy_fallback", return_value=rows):
        result, _ = await tool.coroutine(date_from="2026-09-20", date_to="2026-09-20")

    assert "error" not in result
    assert result["count"] == 1
    assert result["shifts"][0]["status"] == "scheduled"
    assert result["shifts"][0]["participant_name"] == "Amara Participant"


@pytest.mark.asyncio
async def test_returns_a_cancelled_past_shift():
    org_id = str(uuid.uuid4())
    md = _make_user("managing_director", org_id, str(uuid.uuid4()))
    rows = [{
        "id": "s1", "worker_id": "w1", "participant_id": "p1",
        "status": "cancelled",
        "scheduled_start": "2026-09-01T00:00:00+00:00",
        "scheduled_end": "2026-09-01T04:00:00+00:00",
    }]

    tool, _ = _call(md)
    with patch.object(chatbox_tools.participant_service, "get_participants_list_light", AsyncMock(return_value=[{"id": "p1", "full_name": "P"}])), \
         patch.object(chatbox_tools, "_team_members", AsyncMock(return_value=[{"id": "w1", "full_name": "W"}])), \
         patch.object(chatbox_tools, "_execute_shift_query_with_legacy_fallback", return_value=rows):
        result, _ = await tool.coroutine(date_from="2026-09-01", date_to="2026-09-01")

    assert result["shifts"][0]["status"] == "cancelled"


@pytest.mark.asyncio
async def test_no_status_filter_is_sent_to_the_query():
    """status_filter=None is what makes this tool different from
    get_shift_progress_note et al — assert the query is actually called
    that way, not just that results happen to include non-completed rows."""
    org_id = str(uuid.uuid4())
    md = _make_user("managing_director", org_id, str(uuid.uuid4()))

    tool, _ = _call(md)
    with patch.object(chatbox_tools.participant_service, "get_participants_list_light", AsyncMock(return_value=[])), \
         patch.object(chatbox_tools, "_team_members", AsyncMock(return_value=[])), \
         patch.object(chatbox_tools, "_execute_shift_query_with_legacy_fallback", return_value=[]) as mock_query:
        await tool.coroutine(date_from="2026-09-01", date_to="2026-09-07")

    assert mock_query.call_args.kwargs["status_filter"] is None


# ── Scoping (shared _resolve_team_or_org_scope helper) ─────────────────


@pytest.mark.asyncio
async def test_coordinator_only_sees_their_teams_shifts():
    org_id = str(uuid.uuid4())
    coordinator = _make_user("support_coordinator", org_id, str(uuid.uuid4()))
    my_worker_id, other_worker_id = str(uuid.uuid4()), str(uuid.uuid4())
    rows = [
        {"id": "s1", "worker_id": my_worker_id, "participant_id": "p1", "status": "scheduled",
         "scheduled_start": "2026-09-20T00:00:00+00:00", "scheduled_end": "2026-09-20T04:00:00+00:00"},
        {"id": "s2", "worker_id": other_worker_id, "participant_id": "p2", "status": "scheduled",
         "scheduled_start": "2026-09-20T00:00:00+00:00", "scheduled_end": "2026-09-20T04:00:00+00:00"},
    ]

    tool, _ = _call(coordinator)
    with patch.object(chatbox_tools, "get_coordinator_team_ids", return_value={my_worker_id}), \
         patch.object(chatbox_tools.participant_service, "get_participants_list_light", AsyncMock(return_value=[{"id": "p1"}, {"id": "p2"}])), \
         patch.object(chatbox_tools, "_team_members", AsyncMock(return_value=[{"id": my_worker_id, "full_name": "Mine"}])), \
         patch.object(chatbox_tools, "_execute_shift_query_with_legacy_fallback", return_value=rows):
        result, _ = await tool.coroutine(date_from="2026-09-20", date_to="2026-09-20")

    assert result["scope"] == "your team"
    assert result["count"] == 1
    assert result["shifts"][0]["shift_id"] == "s1"


@pytest.mark.asyncio
async def test_rejects_a_support_worker():
    worker = _make_user("support_worker", str(uuid.uuid4()), str(uuid.uuid4()))
    tool, _ = _call(worker)
    result, _ = await tool.coroutine(date_from="2026-09-20", date_to="2026-09-20")
    assert "error" in result


# ── Name filtering ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_filters_to_one_participant_by_name():
    org_id = str(uuid.uuid4())
    md = _make_user("managing_director", org_id, str(uuid.uuid4()))
    rows = [
        {"id": "s1", "worker_id": "w1", "participant_id": "p1", "status": "scheduled",
         "scheduled_start": "2026-09-20T00:00:00+00:00", "scheduled_end": "2026-09-20T04:00:00+00:00"},
        {"id": "s2", "worker_id": "w1", "participant_id": "p2", "status": "scheduled",
         "scheduled_start": "2026-09-20T00:00:00+00:00", "scheduled_end": "2026-09-20T04:00:00+00:00"},
    ]
    participants = [{"id": "p1", "full_name": "Amara Participant"}, {"id": "p2", "full_name": "Zoya Participant"}]

    tool, _ = _call(md)
    with patch.object(chatbox_tools.participant_service, "get_participants_list_light", AsyncMock(return_value=participants)), \
         patch.object(chatbox_tools, "_team_members", AsyncMock(return_value=[{"id": "w1", "full_name": "W"}])), \
         patch.object(chatbox_tools, "_execute_shift_query_with_legacy_fallback", return_value=rows):
        result, _ = await tool.coroutine(date_from="2026-09-20", date_to="2026-09-20", participant_name="Amara")

    assert result["count"] == 1
    assert result["shifts"][0]["participant_id"] == "p1"


@pytest.mark.asyncio
async def test_filters_to_one_worker_by_name():
    org_id = str(uuid.uuid4())
    md = _make_user("managing_director", org_id, str(uuid.uuid4()))
    team = [{"id": "w1", "full_name": "Wanjiru Worker"}, {"id": "w2", "full_name": "Wei Worker"}]

    tool, _ = _call(md)
    with patch.object(chatbox_tools.participant_service, "get_participants_list_light", AsyncMock(return_value=[])), \
         patch.object(chatbox_tools, "_team_members", AsyncMock(return_value=team)), \
         patch.object(chatbox_tools, "_execute_shift_query_with_legacy_fallback", return_value=[]) as mock_query:
        await tool.coroutine(date_from="2026-09-20", date_to="2026-09-20", worker_name="Wanjiru")

    assert mock_query.call_args.kwargs["worker_id"] == "w1"


@pytest.mark.asyncio
async def test_rejects_both_a_participant_and_a_worker_name():
    md = _make_user("managing_director", str(uuid.uuid4()), str(uuid.uuid4()))
    tool, _ = _call(md)
    result, _ = await tool.coroutine(
        date_from="2026-09-20", date_to="2026-09-20",
        participant_name="Amara", worker_name="Wanjiru",
    )
    assert "error" in result


@pytest.mark.asyncio
async def test_unknown_participant_name_errors_before_querying():
    md = _make_user("managing_director", str(uuid.uuid4()), str(uuid.uuid4()))
    tool, _ = _call(md)
    with patch.object(chatbox_tools.participant_service, "get_participants_list_light", AsyncMock(return_value=[])), \
         patch.object(chatbox_tools, "_execute_shift_query_with_legacy_fallback") as mock_query:
        result, _ = await tool.coroutine(date_from="2026-09-20", date_to="2026-09-20", participant_name="Nobody")

    assert "error" in result
    mock_query.assert_not_called()


# ── Bad input / empty result ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rejects_an_invalid_date_range():
    md = _make_user("managing_director", str(uuid.uuid4()), str(uuid.uuid4()))
    tool, _ = _call(md)
    with patch.object(chatbox_tools.participant_service, "get_participants_list_light", AsyncMock(return_value=[])), \
         patch.object(chatbox_tools, "_team_members", AsyncMock(return_value=[])):
        result, _ = await tool.coroutine(date_from="not-a-date", date_to="2026-09-20")

    assert "not a valid date range" in result["error"]


@pytest.mark.asyncio
async def test_empty_result_names_who_was_searched_for():
    md = _make_user("managing_director", str(uuid.uuid4()), str(uuid.uuid4()))
    tool, _ = _call(md)
    with patch.object(chatbox_tools.participant_service, "get_participants_list_light", AsyncMock(return_value=[{"id": "p1", "full_name": "Amara Participant"}])), \
         patch.object(chatbox_tools, "_team_members", AsyncMock(return_value=[])), \
         patch.object(chatbox_tools, "_execute_shift_query_with_legacy_fallback", return_value=[]):
        result, _ = await tool.coroutine(date_from="2026-09-20", date_to="2026-09-20", participant_name="Amara")

    assert "Amara" in result["error"]


# ── Block rendering (blocks.py) ──────────────────────────────────────────


def test_schedule_table_shows_status_column():
    artifact = {
        "timezone": "Australia/Adelaide",
        "date_from": "2026-09-20", "date_to": "2026-09-20",
        "shifts": [
            {"worker_name": "W", "participant_name": "P", "status": "scheduled", "timezone": "Australia/Adelaide",
             "scheduled_start": "2026-09-20T00:00:00+00:00", "scheduled_end": "2026-09-20T04:00:00+00:00"},
            {"worker_name": "W2", "participant_name": "P2", "status": "cancelled", "timezone": "Australia/Adelaide",
             "scheduled_start": "2026-09-20T00:00:00+00:00", "scheduled_end": "2026-09-20T04:00:00+00:00"},
        ],
    }
    blocks = chatbox_blocks._blocks_for_shift_schedule(artifact)
    assert blocks[0]["columns"][-1] == "Status"
    assert blocks[0]["rows"][0][-1] == "Scheduled"
    assert blocks[0]["rows"][1][-1] == "Cancelled"


def test_empty_schedule_renders_a_zero_stat():
    assert chatbox_blocks._blocks_for_shift_schedule({"shifts": []}) == [
        {"type": "stat", "label": "Shifts in range", "value": 0}
    ]
