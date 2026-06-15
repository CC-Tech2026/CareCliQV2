"""CARECLIQV2-72/74/79 — progress_delta parsing and aggregation tests."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from backend.app.services import ai_service, progress_service, session_service


class TestParseProgressDelta:
    def test_valid_list(self):
        raw = [
            {
                "goal_id": "g1",
                "prompt_level": "partial",
                "independence_rating": 3,
                "skill_step": "dressing",
                "delta_summary": "Improved prompting",
            }
        ]
        result = ai_service.parse_progress_delta(raw)
        assert result is not None
        assert len(result) == 1
        assert result[0]["prompt_level"] == "partial"
        assert result[0]["independence_rating"] == 3

    def test_malformed_returns_none(self):
        assert ai_service.parse_progress_delta("not json") is None
        assert ai_service.parse_progress_delta(42) is None

    def test_invalid_prompt_level_stripped(self):
        raw = [{"goal_id": "g1", "prompt_level": "invalid", "delta_summary": "x"}]
        result = ai_service.parse_progress_delta(raw)
        assert result is not None
        assert "prompt_level" not in result[0]
        assert result[0]["delta_summary"] == "x"

    def test_rating_out_of_range_stripped(self):
        raw = [{"independence_rating": 9, "delta_summary": "x"}]
        result = ai_service.parse_progress_delta(raw)
        assert result is not None
        assert "independence_rating" not in result[0]


class TestFormatPriorTrajectory:
    def test_empty(self):
        assert ai_service.format_prior_trajectory_context({}) == ""

    def test_truncates_long_context(self):
        prior = {
            "g1": [
                {
                    "session_date": "2026-06-01",
                    "progress_delta": {
                        "prompt_level": "full",
                        "independence_rating": 2,
                        "delta_summary": "x" * 500,
                    },
                }
            ]
        }
        text = ai_service.format_prior_trajectory_context(prior)
        assert "PRIOR TRAJECTORY" in text
        assert len(text) <= ai_service._PRIOR_TRAJECTORY_MAX_CHARS + 20


class TestParticipantProgressAggregation:
    def test_empty_sessions(self):
        result = progress_service.build_participant_progress("p1", {"goals": []}, [])
        assert result.goals == []
        assert result.plan_renewal_readiness_score == 0

    def test_groups_by_goal(self):
        participant = {
            "goals": [{"id": "g1", "title": "Dressing"}],
        }
        sessions = [
            {
                "id": "s1",
                "status": "completed",
                "session_date": "2026-06-01",
                "progress_delta": [
                    {
                        "goal_id": "g1",
                        "prompt_level": "full",
                        "independence_rating": 2,
                        "delta_summary": "Needed full support",
                    }
                ],
            },
            {
                "id": "s2",
                "status": "completed",
                "session_date": "2026-06-08",
                "progress_delta": [
                    {
                        "goal_id": "g1",
                        "prompt_level": "partial",
                        "independence_rating": 3,
                        "delta_summary": "Partial prompting only",
                    }
                ],
            },
        ]
        result = progress_service.build_participant_progress("p1", participant, sessions)
        assert len(result.goals) == 1
        assert result.goals[0].goal_title == "Dressing"
        assert result.goals[0].session_count == 2
        assert len(result.goals[0].independence_rating_trend) == 2
        assert result.plan_renewal_readiness_score > 0


@pytest.mark.asyncio
async def test_improve_note_with_rag_context():
    with patch(
        "backend.app.services.rag_service.retrieve_high_scoring_participant_notes",
        new_callable=AsyncMock,
        return_value=[
            {
                "session_date": "2026-05-01",
                "compliance_score": 90,
                "content": "Jordan previously demonstrated independent meal preparation.",
            }
        ],
    ), patch.object(ai_service.client.chat.completions, "create") as mock_create:
        mock_create.return_value.choices = [
            type("C", (), {"message": type("M", (), {"content": json.dumps({
                "improved_note": "Jordan completed dressing with partial prompting.",
                "rule_suggestions": [],
            })})()})()
        ]
        result = await ai_service.improve_note(
            "short note",
            [{"rule": "documentation", "message": "too brief"}],
            participant_id="p1",
            organisation_id="org1",
        )
        assert "improved_note" in result
        prompt = mock_create.call_args.kwargs["messages"][1]["content"]
        assert "based on past session records" in prompt
        assert "Jordan previously" in prompt


@pytest.mark.asyncio
async def test_get_prior_progress_sessions_filters_completed():
    user = {"sub": "u1", "role": "support_coordinator", "organization_id": "org1"}

    async def fake_get_sessions(pid, current_user):
        return [
            {"id": "s1", "status": "completed", "session_date": "2026-06-10", "goals_addressed": ["g1"],
             "progress_delta": [{"goal_id": "g1", "prompt_level": "full", "independence_rating": 2}]},
            {"id": "s2", "status": "draft", "session_date": "2026-06-11", "goals_addressed": ["g1"],
             "progress_delta": [{"goal_id": "g1", "prompt_level": "partial"}]},
        ]

    with patch.object(session_service, "get_sessions_by_participant", side_effect=fake_get_sessions):
        prior = await session_service.get_prior_progress_sessions(
            "p1", ["g1"], exclude_session_id="current", current_user=user, limit=5
        )
    assert len(prior["g1"]) == 1
    assert prior["g1"][0]["session_id"] == "s1"
