from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from ..core.access import (
    get_user_id,
    get_user_organization_id,
    is_coordinator_role,
    is_support_worker,
)
from ..core.security import get_current_user
from ..services import participant_service, session_service
from ..services.supabase_client import get_supabase_admin


router = APIRouter(prefix="/dashboard", tags=["dashboards"])


def _today_iso() -> str:
    return date.today().isoformat()


def _date_part(value: Any) -> str:
    if not value:
        return ""
    text = str(value)
    return text[:10]


def _score_status(score: Any) -> str:
    if score is None:
        return "at_risk"
    value = float(score)
    if value >= 85:
        return "compliant"
    if value >= 60:
        return "at_risk"
    return "non_compliant"


def _safe_json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return {}
    return value if value is not None else {}


def _participant_name(session: dict) -> str:
    participant = session.get("participants") or {}
    return participant.get("full_name") or session.get("participant_name") or "Participant"


def _client_payload(participant: dict, sessions: list[dict]) -> dict:
    latest_session = sessions[0] if sessions else None
    scores = [float(s["compliance_score"]) for s in sessions if s.get("compliance_score") is not None]
    lowest_score = min(scores) if scores else None
    return {
        "id": participant.get("id"),
        "full_name": participant.get("full_name"),
        "ndis_number": participant.get("ndis_number"),
        "plan_status": participant.get("plan_status"),
        "plan_management_type": (
            participant.get("plan_management_type")
            or participant.get("plan_management")
            or participant.get("plan_status")
            or "Not recorded"
        ),
        "last_seen": latest_session.get("session_date") if latest_session else None,
        "compliance_status": _score_status(lowest_score) if lowest_score is not None else "at_risk",
        "compliance_score": round(lowest_score, 1) if lowest_score is not None else None,
    }


def _session_summary(session: dict) -> dict:
    return {
        "id": session.get("id"),
        "participant_id": session.get("participant_id") or session.get("patient_id"),
        "participant_name": _participant_name(session),
        "session_date": session.get("session_date"),
        "session_type": session.get("session_type"),
        "duration_minutes": session.get("duration_minutes"),
        "status": session.get("status"),
        "compliance_score": session.get("compliance_score"),
        "compliance_status": _score_status(session.get("compliance_score")),
    }


def _needs_compliance_fix(session: dict) -> bool:
    score = session.get("compliance_score")
    translation_status = session.get("translation_status")
    if translation_status in {"failed", "pending", "unsupported"}:
        return True
    if score is not None and float(score) < 85:
        return True
    notes = session.get("compliance_input_text") or session.get("translated_english_note") or session.get("notes") or ""
    return len(str(notes).strip()) < 20


def _has_rp_flag(session: dict) -> bool:
    if session.get("restrictive_practice_detected") is True:
        return True
    flags = _safe_json(session.get("compliance_flags"))
    insights = _safe_json(session.get("ai_insights"))
    if isinstance(flags, dict) and flags.get("rp_flags"):
        return True
    if isinstance(insights, dict):
        if insights.get("rp_flags"):
            return True
        rules = insights.get("rules_result") or {}
        if isinstance(rules, dict) and rules.get("rp_flags"):
            return True
    return False


def _common_issues(sessions: list[dict], limit: int = 5) -> list[dict]:
    counter: Counter[str] = Counter()
    for session in sessions:
        insights = _safe_json(session.get("ai_insights"))
        if isinstance(insights, dict):
            rules = insights.get("rules_result") or {}
            failed_rules = rules.get("failed_rules") if isinstance(rules, dict) else []
            for rule in failed_rules or []:
                if isinstance(rule, dict):
                    label = rule.get("message") or rule.get("rule") or rule.get("id")
                else:
                    label = str(rule)
                if label:
                    counter[str(label).strip()] += 1
            for item in insights.get("ai_recommendations") or []:
                if item:
                    counter[str(item).strip()] += 1
        notes = session.get("compliance_notes")
        if isinstance(notes, str) and notes.strip():
            for part in notes.split("|"):
                label = part.strip()
                if label:
                    counter[label] += 1

    return [{"issue": issue, "count": count} for issue, count in counter.most_common(limit)]


def _average_score(sessions: list[dict]) -> int:
    scores = [float(s["compliance_score"]) for s in sessions if s.get("compliance_score") is not None]
    if not scores:
        return 0
    return round(sum(scores) / len(scores))


async def _team_members(org_id: str) -> list[dict]:
    supabase = get_supabase_admin()
    try:
        memberships = (
            supabase.table("organization_members")
            .select("user_id, role, is_active, joined_at")
            .eq("organization_id", org_id)
            .eq("is_active", True)
            .execute()
        )
    except Exception:
        return []

    rows = [row for row in memberships.data or [] if isinstance(row, dict)]
    user_ids = [row.get("user_id") for row in rows if row.get("user_id")]
    profiles_by_id: dict[str, dict] = {}
    if user_ids:
        try:
            profiles = (
                supabase.table("users")
                .select("id, email, full_name, role, is_active, last_login, organization_id")
                .in_("id", user_ids)
                .execute()
            )
            profiles_by_id = {
                str(profile.get("id")): profile
                for profile in profiles.data or []
                if isinstance(profile, dict) and profile.get("id")
            }
        except Exception:
            profiles_by_id = {}

    output: list[dict] = []
    for row in rows:
        profile = profiles_by_id.get(str(row.get("user_id")), {})
        output.append({
            "id": row.get("user_id"),
            "role": row.get("role") or profile.get("role"),
            "full_name": profile.get("full_name") or profile.get("email") or "Team member",
            "email": profile.get("email"),
            "is_active": bool(row.get("is_active")),
            "joined_at": row.get("joined_at"),
            "last_login": profile.get("last_login"),
        })
    return output


