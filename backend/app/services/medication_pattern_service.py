"""Medication pattern detection (Medication Management v2 step 4) — two deliberately separate,
correctly scoped signals, per the pattern-detection addendum. Never conflated:

  participant_reliability: all workers, one participant, 7-day window. Compliance-facing,
  audit-exportable, never names a worker.

  worker_coaching: one worker across their own caseload, compared against the org average,
  30-day window. Coaching-facing only — never surfaced in the Compliance Centre, never used
  as grounds for a compliance action on its own.

Known limitation: both rates are computed over *logged* administration rows. A scheduled dose
that nobody logged anything for at all (not even a "missed" entry) does not appear in either
denominator — there is no separate auto-detection job that inserts a "missed" row for a dose
that was never touched. That's a real gap (arguably the worst case for a participant
reliability signal specifically), but closing it means deriving the full theoretical
scheduled-dose count from each medication's schedule across the window, which is a
separate, larger piece of work than this pattern-detection pass — flagged here rather than
silently assumed away.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

PARTICIPANT_WINDOW_DAYS = 7
PARTICIPANT_RATE_THRESHOLD = 0.20
PARTICIPANT_MIN_SAMPLE_FOR_RATE = 5
PARTICIPANT_REFUSED_MISSED_THRESHOLD = 3
# Don't recompute for the same participant more than once within this cadence — the pass
# that calls this can run far more often than "daily" without flooding the table.
PARTICIPANT_RECALC_COOLDOWN = timedelta(hours=20)

WORKER_WINDOW_DAYS = 30
WORKER_MIN_SAMPLE = 20
WORKER_DEVIATION_THRESHOLD = 0.15
WORKER_RECALC_COOLDOWN = timedelta(days=6)

# The rate numerator per the addendum's own formula — refused/withheld are deliberately
# excluded from the percentage (they have their own absolute-count trigger for
# participant_reliability, and are outside scope entirely for worker_coaching).
RATE_OUTCOMES = {"given_late", "given_early", "missed"}


def _is_missing_schema(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg


def _latest_calculated_at(signal_type: str, scope_id: str) -> datetime | None:
    try:
        resp = (
            get_supabase_admin()
            .table("medication_pattern_signals")
            .select("calculated_at")
            .eq("signal_type", signal_type)
            .eq("scope_id", scope_id)
            .order("calculated_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_schema(exc):
            return None
        raise
    if not resp.data:
        return None
    raw = resp.data[0]["calculated_at"]
    return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))


def _insert_signal(record: dict[str, Any]) -> None:
    try:
        get_supabase_admin().table("medication_pattern_signals").insert(record).execute()
    except Exception as exc:
        if not _is_missing_schema(exc):
            logger.warning("Could not insert medication pattern signal: %s", exc)


def calculate_participant_reliability_flags(organization_id: str | None = None) -> int:
    """One row per participant with at least one administration in the trailing 7 days.
    Compliance-facing — never names or ranks a worker."""
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(days=PARTICIPANT_WINDOW_DAYS)

    query = (
        get_supabase_admin()
        .table("medication_administrations")
        .select("participant_id, medication_id, organization_id, outcome")
        .gte("administered_time", window_start.isoformat())
    )
    if organization_id:
        query = query.eq("organization_id", organization_id)
    try:
        rows = query.execute().data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return 0
        raise

    by_participant: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        pid = row.get("participant_id")
        if not pid:
            continue
        by_participant.setdefault(pid, []).append(row)

    created = 0
    for participant_id, admins in by_participant.items():
        last = _latest_calculated_at("participant_reliability", participant_id)
        if last and now - last < PARTICIPANT_RECALC_COOLDOWN:
            continue

        org_id = admins[0]["organization_id"]
        sample_size = len(admins)
        bad_count = sum(1 for a in admins if a.get("outcome") in RATE_OUTCOMES)
        rate = bad_count / sample_size if sample_size else 0.0

        triggered = False
        reasons: list[str] = []
        if sample_size >= PARTICIPANT_MIN_SAMPLE_FOR_RATE and rate > PARTICIPANT_RATE_THRESHOLD:
            triggered = True
            reasons.append(f"{rate:.0%} of {sample_size} scheduled administrations were late, early, or missed in the last {PARTICIPANT_WINDOW_DAYS} days.")

        # Per-medication refused/missed count — 3+ for the SAME medication, not participant-wide.
        by_medication: dict[str, int] = {}
        for a in admins:
            if a.get("outcome") in ("refused", "missed"):
                by_medication[a["medication_id"]] = by_medication.get(a["medication_id"], 0) + 1
        worst_medication_count = max(by_medication.values(), default=0)
        if worst_medication_count >= PARTICIPANT_REFUSED_MISSED_THRESHOLD:
            triggered = True
            reasons.append(f"{worst_medication_count} refused/missed doses for the same medication in the last {PARTICIPANT_WINDOW_DAYS} days.")

        _insert_signal({
            "id": str(uuid4()),
            "signal_type": "participant_reliability",
            "scope_id": participant_id,
            "organization_id": org_id,
            "window_start": window_start.isoformat(),
            "window_end": now.isoformat(),
            "rate_calculated": round(rate, 4),
            "sample_size": sample_size,
            "triggered": triggered,
            "trigger_reason": " ".join(reasons) if reasons else None,
        })
        created += 1
    return created


def calculate_worker_coaching_signals(organization_id: str | None = None) -> int:
    """One row per worker with >=20 administrations in the trailing 30 days, compared against
    their own organisation's average over the same window. Coaching-facing only."""
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(days=WORKER_WINDOW_DAYS)

    query = (
        get_supabase_admin()
        .table("medication_administrations")
        .select("administered_by, organization_id, outcome")
        .gte("administered_time", window_start.isoformat())
    )
    if organization_id:
        query = query.eq("organization_id", organization_id)
    try:
        rows = query.execute().data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return 0
        raise

    by_org: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        org = row.get("organization_id")
        if not org:
            continue
        by_org.setdefault(org, []).append(row)

    created = 0
    for org_id, org_admins in by_org.items():
        org_total = len(org_admins)
        org_bad = sum(1 for a in org_admins if a.get("outcome") in RATE_OUTCOMES)
        org_average_rate = org_bad / org_total if org_total else 0.0

        by_worker: dict[str, list[dict[str, Any]]] = {}
        for a in org_admins:
            worker_id = a.get("administered_by")
            if not worker_id:
                continue
            by_worker.setdefault(worker_id, []).append(a)

        for worker_id, admins in by_worker.items():
            sample_size = len(admins)
            if sample_size < WORKER_MIN_SAMPLE:
                continue  # no signal generated from too small a sample — not even a non-triggered row

            last = _latest_calculated_at("worker_coaching", worker_id)
            if last and now - last < WORKER_RECALC_COOLDOWN:
                continue

            bad_count = sum(1 for a in admins if a.get("outcome") in RATE_OUTCOMES)
            worker_rate = bad_count / sample_size
            deviation = worker_rate - org_average_rate
            triggered = deviation > WORKER_DEVIATION_THRESHOLD

            _insert_signal({
                "id": str(uuid4()),
                "signal_type": "worker_coaching",
                "scope_id": worker_id,
                "organization_id": org_id,
                "window_start": window_start.isoformat(),
                "window_end": now.isoformat(),
                "rate_calculated": round(worker_rate, 4),
                "comparison_rate": round(org_average_rate, 4),
                "deviation": round(deviation, 4),
                "sample_size": sample_size,
                "triggered": triggered,
                "trigger_reason": (
                    f"Medication administration timing this period was {deviation:.0%} points above the "
                    f"organisation average, across {sample_size} logged doses."
                ) if triggered else None,
            })
            created += 1
    return created


