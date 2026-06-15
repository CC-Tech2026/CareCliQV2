"""
CARECLIQV2-36 — NDIS plan budget alignment compliance rules.
Run: pytest backend/tests/test_budget_alignment.py -v
"""
import unittest

from backend.app.services.compliance_engine import (
    check_budget_alignment,
    collect_budget_rule_alerts_from_sessions,
    run_compliance_check,
)
from backend.app.services.funding_service import build_budget_alignment_context


def _base_session(**overrides) -> dict:
    base = {
        "id": "sess-budget-1",
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


class TestBuildBudgetAlignmentContext(unittest.TestCase):
    def test_returns_none_without_plan(self):
        self.assertIsNone(build_budget_alignment_context(_base_session(), None))

    def test_builds_category_context(self):
        plan = {
            "id": "plan-1",
            "plan_budgets": [
                {"category": "core", "allocated_amount": 10000, "used_amount": 5000},
            ],
        }
        ctx = build_budget_alignment_context(_base_session(duration_minutes=60), plan)
        self.assertIsNotNone(ctx)
        self.assertTrue(ctx["has_plan"])
        self.assertTrue(ctx["has_category_budget"])
        self.assertEqual(ctx["category"], "core")
        self.assertEqual(ctx["remaining"], 5000.0)
        self.assertGreater(ctx["session_cost"], 0)


class TestCheckBudgetAlignment(unittest.TestCase):
    def test_skipped_when_no_plan(self):
        self.assertEqual(check_budget_alignment(None), [])

    def test_budget_exceeded_when_cost_above_remaining(self):
        ctx = {
            "has_plan": True,
            "has_category_budget": True,
            "category": "core",
            "category_label": "Core Supports",
            "allocated": 1000,
            "remaining": 50,
            "session_cost": 135.12,
            "percent_remaining": 5.0,
        }
        rules = check_budget_alignment(ctx)
        self.assertEqual(len(rules), 1)
        self.assertEqual(rules[0]["rule"], "budget_exceeded")
        self.assertEqual(rules[0]["status"], "fail")

    def test_budget_warning_when_within_ten_percent(self):
        ctx = {
            "has_plan": True,
            "has_category_budget": True,
            "category": "core",
            "category_label": "Core Supports",
            "allocated": 1000,
            "remaining": 80,
            "session_cost": 20,
            "percent_remaining": 8.0,
        }
        rules = check_budget_alignment(ctx)
        self.assertEqual(len(rules), 1)
        self.assertEqual(rules[0]["rule"], "budget_warning")
        self.assertEqual(rules[0]["status"], "warning")

    def test_no_rules_when_healthy_budget(self):
        ctx = {
            "has_plan": True,
            "has_category_budget": True,
            "category": "core",
            "category_label": "Core Supports",
            "allocated": 10000,
            "remaining": 5000,
            "session_cost": 67.56,
            "percent_remaining": 50.0,
        }
        self.assertEqual(check_budget_alignment(ctx), [])


class TestRunComplianceCheckBudgetIntegration(unittest.TestCase):
    def test_budget_rules_in_rules_result(self):
        ctx = {
            "has_plan": True,
            "has_category_budget": True,
            "category": "core",
            "category_label": "Core Supports",
            "allocated": 100,
            "remaining": 10,
            "session_cost": 135.12,
            "percent_remaining": 10.0,
        }
        result = run_compliance_check(_base_session(), budget_context=ctx)
        codes = [r["rule"] for r in result["rules"]]
        self.assertIn("budget_exceeded", codes)
        self.assertTrue(any(r["status"] == "fail" for r in result["rules"] if r["rule"] == "budget_exceeded"))

    def test_no_budget_rules_without_plan(self):
        result = run_compliance_check(_base_session(), budget_context=None)
        codes = [r["rule"] for r in result["rules"]]
        self.assertNotIn("budget_exceeded", codes)
        self.assertNotIn("budget_warning", codes)


class TestCollectBudgetRuleAlerts(unittest.TestCase):
    def test_extracts_from_ai_insights(self):
        sessions = [{
            "id": "s1",
            "participant_id": "p1",
            "participant_name": "Alex",
            "session_date": "2026-06-01",
            "ai_insights": {
                "rules_result": {
                    "rules": [
                        {"rule": "budget_warning", "status": "warning", "message": "Low budget"},
                    ],
                },
            },
        }]
        alerts = collect_budget_rule_alerts_from_sessions(sessions)
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]["rule"], "budget_warning")


if __name__ == "__main__":
    unittest.main()