@router.get("/worker")
async def worker_dashboard(current_user: dict = Depends(get_current_user)):
    if not is_support_worker(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Worker dashboard access required.")

    participants = await participant_service.get_all_participants(current_user)
    sessions = await session_service.get_all_sessions(500, current_user)
    sessions_by_participant: dict[str, list[dict]] = defaultdict(list)
    for session in sessions:
        participant_id = str(session.get("participant_id") or session.get("patient_id") or "")
        if participant_id:
            sessions_by_participant[participant_id].append(session)

    assigned_clients = [
        _client_payload(participant, sessions_by_participant.get(str(participant.get("id")), []))
        for participant in participants
    ]
    today = _today_iso()
    sessions_today = [s for s in sessions if _date_part(s.get("session_date")) == today]
    today_client_ids = {str(s.get("participant_id") or s.get("patient_id")) for s in sessions_today}
    today_clients = [client for client in assigned_clients if str(client.get("id")) in today_client_ids]
    incomplete_sessions = [
        _session_summary(s)
        for s in sessions
        if s.get("status") not in {"completed", "cancelled"}
    ]
    pending_fixes = [_session_summary(s) for s in sessions if _needs_compliance_fix(s)]
    notes_due = sum(1 for s in sessions if s.get("status") == "draft" or _needs_compliance_fix(s))
    compliance_score = _average_score(sessions)

    return {
        "sessions_today": len(sessions_today),
        "notes_due": notes_due,
        "compliance_score": compliance_score,
        "compliance_status": _score_status(compliance_score),
        "assigned_clients": assigned_clients,
        "today_clients": today_clients,
        "credential_alerts": [],
        "pending_compliance_fixes": pending_fixes[:12],
        "incomplete_sessions": incomplete_sessions[:12],
    }


@router.get("/coordinator")
async def coordinator_dashboard(current_user: dict = Depends(get_current_user)):
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Support coordinator access required.")
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required.")

    participants = await participant_service.get_all_participants(current_user)
    sessions = await session_service.get_all_sessions(1000, current_user)
    today = _today_iso()
    todays_sessions = [s for s in sessions if _date_part(s.get("session_date")) == today]
    scored_today = [s for s in todays_sessions if s.get("compliance_score") is not None]
    compliant_today = sum(1 for s in scored_today if float(s.get("compliance_score")) >= 85)
    notes_at_risk = sum(1 for s in sessions if _needs_compliance_fix(s))
    rp_flags = sum(1 for s in sessions if _has_rp_flag(s))
    team_compliance_breakdown = {
        "compliant": 0,
        "at_risk": 0,
        "non_compliant": 0,
    }
    for session in sessions:
        status_key = _score_status(session.get("compliance_score"))
        team_compliance_breakdown[status_key] = team_compliance_breakdown.get(status_key, 0) + 1
    team = await _team_members(org_id)
    active_workers = [m for m in team if m.get("role") == "support_worker" and m.get("is_active")]

    worker_scores: dict[str, list[float]] = defaultdict(list)
    worker_sessions: dict[str, int] = defaultdict(int)
    for session in sessions:
        worker_id = session.get("worker_id") or session.get("support_worker_id") or session.get("owner_user_id")
        if not worker_id:
            continue
        worker_sessions[str(worker_id)] += 1
        if session.get("compliance_score") is not None:
            worker_scores[str(worker_id)].append(float(session["compliance_score"]))

    worker_names = {str(m.get("id")): m for m in team}
    workers_needing_attention = []
    for worker_id, count in worker_sessions.items():
        scores = worker_scores.get(worker_id, [])
        avg = round(sum(scores) / len(scores)) if scores else 0
        low_score = scores and avg < 85
        missing_notes = any(
            str(s.get("worker_id") or s.get("support_worker_id") or s.get("owner_user_id")) == worker_id
            and _needs_compliance_fix(s)
            for s in sessions
        )
        if low_score or missing_notes:
            worker = worker_names.get(worker_id, {})
            workers_needing_attention.append({
                "id": worker_id,
                "full_name": worker.get("full_name") or "Worker",
                "email": worker.get("email"),
                "compliance_score": avg,
                "sessions": count,
                "reason": "Compliance review required" if low_score else "Notes need attention",
            })

    return {
        "active_workers": len(active_workers),
        "compliant_today": compliant_today,
        "notes_at_risk": notes_at_risk,
        "rp_flags": rp_flags,
        "team_compliance_score": _average_score(sessions),
        "team_compliance_breakdown": team_compliance_breakdown,
        "workers_needing_attention": workers_needing_attention[:12],
        "todays_sessions": [_session_summary(s) for s in todays_sessions[:20]],
        "common_issues": _common_issues(sessions),
        "credential_alerts": [],
        "incident_alerts": [],
        "participants": len(participants),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
