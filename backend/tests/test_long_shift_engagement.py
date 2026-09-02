"""
Check 16 — Long shift engagement tests.
Run: pytest backend/tests/test_long_shift_engagement.py -v
"""
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from backend.app.services.long_shift_service import (
    ACTIVITY_GAP_FAIL_SECS,
    CHECKIN_COOLDOWN_SECS,
    CHECKIN_EARLY_WINDOW_SECS,
    CHECKIN_GAP_SECS,
    LONG_SHIFT_THRESHOLD_SECS,
    MAX_BREAKS_PER_SESSION,
    _compute_current_gap,
    _evaluate_checkin_window,
    _required_checkins,
    evaluate_check16,
    _derive_live_status,
)


def _long_session(**overrides) -> dict:
    base = {
        "id": "sess-1",
        "shift_id": "shift-1",
        "is_long_shift": True,
        "max_gap_secs": 3000,
        "checkin_count": 3,
        "break_duration_secs": 900,
        "last_activity_at": datetime.now(timezone.utc).isoformat(),
    }
    base.update(overrides)
    return base


def _long_shift(hours: float = 5.0) -> dict:
    now = datetime.now(timezone.utc)
    return {
        "id": "shift-1",
        "clocked_in_at": (now - timedelta(hours=hours)).isoformat(),
        "clocked_out_at": None,
        "participant_id": "patient-1",
        "organization_id": "org-1",
    }


class TestDeriveLiveStatus(unittest.TestCase):
    def test_green_under_90_min(self):
        self.assertEqual(_derive_live_status(CHECKIN_GAP_SECS - 1), "GREEN")

    def test_amber_at_90_min(self):
        self.assertEqual(_derive_live_status(CHECKIN_GAP_SECS), "AMBER")

    def test_red_at_120_min(self):
        self.assertEqual(_derive_live_status(ACTIVITY_GAP_FAIL_SECS), "RED")


class TestEvaluateCheck16(unittest.TestCase):
    def test_not_applicable_short_shift(self):
        session = {"id": "s1", "duration_minutes": 120, "is_long_shift": False}
        shift = _long_shift(hours=2)
        result = evaluate_check16(session, shift)
        self.assertEqual(result["status"], "pass")
        self.assertFalse(result["details"].get("applicable", True))

    @patch("backend.app.services.long_shift_service.get_supabase_admin")
    def test_pass_all_subchecks(self, mock_admin):
        mock_admin.return_value.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[]
        )
        session = _long_session(max_gap_secs=1800, checkin_count=4)
        shift = _long_shift(hours=5)
        result = evaluate_check16(session, shift)
        self.assertEqual(result["rule"], "R16")
        self.assertTrue(result["details"]["16a"])
        self.assertTrue(result["details"]["16b"])

    @patch("backend.app.services.long_shift_service.get_supabase_admin")
    def test_fail_16a_large_gap(self, mock_admin):
        mock_admin.return_value.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[]
        )
        session = _long_session(max_gap_secs=ACTIVITY_GAP_FAIL_SECS + 60, checkin_count=4)
        shift = _long_shift(hours=5)
        result = evaluate_check16(session, shift)
        self.assertFalse(result["details"]["16a"])
        self.assertEqual(result["status"], "warning")

    @patch("backend.app.services.long_shift_service.get_supabase_admin")
    def test_fail_16c_no_break_on_6h_shift(self, mock_admin):
        mock_admin.return_value.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[{"is_compliant": False}]
        )
        session = _long_session(checkin_count=5)
        shift = _long_shift(hours=6.5)
        result = evaluate_check16(session, shift)
        self.assertFalse(result["details"]["16c"])


class TestLongShiftThreshold(unittest.TestCase):
    def test_threshold_is_4_hours(self):
        self.assertEqual(LONG_SHIFT_THRESHOLD_SECS, 4 * 3600)


class TestBreakPolicy(unittest.TestCase):
    def test_v1_one_break_per_session(self):
        self.assertEqual(MAX_BREAKS_PER_SESSION, 1)


