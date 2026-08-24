from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import date, datetime, timezone, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from ..core.access import (
    get_coordinator_team_ids,
    get_user_id,
    get_user_organization_id,
    is_coordinator_role,
    is_managing_director,
    is_support_worker,
)
from ..core.security import get_current_user
from ..models.billing_period import normalize_plan_management_type, plan_management_type_label
from ..services import billing_service, incident_service, participant_service, session_service
from ..services.dashboard_landing_service import build_worker_landing_dashboard
from ..services.travel_time_service import estimate_travel_time
from ..services import shift_service
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


def _row_id_set(row: dict, *fields: str) -> set[str]:
    values: set[str] = set()
    for field in fields:
        raw = row.get(field)
        if isinstance(raw, (list, tuple, set)):
            for item in raw:
                if item is not None and str(item).strip():
                    values.add(str(item).strip())
        elif raw is not None and str(raw).strip():
            values.add(str(raw).strip())
    return values


def _filter_participants_by_worker_ids(participants: list[dict], worker_ids: set[str]) -> list[dict]:
    if not worker_ids:
        return []
    return [
        participant
        for participant in participants
        if _row_id_set(
            participant,
            "assigned_worker_id",
            "support_worker_id",
            "owner_user_id",
            "created_by",
            "_support_assignment_user_ids",
            "_assignment_user_ids",
            "_assigned_user_ids",
        ) & worker_ids
    ]


def _filter_sessions_by_worker_ids(sessions: list[dict], worker_ids: set[str]) -> list[dict]:
    if not worker_ids:
        return []
    return [
        session
        for session in sessions
        if _row_id_set(
            session,
            "worker_id",
            "support_worker_id",
            "owner_user_id",
            "created_by",
            "user_id",
        ) & worker_ids
    ]


async def _team_members(org_id: str, scoped_user_ids: set[str] | None = None) -> list[dict]:
    supabase = get_supabase_admin()
    try:
        memberships = (
            supabase.table("organization_members")
            .select("user_id, role, is_active, joined_at")
            .eq("organization_id", org_id)
            .eq("is_active", "true")
            .execute()
        )
    except Exception:
        return []

    rows = [row for row in memberships.data or [] if isinstance(row, dict)]
    if scoped_user_ids is not None:
        rows = [row for row in rows if str(row.get("user_id") or "") in scoped_user_ids]
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

    participants = await participant_service.get_participants_list_light(current_user)
    sessions = await session_service.get_sessions_for_dashboard(200, current_user)
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


