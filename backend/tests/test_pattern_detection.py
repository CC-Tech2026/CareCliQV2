"""
CARECLIQV2-34 — Cross-session pattern detection.
Run: python3 -m unittest backend.tests.test_pattern_detection -v
"""
import unittest
from datetime import datetime, timedelta, timezone

from backend.app.services.pattern_detection_service import (
    detect_incident_escalation,
    detect_low_compliance_pairs,
    detect_refused_activity_without_deescalation,
)


def _session(
    worker: str,
    participant: str,
    score: float | None,
    *,
    sid: str = "s1",
    note: str = "",
    days_ago: int = 0,
) -> dict:
    dt = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return {
        "id": sid,
        "worker_id": worker,
        "participant_id": participant,
        "compliance_score": score,
        "session_date": dt.isoformat(),
        "compliance_input_text": note,
        "notes": note,
    }


class TestLowCompliancePairs(unittest.TestCase):
    def test_no_pattern_below_min_sessions(self):
        sessions = [_session("w1", "p1", 50.0, sid=f"s{i}") for i in range(3)]
        self.assertEqual(detect_low_compliance_pairs(sessions, {}, {}), [])

    def test_pattern_when_avg_below_70(self):
        sessions = [_session("w1", "p1", 60.0, sid=f"s{i}") for i in range(4)]
        rules = detect_low_compliance_pairs(
            sessions,
            {"w1": "Worker A"},
            {"p1": "Participant X"},
        )
        self.assertEqual(len(rules), 1)
        self.assertEqual(rules[0]["pattern_type"], "low_compliance_pair")

    def test_no_pattern_when_avg_at_70(self):
        sessions = [_session("w1", "p1", 70.0, sid=f"s{i}") for i in range(4)]
        self.assertEqual(detect_low_compliance_pairs(sessions, {}, {}), [])


class TestIncidentEscalation(unittest.TestCase):
    def test_escalation_when_recent_spike(self):
        now = datetime(2026, 6, 15, tzinfo=timezone.utc)
        incidents = []
        for i in range(3):
            incidents.append({
                "participant_id": "p1",
                "incident_date": (now - timedelta(days=5 + i)).isoformat(),
            })
        rules = detect_incident_escalation(
            incidents,
            {"p1": "Participant Y"},
            now=now,
        )
        self.assertEqual(len(rules), 1)
        self.assertEqual(rules[0]["pattern_type"], "incident_escalation")

    def test_no_escalation_when_prior_period_high(self):
        now = datetime(2026, 6, 15, tzinfo=timezone.utc)
        incidents = []
        for i in range(3):
            incidents.append({
                "participant_id": "p1",
                "incident_date": (now - timedelta(days=5 + i)).isoformat(),
            })
        for i in range(2):
            incidents.append({
                "participant_id": "p1",
                "incident_date": (now - timedelta(days=35 + i)).isoformat(),
            })
        self.assertEqual(
            detect_incident_escalation(incidents, {"p1": "Participant Y"}, now=now),
            [],
        )


class TestRefusedActivity(unittest.TestCase):
    def test_pattern_without_deescalation(self):
        note = "Participant refused activity and would not engage with the task."
        sessions = [
            _session("w1", "p1", 80.0, sid="s1", note=note, days_ago=1),
            _session("w1", "p1", 75.0, sid="s2", note=note, days_ago=3),
        ]
        rules = detect_refused_activity_without_deescalation(
            sessions,
            {"p1": "Participant Z"},
        )
        self.assertEqual(len(rules), 1)
        self.assertEqual(rules[0]["pattern_type"], "refused_activity_no_deescalation")

    def test_no_pattern_when_deescalation_documented(self):
        note = (
            "Participant refused activity. Staff used de-escalation and offered a sensory break."
        )
        sessions = [
            _session("w1", "p1", 80.0, sid="s1", note=note, days_ago=1),
            _session("w1", "p1", 75.0, sid="s2", note=note, days_ago=3),
        ]
        self.assertEqual(detect_refused_activity_without_deescalation(sessions, {}), [])
