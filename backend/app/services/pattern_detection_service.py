"""
CARECLIQV2-34 — Cross-session risk pattern detection for coordinator alerts.

Weekly job analyses org-wide sessions and incidents to surface:
- Worker–participant avg compliance <70% over ≥4 sessions
- Participant incident escalation (3+ in 30d vs ≤1 in prior 30d)
- Repeated refused activity without documented de-escalation
"""

from __future__ import annotations

import logging
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

LOW_COMPLIANCE_THRESHOLD = 70.0
LOW_COMPLIANCE_MIN_SESSIONS = 4
INCIDENT_RECENT_MIN = 3
INCIDENT_PRIOR_MAX = 1
INCIDENT_WINDOW_DAYS = 30
REFUSED_MIN_SESSIONS = 2
REFUSED_LOOKBACK_DAYS = 90
DISMISS_SUPPRESS_DAYS = 90

REFUSED_RE = re.compile(
    r"\b(refused|refusal|declined to|would not participate|refused activity)\b",
    re.IGNORECASE,
)
DEESCALATION_RE = re.compile(
    r"(de-?escalat|calmed? down|redirected?|behaviou?r support|break offered|"
    r"co-?regulat|sensory break|quiet space|distraction technique)",
    re.IGNORECASE,
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        text = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _session_text(session: dict) -> str:
    parts = [
        session.get("compliance_input_text"),
        session.get("translated_english_note"),
        session.get("notes"),
        session.get("activities_performed"),
        session.get("participant_response"),
        session.get("outcomes"),
    ]
    return " ".join(str(p) for p in parts if p).strip()


def _worker_id(session: dict) -> Optional[str]:
    wid = (
        session.get("worker_id")
        or session.get("support_worker_id")
        or session.get("owner_user_id")
    )
    return str(wid) if wid else None


def _participant_id(session: dict) -> Optional[str]:
    pid = session.get("participant_id") or session.get("patient_id")
    return str(pid) if pid else None


def detect_low_compliance_pairs(
    sessions: list[dict],
    worker_names: dict[str, str],
    participant_names: dict[str, str],
) -> list[dict[str, Any]]:
    """Average compliance <70% over ≥4 scored sessions for a worker–participant pair."""
    buckets: dict[tuple[str, str], list[float]] = defaultdict(list)

    for session in sessions:
        score = session.get("compliance_score")
        if score is None:
            continue
        worker = _worker_id(session)
        participant = _participant_id(session)
        if not worker or not participant:
            continue
        buckets[(worker, participant)].append(float(score))

    patterns: list[dict[str, Any]] = []
    for (worker, participant), scores in buckets.items():
        if len(scores) < LOW_COMPLIANCE_MIN_SESSIONS:
            continue
        avg = sum(scores) / len(scores)
        if avg >= LOW_COMPLIANCE_THRESHOLD:
            continue
        worker_name = worker_names.get(worker, "Worker")
        participant_name = participant_names.get(participant, "Participant")
        patterns.append({
            "pattern_type": "low_compliance_pair",
            "severity": "high" if avg < 60 else "medium",
            "title": "Low compliance pattern detected",
            "message": (
                f"{worker_name}'s sessions for {participant_name} average {avg:.0f}% compliance "
                f"over {len(scores)} sessions — coaching review recommended."
            ),
            "worker_id": worker,
            "participant_id": participant,
            "metadata": {
                "average_compliance": round(avg, 1),
                "session_count": len(scores),
                "worker_name": worker_name,
                "participant_name": participant_name,
            },
        })
    return patterns


def detect_incident_escalation(
    incidents: list[dict],
    participant_names: dict[str, str],
    *,
    now: Optional[datetime] = None,
) -> list[dict[str, Any]]:
    """3+ incidents in last 30 days vs ≤1 in the prior 30 days."""
    now = now or _utc_now()
    recent_start = now - timedelta(days=INCIDENT_WINDOW_DAYS)
    prior_start = now - timedelta(days=INCIDENT_WINDOW_DAYS * 2)

    recent: dict[str, int] = defaultdict(int)
    prior: dict[str, int] = defaultdict(int)

    for incident in incidents:
        pid = incident.get("participant_id")
        if not pid:
            continue
        pid = str(pid)
        dt = _parse_ts(incident.get("incident_date") or incident.get("reported_date"))
        if not dt:
            continue
        if dt >= recent_start:
            recent[pid] += 1
        elif prior_start <= dt < recent_start:
            prior[pid] += 1

    patterns: list[dict[str, Any]] = []
    for pid, recent_count in recent.items():
        if recent_count < INCIDENT_RECENT_MIN:
            continue
        if prior.get(pid, 0) > INCIDENT_PRIOR_MAX:
            continue
        participant_name = participant_names.get(pid, "Participant")
        patterns.append({
            "pattern_type": "incident_escalation",
            "severity": "high",
            "title": "Incident frequency escalation",
            "message": (
                f"{participant_name} has {recent_count} incidents in the last 30 days "
                f"(up from {prior.get(pid, 0)} in the prior 30 days) — coordinator escalation recommended."
            ),
            "worker_id": None,
            "participant_id": pid,
            "metadata": {
                "recent_incidents": recent_count,
                "prior_incidents": prior.get(pid, 0),
                "participant_name": participant_name,
            },
        })
    return patterns


def detect_refused_activity_without_deescalation(
    sessions: list[dict],
    participant_names: dict[str, str],
    *,
    now: Optional[datetime] = None,
) -> list[dict[str, Any]]:
    """Repeated refused-activity notes without de-escalation documentation."""
    now = now or _utc_now()
    cutoff = now - timedelta(days=REFUSED_LOOKBACK_DAYS)
    hits: dict[str, list[str]] = defaultdict(list)

    for session in sessions:
        participant = _participant_id(session)
        if not participant:
            continue
        dt = _parse_ts(session.get("session_date") or session.get("created_at"))
        if dt and dt < cutoff:
            continue
        text = _session_text(session)
        if not text or not REFUSED_RE.search(text):
            continue
        if DEESCALATION_RE.search(text):
            continue
        hits[participant].append(str(session.get("id") or ""))

    patterns: list[dict[str, Any]] = []
    for participant, session_ids in hits.items():
        session_ids = [sid for sid in session_ids if sid]
        if len(session_ids) < REFUSED_MIN_SESSIONS:
            continue
        participant_name = participant_names.get(participant, "Participant")
        patterns.append({
            "pattern_type": "refused_activity_no_deescalation",
            "severity": "medium",
            "title": "Refused activity without de-escalation",
            "message": (
                f"{participant_name} has {len(session_ids)} recent sessions documenting refused "
                "activity without de-escalation — behaviour support plan review recommended."
            ),
            "worker_id": None,
            "participant_id": participant,
            "metadata": {
                "session_ids": session_ids[:10],
                "session_count": len(session_ids),
                "participant_name": participant_name,
            },
        })
    return patterns


def _fingerprint(pattern: dict[str, Any]) -> str:
    return "|".join([
        pattern.get("pattern_type", ""),
        str(pattern.get("worker_id") or ""),
        str(pattern.get("participant_id") or ""),
    ])


def _load_name_maps(
    org_id: str,
    worker_ids: set[str],
    participant_ids: set[str],
) -> tuple[dict[str, str], dict[str, str]]:
    supabase = get_supabase_admin()
    worker_names: dict[str, str] = {}
    participant_names: dict[str, str] = {}

    if worker_ids:
        try:
            resp = (
                supabase.table("users")
                .select("id, full_name")
                .in_("id", list(worker_ids))
                .execute()
            )
            for row in resp.data or []:
                worker_names[str(row["id"])] = row.get("full_name") or "Worker"
        except Exception as exc:
            logger.warning("Could not load worker names for pattern detection: %s", exc)

    if participant_ids:
        try:
            resp = (
                supabase.table("patients")
                .select("id, full_name")
                .eq("organization_id", org_id)
                .in_("id", list(participant_ids))
                .execute()
            )
            for row in resp.data or []:
                participant_names[str(row["id"])] = row.get("full_name") or "Participant"
        except Exception as exc:
            logger.warning("Could not load participant names for pattern detection: %s", exc)

    return worker_names, participant_names


def _fetch_org_sessions(org_id: str) -> list[dict]:
    supabase = get_supabase_admin()
    try:
        resp = (
            supabase.table("sessions")
            .select(
                "id, patient_id, worker_id, support_worker_id, owner_user_id, "
                "compliance_score, session_date, created_at, notes, "
                "compliance_input_text, translated_english_note, "
                "activities_performed, participant_response, outcomes"
            )
            .eq("organization_id", org_id)
            .order("session_date", desc=True)
            .limit(2000)
            .execute()
        )
        rows = resp.data or []
        for row in rows:
            row["participant_id"] = row.get("patient_id")
        return rows
    except Exception as exc:
        logger.warning("Could not load sessions for pattern detection: %s", exc)
        return []


def _fetch_org_incidents(org_id: str) -> list[dict]:
    supabase = get_supabase_admin()
    try:
        resp = (
            supabase.table("incidents")
            .select("id, participant_id, incident_date, reported_date")
            .eq("organization_id", org_id)
            .order("incident_date", desc=True)
            .limit(1000)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        logger.warning("Could not load incidents for pattern detection: %s", exc)
        return []


def _recently_dismissed_fingerprints(org_id: str) -> set[str]:
    supabase = get_supabase_admin()
    cutoff = (_utc_now() - timedelta(days=DISMISS_SUPPRESS_DAYS)).isoformat()
    try:
        resp = (
            supabase.table("ai_detected_patterns")
            .select("pattern_type, worker_id, participant_id")
            .eq("organization_id", org_id)
            .not_.is_("dismissed_at", "null")
            .gte("dismissed_at", cutoff)
            .execute()
        )
        return {
            "|".join([
                row.get("pattern_type", ""),
                str(row.get("worker_id") or ""),
                str(row.get("participant_id") or ""),
            ])
            for row in (resp.data or [])
        }
    except Exception as exc:
        if "does not exist" in str(exc).lower() or "pgrst" in str(exc).lower():
            return set()
        logger.warning("Could not load dismissed patterns: %s", exc)
        return set()


def _upsert_patterns(org_id: str, detected: list[dict[str, Any]]) -> int:
    if not detected:
        return 0

    supabase = get_supabase_admin()
    dismissed = _recently_dismissed_fingerprints(org_id)
    created = 0
    now_iso = _utc_now().isoformat()

    for pattern in detected:
        fp = _fingerprint(pattern)
        if fp in dismissed:
            continue

        try:
            query = (
                supabase.table("ai_detected_patterns")
                .select("id")
                .eq("organization_id", org_id)
                .eq("pattern_type", pattern["pattern_type"])
                .is_("dismissed_at", "null")
            )
            worker_id = pattern.get("worker_id")
            participant_id = pattern.get("participant_id")
            if worker_id:
                query = query.eq("worker_id", worker_id)
            else:
                query = query.is_("worker_id", "null")
            if participant_id:
                query = query.eq("participant_id", participant_id)
            else:
                query = query.is_("participant_id", "null")
            existing = query.limit(1).execute()
            row = {
                "organization_id": org_id,
                "pattern_type": pattern["pattern_type"],
                "severity": pattern.get("severity", "medium"),
                "title": pattern["title"],
                "message": pattern["message"],
                "worker_id": pattern.get("worker_id"),
                "participant_id": pattern.get("participant_id"),
                "metadata": pattern.get("metadata") or {},
                "detected_at": now_iso,
                "updated_at": now_iso,
            }
            if existing.data:
                supabase.table("ai_detected_patterns").update(row).eq("id", existing.data[0]["id"]).execute()
            else:
                supabase.table("ai_detected_patterns").insert(row).execute()
                created += 1
        except Exception as exc:
            logger.warning("Failed to upsert pattern %s: %s", fp, exc)

    return created


def run_pattern_detection_for_org(org_id: str) -> dict[str, Any]:
    """Detect and persist patterns for a single organisation."""
    sessions = _fetch_org_sessions(org_id)
    incidents = _fetch_org_incidents(org_id)

    worker_ids = {wid for s in sessions if (wid := _worker_id(s))}
    participant_ids = {
        pid for s in sessions if (pid := _participant_id(s))
    } | {str(i.get("participant_id")) for i in incidents if i.get("participant_id")}

    worker_names, participant_names = _load_name_maps(org_id, worker_ids, participant_ids)

    detected: list[dict[str, Any]] = []
    detected.extend(detect_low_compliance_pairs(sessions, worker_names, participant_names))
    detected.extend(detect_incident_escalation(incidents, participant_names))
    detected.extend(detect_refused_activity_without_deescalation(sessions, participant_names))

    created = _upsert_patterns(org_id, detected)
    return {
        "organization_id": org_id,
        "detected": len(detected),
        "created": created,
        "patterns": detected,
    }


def run_pattern_detection_all_orgs() -> dict[str, Any]:
    """Run detection for every organisation (weekly cron entry point)."""
    supabase = get_supabase_admin()
    try:
        resp = supabase.table("organizations").select("id").execute()
        org_ids = [str(row["id"]) for row in (resp.data or []) if row.get("id")]
    except Exception as exc:
        logger.error("Failed to list organisations for pattern detection: %s", exc)
        return {"organizations": 0, "results": []}

    results = [run_pattern_detection_for_org(org_id) for org_id in org_ids]
    return {
        "organizations": len(org_ids),
        "results": results,
        "total_detected": sum(r["detected"] for r in results),
        "total_created": sum(r["created"] for r in results),
    }


def get_active_patterns(org_id: str, limit: int = 50) -> list[dict[str, Any]]:
    """Return non-dismissed patterns for coordinator dashboard."""
    supabase = get_supabase_admin()
    try:
        resp = (
            supabase.table("ai_detected_patterns")
            .select("*")
            .eq("organization_id", org_id)
            .is_("dismissed_at", "null")
            .order("detected_at", desc=True)
            .limit(limit)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if "does not exist" in str(exc).lower() or "pgrst" in str(exc).lower():
            return []
        raise


def dismiss_pattern(pattern_id: str, org_id: str, user_id: str) -> Optional[dict[str, Any]]:
    """Dismiss a pattern alert (coordinator action)."""
    supabase = get_supabase_admin()
    now_iso = _utc_now().isoformat()
    try:
        resp = (
            supabase.table("ai_detected_patterns")
            .update({
                "dismissed_at": now_iso,
                "dismissed_by": user_id,
                "updated_at": now_iso,
            })
            .eq("id", pattern_id)
            .eq("organization_id", org_id)
            .is_("dismissed_at", "null")
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None
    except Exception as exc:
        logger.warning("Failed to dismiss pattern %s: %s", pattern_id, exc)
        return None
