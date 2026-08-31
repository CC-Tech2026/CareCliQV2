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
    fair distribution           10   (real, Phase 4 - this worker's share of the
                                       participant's completed shifts in the last
                                       90 days; neutral half-weight until that
                                       window has enough shifts on file across
                                       any worker for a share to mean anything)

"Missing data reads as neutral, never as a bad fit" (Section 5.2) applies at
the component level too: a component with no comparable data on EITHER side
scores at half its own weight, not zero. A real zero only happens once both
sides have tags in that category and genuinely share none.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from .supabase_client import get_supabase_admin
from . import tag_service
from . import shift_match_feedback_service as feedback_service

INTERESTS_WEIGHT = 30.0
LIVED_EXPERIENCE_WEIGHT = 25.0
PRIOR_HISTORY_WEIGHT = 25.0  # real (Phase 3) - neutral half-weight until this pair has rated feedback
CONTINUITY_WEIGHT = 10.0
FAIR_DISTRIBUTION_WEIGHT = 10.0  # real (Phase 4) - neutral half-weight until there's enough recent history

# Below this many completed shifts for a participant (across every worker,
# not just the candidate), a "share" of them doesn't mean anything yet - a
# freshly seeded organisation should read as neutral, not as everyone being
# unfairly overloaded on one shift each.
FAIR_DISTRIBUTION_MIN_SHIFTS = 3
FAIR_DISTRIBUTION_LOOKBACK_DAYS = 90
# Above this share of a participant's recent shifts, flag it in the reasons -
# below it, a real (non-neutral) score still applies but isn't called out.
FAIR_DISTRIBUTION_FLAG_SHARE = 0.6

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


def _continuity_worker_ids_batch(worker_ids: list[str], participant_id: str, organization_id: str) -> set[str]:
    """Which of these candidates have ever completed a shift with this
    participant - batch form of the old per-worker _continuity_component
    existence check, one query for the whole candidate list instead of one
    query per candidate."""
    if not worker_ids:
        return set()
    supabase = get_supabase_admin()
    try:
        resp = (
            supabase.table("shifts")
            .select("worker_id")
            .eq("organization_id", organization_id)
            .eq("participant_id", participant_id)
            .eq("status", "completed")
            .in_("worker_id", worker_ids)
            .execute()
        )
        return {r["worker_id"] for r in (resp.data or []) if r.get("worker_id")}
    except Exception:
        return set()


def _prior_history_from_batch(history: Optional[tuple[float, int]]) -> tuple[float, Optional[str]]:
    if not history:
        return PRIOR_HISTORY_WEIGHT / 2, None
    avg_rating, count = history
    # avg_rating is 1-5; map linearly onto this component's weight (1 -> 0, 5 -> full weight).
    score = max(0.0, min(PRIOR_HISTORY_WEIGHT, (avg_rating - 1) / 4 * PRIOR_HISTORY_WEIGHT))
    times = "once" if count == 1 else f"{count} times"
    reason = f"Worked with this participant {times}, average rating {avg_rating:.1f}/5"
    return score, reason


def _recent_shift_counts_by_worker(participant_id: str, organization_id: str) -> Counter[str]:
    """How many completed shifts each worker has taken with this participant
    in the lookback window - fetched once per scoring pass (not once per
    candidate), since it's participant-scoped, not worker-scoped."""
    supabase = get_supabase_admin()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=FAIR_DISTRIBUTION_LOOKBACK_DAYS)).isoformat()
    try:
        resp = (
            supabase.table("shifts")
            .select("worker_id")
            .eq("organization_id", organization_id)
            .eq("participant_id", participant_id)
            .eq("status", "completed")
            .gte("scheduled_start", cutoff)
            .execute()
        )
        rows = resp.data or []
    except Exception:
        rows = []
    return Counter(str(r["worker_id"]) for r in rows if r.get("worker_id"))


