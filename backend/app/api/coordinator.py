from __future__ import annotations

import json
from datetime import date
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status

from ..core.access import get_user_organization_id, is_coordinator_role
from ..core.security import get_current_user
from ..services import participant_service, session_service
from ..services.supabase_client import get_supabase_admin


router = APIRouter(prefix="/coordinator", tags=["coordinator"])


def _require_coordinator(user: dict) -> str:
    if not is_coordinator_role(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Support coordinator access required.")
    org_id = get_user_organization_id(user)
    if not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required.")
    return org_id


def _date_part(value: Any) -> str:
    return str(value or "")[:10]


def _score_status(score: Any) -> str:
    if score is None:
        return "draft"
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


def _session_payload(session: dict) -> dict:
    participant = session.get("participants") or {}
    return {
        "id": session.get("id"),
        "participant_id": session.get("participant_id") or session.get("patient_id"),
        "participant_name": participant.get("full_name") or session.get("participant_name"),
        "worker_id": session.get("worker_id") or session.get("support_worker_id") or session.get("owner_user_id"),
        "practitioner_id": session.get("practitioner_id") or session.get("allied_health_id"),
        "session_date": session.get("session_date"),
        "session_type": session.get("session_type"),
        "duration_minutes": session.get("duration_minutes"),
        "status": session.get("status"),
        "compliance_score": session.get("compliance_score"),
        "compliance_status": _score_status(session.get("compliance_score")),
        "translation_status": session.get("translation_status"),
    }


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
        return isinstance(rules, dict) and bool(rules.get("rp_flags"))
    return False


def _rp_payload(session: dict) -> list[dict]:
    flags = _safe_json(session.get("compliance_flags"))
    insights = _safe_json(session.get("ai_insights"))
    candidates = []
    if isinstance(flags, dict):
        candidates.extend(flags.get("rp_flags") or [])
    if isinstance(insights, dict):
        candidates.extend(insights.get("rp_flags") or [])
        rules = insights.get("rules_result") or {}
        if isinstance(rules, dict):
            candidates.extend(rules.get("rp_flags") or [])
    if not candidates and session.get("restrictive_practice_detected"):
        candidates.append({"category": "restrictive_practice", "severity": "review"})
    return [
        {
            "session_id": session.get("id"),
            "participant_id": session.get("participant_id") or session.get("patient_id"),
            "participant_name": (session.get("participants") or {}).get("full_name"),
            "session_date": session.get("session_date"),
            "category": flag.get("category") if isinstance(flag, dict) else "restrictive_practice",
            "severity": flag.get("severity") if isinstance(flag, dict) else "review",
            "phrase": flag.get("phrase") if isinstance(flag, dict) else None,
            "suggestion": flag.get("suggestion") if isinstance(flag, dict) else None,
        }
        for flag in candidates
    ]


async def _team(org_id: str) -> list[dict]:
    supabase = get_supabase_admin()
    try:
        memberships = (
            supabase.table("organization_members")
            .select("user_id, role, is_active, joined_at")
            .eq("organization_id", org_id)
            .execute()
        )
    except Exception:
        return await _team_fallback(org_id)

    rows = [row for row in memberships.data or [] if isinstance(row, dict)]
    if not rows:
        return await _team_fallback(org_id)

    user_ids = [row.get("user_id") for row in rows if row.get("user_id")]
    profiles_by_id: dict[str, dict] = {}
    if user_ids:
        try:
            profiles = (
                supabase.table("users")
                .select("id, email, full_name, role, is_active, last_login, organization_id")
                .in_("id", user_ids)
                .eq("organization_id", org_id)
                .execute()
            )
            profiles_by_id = {
                str(row.get("id")): row
                for row in profiles.data or []
                if isinstance(row, dict) and row.get("id")
            }
        except Exception:
            profiles_by_id = {}

    output = []
    for row in rows:
        profile = profiles_by_id.get(str(row.get("user_id")), {})
        output.append({
            "id": row.get("user_id"),
            "full_name": profile.get("full_name") or profile.get("email") or "Team member",
            "email": profile.get("email"),
            "role": row.get("role") or profile.get("role"),
            "is_active": bool(row.get("is_active")),
            "joined_at": row.get("joined_at"),
            "last_login": profile.get("last_login"),
        })
    return output


async def _team_fallback(org_id: str) -> list[dict]:
    supabase = get_supabase_admin()
    try:
        profiles = (
            supabase.table("users")
            .select("id, email, full_name, role, is_active, last_login, organization_id")
            .eq("organization_id", org_id)
            .in_("role", ["support_worker", "allied_health", "support_coordinator"])
            .execute()
        )
    except Exception:
        return []

    output = []
    for row in profiles.data or []:
        if not isinstance(row, dict) or not row.get("id"):
            continue
        output.append({
            "id": row.get("id"),
            "full_name": row.get("full_name") or row.get("email") or "Team member",
            "email": row.get("email"),
            "role": row.get("role"),
            "is_active": bool(row.get("is_active")),
            "joined_at": None,
            "last_login": row.get("last_login"),
        })
    return output


@router.get("/team")
async def team(current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    return await _team(org_id)


@router.get("/all-sessions")
async def all_sessions(limit: int = 500, current_user: dict = Depends(get_current_user)):
    _require_coordinator(current_user)
    sessions = await session_service.get_all_sessions(limit, current_user)
    return [_session_payload(session) for session in sessions]


@router.get("/compliance-overview")
async def compliance_overview(current_user: dict = Depends(get_current_user)):
    _require_coordinator(current_user)
    sessions = await session_service.get_compliance_report(current_user)
    scores = [float(s["compliance_score"]) for s in sessions if s.get("compliance_score") is not None]
    average = round(sum(scores) / len(scores), 1) if scores else 0
    return {
        "average_score": average,
        "total_sessions": len(sessions),
        "compliant": sum(1 for score in scores if score >= 85),
        "at_risk": sum(1 for score in scores if 60 <= score < 85),
        "non_compliant": sum(1 for score in scores if score < 60),
        "sessions": [_session_payload(session) for session in sessions],
    }


@router.get("/rp-flags")
async def rp_flags(current_user: dict = Depends(get_current_user)):
    _require_coordinator(current_user)
    sessions = await session_service.get_all_sessions(1000, current_user)
    flags: list[dict] = []
    for session in sessions:
        if _has_rp_flag(session):
            flags.extend(_rp_payload(session))
    return flags


@router.get("/credential-alerts")
async def credential_alerts(current_user: dict = Depends(get_current_user)):
    _require_coordinator(current_user)
    return {
        "generated_at": date.today().isoformat(),
        "alerts": [],
    }