def list_participant_reliability_flags(organization_id: str, participant_id: str | None = None) -> list[dict[str, Any]]:
    """Latest signal per participant — Compliance Centre / audit-exportable view."""
    try:
        query = (
            get_supabase_admin()
            .table("medication_pattern_signals")
            .select("*")
            .eq("signal_type", "participant_reliability")
            .eq("organization_id", organization_id)
            .order("calculated_at", desc=True)
        )
        if participant_id:
            query = query.eq("scope_id", participant_id)
        rows = query.execute().data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise

    latest_by_participant: dict[str, dict[str, Any]] = {}
    for row in rows:
        pid = row["scope_id"]
        if pid not in latest_by_participant:
            latest_by_participant[pid] = row
    return list(latest_by_participant.values())


def get_worker_coaching_signal(organization_id: str, worker_id: str) -> dict[str, Any] | None:
    """Latest coaching signal for one worker — never exposed via the Compliance Centre."""
    try:
        resp = (
            get_supabase_admin()
            .table("medication_pattern_signals")
            .select("*")
            .eq("signal_type", "worker_coaching")
            .eq("organization_id", organization_id)
            .eq("scope_id", worker_id)
            .order("calculated_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_schema(exc):
            return None
        raise
    return resp.data[0] if resp.data else None


async def run_medication_pattern_pass() -> int:
    """Called from the unified notification scheduler pass. Cheap to call often — each
    calculation self-limits via the cooldown checks above, so calling it every scheduler
    tick just means signals go out sooner, not that the table gets flooded."""
    participant_count = calculate_participant_reliability_flags()
    worker_count = calculate_worker_coaching_signals()
    return participant_count + worker_count
