"""
Realistic compliance scenario tests — simulates actual notes a support worker would submit.

Each scenario describes a real-world situation and verifies the engine's response.
Run: python3.12 -m unittest backend.tests.test_compliance_scenarios -v

Output shows: score, compliance status, which rules blocked, and which rules warned.
"""
import unittest
from backend.app.services.compliance_engine import run_compliance_check


# ---------------------------------------------------------------------------
# A realistic base session — passes all 12 rules when using a good note
# ---------------------------------------------------------------------------

_GOOD_NOTE = (
    "Participant engaged positively throughout the two-hour session focused on community "
    "access and independent living skills. Support was provided to assist with grocery "
    "shopping at Coles Bondi Junction. Participant demonstrated strong decision-making, "
    "selecting items independently and managing the self-checkout with minimal prompting. "
    "Progress was observed toward Goal 2: Independent Community Participation as outlined "
    "in the current NDIS plan. Participant reported feeling confident and expressed "
    "satisfaction with the support provided. Communication was clear throughout, with "
    "the participant engaging in conversation with shop staff independently. "
    "Worker provided close prompting during the transit journey and assisted with Opal "
    "card use. No incidents occurred. Participant declined assistance with carrying bags, "
    "preferring to manage independently — consistent with their goal of building "
    "independence in daily living tasks."
)

def _session(**overrides) -> dict:
    base = {
        "id": "test-session",
        "translation_status": "not_required",
        "compliance_input_text": _GOOD_NOTE,
        "session_date": "2026-06-04",
        "updated_at": "2026-06-04T18:00:00",
        "start_time": "10:00",
        "end_time": "12:00",
        "duration_minutes": 120,
        "session_type": "Community Access",
        "goals_addressed": '["community participation", "independent living"]',
        "worker_id": "worker-1",
        "patient_id": "patient-1",
    }
    base.update(overrides)
    return base


def _effective_tier(rule: dict) -> str:
    """Mirror sessions API: enforcement_tier takes precedence over is_blocking."""
    tier = rule.get("enforcement_tier")
    if tier in ("block", "warn", "info"):
        return tier
    return "block" if rule.get("is_blocking") else "info"


def _failed_rules_by_tier(result: dict, tier: str) -> list[str]:
    return [
        r["rule"]
        for r in result["rules"]
        if r["status"] == "fail" and _effective_tier(r) == tier
    ]


def _block_tier_rules(result: dict) -> list[str]:
    """Rules that hard-block save/approve (enforcement_tier=block)."""
    return _failed_rules_by_tier(result, "block")


def _warn_tier_rules(result: dict) -> list[str]:
    """Rules that require worker acknowledgement before save (enforcement_tier=warn)."""
    return _failed_rules_by_tier(result, "warn")


def _report(result: dict) -> str:
    """Format a compact compliance result for test failure messages."""
    block_fails = [r for r in result["rules"] if r["status"] == "fail" and _effective_tier(r) == "block"]
    warn_fails = [r for r in result["rules"] if r["status"] == "fail" and _effective_tier(r) == "warn"]
    info_fails = [r for r in result["rules"] if r["status"] == "fail" and _effective_tier(r) == "info"]
    warnings = [r for r in result["rules"] if r["status"] == "warning"]
    lines = [
        f"Score: {result['score']} | passed={result['passed']} warn={result['warnings']} fail={result['failed']}",
        *[f"  BLOCK    [{r['rule']}] {r['message']}" for r in block_fails],
        *[f"  WARN     [{r['rule']}] {r['message']}" for r in warn_fails],
        *[f"  INFO     [{r['rule']}] {r['message']}" for r in info_fails],
        *[f"  WARNING  [{r['rule']}] {r['message']}" for r in warnings],
    ]
    return "\n".join(lines)


def _blocking_rules(result: dict) -> list[str]:
    """Alias kept for readability — means block-tier failures only."""
    return _block_tier_rules(result)


def _rule(result: dict, rule_id: str) -> dict:
    return next((r for r in result["rules"] if r["rule"] == rule_id), {})


# ===========================================================================
# SCENARIO 1 — Ideal note, everything correct
# ===========================================================================

