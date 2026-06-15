from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


PromptLevel = Literal["full", "partial", "independent"]


class ProgressDeltaEntry(BaseModel):
    goal_id: Optional[str] = None
    prompt_level: Optional[PromptLevel] = None
    independence_rating: Optional[int] = Field(default=None, ge=1, le=5)
    skill_step: Optional[str] = None
    delta_summary: Optional[str] = None


class ProgressTrendPoint(BaseModel):
    session_id: Optional[str] = None
    session_date: Optional[str] = None
    value: Optional[str | int] = None


class GoalProgressTrajectory(BaseModel):
    goal_id: str
    goal_title: str
    session_count: int = 0
    prompt_level_trend: list[ProgressTrendPoint] = Field(default_factory=list)
    independence_rating_trend: list[ProgressTrendPoint] = Field(default_factory=list)


class ParticipantProgressResponse(BaseModel):
    participant_id: str
    plan_renewal_readiness_score: int = 0
    goals: list[GoalProgressTrajectory] = Field(default_factory=list)
