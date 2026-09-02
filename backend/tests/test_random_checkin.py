"""Random compliance check-in scheduling tests."""
import unittest
from datetime import datetime, timedelta, timezone

from backend.app.services.random_checkin_service import (
    RANDOM_CHECKIN_ABS_MIN_GAP_SECS,
    RANDOM_CHECKIN_MIN_GAP_SECS,
    RANDOM_CHECKIN_MIN_SHIFT_SECS,
    RANDOM_CHECKIN_RESPONSE_SECS,
    evaluate_random_checkin_window,
    generate_random_checkin_times,
    uses_random_checkins,
)


class TestUsesRandomCheckins(unittest.TestCase):
    def test_only_4_plus_hours(self):
        self.assertFalse(uses_random_checkins(3 * 3600))
        self.assertTrue(uses_random_checkins(RANDOM_CHECKIN_MIN_SHIFT_SECS))
        self.assertTrue(uses_random_checkins(5 * 3600))
        self.assertTrue(uses_random_checkins(8 * 3600))


class TestGenerateRandomCheckinTimes(unittest.TestCase):
    def test_generates_two_or_three_spaced_times(self):
        clock_in = datetime(2026, 7, 1, 8, 0, tzinfo=timezone.utc)
        shift_end = clock_in + timedelta(hours=8)
        times = generate_random_checkin_times(
            clock_in,
            shift_end,
            3,
            rng=__import__("random").Random(42),
        )
        self.assertEqual(len(times), 3)
        for i in range(len(times) - 1):
            gap = (times[i + 1] - times[i]).total_seconds()
            self.assertGreaterEqual(gap, RANDOM_CHECKIN_MIN_GAP_SECS)

    def test_times_within_shift_window(self):
        clock_in = datetime(2026, 7, 1, 8, 0, tzinfo=timezone.utc)
        shift_end = clock_in + timedelta(hours=7)
        times = generate_random_checkin_times(clock_in, shift_end, 2, rng=__import__("random").Random(7))
        self.assertEqual(len(times), 2)
        self.assertGreater(times[0], clock_in)
        self.assertLess(times[-1], shift_end)

    def test_never_below_absolute_min_gap_on_tight_window(self):
        # A short 4h shift leaves a small usable window once start/end buffers are
        # applied - even asking for 2 check-ins must never pack them < 15 min apart.
        clock_in = datetime(2026, 7, 1, 8, 0, tzinfo=timezone.utc)
        shift_end = clock_in + timedelta(hours=4)
        times = generate_random_checkin_times(clock_in, shift_end, 2, rng=__import__("random").Random(3))
        for i in range(len(times) - 1):
            gap = (times[i + 1] - times[i]).total_seconds()
            self.assertGreaterEqual(gap, RANDOM_CHECKIN_ABS_MIN_GAP_SECS)


class TestEvaluateRandomCheckinWindow(unittest.TestCase):
    def _now(self) -> datetime:
        return datetime(2026, 7, 1, 14, 0, tzinfo=timezone.utc)

    def test_prompted_window_allows_submit(self):
        now = self._now()
        prompted_at = now - timedelta(minutes=2)
        deadline = prompted_at + timedelta(seconds=RANDOM_CHECKIN_RESPONSE_SECS)
        scheduled = [{
            "status": "prompted",
            "prompted_at": prompted_at.isoformat(),
            "response_deadline_at": deadline.isoformat(),
            "scheduled_at": (prompted_at - timedelta(minutes=1)).isoformat(),
        }]
        result = evaluate_random_checkin_window(
            now=now,
            scheduled_checkins=scheduled,
            on_break=False,
            last_checkin_at=None,
            duration_secs=7 * 3600,
            checkin_count=0,
        )
        self.assertTrue(result["can_submit_checkin"])
        self.assertTrue(result["checkin_overdue"])

    def test_blocked_before_scheduled_time(self):
        now = self._now()
        scheduled = [{
            "status": "pending",
            "scheduled_at": (now + timedelta(hours=1)).isoformat(),
        }]
        result = evaluate_random_checkin_window(
            now=now,
            scheduled_checkins=scheduled,
            on_break=False,
            last_checkin_at=None,
            duration_secs=7 * 3600,
            checkin_count=0,
        )
        self.assertFalse(result["can_submit_checkin"])
        self.assertEqual(result["block_reason"], "not_due_yet")
        self.assertGreater(result["next_checkin_due_secs"], 0)

    def test_not_applicable_under_4_hours(self):
        now = self._now()
        result = evaluate_random_checkin_window(
            now=now,
            scheduled_checkins=[],
            on_break=False,
            last_checkin_at=None,
            duration_secs=3 * 3600,
            checkin_count=0,
        )
        self.assertFalse(result["applicable"])


if __name__ == "__main__":
    unittest.main()