@router.get("/worker-landing")
async def worker_landing_dashboard(current_user: dict = Depends(get_current_user)):
    """Aggregated support worker landing page payload (CARECLIQV2-104)."""
    if not is_support_worker(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Worker dashboard access required.")
    return await build_worker_landing_dashboard(current_user)


@router.get("/worker-landing/travel-time")
async def worker_landing_travel_time(
    shift_id: str,
    origin_lat: float | None = None,
    origin_lng: float | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Travel time estimate for the worker's next shift destination (CARECLIQV2-114)."""
    if not is_support_worker(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Worker dashboard access required.")

    worker_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    if not worker_id or not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required.")

    shift = shift_service.get_shift_detail_for_worker(shift_id, worker_id, org_id)
    if not shift:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")

    address = (shift.get("participant_address") or "").strip()
    travel = await estimate_travel_time(
        address,
        origin_lat=origin_lat,
        origin_lng=origin_lng,
    )
    return {
        "shift_id": shift_id,
        "destination_address": address or None,
        **travel,
    }


@router.get("/coordinator")
async def coordinator_dashboard(current_user: dict = Depends(get_current_user)):
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Support coordinator access required.")
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required.")

    participants = await participant_service.get_participants_list_light(current_user)
    sessions = await session_service.get_sessions_for_dashboard(400, current_user)
    supabase = get_supabase_admin()
    team_worker_ids = set(get_coordinator_team_ids(current_user, supabase))
    participants = _filter_participants_by_worker_ids(participants, team_worker_ids)
    sessions = _filter_sessions_by_worker_ids(sessions, team_worker_ids)
    team_participant_ids = {
        str(participant.get("id"))
        for participant in participants
        if participant.get("id")
    }
    today = _today_iso()
    week_ago = (date.today() - timedelta(days=7)).isoformat()
    month_start = date.today().replace(day=1).isoformat()
    todays_sessions = [s for s in sessions if _date_part(s.get("session_date")) == today]
    sessions_this_week = [s for s in sessions if _date_part(s.get("session_date")) >= week_ago]
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
    team = await _team_members(org_id, team_worker_ids)
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

    try:
        incident_rows = await incident_service.get_all_incidents(1000, org_id=org_id, current_user=current_user)
        incidents_this_month = [
            row for row in incident_rows
            if _date_part(row.get("incident_date")) >= month_start
            and str(row.get("participant_id") or "") in team_participant_ids
        ]
    except Exception:
        incidents_this_month = []

    return {
        "active_workers": len(active_workers),
        "compliant_today": compliant_today,
        "notes_at_risk": notes_at_risk,
        "rp_flags": rp_flags,
        "team_participants": len(participants),
        "sessions_this_week": len(sessions_this_week),
        "incidents_this_month": len(incidents_this_month),
        "workers_needing_support": len(workers_needing_attention),
        "team_compliance_score": _average_score(sessions),
        "team_compliance_breakdown": team_compliance_breakdown,
        "workers_needing_attention": workers_needing_attention[:12],
        "todays_sessions": [_session_summary(s) for s in todays_sessions[:20]],
        "common_issues": _common_issues(sessions),
        "credential_alerts": [],
        "incident_alerts": [
            {
                "id": row.get("id"),
                "participant_name": row.get("participant_name"),
                "incident_date": row.get("incident_date"),
                "severity": row.get("severity"),
                "status": row.get("status"),
                "title": row.get("title"),
            }
            for row in incidents_this_month[:12]
        ],
        "participants": len(participants),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def _goal_achievement_rate(participants: list[dict]) -> float:
    """Derive goal achievement rate from participant plan status fields."""
    if not participants:
        return 0.0
    achieved = sum(
        1 for p in participants
        if p.get("plan_status") == "active"
    )
    return round((achieved / len(participants)) * 100, 1)


def _retention_rate(team: list[dict]) -> float:
    """Simplified retention rate: percentage of members still active."""
    if not team:
        return 100.0
    active = sum(1 for m in team if m.get("is_active"))
    return round((active / len(team)) * 100, 1)


@router.get("/managing-director")
async def md_dashboard(current_user: dict = Depends(get_current_user)):
    """Executive dashboard aggregate for managing_director role."""
    if not is_managing_director(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Managing Director access required.")
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required.")

    participants = await participant_service.get_participants_list_light(current_user)
    sessions = await session_service.get_sessions_for_dashboard(400, current_user)
    team = await _team_members(org_id)

    today = _today_iso()
    active_workers = [m for m in team if m.get("is_active")]
    support_workers = [m for m in active_workers if m.get("role") == "support_worker"]

    # Sessions this week
    from datetime import timedelta
    week_ago = (date.today() - timedelta(days=7)).isoformat()
    sessions_this_week = [s for s in sessions if _date_part(s.get("session_date")) >= week_ago]

    # Compliance
    compliance_score = _average_score(sessions)
    compliance_target = 90

    # Workers needing attention (derived from coordinator logic)
    worker_scores: dict[str, list[float]] = defaultdict(list)
    worker_sessions_count: dict[str, int] = defaultdict(int)
    for session in sessions:
        wid = session.get("worker_id") or session.get("support_worker_id") or session.get("owner_user_id")
        if not wid:
            continue
        worker_sessions_count[str(wid)] += 1
        if session.get("compliance_score") is not None:
            worker_scores[str(wid)].append(float(session["compliance_score"]))

    workers_at_risk = []
    worker_map = {str(m.get("id")): m for m in team}
    for wid, count in worker_sessions_count.items():
        scores = worker_scores.get(wid, [])
        avg = round(sum(scores) / len(scores)) if scores else 0
        if scores and avg < 85:
            worker_info = worker_map.get(wid, {})
            workers_at_risk.append({
                "id": wid,
                "full_name": worker_info.get("full_name") or "Worker",
                "compliance_score": avg,
                "sessions": count,
            })

    # Incidents this month only (sessions with RP flags within the current calendar month)
    current_month_prefix = today[:7]  # e.g. "2026-06"
    incidents_this_month = sum(
        1 for s in sessions
        if _has_rp_flag(s) and _date_part(s.get("session_date")).startswith(current_month_prefix)
    )

    # Goal achievement rate
    goal_rate = _goal_achievement_rate(participants)

    # Retention rate — query ALL org members (including inactive) for a correct denominator
    supabase = get_supabase_admin()
    try:
        all_members_result = (
            supabase.table("organization_members")
            .select("user_id, is_active", count="exact")
            .eq("organization_id", org_id)
            .execute()
        )
        total_member_count = all_members_result.count or len(all_members_result.data or [])
        inactive_count = sum(1 for m in (all_members_result.data or []) if not m.get("is_active"))
    except Exception:
        total_member_count = len(team)
        inactive_count = 0
    active_count = total_member_count - inactive_count
    retention_rate = round((active_count / total_member_count) * 100, 1) if total_member_count else 100.0

    # Revenue summary from billing service
    try:
        revenue_data = await billing_service.get_revenue_report(current_user)
        revenue_this_month_cents = 0
        if revenue_data.get("monthly"):
            for month_entry in revenue_data["monthly"]:
                if str(month_entry.get("month", "")).startswith(current_month_prefix):
                    revenue_this_month_cents = month_entry.get("billed", 0)
                    break
        revenue_summary = {
            "total_billed_cents": revenue_data.get("total_billed_cents", 0),
            "total_paid_cents": revenue_data.get("total_paid_cents", 0),
            "total_outstanding_cents": revenue_data.get("total_outstanding_cents", 0),
            "revenue_this_month_cents": revenue_this_month_cents,
            "invoice_count": revenue_data.get("invoice_count", 0),
        }
    except Exception:
        revenue_summary = {
            "total_billed_cents": 0,
            "total_paid_cents": 0,
            "total_outstanding_cents": 0,
            "revenue_this_month_cents": 0,
            "invoice_count": 0,
        }

    # Common issues
    common_issues = _common_issues(sessions)

    # Full staff directory — all active team members with per-worker compliance stats
    # Build participant-per-worker count from the participant list
    participant_count_by_worker: dict[str, int] = defaultdict(int)
    for participant in participants:
        wid = str(participant.get("assigned_worker_id") or participant.get("owner_user_id") or "")
        if wid:
            participant_count_by_worker[wid] += 1

    staff_directory = []
    for member in team:
        if not member.get("is_active"):
            continue
        mid = str(member.get("id") or "")
        scores = worker_scores.get(mid, [])
        avg_score = round(sum(scores) / len(scores)) if scores else 0
        session_count = worker_sessions_count.get(mid, 0)
        staff_directory.append({
            "id": mid,
            "full_name": member.get("full_name") or "Team Member",
            "email": member.get("email"),
            "role": member.get("role"),
            "compliance_score": avg_score,
            "sessions": session_count,
            "participant_count": participant_count_by_worker.get(mid, 0),
            "last_login": member.get("last_login"),
            "joined_at": member.get("joined_at"),
        })
    # Sort by compliance score descending
    staff_directory.sort(key=lambda x: x["compliance_score"], reverse=True)

    # Org alerts
    org_alerts = []
    if workers_at_risk:
        org_alerts.append({
            "type": "compliance",
            "severity": "high",
            "message": f"{len(workers_at_risk)} worker{'s' if len(workers_at_risk) > 1 else ''} below 85% compliance threshold",
        })
    if compliance_score < compliance_target:
        org_alerts.append({
            "type": "compliance",
            "severity": "medium",
            "message": f"Organisation compliance {compliance_score}% is below {compliance_target}% target",
        })
    notes_at_risk = sum(1 for s in sessions if _needs_compliance_fix(s))
    if notes_at_risk > 0:
        org_alerts.append({
            "type": "documentation",
            "severity": "medium",
            "message": f"{notes_at_risk} session note{'s' if notes_at_risk > 1 else ''} require attention",
        })
    if incidents_this_month > 0:
        org_alerts.append({
            "type": "incident",
            "severity": "high" if incidents_this_month >= 3 else "low",
            "message": f"{incidents_this_month} incident flag{'s' if incidents_this_month > 1 else ''} this month",
        })

    return {
        "active_participants": len(participants),
        "active_staff": len(active_workers),
        "support_workers": len(support_workers),
        "staff_retention_rate": retention_rate,
        "sessions_this_week": len(sessions_this_week),
        "compliance_score": compliance_score,
        "compliance_target": compliance_target,
        "incidents_this_month": incidents_this_month,
        "goal_achievement_rate": goal_rate,
        "workers_at_risk": workers_at_risk[:10],
        "workers_needing_attention": workers_at_risk[:10],
        "common_issues": common_issues,
        "org_alerts": org_alerts,
        "team_compliance_breakdown": {
            "compliant": sum(1 for s in sessions if _score_status(s.get("compliance_score")) == "compliant"),
            "at_risk": sum(1 for s in sessions if _score_status(s.get("compliance_score")) == "at_risk"),
            "non_compliant": sum(1 for s in sessions if _score_status(s.get("compliance_score")) == "non_compliant"),
        },
        "worker_rankings": sorted(
            [
                {
                    "id": wid,
                    "full_name": worker_map.get(wid, {}).get("full_name") or "Worker",
                    "compliance_score": round(sum(sc) / len(sc)) if sc else 0,
                    "sessions": worker_sessions_count.get(wid, 0),
                }
                for wid, sc in worker_scores.items()
                if sc
            ],
            key=lambda x: x["compliance_score"],
            reverse=True,
        )[:20],
        "revenue_summary": revenue_summary,
        "staff_directory": staff_directory,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/compliance-trend")
async def compliance_trend(current_user: dict = Depends(get_current_user)):
    """90-day compliance trend grouped by ISO week. Accessible to coordinator + MD."""
    if not (is_coordinator_role(current_user) or is_managing_director(current_user)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Coordinator or Managing Director access required.")

    sessions = await session_service.get_sessions_for_dashboard(800, current_user)

    from datetime import timedelta
    cutoff = (date.today() - timedelta(days=90)).isoformat()
    recent = [
        s for s in sessions
        if s.get("session_date") and _date_part(s.get("session_date")) >= cutoff
    ]

    # Group by ISO week
    week_data: dict[str, list[float]] = defaultdict(list)
    week_counts: dict[str, int] = defaultdict(int)
    for session in recent:
        raw_date = _date_part(session.get("session_date"))
        if not raw_date:
            continue
        try:
            d = date.fromisoformat(raw_date)
            week_key = f"{d.isocalendar()[0]}-W{d.isocalendar()[1]:02d}"
        except ValueError:
            continue
        week_counts[week_key] += 1
        if session.get("compliance_score") is not None:
            week_data[week_key].append(float(session["compliance_score"]))

    # Build sorted list
    trend = []
    for week_key in sorted(set(list(week_data.keys()) + list(week_counts.keys()))):
        scores = week_data.get(week_key, [])
        trend.append({
            "week": week_key,
            "avg_score": round(sum(scores) / len(scores), 1) if scores else None,
            "session_count": week_counts.get(week_key, 0),
        })

    return {"trend": trend, "days": 90}
