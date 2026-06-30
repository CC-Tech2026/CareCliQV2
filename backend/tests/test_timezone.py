"""Timezone parsing for Australian shift scheduling."""

from datetime import date, timezone

from backend.app.core.timezone import app_day_bounds_utc, app_today, parse_shift_datetime, shift_local_date


def test_naive_local_time_converts_to_utc():
    # 9:00 AM Adelaide (ACST, UTC+9:30) on 2026-06-30
    utc = parse_shift_datetime("2026-06-30T09:00:00")
    assert utc.hour == 23
    assert utc.minute == 30
    assert utc.day == 29
    assert utc.month == 6
    assert utc.tzinfo == timezone.utc


def test_aware_utc_passthrough():
    utc = parse_shift_datetime("2026-06-30T09:00:00+00:00")
    assert utc.hour == 9
    assert utc.tzinfo == timezone.utc


def test_app_today_returns_app_timezone_date():
    assert isinstance(app_today(), date)


def test_shift_local_date_uses_adelaide_calendar_day():
    # 19:30 UTC on 2026-06-30 is 05:00 on 2026-07-01 in Adelaide
    assert shift_local_date("2026-06-30T19:30:00+00:00") == date(2026, 7, 1)
    # 10:00 UTC on 2026-06-30 is 19:30 on 2026-06-30 in Adelaide
    assert shift_local_date("2026-06-30T10:00:00+00:00") == date(2026, 6, 30)


def test_app_day_bounds_utc_for_adelaide_day():
    start, end = app_day_bounds_utc(date(2026, 6, 30))
    assert start == "2026-06-29T14:30:00+00:00"
    assert end == "2026-06-30T14:30:00+00:00"
