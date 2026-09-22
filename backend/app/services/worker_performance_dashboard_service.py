"""Worker performance dashboard — CARECLIQV2-288."""

from __future__ import annotations

import logging
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Any

from .shift_validation_service import compliance_score_band
from .supabase_client import get_supabase_admin
from .worker_shift_history_service import list_completed_shifts
from ..core.timezone import app_today

logger = logging.getLogger(__name__)

ACHIEVEMENT_KEYS = (
    "compliance_streak_5",
    "all_evidence_10",
    "zero_incidents_30",
    "perfect_punctuality_10",
)


def _is_missing_schema(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg


def _avg_score(shifts: list[dict[str, Any]]) -> float | None:
    scores = [float(s["compliance_score"]) for s in shifts if s.get("compliance_score") is not None]
    if not scores:
        return None
    return round(sum(scores) / len(scores), 1)


def _trend_sentence(current: float | None, prior: float | None) -> dict[str, Any]:
    if current is None or prior is None:
        return {
            "direction": "stable",
            "delta": 0,
            "sentence": "Keep completing shifts to build your performance trend.",
            "tooltip": "Not enough data for comparison yet.",
        }
    delta = round(current - prior, 1)
    if delta > 5:
        direction = "up"
        sentence = f"Your score has improved {abs(delta):g} points over the last month."
    elif delta < -5:
        direction = "down"
        sentence = f"Your score has dropped {abs(delta):g} points over the last month."
    else:
        direction = "stable"
        sentence = "Your compliance score has been steady over the last month."
    return {
        "direction": direction,
        "delta": delta,
        "sentence": sentence,
        "tooltip": f"Last 30 days: {current}% vs prior 30 days: {prior}%",
    }


def _top_tags(worker_id: str, organization_id: str, category: str, limit: int) -> list[dict[str, Any]]:
    try:
        fb_resp = (
            get_supabase_admin()
            .table("shift_feedback")
            .select("id")
            .eq("worker_id", worker_id)
            .eq("organization_id", organization_id)
            .execute()
        )
        feedback_ids = [r["id"] for r in (fb_resp.data or [])]
        if not feedback_ids:
            return []
        tag_resp = (
            get_supabase_admin()
            .table("shift_feedback_tags")
            .select("tag_id, feedback_tags(label, category)")
            .in_("feedback_id", feedback_ids)
            .execute()
        )
        labels: list[str] = []
        for row in tag_resp.data or []:
            tag = row.get("feedback_tags") or {}
            if tag.get("category") == category and tag.get("label"):
                labels.append(str(tag["label"]))
        counts = Counter(labels)
        return [{"label": label, "count": count} for label, count in counts.most_common(limit)]
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        logger.debug("top tags failed: %s", exc)
        return []


def _fetch_completed_shift_rows(worker_id: str, organization_id: str, limit: int = 30) -> list[dict]:
    try:
        resp = (
            get_supabase_admin()
            .table("shifts")
            .select("id, scheduled_start, clocked_in_at, session_id, tasks, status")
            .eq("worker_id", worker_id)
            .eq("organization_id", organization_id)
            .eq("status", "completed")
            .order("scheduled_start", desc=True)
            .limit(limit)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


def _session_validation_map(shift_rows: list[dict]) -> dict[str, dict]:
    session_ids = [str(s["session_id"]) for s in shift_rows if s.get("session_id")]
    if not session_ids:
        return {}
    try:
        resp = (
            get_supabase_admin()
            .table("sessions")
            .select("id, end_validation")
            .in_("id", session_ids)
            .execute()
        )
        return {str(r["id"]): r.get("end_validation") or {} for r in (resp.data or [])}
    except Exception:
        return {}


def _evaluate_badges(worker_id: str, organization_id: str, shift_rows: list[dict]) -> list[dict[str, Any]]:
    validations = _session_validation_map(shift_rows)
    definitions: dict[str, dict] = {}
    try:
        def_resp = get_supabase_admin().table("achievement_definitions").select("*").execute()
        definitions = {r["key"]: r for r in (def_resp.data or [])}
    except Exception:
        pass

    unlocked: set[str] = set()
    try:
        ach_resp = (
            get_supabase_admin()
            .table("worker_achievements")
            .select("achievement_key, unlocked_at")
            .eq("worker_id", worker_id)
            .execute()
        )
        unlocked = {r["achievement_key"] for r in (ach_resp.data or [])}
        unlock_dates = {r["achievement_key"]: r["unlocked_at"] for r in (ach_resp.data or [])}
    except Exception:
        unlock_dates = {}

    scores: list[int] = []
    evidence_ok = True
    punctual_count = 0
    grace = timedelta(minutes=5)

    for shift in shift_rows[:10]:
        val = validations.get(str(shift.get("session_id") or ""), {})
        if not val and shift.get("tasks"):
            from .shift_validation_service import compute_shift_validation

            val = compute_shift_validation(shift.get("tasks") or [])
        score = val.get("compliance_score")
        if score is not None:
            scores.append(int(score))
        if val.get("tasks_without_evidence", 0) > 0:
            evidence_ok = False
        sched = shift.get("scheduled_start")
        clocked = shift.get("clocked_in_at")
        if sched and clocked:
            try:
                dt_sched = datetime.fromisoformat(str(sched).replace("Z", "+00:00"))
                dt_clock = datetime.fromisoformat(str(clocked).replace("Z", "+00:00"))
                if dt_clock <= dt_sched + grace:
                    punctual_count += 1
            except ValueError:
                pass

    newly_unlocked: list[str] = []
    if len(scores) >= 5 and all(s == 100 for s in scores[:5]):
        if "compliance_streak_5" not in unlocked:
            newly_unlocked.append("compliance_streak_5")
    if len(shift_rows) >= 10 and evidence_ok:
        if "all_evidence_10" not in unlocked:
            newly_unlocked.append("all_evidence_10")
    if punctual_count >= 10:
        if "perfect_punctuality_10" not in unlocked:
            newly_unlocked.append("perfect_punctuality_10")

    try:
        since = (app_today() - timedelta(days=30)).isoformat()
        inc_resp = (
            get_supabase_admin()
            .table("incidents")
            .select("id", count="exact")
            .eq("created_by", worker_id)
            .gte("created_at", since)
            .execute()
        )
        if int(inc_resp.count or 0) == 0 and "zero_incidents_30" not in unlocked:
            newly_unlocked.append("zero_incidents_30")
    except Exception:
        pass

    now = datetime.now(timezone.utc).isoformat()
    for key in newly_unlocked:
        try:
            get_supabase_admin().table("worker_achievements").insert({
                "worker_id": worker_id,
                "organization_id": organization_id,
                "achievement_key": key,
                "unlocked_at": now,
            }).execute()
            unlocked.add(key)
            unlock_dates[key] = now
        except Exception:
            pass

    badges = []
    for key in ACHIEVEMENT_KEYS:
        defn = definitions.get(key, {})
        badges.append({
            "key": key,
            "title": defn.get("title", key),
            "description": defn.get("description", ""),
            "unlocked": key in unlocked,
            "unlocked_at": unlock_dates.get(key),
        })
    return badges


def get_performance_dashboard(worker_id: str, organization_id: str) -> dict[str, Any]:
    today = app_today()
    window_start = today - timedelta(days=30)
    prior_start = today - timedelta(days=60)

    history = list_completed_shifts(worker_id, organization_id)
    all_shifts = history.get("shifts") or []

    current_window = []
    prior_window = []
    for row in all_shifts:
        day = None
        try:
            day = date.fromisoformat(str(row.get("shift_date") or "")[:10])
        except ValueError:
            continue
        if day and day >= window_start:
            current_window.append(row)
        elif day and prior_start <= day < window_start:
            prior_window.append(row)

    current_avg = _avg_score(current_window)
    prior_avg = _avg_score(prior_window)
    trend = _trend_sentence(current_avg, prior_avg)

    shift_rows = _fetch_completed_shift_rows(worker_id, organization_id, 30)
    badges = _evaluate_badges(worker_id, organization_id, shift_rows)

    recommendation = None
    try:
        rec_resp = (
            get_supabase_admin()
            .table("worker_training_recommendations")
            .select("id, title, training_module_id, recommended_at")
            .eq("worker_id", worker_id)
            .is_("dismissed_at", "null")
            .order("recommended_at", desc=True)
            .limit(1)
            .execute()
        )
        recommendation = (rec_resp.data or [None])[0]
    except Exception as exc:
        if not _is_missing_schema(exc):
            logger.debug("training recommendation lookup: %s", exc)

    return {
        "average_score_30d": current_avg,
        "compliance_band": compliance_score_band(current_avg),
        "trend": trend,
        "strengths": _top_tags(worker_id, organization_id, "strength", 3),
        "focus_areas": _top_tags(worker_id, organization_id, "improvement", 2),
        "badges": badges,
        "recommended_training": recommendation,
    }
