"""
CARECLIQV2-35 — Session vs shift duration consistency compliance rules.
Run: pytest backend/tests/test_duration_consistency.py -v
"""
import unittest

from backend.app.services.compliance_engine import (
    check_duration_consistency,
    run_compliance_check,
)
from backend.app.services.shift_service import build_duration_consistency_context


def _base_session(**overrides) -> dict:
    base = {
        "id": "sess-duration-1",
        "shift_id": "shift-1",
        "translation_status": "not_required",
        "compliance_input_text": (
            "The participant engaged positively throughout the session. "
            "He reported feeling confident and demonstrated improved independence with meal preparation. "
            "We worked toward his NDIS goal of developing cooking skills and community participation. "
            "The participant expressed enthusiasm and communicated clearly throughout the two-hour session. "
            "Progress toward stated goals was observed, with noticeable improvement in task completion. "
            "Activities included structured cooking tasks and grocery shopping at the local supermarket. "
            "He declined assistance with washing up, choosing to do it independently and competently. "
            "The session focused on skill development and independence as outlined in his current NDIS plan."
        ),
        "session_date": "2026-06-02",
        "updated_at": "2026-06-03T09:00:00",
        "start_time": "09:00",
        "end_time": "11:00",
        "duration_minutes": 120,
        "session_type": "Daily Living Support",
        "goals_addressed": '["cooking independence"]',
    }
    base.update(overrides)
    return base


class TestCheckDurationConsistency(unittest.TestCase):
    def test_skipped_without_context(self):
        self.assertEqual(check_duration_consistency(None), [])

    def test_skipped_within_threshold(self):
        ctx = {
            "session_duration_minutes": 120,
            "shift_duration_minutes": 140,
            "deviation_minutes": 20,
        }
        self.assertEqual(check_duration_consistency(ctx), [])

    def test_warning_between_31_and_60_minutes(self):
        ctx = {
            "session_duration_minutes": 120,
            "shift_duration_minutes": 155,
            "deviation_minutes": 35,
        }
        rules = check_duration_consistency(ctx)
        self.assertEqual(len(rules), 1)
        self.assertEqual(rules[0]["rule"], "duration_consistency_warning")
        self.assertEqual(rules[0]["status"], "warning")

    def test_error_above_60_minutes(self):
        ctx = {
            "session_duration_minutes": 120,
            "shift_duration_minutes": 190,
            "deviation_minutes": 70,
        }
        rules = check_duration_consistency(ctx)
        self.assertEqual(len(rules), 1)
        self.assertEqual(rules[0]["rule"], "duration_consistency_error")
        self.assertEqual(rules[0]["status"], "fail")

    def test_skipped_when_shift_duration_zero(self):
        ctx = {
            "session_duration_minutes": 120,
            "shift_duration_minutes": 0,
            "deviation_minutes": 120,
        }
        self.assertEqual(check_duration_consistency(ctx), [])


class TestRunComplianceWithDuration(unittest.TestCase):
    def test_no_duration_rules_without_shift_id(self):
        session = _base_session(shift_id=None)
        result = run_compliance_check(session, duration_context=None)
        codes = [r["rule"] for r in result["rules"]]
        self.assertNotIn("duration_consistency_warning", codes)
        self.assertNotIn("duration_consistency_error", codes)

    def test_error_applies_score_penalty(self):
        session = _base_session(duration_minutes=200)
        duration_ctx = {
            "session_duration_minutes": 200,
            "shift_duration_minutes": 135,
            "deviation_minutes": 65,
        }
        without = run_compliance_check(
            _base_session(duration_minutes=120, shift_id=None),
            duration_context=None,
        )
        with_error = run_compliance_check(session, duration_context=duration_ctx)
        error_rules = [r for r in with_error["rules"] if r["rule"] == "duration_consistency_error"]
        self.assertEqual(len(error_rules), 1)
        self.assertLess(with_error["score"], without["score"])


class TestBuildDurationContext(unittest.TestCase):
    def test_returns_none_without_shift_id(self):
        self.assertIsNone(build_duration_consistency_context({"id": "s1", "duration_minutes": 60}))
