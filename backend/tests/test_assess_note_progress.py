"""CARECLIQV2-75 — Progress Evidence 5th compliance criterion tests."""

from __future__ import annotations

import asyncio
from unittest.mock import patch

from backend.app.services import ai_service


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_has_measurable_progress_delta_requires_content():
    assert ai_service.has_measurable_progress_delta(None) is False
    assert ai_service.has_measurable_progress_delta([]) is False
    assert ai_service.has_measurable_progress_delta([{"goal_id": "g1"}]) is False
    assert ai_service.has_measurable_progress_delta([
        {"goal_id": "g1", "delta_summary": "Improved from full to partial prompting."},
    ]) is True


@patch("backend.app.services.ai_service.client.chat.completions.create")
def test_assess_note_caps_at_80_without_progress_delta(mock_create):
    mock_create.return_value.choices[0].message.content = (
        '{"goal_score": 28, "goal_feedback": "ok", "outcome_score": 20, '
        '"outcome_feedback": "ok", "nextstep_score": 12, "nextstep_feedback": "ok"}'
    )

    async def _test():
        return await ai_service.assess_note(
            note_text="Participant engaged in meal preparation with partial prompting. "
            "They demonstrated improved independence with chopping vegetables. "
            "Next session will focus on stove safety with supervisor nearby.",
            session_started=True,
            goals=[{"title": "Develop daily living skills", "description": "Meal prep"}],
            progress_delta=None,
        )

    result = _run(_test())
    assert result["score"] == 80
    assert result["breakdown"]["progress_evidence"]["pass"] is False


@patch("backend.app.services.ai_service.client.chat.completions.create")
def test_assess_note_includes_progress_evidence_points(mock_create):
    mock_create.return_value.choices[0].message.content = (
        '{"goal_score": 28, "goal_feedback": "ok", "outcome_score": 20, '
        '"outcome_feedback": "ok", "nextstep_score": 12, "nextstep_feedback": "ok"}'
    )
    delta = [{
        "goal_id": "g1",
        "prompt_level": "partial",
        "independence_rating": 3,
        "skill_step": "chopping",
        "delta_summary": "Moved from full to partial prompting.",
    }]

    async def _test():
        return await ai_service.assess_note(
            note_text="Participant engaged in meal preparation with partial prompting. "
            "They demonstrated improved independence with chopping vegetables. "
            "Next session will focus on stove safety with supervisor nearby.",
            session_started=True,
            goals=[{"title": "Develop daily living skills"}],
            progress_delta=delta,
        )

    result = _run(_test())
    assert result["breakdown"]["progress_evidence"]["pass"] is True
    assert result["breakdown"]["progress_evidence"]["score"] == 20
    assert result["score"] == 100