class TestScenario01_PerfectNote(unittest.TestCase):
    """
    Worker writes a detailed, specific note in English.
    Goals linked, times recorded, objective language, 130+ words.
    Expected: compliant, no blocks, score > 85.
    """

    def setUp(self):
        self.result = run_compliance_check(_session())

    def test_no_blocking_failures(self):
        self.assertEqual(
            _blocking_rules(self.result), [],
            f"Expected no blocks:\n{_report(self.result)}"
        )

    def test_score_is_compliant(self):
        self.assertGreaterEqual(
            self.result["score"], 85,
            f"Expected compliant score (≥85):\n{_report(self.result)}"
        )

    def test_all_key_rules_pass(self):
        for rule_id in ("R1", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10"):
            r = _rule(self.result, rule_id)
            self.assertEqual(r["status"], "pass",
                f"{rule_id} should pass on a perfect note — got: {r.get('message')}")


# ===========================================================================
# SCENARIO 2 — Support worker documents a clinical assessment (R8 blocks)
# ===========================================================================

class TestScenario02_ScopeOfPractice(unittest.TestCase):
    """
    Worker accidentally writes clinical language in the note.
    Real example: "I completed a clinical assessment and the participant
    was diagnosed with anxiety. I administered PRN medication."
    Expected: R8 blocks, note cannot be approved.
    """

    _CLINICAL_NOTE = _GOOD_NOTE + (
        " At the end of the session I completed a clinical assessment and noted that "
        "the participant appears to have worsened anxiety. I administered PRN medication "
        "as the participant was distressed."
    )

    def setUp(self):
        self.result = run_compliance_check(_session(compliance_input_text=self._CLINICAL_NOTE))

    def test_r8_blocks(self):
        self.assertIn("R8", _blocking_rules(self.result),
            f"R8 should block on clinical/medication language:\n{_report(self.result)}")

    def test_note_cannot_be_approved(self):
        self.assertTrue(
            len(_blocking_rules(self.result)) > 0,
            f"Session must not be approved when R8 fails:\n{_report(self.result)}"
        )

    def test_r8_message_mentions_scope(self):
        r = _rule(self.result, "R8")
        self.assertIn("scope", r.get("message", "").lower(),
            f"R8 message should mention scope: {r.get('message')}")


# ===========================================================================
# SCENARIO 3 — Physical restraint used, no incident report linked (R10 blocks)
# ===========================================================================

class TestScenario03_RestrictivePractice(unittest.TestCase):
    """
    Worker documents that they physically restrained a participant.
    No incident report has been linked (rp_incident_linked=False).
    Expected: R10 blocks, note cannot be approved.
    """

    _RP_NOTE = _GOOD_NOTE + (
        " During the session the participant became agitated and attempted to leave the "
        "building unsafely. Staff physically restrained the participant and held them "
        "down on the floor until they were calm."
    )

    def setUp(self):
        self.result = run_compliance_check(
            _session(
                compliance_input_text=self._RP_NOTE,
                rp_incident_linked=False,
            )
        )

    def test_r10_blocks(self):
        self.assertIn("R10", _blocking_rules(self.result),
            f"R10 should block when RP detected without incident:\n{_report(self.result)}")

    def test_rp_flag_detected(self):
        self.assertTrue(
            self.result["restrictive_practice_detected"],
            "RP flag should be raised"
        )

    def test_rp_category_is_physical(self):
        self.assertIn(
            "physical_restraint",
            self.result["restrictive_practice_types"],
            f"physical_restraint should be in detected types: {self.result['restrictive_practice_types']}"
        )

    def test_r10_passes_when_incident_linked(self):
        result_linked = run_compliance_check(
            _session(
                compliance_input_text=self._RP_NOTE,
                rp_incident_linked=True,
            )
        )
        r10 = _rule(result_linked, "R10")
        self.assertEqual(r10["status"], "pass",
            f"R10 should pass when incident is linked: {r10.get('message')}")


# ===========================================================================
# SCENARIO 4 — Incident language detected, auto-draft created (R9 warns, not blocks)
# ===========================================================================

class TestScenario04_IncidentLanguage(unittest.TestCase):
    """
    Worker mentions that the participant fell during the session.
    R9 should detect this and trigger an incident draft.
    R9 does NOT block approval — it just creates an incident report.
    Expected: R9 fails, but it is not is_blocking, so save proceeds.
    """

    _INCIDENT_NOTE = _GOOD_NOTE + (
        " Toward the end of the session the participant tripped and fell near the "
        "entrance of the shopping centre. An ambulance was called as a precaution. "
        "The participant was assessed and discharged on scene."
    )

    def setUp(self):
        self.result = run_compliance_check(_session(compliance_input_text=self._INCIDENT_NOTE))

    def test_r9_detects_incident(self):
        r9 = _rule(self.result, "R9")
        self.assertEqual(r9["status"], "fail",
            f"R9 should detect fall/ambulance language")

    def test_r9_does_not_block(self):
        self.assertNotIn("R9", _blocking_rules(self.result),
            f"R9 must NOT block — it only triggers an incident workflow")

    def test_incident_triggers_captured(self):
        r9 = _rule(self.result, "R9")
        triggers = r9.get("incident_triggers", [])
        self.assertTrue(
            any("fall" in t or "ambulance" in t for t in triggers),
            f"Expected fall/ambulance in triggers: {triggers}"
        )


# ===========================================================================
# SCENARIO 5 — Subjective language in note (R6 fails, info tier)
# ===========================================================================

class TestScenario05_SubjectiveLanguage(unittest.TestCase):
    """
    Worker writes their opinion rather than observable facts.
    "I think the participant is struggling" / "I feel she needs more help".
    Expected: R6 fails (info tier — surfaced in panel, does not hard-block).
    """

    _SUBJECTIVE_NOTE = _GOOD_NOTE + (
        " I think the participant is starting to struggle more with community tasks. "
        "I believe she needs additional support hours. I feel the current plan is "
        "insufficient for her needs."
    )

    def setUp(self):
        self.result = run_compliance_check(_session(compliance_input_text=self._SUBJECTIVE_NOTE))

    def test_r6_fails(self):
        r6 = _rule(self.result, "R6")
        self.assertEqual(r6["status"], "fail",
            f"R6 should fail on subjective language:\n{_report(self.result)}")

    def test_r6_is_info_tier(self):
        r6 = _rule(self.result, "R6")
        self.assertEqual(_effective_tier(r6), "info",
            f"R6 is info-tier and must not hard-block:\n{_report(self.result)}")
        self.assertNotIn("R6", _block_tier_rules(self.result))

    def test_r6_message_quotes_phrase(self):
        r6 = _rule(self.result, "R6")
        self.assertTrue(
            any(phrase in r6.get("message", "") for phrase in ("I think", "I believe", "I feel")),
            f"R6 message should quote the offending phrase: {r6.get('message')}"
        )


# ===========================================================================
# SCENARIO 6 — Non-person-first language (R7 fails, warn tier)
# ===========================================================================

class TestScenario06_PersonFirstLanguage(unittest.TestCase):
    """
    Worker uses outdated disability language.
    "The wheelchair-bound client" / "suffers from autism".
    Expected: R7 fails (warn tier — worker must acknowledge before save).
    """

    _PFL_NOTE = _GOOD_NOTE.replace(
        "Participant engaged",
        "The wheelchair-bound client engaged"
    )

    def setUp(self):
        self.result = run_compliance_check(_session(compliance_input_text=self._PFL_NOTE))

    def test_r7_fails_warn_tier(self):
        self.assertIn("R7", _warn_tier_rules(self.result),
            f"R7 should fail on warn tier for 'wheelchair-bound':\n{_report(self.result)}")
        self.assertNotIn("R7", _block_tier_rules(self.result))

    def test_r7_suggests_correction(self):
        r7 = _rule(self.result, "R7")
        self.assertIn("wheelchair", r7.get("message", "").lower(),
            f"R7 should mention wheelchair in message: {r7.get('message')}")


# ===========================================================================
# SCENARIO 7 — No goals linked (R5 fails, warn tier)
# ===========================================================================

class TestScenario07_NoGoalsLinked(unittest.TestCase):
    """
    Worker submits a note but forgets to link any NDIS goals to the session.
    Expected: R5 fails (warn tier — worker must acknowledge before save).
    """

    def setUp(self):
        self.result = run_compliance_check(
            _session(goals_addressed="[]")
        )

    def test_r5_fails_warn_tier(self):
        self.assertIn("R5", _warn_tier_rules(self.result),
            f"R5 should fail on warn tier when no goals are linked:\n{_report(self.result)}")
        self.assertNotIn("R5", _block_tier_rules(self.result))

    def test_r5_message_mentions_goals(self):
        r5 = _rule(self.result, "R5")
        self.assertIn("goal", r5.get("message", "").lower())


# ===========================================================================
# SCENARIO 8 — Session times missing (R1 blocks)
# ===========================================================================

class TestScenario08_MissingTimes(unittest.TestCase):
    """
    Worker submits a note but forgot to record start/end times.
    Without times the session cannot be claimed.
    Expected: R1 blocks approval.
    """

    def setUp(self):
        self.result = run_compliance_check(
            _session(start_time="", end_time="", duration_minutes=0)
        )

    def test_r1_blocks(self):
        self.assertIn("R1", _blocking_rules(self.result),
            f"R1 should block when times are missing:\n{_report(self.result)}")

    def test_r1_message_mentions_time(self):
        r1 = _rule(self.result, "R1")
        self.assertIn("time", r1.get("message", "").lower())


# ===========================================================================
# SCENARIO 9 — Note submitted 10 days late (R2 fails, warn tier)
# ===========================================================================

class TestScenario09_LateDocumentation(unittest.TestCase):
    """
    Worker submits a note 10 days after the session.
    NDIS requires documentation within 48 hours.
    Expected: R2 fails (warn tier — worker must acknowledge before save).
    """

    def setUp(self):
        self.result = run_compliance_check(
            _session(
                session_date="2026-05-24",
                updated_at="2026-06-04T10:00:00",  # 11 days late
            )
        )

    def test_r2_fails_warn_tier(self):
        self.assertIn("R2", _warn_tier_rules(self.result),
            f"R2 should fail on warn tier when note is >7 days late:\n{_report(self.result)}")
        self.assertNotIn("R2", _block_tier_rules(self.result))

    def test_r2_message_mentions_days(self):
        r2 = _rule(self.result, "R2")
        self.assertIn("days", r2.get("message", "").lower())


# ===========================================================================
# SCENARIO 10 — Copy-paste from previous session (R11 warns but does not block)
# ===========================================================================

class TestScenario10_DuplicateNote(unittest.TestCase):
    """
    Worker reuses nearly identical note from a previous shift.
    R11 should warn but NOT block — it's an audit risk, not a hard stop.
    """

    def setUp(self):
        prev = {
            "id": "prev-session",
            "patient_id": "patient-1",
            "worker_id": "worker-1",
            "session_date": "2026-06-03",
            "notes": _GOOD_NOTE,
        }
        self.result = run_compliance_check(
            _session(),
            existing_sessions=[prev]
        )

    def test_r11_detects_similarity(self):
        r11 = _rule(self.result, "R11")
        self.assertIn(r11["status"], ("fail", "warning"),
            "R11 should flag high similarity to previous note")

    def test_r11_does_not_block(self):
        self.assertNotIn("R11", _blocking_rules(self.result),
            "R11 must NOT block — it is a warning/audit risk only")


# ===========================================================================
# SCENARIO 11 — Vague filler note (R3 warns, does not block)
# ===========================================================================

class TestScenario11_FillerNote(unittest.TestCase):
    """
    Worker writes a vague, non-specific note.
    "Good session. All went well. No issues."
    R3 detects filler language — warns but does not block (per spec).
    """

    def setUp(self):
        self.result = run_compliance_check(
            _session(compliance_input_text="Good session today. All went well. No issues to report.")
        )

    def test_r3_fails_on_filler(self):
        r3 = _rule(self.result, "R3")
        self.assertEqual(r3["status"], "fail",
            "R3 should fail on filler phrases")

    def test_r3_is_info_tier(self):
        r3 = _rule(self.result, "R3")
        self.assertEqual(_effective_tier(r3), "info",
            "R3 must be info-tier — surfaced in panel without hard-blocking save")
        self.assertNotIn("R3", _block_tier_rules(self.result))


# ===========================================================================
# SCENARIO 12 — Multiple violations at once (realistic worst-case note)
# ===========================================================================

class TestScenario12_WorstCase(unittest.TestCase):
    """
    Everything wrong: short note, no times, no goals, subjective language,
    clinical language, and non-person-first.
    Expected: multiple blocking rules fire, score very low.
    """

    _TERRIBLE_NOTE = (
        "Good session. The wheelchair-bound client did some tasks. "
        "I think she is improving. I administered medication and completed a "
        "clinical assessment. No issues."
    )

    def setUp(self):
        self.result = run_compliance_check(
            _session(
                compliance_input_text=self._TERRIBLE_NOTE,
                start_time="",
                end_time="",
                duration_minutes=0,
                goals_addressed="[]",
                session_type="",
            )
        )

    def test_multiple_failures_fire(self):
        block_fails = _block_tier_rules(self.result)
        warn_fails = _warn_tier_rules(self.result)
        self.assertGreaterEqual(len(block_fails), 2,
            f"Expected at least 2 block-tier failures:\n{_report(self.result)}")
        self.assertGreaterEqual(len(block_fails) + len(warn_fails), 3,
            f"Expected multiple tiered failures:\n{_report(self.result)}")

    def test_score_is_very_low(self):
        self.assertLess(self.result["score"], 45,
            f"Score should be very low for worst-case note:\n{_report(self.result)}")

    def test_worst_case_tiered_failures(self):
        self.assertIn("R1", _block_tier_rules(self.result),
            f"R1 should be block-tier on worst-case note:\n{_report(self.result)}")
        self.assertIn("R8", _block_tier_rules(self.result),
            f"R8 should be block-tier on worst-case note:\n{_report(self.result)}")
        self.assertEqual(_rule(self.result, "R6")["status"], "fail")
        self.assertIn("R7", _warn_tier_rules(self.result),
            f"R7 should fail on warn tier:\n{_report(self.result)}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
