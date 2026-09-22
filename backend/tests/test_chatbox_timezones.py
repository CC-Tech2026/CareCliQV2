"""
Chatbox ("Quill") — shift dates and times are shown and looked up in the
app's Australian timezone, not raw UTC.

Shifts are stored as UTC timestamptz. Before this, blocks.py formatted the
UTC value directly (a 5:00 PM Adelaide shift rendered as 07:30 AM), and the
progress-note tools compared 'YYYY-MM-DD' strings straight against the UTC
column, so any shift starting before ~10:30 AM local was filed under the
previous day and missed. These tests pin the conversions against a fixed
APP_TIMEZONE so they don't depend on the machine's environment.
"""
from __future__ import annotations

import uuid
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch
from zoneinfo import ZoneInfo

import pytest

from backend.app.core import timezone as app_tz
from backend.app.services.chatbox import blocks as chatbox_blocks
from backend.app.services.chatbox import db as chatbox_db
from backend.app.services.chatbox import tools as chatbox_tools

ADELAIDE = ZoneInfo("Australia/Adelaide")  # UTC+9:30 in August (no DST)


MELBOURNE = ZoneInfo("Australia/Melbourne")  # UTC+10:00 in August


@pytest.fixture(autouse=True)
def _fixed_timezone():
    """Asker's branch = Adelaide (the request zone); participants and
    workers resolve to Adelaide unless a test overrides the lookup."""
    with patch.object(app_tz, "APP_TIMEZONE", ADELAIDE), \
         patch.object(chatbox_tools, "participant_timezone", lambda *a, **k: ADELAIDE), \
         patch.object(chatbox_tools, "user_timezone", lambda *a, **k: ADELAIDE), \
         patch.object(chatbox_db.settings, "supabase_jwt_secret", "test-jwt-secret-" + "x" * 40):
        yield


# ── Display (blocks.py) ────────────────────────────────────────────────


def test_shift_time_is_rendered_in_local_time_not_utc():
    assert chatbox_blocks._format_shift_time("2026-08-24T07:30:00+00:00") == "05:00 PM"


def test_evening_utc_timestamp_lands_on_the_next_local_day():
    # 22:30 UTC on the 24th is 08:00 on the 25th in Adelaide
    assert chatbox_blocks._format_shift_date("2026-08-24T22:30:00+00:00") == "25 Aug"
    assert chatbox_blocks._format_shift_time("2026-08-24T22:30:00+00:00") == "08:00 AM"


def test_zulu_suffix_is_handled():
    assert chatbox_blocks._format_shift_time("2026-08-24T07:30:00Z") == "05:00 PM"


def test_unparseable_values_pass_through_unchanged():
    assert chatbox_blocks._format_shift_date("not a date") == "not a date"
    assert chatbox_blocks._format_shift_time(None) is None


def test_shift_coverage_table_shows_local_times():
    artifact = {
        "scope": "organisation-wide",
        "count": 1,
        "on_shift_now": [{
            "worker_name": "Amara Worker",
            "participant_name": "P",
            "scheduled_start": "2026-08-24T07:30:00+00:00",
            "scheduled_end": "2026-08-24T09:30:00+00:00",
        }],
    }
    [table] = chatbox_blocks.build_blocks("get_shift_coverage", artifact)
    assert table["rows"][0] == ["Amara Worker", "P", "24 Aug", "05:00 PM", "07:00 PM"]


# ── Lookup (tools.py) ──────────────────────────────────────────────────


def test_local_date_range_covers_the_whole_local_day_in_utc():
    start, end = chatbox_tools._local_date_range_utc("2026-08-25", "2026-08-25")
    # Adelaide 25 Aug 00:00 -> 24 Aug 14:30 UTC; 25 Aug 23:59:59 -> 25 Aug 14:29:59 UTC
    assert start == "2026-08-24T14:30:00+00:00"
    assert end == "2026-08-25T14:29:59+00:00"


def test_local_date_range_spans_multiple_days():
    start, end = chatbox_tools._local_date_range_utc("2026-08-01", "2026-08-31")
    assert start == "2026-07-31T14:30:00+00:00"
    assert end == "2026-08-31T14:29:59+00:00"


def test_local_date_range_rejects_non_iso_input():
    assert chatbox_tools._local_date_range_utc("yesterday", "2026-08-25") is None
    assert chatbox_tools._local_date_range_utc("2026-08-25", "") is None


