"""CARECLIQV2-76 — Aggregate per-goal progress trajectories from session progress_delta."""
from __future__ import annotations

import json
import logging
from typing import Any

from ..schemas.progress import (
    GoalProgressTrajectory,
    ParticipantProgressResponse,
    ProgressTrendPoint,
)
from . import session_service

logger = logging.getLogger(__name__)

_PROMPT_LEVEL_ORDER = {"full": 3, "partial": 2, "independent": 1}


def _normalize_progress_delta(raw: Any) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return []
    if isinstance(raw, dict):
        return [raw]
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, dict)]
    return []


def _goal_title_map(participant: dict) -> dict[str, str]:
    titles: dict[str, str] = {}
    for goal in participant.get("goals") or []:
        if isinstance(goal, dict) and goal.get("id"):
            titles[str(goal["id"])] = str(goal.get("title") or goal.get("description") or goal["id"])
    return titles


def _score_goal_trajectory(
    prompt_trend: list[ProgressTrendPoint],
    independence_trend: list[ProgressTrendPoint],
    session_count: int,
) -> int:
    score = 50
    ratings = [p.value for p in independence_trend if isinstance(p.value, (int, float))]
    if len(ratings) >= 2:
        if ratings[-1] > ratings[0]:
            score = 82
        elif ratings[-1] == ratings[0]:
            score = 62
        else:
            score = 42
    elif len(ratings) == 1:
        score = 55

    prompt_values = [p.value for p in prompt_trend if isinstance(p.value, str)]
    if len(prompt_values) >= 2:
        first = _PROMPT_LEVEL_ORDER.get(str(prompt_values[0]).lower(), 0)
        last = _PROMPT_LEVEL_ORDER.get(str(prompt_values[-1]).lower(), 0)
        if last < first:
            score = min(100, score + 12)
        elif last > first:
            score = max(0, score - 8)

    if session_count >= 5:
        score = min(100, score + 8)
    elif session_count >= 3:
        score = min(100, score + 4)

    return max(0, min(100, score))


def compute_plan_renewal_readiness(goals: list[GoalProgressTrajectory]) -> int:
    if not goals:
        return 0
    scores = [
        _score_goal_trajectory(g.prompt_level_trend, g.independence_rating_trend, g.session_count)
        for g in goals
    ]
    return round(sum(scores) / len(scores))


def build_participant_progress(
    participant_id: str,
    participant: dict,
    sessions: list[dict],
) -> ParticipantProgressResponse:
    titles = _goal_title_map(participant)
    by_goal: dict[str, GoalProgressTrajectory] = {}

    completed = [
        s for s in sessions
        if str(s.get("status") or "").lower() == "completed"
    ]
    completed.sort(key=lambda s: str(s.get("session_date") or ""))

    for session in completed:
        session_id = str(session.get("id") or "")
        session_date = str(session.get("session_date") or "")
        for entry in _normalize_progress_delta(session.get("progress_delta")):
            goal_id = str(entry.get("goal_id") or "unknown")
            if goal_id not in by_goal:
                by_goal[goal_id] = GoalProgressTrajectory(
                    goal_id=goal_id,
                    goal_title=titles.get(goal_id, goal_id),
                    session_count=0,
                )
            goal = by_goal[goal_id]
            goal.session_count += 1
            if entry.get("prompt_level"):
                goal.prompt_level_trend.append(
                    ProgressTrendPoint(
                        session_id=session_id,
                        session_date=session_date,
                        value=str(entry["prompt_level"]),
                    )
                )
            if entry.get("independence_rating") is not None:
                try:
                    rating = int(entry["independence_rating"])
                except (TypeError, ValueError):
                    rating = None
                if rating is not None:
                    goal.independence_rating_trend.append(
                        ProgressTrendPoint(
                            session_id=session_id,
                            session_date=session_date,
                            value=rating,
                        )
                    )

    goals = list(by_goal.values())
    return ParticipantProgressResponse(
        participant_id=participant_id,
        plan_renewal_readiness_score=compute_plan_renewal_readiness(goals),
        goals=goals,
    )


async def get_participant_progress(
    participant_id: str,
    current_user: dict,
) -> ParticipantProgressResponse:
    from . import participant_service

    participant = await participant_service.get_participant_by_id(participant_id, current_user)
    if not participant:
        return ParticipantProgressResponse(participant_id=participant_id, goals=[])

    sessions = await session_service.get_sessions_by_participant(participant_id, current_user)
    return build_participant_progress(participant_id, participant, sessions)