def _fair_distribution_component(worker_id: str, recent_counts: Counter[str]) -> tuple[float, Optional[str]]:
    total = sum(recent_counts.values())
    if total < FAIR_DISTRIBUTION_MIN_SHIFTS:
        return FAIR_DISTRIBUTION_WEIGHT / 2, None
    share = recent_counts.get(worker_id, 0) / total
    score = FAIR_DISTRIBUTION_WEIGHT * (1 - share)
    reason = (
        "Has taken most of this participant's recent shifts - consider spreading coverage"
        if share >= FAIR_DISTRIBUTION_FLAG_SHARE
        else None
    )
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
    recent_counts = _recent_shift_counts_by_worker(participant_id, organization_id)

    # Everything below used to be fetched per candidate worker (has_do_not_repeat_flag,
    # list_worker_tags, continuity, rating history - 4-5 sequential queries each),
    # which turned a team of a dozen workers into 50+ round trips. Batched up
    # front instead: a small constant number of queries regardless of how many
    # candidates there are.
    do_not_repeat_ids = feedback_service.do_not_repeat_worker_ids(participant_id, organization_id)
    remaining_ids = [wid for wid in worker_ids if wid not in do_not_repeat_ids]
    worker_tags_by_id = tag_service.list_worker_tags_batch(remaining_ids, include_private=True)
    continuity_worker_ids = _continuity_worker_ids_batch(remaining_ids, participant_id, organization_id)
    rating_history_by_id = feedback_service.rating_history_by_worker(participant_id, organization_id, remaining_ids)

    out: dict[str, dict[str, Any]] = {}
    for worker_id in worker_ids:
        # A coordinator explicitly flagging "would not repeat" for this exact
        # pair is a deliberate, considered call (see do_not_repeat_worker_ids'
        # docstring) - it overrides scoring entirely rather than lowering it,
        # per the design spec's "documented problem is a hard stop, not a
        # lower score" principle. Consistent with this codebase's existing
        # convention of always showing and explaining rather than silently
        # removing a candidate (e.g. an unavailable worker still appears in
        # /available-workers, just sorted last with a reason) - excluded is a
        # sort/display tier, not a hard filter the caller can't see past.
        if worker_id in do_not_repeat_ids:
            out[worker_id] = {
                "score": 0,
                "reasons": ["Previous pairing marked as not to repeat"],
                "excluded": True,
            }
            continue

        worker_tags = worker_tags_by_id.get(worker_id, [])
        worker_interests = _tags_in_categories(worker_tags, interests_cat_ids)
        worker_lived_exp = _tags_in_categories(worker_tags, lived_exp_cat_ids)

        interests_score, interests_reason = _overlap_component(
            participant_interests, worker_interests, INTERESTS_WEIGHT, "Shares interests"
        )
        lived_exp_score, lived_exp_reason = _overlap_component(
            participant_lived_exp, worker_lived_exp, LIVED_EXPERIENCE_WEIGHT, "Relevant lived experience"
        )
        continuity_score, continuity_reason = (
            (CONTINUITY_WEIGHT, "Has worked with this participant before")
            if worker_id in continuity_worker_ids
            else (0.0, None)
        )
        prior_history_score, prior_history_reason = _prior_history_from_batch(rating_history_by_id.get(worker_id))
        # The rated-history reason ("worked together 3 times, avg 4.6/5") is
        # strictly more informative than the plain continuity one ("has worked
        # with this participant before") when both are true - don't show both.
        if prior_history_reason:
            continuity_reason = None
        fair_distribution_score, fair_distribution_reason = _fair_distribution_component(worker_id, recent_counts)

        total = (
            interests_score
            + lived_exp_score
            + prior_history_score
            + continuity_score
            + fair_distribution_score
        )

        # Prior history is the strongest, most concrete signal when present -
        # shown first, ahead of the tag-overlap reasons. The distribution flag
        # is a caution rather than a positive signal, so it's last in line and
        # rarely displayed (WorkerMatchBadge only shows reasons[0]) unless
        # nothing more positive applies.
        reasons = [
            r for r in (prior_history_reason, interests_reason, lived_exp_reason, continuity_reason, fair_distribution_reason)
            if r
        ][:MAX_REASONS]
        out[worker_id] = {"score": round(total), "reasons": reasons}

    return out
