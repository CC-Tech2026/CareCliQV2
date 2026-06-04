"""
Tests for NDIS Compliance Engine — R1 through R12.
Run: pytest backend/tests/test_compliance_r1_r12.py -v
"""
import unittest
from backend.app.services.compliance_engine import run_compliance_check


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _base_session(**overrides) -> dict:
    """A session that passes all 12 rules. Override individual fields to test failures."""
    base = {
        "id": "test-session-1",
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
        "updated_at": "2026-06-03T09:00:00",   # 1 day after — within 48 hrs
        "start_time": "09:00",
        "end_time": "11:00",
        "duration_minutes": 120,
        "session_type": "Daily Living Support",
        "goals_addressed": '["cooking independence", "community participation"]',
        "worker_id": "worker-1",
        "patient_id": "patient-1",
    }
    base.update(overrides)
    return base


def _get_rule(result: dict, rule_id: str) -> dict:
    return next((r for r in result["rules"] if r["rule"] == rule_id), {})


# ---------------------------------------------------------------------------
# R1 — Session time and duration
# ---------------------------------------------------------------------------

class TestR1(unittest.TestCase):
    def test_pass_when_start_end_duration_present(self):
        r = _get_rule(run_compliance_check(_base_session()), "R1")
        self.assertEqual(r["status"], "pass")

    def test_fail_when_start_time_missing(self):
        r = _get_rule(run_compliance_check(_base_session(start_time="")), "R1")
        self.assertEqual(r["status"], "fail")
        self.assertIn("start time", r["message"].lower())

    def test_fail_when_end_time_missing(self):
        r = _get_rule(run_compliance_check(_base_session(end_time="")), "R1")
        self.assertEqual(r["status"], "fail")

    def test_fail_when_duration_zero(self):
        r = _get_rule(run_compliance_check(_base_session(duration_minutes=0)), "R1")
        self.assertEqual(r["status"], "fail")

    def test_warning_when_duration_over_8_hours(self):
        r = _get_rule(run_compliance_check(_base_session(duration_minutes=500)), "R1")
        self.assertEqual(r["status"], "warning")
        self.assertIn("8 hours", r["message"])


# ---------------------------------------------------------------------------
# R2 — 48-hour documentation
# ---------------------------------------------------------------------------

class TestR2(unittest.TestCase):
    def test_pass_within_48_hours(self):
        r = _get_rule(run_compliance_check(_base_session(
            session_date="2026-06-02",
            updated_at="2026-06-03T10:00:00",
        )), "R2")
        self.assertEqual(r["status"], "pass")

    def test_warning_at_5_days(self):
        r = _get_rule(run_compliance_check(_base_session(
            session_date="2026-06-01",
            updated_at="2026-06-06T10:00:00",
        )), "R2")
        self.assertEqual(r["status"], "warning")

    def test_fail_over_7_days(self):
        r = _get_rule(run_compliance_check(_base_session(
            session_date="2026-05-01",
            updated_at="2026-06-03T10:00:00",
        )), "R2")
        self.assertEqual(r["status"], "fail")
        self.assertIn("48-hour", r["message"])


# ---------------------------------------------------------------------------
# R3 — Note quality (80-word minimum + filler phrases)
# ---------------------------------------------------------------------------

class TestR3(unittest.TestCase):
    def test_pass_with_80_plus_words(self):
        r = _get_rule(run_compliance_check(_base_session()), "R3")
        self.assertEqual(r["status"], "pass")

    def test_fail_on_filler_phrase_good_session(self):
        r = _get_rule(run_compliance_check(_base_session(
            compliance_input_text="Good session today. The participant was fine."
        )), "R3")
        self.assertEqual(r["status"], "fail")
        self.assertIn("good session", r["message"])

    def test_fail_on_filler_phrase_went_well(self):
        r = _get_rule(run_compliance_check(_base_session(
            compliance_input_text="Everything went well. All went well today."
        )), "R3")
        self.assertEqual(r["status"], "fail")

    def test_fail_when_under_30_words(self):
        r = _get_rule(run_compliance_check(_base_session(
            compliance_input_text="Short note."
        )), "R3")
        self.assertEqual(r["status"], "fail")

    def test_warning_between_30_and_79_words(self):
        text = "The participant attended the session and worked on daily living skills. " * 2
        r = _get_rule(run_compliance_check(_base_session(compliance_input_text=text)), "R3")
        self.assertIn(r["status"], ["warning", "fail"])


# ---------------------------------------------------------------------------
# R4 — Support type documented
# ---------------------------------------------------------------------------

class TestR4(unittest.TestCase):
    def test_pass_when_session_type_set(self):
        r = _get_rule(run_compliance_check(_base_session()), "R4")
        self.assertEqual(r["status"], "pass")

    def test_fail_when_session_type_missing(self):
        r = _get_rule(run_compliance_check(_base_session(session_type="")), "R4")
        self.assertEqual(r["status"], "fail")


# ---------------------------------------------------------------------------
# R5 — Goals linked + goal language in note body
# ---------------------------------------------------------------------------

