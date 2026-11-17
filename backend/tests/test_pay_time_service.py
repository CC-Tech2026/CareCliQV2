"""Paid time is the time worked, kept apart from billed time: never capped at
the roster, split around a sleepover, with breaks passed on as recorded."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from backend.app.services import pay_time_service as pay
from backend.app.services.shift_verification_service import billable_minutes


def _shift(**extra):
    return {
        "id": "s-1",
        "scheduled_start": "2026-11-14T09:00:00+10:30",
        "scheduled_end": "2026-11-14T12:00:00+10:30",
        "clocked_in_at": "2026-11-14T09:00:00+10:30",
        "clocked_out_at": "2026-11-14T12:40:00+10:30",
        **extra,
    }


def test_staying_late_is_paid_even_though_billing_stops_at_the_roster():
    shift = _shift()
    assert billable_minutes(shift)["billable_minutes"] == 180  # billing: capped
    paid = pay.paid_time(shift)
    assert paid["worked_minutes"] == 220 and paid["over_roster_minutes"] == 40
    assert paid["source"] == "clock"
    assert [(p["kind"], p["minutes"]) for p in paid["periods"]] == [("active", 220)]


def test_leaving_early_is_paid_for_the_time_worked():
    paid = pay.paid_time(_shift(clocked_out_at="2026-11-14T11:00:00+10:30"))
    assert paid["worked_minutes"] == 120 and paid["over_roster_minutes"] == 0


def test_without_clock_times_the_roster_is_used_and_said_so():
    paid = pay.paid_time(_shift(clocked_in_at=None, clocked_out_at=None))
    assert paid["source"] == "roster" and paid["worked_minutes"] == 180


def test_no_times_at_all_is_an_error_not_a_guess():
    with pytest.raises(ValueError):
        pay.paid_time({"id": "s-1"})


def test_breaks_inside_the_shift_are_kept_and_outside_ones_dropped():
    breaks = [
        {"break_start_at": "2026-11-14T10:30:00+10:30", "break_end_at": "2026-11-14T11:00:00+10:30"},
        {"break_start_at": "2026-11-14T08:00:00+10:30", "break_end_at": "2026-11-14T08:30:00+10:30"},
    ]
    paid = pay.paid_time(_shift(), breaks)
    assert paid["break_minutes"] == 30 and len(paid["breaks"]) == 1
    # Breaks are recorded, not deducted here: whether they're paid is payroll's setting.
    assert paid["worked_minutes"] == 220


def test_a_sleepover_with_a_call_out_splits_into_periods():
    shift = _shift(
        scheduled_start="2026-11-14T20:00:00+10:30", scheduled_end="2026-11-15T08:00:00+10:30",
        clocked_in_at="2026-11-14T20:00:00+10:30", clocked_out_at="2026-11-15T08:00:00+10:30",
    )
    segments = [
        {"segment_type": "active_work", "segment_start": "2026-11-14T20:00:00+10:30", "segment_end": "2026-11-14T22:00:00+10:30"},
        {"segment_type": "sleepover_block", "segment_start": "2026-11-14T22:00:00+10:30", "segment_end": "2026-11-15T06:00:00+10:30"},
        {"segment_type": "call_out", "segment_start": "2026-11-15T01:00:00+10:30", "segment_end": "2026-11-15T01:45:00+10:30"},
    ]
    paid = pay.paid_time(shift, [], segments)
    assert [(p["kind"], p["minutes"]) for p in paid["periods"]] == [
        ("active", 120), ("sleepover", 180), ("active", 45), ("sleepover", 255), ("active", 120),
    ]


def test_a_shift_no_longer_marked_as_a_sleepover_ignores_old_segments():
    segments = [{"segment_type": "sleepover_block", "segment_start": "2026-11-14T10:00:00+10:30",
                 "segment_end": "2026-11-14T11:00:00+10:30"}]
    paid = pay.paid_time(_shift(is_sleepover=False), [], segments)
    assert [p["kind"] for p in paid["periods"]] == ["active"]


def test_the_snapshot_round_trips():
    paid = pay.paid_time(_shift(), [{"break_start_at": "2026-11-14T10:30:00+10:30", "break_end_at": "2026-11-14T11:00:00+10:30"}])
    record = pay.to_record(paid)
    assert isinstance(record["start"], str) and isinstance(record["periods"][0]["end"], str)
    back = pay.from_record(record)
    assert back["start"] == paid["start"] == datetime(2026, 11, 13, 22, 30, tzinfo=timezone.utc)
    assert back["breaks"][0]["end"] == paid["breaks"][0]["end"]
