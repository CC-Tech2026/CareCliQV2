"""Live note help runs the real NDIS rules (compliance_engine) on the draft,
so what the worker app shows while writing is what the note is scored on."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.app.services import compliance_engine, note_guidance_service as guide

LONG_GOOD = (
    "I supported Alex to prepare lunch in the kitchen from 12:00 to 12:45. Alex engaged well and chopped "
    "the vegetables independently, then reported feeling proud of the meal. This worked towards Alex's goal "
    "to cook simple meals with less help, and Alex achieved two steps without prompting today. Alex appeared "
    "calm and settled throughout the visit and reported no pain. We washed up together and Alex chose to dry "
    "the dishes. Alex then asked to plan tomorrow's lunch, and we wrote a shopping list for the next visit "
    "together at the table before I left at the end of the shift."
)


@pytest.fixture(autouse=True)
def default_rules():
    with patch.object(compliance_engine, "load_rule_configs", return_value={}):
        yield


def _rule(result, code):
    return next((r for r in result["rules"] if r["rule"] == code), None)


def test_short_note_fails_detail_with_the_real_threshold():
    result = guide.check_draft("Helped Alex with lunch and a short walk around the block.", participant_name="Alex")
    r3 = _rule(result, "R3")
    assert r3["status"] == "fail"
    assert "of 80 words" in r3["message"]
    assert result["ready"] is False


def test_no_concerns_is_filler_and_does_not_answer_the_concern_question():
    text = "Alex engaged with the shopping and chose the items. No concerns."
    result = guide.check_draft(text, participant_name="Alex")
    r3 = _rule(result, "R3")
    assert r3["status"] == "fail"
    # R3 reports length first for a short note; the filler shows once long enough.
    longer = LONG_GOOD.replace("reported no pain", "no concerns")
    r3_long = _rule(guide.check_draft(longer, participant_name="Alex"), "R3")
    assert r3_long["status"] == "fail" and '"no concerns" is too vague' in r3_long["message"]
    plain = guide.check_draft("We went to the shops. No concerns.", participant_name="Alex")
    assert plain["next_question"]["id"] == "response"
    skipped_response = guide.check_draft(
        "We went to the shops. No concerns.", participant_name="Alex", skipped=["response"]
    )
    assert skipped_response["next_question"]["id"] == "concern"


def test_response_words_match_the_server_rule():
    assert _rule(guide.check_draft("Alex engaged well.", participant_name="Alex"), "R12")["status"] == "pass"
    said = _rule(guide.check_draft("Alex said hello.", participant_name="Alex"), "R12")
    assert said["status"] == "warning"
    assert "engaged well" in said["message"]


def test_goal_rule_applies_only_when_there_is_a_goal():
    no_goals = guide.check_draft("Alex engaged well at the shops.", participant_name="Alex")
    assert _rule(no_goals, "R5") is None
    linked = guide.check_draft("Alex engaged well at the shops.", participant_name="Alex", goal_ids=["g1"])
    assert _rule(linked, "R5")["status"] != "pass"
    assert linked["next_question"]["id"] == "goal"


def test_language_rules_explain_what_to_change():
    r6 = _rule(guide.check_draft("I think Alex was tired after lunch today.", participant_name="Alex"), "R6")
    assert r6["status"] == "fail" and '"I think"' in r6["message"]
    r7 = _rule(guide.check_draft("Alex is wheelchair bound and needed help.", participant_name="Alex"), "R7")
    assert r7["status"] == "fail" and "person who uses a wheelchair" in r7["message"]
    r8 = _rule(guide.check_draft("I gave the medication at lunch.", participant_name="Alex"), "R8")
    assert r8["status"] == "fail" and "outside a support worker's role" in r8["message"]


def test_incidents_and_restrictive_practices():
    fell = guide.check_draft("Alex fell in the bathroom at 3pm.", participant_name="Alex")
    assert _rule(fell, "R9")["status"] == "fail"
    assert "incident report" in _rule(fell, "R9")["message"]
    assert fell["next_question"]["id"] != "concern"  # an incident answers it
    held = guide.check_draft("Staff restrained Alex during the outing.", participant_name="Alex")
    r10 = _rule(held, "R10")
    if r10["status"] == "fail":
        assert r10["blocks_approval"] is True


def test_copying_an_earlier_note_is_flagged():
    previous = [{"id": "s0", "patient_id": "p1", "worker_id": "w1", "session_date": "2026-11-01",
                 "compliance_input_text": LONG_GOOD}]
    result = guide.check_draft(LONG_GOOD, participant_name="Alex", previous_notes=previous,
                               participant_id="p1", worker_id="w1")
    r11 = _rule(result, "R11")
    assert r11["status"] == "fail" and "different about today" in r11["message"]


def test_a_complete_note_is_ready():
    result = guide.check_draft(LONG_GOOD, participant_name="Alex", goal_ids=["g1"])
    failing = [r["rule"] for r in result["rules"] if r["status"] == "fail"]
    assert failing == []
    assert result["ready"] is True
    assert result["checked_when_finished"] == ["R1", "R2", "R4"]


def test_messages_are_plain():
    texts = [
        "I think the disabled person seems to be tired, good session, gave the medication, fell.",
        "Ok.",
    ]
    for text in texts:
        for rule in guide.check_draft(text, participant_name="Alex")["rules"]:
            msg = rule["message"] or ""
            assert "—" not in msg and "–" not in msg
            assert not msg.startswith("R")


def test_a_rewrite_that_adds_an_incident_is_caught():
    original = "Alex engaged well at the park and chose to walk the long way home."
    assert guide.improvement_adds_facts(original, original + " Alex fell near the gate.") == ["R9"]
    assert guide.improvement_adds_facts(original, "Alex engaged well at the park today.") == []


@pytest.mark.asyncio
async def test_improve_endpoint_drops_a_suggestion_that_adds_facts():
    from backend.app.api import ai as ai_api

    with patch.object(ai_api.ai_service, "improve_note", AsyncMock(return_value={
        "improved_note": "Alex engaged at the park. Alex fell and was taken to hospital.",
        "rule_suggestions": [],
    })):
        result = await ai_api.improve_note_endpoint(
            {"notes": "Alex engaged at the park.", "failed_rules": []},
            {"sub": "w1", "role": "support_worker", "organization_id": "o1"},
        )
    assert result["improved_note"] == "" and result["discarded"] is True


@pytest.mark.asyncio
async def test_improve_endpoint_attaches_the_rule_check():
    from backend.app.api import ai as ai_api

    with patch.object(ai_api.ai_service, "improve_note", AsyncMock(return_value={
        "improved_note": LONG_GOOD, "rule_suggestions": [],
    })):
        result = await ai_api.improve_note_endpoint(
            {"notes": "Helped Alex cook lunch.", "failed_rules": []},
            {"sub": "w1", "role": "support_worker", "organization_id": "o1"},
        )
    assert result["check"]["ready"] is True


@pytest.mark.asyncio
async def test_check_endpoint_refuses_a_session_the_worker_does_not_own():
    from fastapi import HTTPException

    from backend.app.api import worker

    with patch.object(worker.shift_service, "_get_worker_session_or_none", return_value=None), patch.object(
        worker, "get_supabase_admin", return_value=MagicMock()
    ):
        with pytest.raises(HTTPException) as info:
            await worker.worker_check_note(
                worker.NoteCheckBody(text="Alex engaged well.", session_id="s-other"),
                {"sub": "w1", "role": "support_worker", "organization_id": "o1"},
            )
    assert info.value.status_code == 404


def test_hint_ids_and_values_for_the_app_to_translate():
    result = guide.check_draft("Helped Alex with lunch and a short walk around the block.", participant_name="Alex")
    r3 = _rule(result, "R3")
    assert r3["hint_id"] == "word-count" and r3["params"]["min"] == 80 and r3["params"]["words"] == 11
    r6 = _rule(guide.check_draft("I think Alex was tired after lunch today.", participant_name="Alex"), "R6")
    assert r6["hint_id"] == "subjective-language" and r6["params"]["phrase"] == "I think"
    r9 = _rule(guide.check_draft("Alex fell in the bathroom at 3pm.", participant_name="Alex"), "R9")
    assert r9["hint_id"] == "incident" and r9["params"]["phrase"]


# ── A rewrite must never lose what the worker wrote ──────────────────────────

ORIGINAL = 'At 2:30pm Liam took 2 tablets of paracetamol 500mg. He said "my knee hurts". We walked for 30 minutes.'


def test_rewrite_that_drops_times_doses_and_quotes_is_caught():
    lost = guide.improvement_drops_facts(ORIGINAL, "Liam took paracetamol and walked. He reported knee pain.")
    assert any(item.startswith("details:") for item in lost)
    assert "quote" in lost


def test_rewrite_that_keeps_every_detail_passes():
    kept = 'At 2:30pm Liam took 2 tablets of paracetamol 500mg and said "my knee hurts". Liam walked for 30 minutes.'
    assert guide.improvement_drops_facts(ORIGINAL, kept) == []


def test_rewrite_that_cuts_a_long_note_down_is_caught():
    long_note = " ".join(["observed"] * 60)
    assert "shortened" in guide.improvement_drops_facts(long_note, " ".join(["observed"] * 30))
