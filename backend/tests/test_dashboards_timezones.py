"""
Dashboard date helpers use the app's Australian calendar day, not UTC.

session_date / incident_date are timestamptz returned as UTC. _date_part
used to slice the first ten characters (the UTC day) and _today_iso used
the server machine's date, so "sessions today" / "incidents this month"
miscounted anything logged before ~9:30 AM Adelaide. Same root cause as
the Quill fixes in test_chatbox_timezones.py.
"""
from __future__ import annotations

from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest

from backend.app.api import dashboards
from backend.app.core import timezone as app_tz

ADELAIDE = ZoneInfo("Australia/Adelaide")  # UTC+9:30 in August (no DST)


@pytest.fixture(autouse=True)
def _fixed_timezone():
    with patch.object(app_tz, "APP_TIMEZONE", ADELAIDE):
        yield


def test_date_part_uses_the_local_calendar_day():
    # 22:30 UTC on the 24th is 08:00 on the 25th in Adelaide
    assert dashboards._date_part("2026-08-24T22:30:00+00:00") == "2026-08-25"
    assert dashboards._date_part("2026-08-24T07:30:00Z") == "2026-08-24"


def test_date_part_passes_date_only_and_empty_values_through():
    assert dashboards._date_part("2026-08-24") == "2026-08-24"
    assert dashboards._date_part(None) == ""
    assert dashboards._date_part("not a date") == "not a date"[:10]


def test_today_iso_is_the_app_timezone_date_not_the_machine_date():
    # 20:00 UTC on 24 Aug is already 05:30 on 25 Aug in Adelaide
    fixed_now = datetime(2026, 8, 24, 20, 0, tzinfo=app_tz.timezone.utc)

    class _FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed_now.astimezone(tz) if tz else fixed_now

    with patch.object(app_tz, "datetime", _FrozenDatetime):
        assert dashboards._today_iso() == "2026-08-25"