class TestCheckinWindow(unittest.TestCase):
    def _now(self) -> datetime:
        return datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc)

    def test_not_applicable_before_4_hours(self):
        now = self._now()
        result = _evaluate_checkin_window(
            now=now,
            last_activity_at=now - timedelta(hours=3),
            last_checkin_at=None,
            clocked_in_at=now - timedelta(hours=3),
            on_break=False,
            duration_secs=3 * 3600,
            checkin_count=0,
            shift_hours=3.0,
        )
        self.assertFalse(result["applicable"])
        self.assertFalse(result["can_submit_checkin"])

    def test_routine_allowed_when_due_and_cooldown_clear(self):
        now = self._now()
        result = _evaluate_checkin_window(
            now=now,
            last_activity_at=now - timedelta(minutes=80),
            last_checkin_at=now - timedelta(minutes=45),
            clocked_in_at=now - timedelta(hours=5),
            on_break=False,
            duration_secs=5 * 3600,
            checkin_count=2,
            shift_hours=5.0,
        )
        self.assertTrue(result["can_submit_checkin"])
        self.assertIsNone(result["block_reason"])

    def test_blocked_when_not_due_yet(self):
        now = self._now()
        result = _evaluate_checkin_window(
            now=now,
            last_activity_at=now - timedelta(minutes=30),
            last_checkin_at=None,
            clocked_in_at=now - timedelta(hours=5),
            on_break=False,
            duration_secs=5 * 3600,
            checkin_count=1,
            shift_hours=5.0,
        )
        self.assertFalse(result["can_submit_checkin"])
        self.assertEqual(result["block_reason"], "not_due_yet")
        self.assertGreater(result["next_checkin_due_secs"], CHECKIN_EARLY_WINDOW_SECS)

    def test_blocked_during_cooldown(self):
        now = self._now()
        result = _evaluate_checkin_window(
            now=now,
            last_activity_at=now - timedelta(minutes=95),
            last_checkin_at=now - timedelta(minutes=10),
            clocked_in_at=now - timedelta(hours=5),
            on_break=False,
            duration_secs=5 * 3600,
            checkin_count=2,
            shift_hours=5.0,
        )
        self.assertFalse(result["can_submit_checkin"])
        self.assertEqual(result["block_reason"], "cooldown")
        self.assertGreater(result["cooldown_remaining_secs"], 0)

    def test_blocked_on_break(self):
        now = self._now()
        result = _evaluate_checkin_window(
            now=now,
            last_activity_at=now - timedelta(minutes=95),
            last_checkin_at=now - timedelta(minutes=45),
            clocked_in_at=now - timedelta(hours=5),
            on_break=True,
            duration_secs=5 * 3600,
            checkin_count=2,
            shift_hours=5.0,
        )
        self.assertEqual(result["block_reason"], "on_break")

    def test_overdue_when_gap_exceeds_90_minutes(self):
        now = self._now()
        result = _evaluate_checkin_window(
            now=now,
            last_activity_at=now - timedelta(minutes=100),
            last_checkin_at=now - timedelta(minutes=45),
            clocked_in_at=now - timedelta(hours=5),
            on_break=False,
            duration_secs=5 * 3600,
            checkin_count=2,
            shift_hours=5.0,
        )
        self.assertTrue(result["checkin_overdue"])
        self.assertEqual(result["next_checkin_due_secs"], 0)


class TestRequiredCheckins(unittest.TestCase):
    def test_5_hour_shift_uses_random_short_band_when_session_unknown(self):
        # 4-6h shifts now use the same random scheduling as 6h+, just with a
        # smaller count (1-2) - this is the display estimate before the
        # actual per-shift schedule exists.
        self.assertEqual(_required_checkins(5.0, 5 * 3600), 1)

    def test_6_hour_shift_uses_random_when_session_unknown(self):
        self.assertEqual(_required_checkins(6.0, 6 * 3600), 2)

    def test_6_hour_shift_with_scheduled_rows(self):
        with patch("backend.app.services.random_checkin_service._list_scheduled_checkins") as mock_sched:
            mock_sched.return_value = [{"status": "pending"}, {"status": "pending"}, {"status": "pending"}]
            self.assertEqual(_required_checkins(6.0, 6 * 3600, "sess-1"), 3)

    def test_gap_frozen_during_break(self):
        now = datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc)
        break_start = now - timedelta(minutes=20)
        last_activity = now - timedelta(hours=2)
        gap = _compute_current_gap(
            now=now,
            last_activity_at=last_activity,
            clocked_in_at=now - timedelta(hours=5),
            on_break=True,
            break_started_at=break_start,
        )
        self.assertEqual(gap, int((break_start - last_activity).total_seconds()))


if __name__ == "__main__":
    unittest.main()