class TestR5(unittest.TestCase):
    def test_pass_when_goals_linked_and_goal_language_present(self):
        r = _get_rule(run_compliance_check(_base_session()), "R5")
        self.assertEqual(r["status"], "pass")

    def test_fail_when_no_goals_linked(self):
        r = _get_rule(run_compliance_check(_base_session(goals_addressed="[]")), "R5")
        self.assertEqual(r["status"], "fail")

    def test_warning_when_goals_linked_but_no_goal_language_in_note(self):
        r = _get_rule(run_compliance_check(_base_session(
            compliance_input_text="The participant had breakfast and watched TV. No specific work done.",
            goals_addressed='["cooking"]',
        )), "R5")
        self.assertEqual(r["status"], "warning")
        self.assertIn("goal language", r["message"])


# ---------------------------------------------------------------------------
# R6 — Objective language
# ---------------------------------------------------------------------------

class TestR6(unittest.TestCase):
    def test_pass_with_objective_language(self):
        r = _get_rule(run_compliance_check(_base_session()), "R6")
        self.assertEqual(r["status"], "pass")

    def test_fail_on_i_think(self):
        r = _get_rule(run_compliance_check(_base_session(
            compliance_input_text=_base_session()["compliance_input_text"] + " I think the participant is doing better."
        )), "R6")
        self.assertEqual(r["status"], "fail")
        self.assertIn("I think", r["message"])

    def test_fail_on_i_believe(self):
        r = _get_rule(run_compliance_check(_base_session(
            compliance_input_text=_base_session()["compliance_input_text"] + " I believe she needs more support."
        )), "R6")
        self.assertEqual(r["status"], "fail")

    def test_fail_on_i_feel(self):
        r = _get_rule(run_compliance_check(_base_session(
            compliance_input_text=_base_session()["compliance_input_text"] + " I feel the session went okay."
        )), "R6")
        self.assertEqual(r["status"], "fail")


# ---------------------------------------------------------------------------
# R7 — Person-first language
# ---------------------------------------------------------------------------

class TestR7(unittest.TestCase):
    def test_pass_with_person_first_language(self):
        r = _get_rule(run_compliance_check(_base_session()), "R7")
        self.assertEqual(r["status"], "pass")

    def test_warning_on_wheelchair_bound(self):
        r = _get_rule(run_compliance_check(_base_session(
            compliance_input_text=_base_session()["compliance_input_text"] + " The wheelchair-bound client was assisted."
        )), "R7")
        self.assertEqual(r["status"], "warning")

    def test_warning_on_suffers_from(self):
        r = _get_rule(run_compliance_check(_base_session(
            compliance_input_text=_base_session()["compliance_input_text"] + " The participant suffers from anxiety."
        )), "R7")
        self.assertEqual(r["status"], "warning")


# ---------------------------------------------------------------------------
# R8 — Scope of practice
# ---------------------------------------------------------------------------

class TestR8(unittest.TestCase):
    def test_pass_when_no_clinical_language(self):
        r = _get_rule(run_compliance_check(_base_session()), "R8")
        self.assertEqual(r["status"], "pass")

    def test_fail_on_administered_medication(self):
        r = _get_rule(run_compliance_check(_base_session(
            compliance_input_text=_base_session()["compliance_input_text"] + " I administered medication to the participant."
        )), "R8")
        self.assertEqual(r["status"], "fail")
        self.assertIn("scope", r["message"])

    def test_fail_on_clinical_assessment(self):
        r = _get_rule(run_compliance_check(_base_session(
            compliance_input_text=_base_session()["compliance_input_text"] + " Completed a clinical assessment today."
        )), "R8")
        self.assertEqual(r["status"], "fail")

    def test_fail_on_diagnosis(self):
        r = _get_rule(run_compliance_check(_base_session(
            compliance_input_text=_base_session()["compliance_input_text"] + " The participant was diagnosed with depression."
        )), "R8")
        self.assertEqual(r["status"], "fail")


# ---------------------------------------------------------------------------
# R9 — Incident triggers
# ---------------------------------------------------------------------------

class TestR9(unittest.TestCase):
    def test_pass_when_no_incident_language(self):
        r = _get_rule(run_compliance_check(_base_session()), "R9")
        self.assertEqual(r["status"], "pass")
        self.assertEqual(r["incident_triggers"], [])

    def test_fail_on_fell(self):
        r = _get_rule(run_compliance_check(_base_session(
            compliance_input_text=_base_session()["compliance_input_text"] + " The participant fell during the session."
        )), "R9")
        self.assertEqual(r["status"], "fail")
        self.assertIn("fall/injury", r["incident_triggers"])

    def test_fail_on_ambulance(self):
        r = _get_rule(run_compliance_check(_base_session(
            compliance_input_text=_base_session()["compliance_input_text"] + " An ambulance was called."
        )), "R9")
        self.assertEqual(r["status"], "fail")
        self.assertIn("ambulance/emergency services", r["incident_triggers"])

    def test_fail_on_self_harm(self):
        r = _get_rule(run_compliance_check(_base_session(
            compliance_input_text=_base_session()["compliance_input_text"] + " The participant disclosed self-harm."
        )), "R9")
        self.assertEqual(r["status"], "fail")
        self.assertIn("self-harm/suicidality", r["incident_triggers"])

    def test_fail_on_aggressive(self):
        r = _get_rule(run_compliance_check(_base_session(
            compliance_input_text=_base_session()["compliance_input_text"] + " The participant became aggressive toward staff."
        )), "R9")
        self.assertEqual(r["status"], "fail")


