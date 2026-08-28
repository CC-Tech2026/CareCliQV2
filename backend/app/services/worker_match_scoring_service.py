"""Worker-Participant Matching Enhancement, Phase 2 (Ranking).

Soft ranking score layered on top of the existing hard filters (availability,
credentials, skills - untouched; see coordinator.py's get_available_workers).
Never blocks a candidate; purely explanatory, per the design spec's
"coordinator authority is final" principle - a low score is a suggestion to
look elsewhere first, not a restriction.

Weights (Section 5.2 of the design spec) - a starting configuration, not a
fixed formula:
    shared interests            30   (real - participant_tags/worker_tags overlap)
    relevant lived experience   25   (real - same mechanism, different category role)
    prior positive history      25   (real, Phase 3 - average outcome_rating from
                                       shift_match_feedback for this pair; neutral
                                       half-weight until this pair has any rated
                                       feedback on file)
    continuity                  10   (real - has a completed shift with this
                                       participant ever happened, from `shifts`)
    fair distribution           10   (Phase 4 placeholder, deferred by design
                                       until there's enough real shift history
                                       to make it meaningful - same fixed-
                                       neutral treatment prior history used to get)

"Missing data reads as neutral, never as a bad fit" (Section 5.2) applies at
the component level too: a component with no comparable data on EITHER side
scores at half its own weight, not zero. A real zero only happens once both
sides have tags in that category and genuinely share none.
"""

from __future__ import annotations

from typing import Any, Optional

from .supabase_client import get_supabase_admin
from . import tag_service
from . import shift_match_feedback_service as feedback_service

INTERESTS_WEIGHT = 30.0
LIVED_EXPERIENCE_WEIGHT = 25.0
PRIOR_HISTORY_WEIGHT = 25.0  # real (Phase 3) - neutral half-weight until this pair has rated feedback
CONTINUITY_WEIGHT = 10.0
FAIR_DISTRIBUTION_WEIGHT = 10.0  # Phase 4 placeholder - always neutral today

MAX_REASONS = 3


def _tags_in_categories(tags: list[dict[str, Any]], category_ids: set[str]) -> dict[str, str]:
    """tag_id -> label, restricted to the given category ids."""
    return {
        t["tag_id"]: t.get("label") or ""
        for t in tags
        if t.get("category_id") in category_ids and t.get("tag_id")
    }


def _overlap_component(
    participant_tags: dict[str, str],
    worker_tags: dict[str, str],
    weight: float,
    reason_prefix: str,
) -> tuple[float, Optional[str]]:
    if not participant_tags or not worker_tags:
        return weight / 2, None
    shared_ids = set(participant_tags) & set(worker_tags)
    if not shared_ids:
        return 0.0, None
    labels = [participant_tags[i] for i in shared_ids if participant_tags.get(i)][:2]
    score = weight if len(shared_ids) >= 2 else weight * 0.6
    reason = f"{reason_prefix}: {', '.join(labels)}" if labels else f"{reason_prefix} ({len(shared_ids)})"
    return score, reason


def _continuity_component(worker_id: str, participant_id: str, organization_id: str) -> tuple[float, Optional[str]]:
    supabase = get_supabase_admin()
    try:
        resp = (
            supabase.table("shifts")
            .select("id")
            .eq("organization_id", organization_id)
            .eq("worker_id", worker_id)
            .eq("participant_id", participant_id)
            .eq("status", "completed")
            .limit(1)
            .execute()
        )
        worked_before = bool(resp.data)
    except Exception:
        worked_before = False
    if worked_before:
        return CONTINUITY_WEIGHT, "Has worked with this participant before"
    return 0.0, None


def _prior_history_component(worker_id: str, participant_id: str, organization_id: str) -> tuple[float, Optional[str]]:
    history = feedback_service.rating_history_for_pair(worker_id, participant_id, organization_id)
    if not history:
        return PRIOR_HISTORY_WEIGHT / 2, None
    avg_rating, count = history
    # avg_rating is 1-5; map linearly onto this component's weight (1 -> 0, 5 -> full weight).
    score = max(0.0, min(PRIOR_HISTORY_WEIGHT, (avg_rating - 1) / 4 * PRIOR_HISTORY_WEIGHT))
    times = "once" if count == 1 else f"{count} times"
    reason = f"Worked with this participant {times}, average rating {avg_rating:.1f}/5"
    return score, reason


def score_candidates(
    worker_ids: list[str],
    participant_id: Optional[str],
    organization_id: str,
) -> dict[str, dict[str, Any]]:
    """worker_id -> {"score": int, "reasons": [str, ...]}.

    Returns an empty dict (nothing to rank by) when there's no participant to
    compare against - the caller treats a missing entry the same as today's
    behaviour when participant_id isn't supplied to /available-workers.
    """
    if not participant_id or not worker_ids:
        return {}

    interests_cat_ids = set(tag_service.category_ids_for_role(organization_id, "interests"))
    lived_exp_cat_ids = set(tag_service.category_ids_for_role(organization_id, "lived_experience"))

    participant_tags = tag_service.list_participant_tags(participant_id)
    participant_interests = _tags_in_categories(participant_tags, interests_cat_ids)
    participant_lived_exp = _tags_in_categories(participant_tags, lived_exp_cat_ids)

    out: dict[str, dict[str, Any]] = {}
    for worker_id in worker_ids:
        worker_tags = tag_service.list_worker_tags(worker_id, include_private=True)
        worker_interests = _tags_in_categories(worker_tags, interests_cat_ids)
        worker_lived_exp = _tags_in_categories(worker_tags, lived_exp_cat_ids)

        interests_score, interests_reason = _overlap_component(
            participant_interests, worker_interests, INTERESTS_WEIGHT, "Shares interests"
        )
        lived_exp_score, lived_exp_reason = _overlap_component(
            participant_lived_exp, worker_lived_exp, LIVED_EXPERIENCE_WEIGHT, "Relevant lived experience"
        )
        continuity_score, continuity_reason = _continuity_component(worker_id, participant_id, organization_id)
        prior_history_score, prior_history_reason = _prior_history_component(worker_id, participant_id, organization_id)
        # The rated-history reason ("worked together 3 times, avg 4.6/5") is
        # strictly more informative than the plain continuity one ("has worked
        # with this participant before") when both are true - don't show both.
        if prior_history_reason:
            continuity_reason = None

        total = (
            interests_score
            + lived_exp_score
            + prior_history_score
            + continuity_score
            + (FAIR_DISTRIBUTION_WEIGHT / 2)
        )

        # Prior history is the strongest, most concrete signal when present -
        # shown first, ahead of the tag-overlap reasons.
        reasons = [r for r in (prior_history_reason, interests_reason, lived_exp_reason, continuity_reason) if r][:MAX_REASONS]
        out[worker_id] = {"score": round(total), "reasons": reasons}

    return out
