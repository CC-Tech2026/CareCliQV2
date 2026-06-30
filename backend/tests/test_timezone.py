"""Timezone parsing for Australian shift scheduling."""

from datetime import timezone

from app.core.timezone import app_today, parse_shift_datetime


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


def test_app_today_uses_sydney():
    assert app_today().tzinfo is None