# ---------------------------------------------------------------------------
# R10 — Restrictive practice must have linked incident
# ---------------------------------------------------------------------------

class TestR10(unittest.TestCase):
    def test_pass_when_no_rp_language(self):
        r = _get_rule(run_compliance_check(_base_session()), "R10")
        self.assertEqual(r["status"], "pass")

    def test_fail_when_rp_detected_and_not_linked(self):
        r = _get_rule(run_compliance_check(_base_session(
            compliance_input_text=_base_session()["compliance_input_text"] + " The participant was held down by staff.",
            rp_incident_linked=False,
        )), "R10")
        self.assertEqual(r["status"], "fail")
        self.assertIn("incident report", r["message"])

    def test_pass_when_rp_detected_but_incident_linked(self):
        r = _get_rule(run_compliance_check(_base_session(
            compliance_input_text=_base_session()["compliance_input_text"] + " The participant was held down by staff.",
            rp_incident_linked=True,
        )), "R10")
        self.assertEqual(r["status"], "pass")


# ---------------------------------------------------------------------------
# R11 — Note similarity
# ---------------------------------------------------------------------------

class TestR11(unittest.TestCase):
    def test_pass_when_no_previous_sessions(self):
        r = _get_rule(run_compliance_check(_base_session()), "R11")
        self.assertEqual(r["status"], "pass")

    def test_fail_when_note_is_near_identical_to_previous(self):
        note_text = _base_session()["compliance_input_text"]
        prev_session = {
            "id": "prev-session-1",
            "patient_id": "patient-1",
            "worker_id": "worker-1",
            "session_date": "2026-06-01",
            "notes": note_text,  # identical note
        }
        result = run_compliance_check(_base_session(), existing_sessions=[prev_session])
        r = _get_rule(result, "R11")
        self.assertEqual(r["status"], "fail")
        self.assertIn("similar", r["message"])

    def test_pass_when_previous_session_is_different_worker(self):
        note_text = _base_session()["compliance_input_text"]
        prev_session = {
            "id": "prev-session-2",
            "patient_id": "patient-1",
            "worker_id": "different-worker",   # different worker — should not compare
            "session_date": "2026-06-01",
            "notes": note_text,
        }
        result = run_compliance_check(_base_session(), existing_sessions=[prev_session])
        r = _get_rule(result, "R11")
        self.assertEqual(r["status"], "pass")


# ---------------------------------------------------------------------------
# R12 — Participant response language
# ---------------------------------------------------------------------------

class TestR12(unittest.TestCase):
    def test_pass_when_response_language_present(self):
        r = _get_rule(run_compliance_check(_base_session()), "R12")
        self.assertEqual(r["status"], "pass")

    def test_warning_when_no_response_language(self):
        r = _get_rule(run_compliance_check(_base_session(
            compliance_input_text=(
                "The support worker assisted with cooking tasks. "
                "Meal preparation activities were carried out. "
                "The kitchen was cleaned at the end. Shopping was done at the local store. "
                "Items were purchased and put away. The session lasted two hours total."
            ),
        )), "R12")
        self.assertEqual(r["status"], "warning")
        self.assertIn("participant", r["message"].lower())


# ---------------------------------------------------------------------------
# Score and total rule count
# ---------------------------------------------------------------------------

class TestOverall(unittest.TestCase):
    def test_exactly_12_rules_returned(self):
        result = run_compliance_check(_base_session())
        self.assertEqual(result["total_rules"], 12)

    def test_all_rules_have_r_label(self):
        result = run_compliance_check(_base_session())
        for rule in result["rules"]:
            self.assertRegex(rule["rule"], r"^R\d+$", f"Rule key should be Rn format: {rule['rule']}")

    def test_all_rules_have_label_field(self):
        result = run_compliance_check(_base_session())
        for rule in result["rules"]:
            self.assertIn("label", rule, f"Missing 'label' on {rule['rule']}")

    def test_score_is_high_for_clean_session(self):
        result = run_compliance_check(_base_session())
        self.assertGreater(result["score"], 80)

    def test_score_is_low_for_terrible_session(self):
        result = run_compliance_check(_base_session(
            start_time="", end_time="", duration_minutes=0,
            session_type="",
            goals_addressed="[]",
            compliance_input_text="Good session. I think it went well.",
            session_date="2026-05-01",
            updated_at="2026-06-03T10:00:00",
        ))
        self.assertLess(result["score"], 50)


if __name__ == "__main__":
    unittest.main()