def test_format_local_gives_the_model_a_readable_local_string():
    assert chatbox_tools._format_local("2026-08-24T07:30:00+00:00") == "24 Aug 2026, 05:00 PM"
    assert chatbox_tools._format_local(None) is None


@pytest.mark.asyncio
async def test_progress_note_tool_queries_the_utc_window_for_the_local_day():
    """An 08:00 AM Adelaide shift on the 25th is stored as 22:30 UTC on the
    24th. Asking for the 25th must query a window that includes it."""
    org_id = str(uuid.uuid4())
    md = {"id": str(uuid.uuid4()), "organization_id": org_id, "role": "managing_director"}
    participant = {"id": str(uuid.uuid4()), "full_name": "Amara Participant"}
    captured: dict = {}

    def _fake_query(**kwargs):
        captured.update(kwargs)
        return []

    with patch.object(chatbox_tools, "audit_service") as mock_audit, \
         patch.object(chatbox_tools, "quill_client", return_value=MagicMock()), \
         patch.object(chatbox_tools.participant_service, "get_participants_list_light", AsyncMock(return_value=[participant])), \
         patch.object(chatbox_tools, "_execute_shift_query_with_legacy_fallback", side_effect=_fake_query):
        mock_audit.log_action = AsyncMock()
        tool = next(t for t in chatbox_tools.build_tools_for_user(md, "t") if t.name == "get_shift_progress_note")
        result, _ = await tool.coroutine(participant_name="Amara", shift_date="2026-08-25")

    assert captured["start_date"] == "2026-08-24T14:30:00+00:00"
    assert captured["end_date"] == "2026-08-25T14:29:59+00:00"
    assert "error" in result  # no rows returned -> "no completed shift" error, not a crash


@pytest.mark.asyncio
async def test_progress_note_tool_rejects_a_bad_date_before_querying():
    org_id = str(uuid.uuid4())
    md = {"id": str(uuid.uuid4()), "organization_id": org_id, "role": "managing_director"}
    participant = {"id": str(uuid.uuid4()), "full_name": "Amara Participant"}

    with patch.object(chatbox_tools, "audit_service") as mock_audit, \
         patch.object(chatbox_tools, "quill_client", return_value=MagicMock()), \
         patch.object(chatbox_tools.participant_service, "get_participants_list_light", AsyncMock(return_value=[participant])), \
         patch.object(chatbox_tools, "_execute_shift_query_with_legacy_fallback") as mock_query:
        mock_audit.log_action = AsyncMock()
        tool = next(t for t in chatbox_tools.build_tools_for_user(md, "t") if t.name == "get_shift_progress_note")
        result, _ = await tool.coroutine(participant_name="Amara", shift_date="last tuesday")

    assert "not a valid date" in result["error"]
    mock_query.assert_not_called()


# ── Session dates (get_session_activity / get_rp_flag_count) ──────────


def test_session_local_date_uses_the_app_timezone_calendar_day():
    # 22:30 UTC on the 24th is 08:00 on the 25th in Adelaide
    assert chatbox_tools._session_local_date("2026-08-24T22:30:00+00:00") == "2026-08-25"
    assert chatbox_tools._session_local_date("2026-08-24T07:30:00Z") == "2026-08-24"


def test_session_local_date_falls_back_for_date_only_or_empty_values():
    assert chatbox_tools._session_local_date("2026-08-24") == "2026-08-24"
    assert chatbox_tools._session_local_date(None) == ""


def _md_user() -> dict:
    return {"id": str(uuid.uuid4()), "organization_id": str(uuid.uuid4()), "role": "managing_director"}


@pytest.mark.asyncio
async def test_session_activity_counts_an_early_morning_local_session_as_today():
    """A session logged at 08:00 Adelaide on the 25th is stored as 22:30 UTC
    on the 24th. It must count towards 'today' when today is the 25th."""
    sessions = [
        {"id": "a", "session_date": "2026-08-24T22:30:00+00:00"},   # 25 Aug 08:00 local -> today
        {"id": "b", "session_date": "2026-08-24T07:30:00+00:00"},   # 24 Aug 17:00 local -> this week
        {"id": "c", "session_date": "2026-08-10T07:30:00+00:00"},   # too old
    ]
    with patch.object(chatbox_tools, "audit_service") as mock_audit, \
         patch.object(chatbox_tools, "app_today", return_value=date(2026, 8, 25)), \
         patch.object(chatbox_tools.session_service, "get_sessions_for_dashboard", AsyncMock(return_value=sessions)):
        mock_audit.log_action = AsyncMock()
        tool = next(t for t in chatbox_tools.build_tools_for_user(_md_user(), "t") if t.name == "get_session_activity")
        result, _ = await tool.coroutine()

    assert result["sessions_today"] == 1
    assert result["sessions_this_week"] == 2


@pytest.mark.asyncio
async def test_rp_flag_count_uses_the_local_month_at_the_boundary():
    """An RP flag at 08:00 Adelaide on 1 Sep is stored as 22:30 UTC on 31 Aug.
    It belongs to September, not August."""
    sessions = [
        {"id": "a", "session_date": "2026-08-31T22:30:00+00:00", "restrictive_practice_detected": True},  # 1 Sep local
        {"id": "b", "session_date": "2026-08-20T07:30:00+00:00", "restrictive_practice_detected": True},  # August
        {"id": "c", "session_date": "2026-09-05T07:30:00+00:00", "restrictive_practice_detected": False},
    ]
    with patch.object(chatbox_tools, "audit_service") as mock_audit, \
         patch.object(chatbox_tools, "app_today", return_value=date(2026, 9, 15)), \
         patch.object(chatbox_tools.session_service, "get_sessions_for_dashboard", AsyncMock(return_value=sessions)):
        mock_audit.log_action = AsyncMock()
        tool = next(t for t in chatbox_tools.build_tools_for_user(_md_user(), "t") if t.name == "get_rp_flag_count")
        result, _ = await tool.coroutine()

    assert result["rp_flag_count_this_month"] == 1


# ── Branches: a Melbourne participant seen from the Adelaide office ────


def test_coverage_table_labels_rows_from_another_branch():
    artifact = {
        "timezone": "Australia/Adelaide",
        "on_shift_now": [
            {"worker_name": "A", "participant_name": "P-ADL", "timezone": "Australia/Adelaide",
             "scheduled_start": "2026-08-24T07:30:00+00:00", "scheduled_end": "2026-08-24T13:30:00+00:00"},
            {"worker_name": "B", "participant_name": "P-MEL", "timezone": "Australia/Melbourne",
             "scheduled_start": "2026-08-24T07:30:00+00:00", "scheduled_end": "2026-08-24T13:30:00+00:00"},
        ],
    }
    rows = chatbox_blocks._blocks_for_shift_coverage(artifact)[0]["rows"]
    assert rows[0][3:] == ["05:00 PM", "11:00 PM"]           # same branch: no label
    assert rows[1][3:] == ["05:30 PM AEST", "11:30 PM AEST"]  # other branch: labelled


def test_format_local_can_label_the_zone():
    assert chatbox_tools._format_local("2026-08-24T07:30:00+00:00", MELBOURNE, label_zone=True) == "24 Aug 2026, 05:30 PM AEST"


@pytest.mark.asyncio
async def test_progress_note_lookup_uses_the_participants_branch_day():
    """A Melbourne participant's '25 Aug' is Melbourne midnight-to-midnight
    (14:00 UTC), not Adelaide's (14:30 UTC) — even when asked from Adelaide."""
    org_id = str(uuid.uuid4())
    md = {"id": str(uuid.uuid4()), "organization_id": org_id, "role": "managing_director"}
    participant = {"id": str(uuid.uuid4()), "full_name": "Mel Participant"}
    captured: dict = {}

    def _fake_query(**kwargs):
        captured.update(kwargs)
        return []

    with patch.object(chatbox_tools, "audit_service") as mock_audit, \
         patch.object(chatbox_tools, "quill_client", return_value=MagicMock()), \
         patch.object(chatbox_tools, "participant_timezone", lambda *a, **k: MELBOURNE), \
         patch.object(chatbox_tools.participant_service, "get_participants_list_light", AsyncMock(return_value=[participant])), \
         patch.object(chatbox_tools, "_execute_shift_query_with_legacy_fallback", side_effect=_fake_query):
        mock_audit.log_action = AsyncMock()
        tool = next(t for t in chatbox_tools.build_tools_for_user(md, "t") if t.name == "get_shift_progress_note")
        await tool.coroutine(participant_name="Mel", shift_date="2026-08-25")

    assert captured["start_date"] == "2026-08-24T14:00:00+00:00"
    assert captured["end_date"] == "2026-08-25T13:59:59+00:00"
