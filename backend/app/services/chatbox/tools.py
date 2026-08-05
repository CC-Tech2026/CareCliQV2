"""LangGraph tools for the CareCliQ chatbox ("Quill").

Each tool wraps existing aggregation logic from app.api.dashboards (and other
service/API modules) rather than reintroducing new queries — see
md_dashboard()/coordinator_dashboard() for the original implementations most
of these mirror.

Scoping note: compliance score, RP-flag counts, and goal achievement are
team-scoped for a coordinator (matching coordinator_dashboard()'s deliberate
team filter) because that's what the existing dashboards already show them.
Incidents, shifts, and revenue are organisation-wide for BOTH roles, because
that's what their existing endpoints (incidents.py, coordinator_shifts(),
billing_service.get_revenue_report()) already do — there is no team-scoped
version of those in the app today, so this doesn't invent one. Retention
rate is managing_director only for the same reason: no coordinator-scoped
version exists anywhere in the codebase.
"""

import logging
from datetime import datetime, timedelta, timezone

from langchain_core.tools import tool

from ...core.access import (
    get_coordinator_team_ids,
    get_user_id,
    get_user_organization_id,
    is_coordinator_role,
    is_managing_director,
)
from .. import audit_service, billing_service, incident_service, participant_service, rag_service, session_service
from ..supabase_client import get_supabase_admin
from ...api.coordinator import _execute_shift_query_with_legacy_fallback
from ...api.dashboards import (
    _average_score,
    _date_part,
    _filter_participants_by_worker_ids,
    _filter_sessions_by_worker_ids,
    _goal_achievement_rate,
    _has_rp_flag,
    _team_members,
    _today_iso,
)

logger = logging.getLogger(__name__)


async def _log_tool_call(current_user: dict, thread_id: str, tool_name: str, result: dict) -> None:
    """Audit each tool invocation individually, not just each chat turn, so
    the trail shows exactly which data was pulled. Never blocks the tool's
    actual response on failure."""
    try:
        await audit_service.log_action(
            action_type="chatbox.tool_call",
            entity_type="chatbox_thread",
            entity_id=thread_id,
            user_id=get_user_id(current_user),
            organization_id=get_user_organization_id(current_user),
            details={
                "tool": tool_name,
                "ok": isinstance(result, dict) and "error" not in result,
                "scope": result.get("scope") if isinstance(result, dict) else None,
            },
        )
    except Exception:
        logger.warning("Failed to write chatbox tool-call audit log for %s", tool_name)


def build_tools_for_user(current_user: dict, thread_id: str) -> list:
    """Build the tool list scoped to *current_user*.

    current_user is captured by closure, never supplied by the LLM, so a tool
    call can't be redirected to another org or user. Every tool call is
    audit-logged individually via _log_tool_call, wired on below.
    """

    @tool
    async def get_compliance_snapshot() -> dict:
        """Get the current compliance score, target, and the list of workers
        currently below the 85 compliance threshold ("at risk"). Scoped to
        the whole organisation for a managing director, or to a coordinator's
        own team. Use this for any question about overall compliance score,
        or which workers need attention."""
        org_id = get_user_organization_id(current_user)
        if not org_id:
            return {"error": "No organization membership found for this user."}

        sessions = await session_service.get_sessions_for_dashboard(400, current_user)

        if is_managing_director(current_user):
            scope = "organisation-wide"
            team = await _team_members(org_id)
        elif is_coordinator_role(current_user):
            scope = "your team"
            supabase = get_supabase_admin()
            team_worker_ids = set(get_coordinator_team_ids(current_user, supabase))
            sessions = _filter_sessions_by_worker_ids(sessions, team_worker_ids)
            team = await _team_members(org_id, team_worker_ids)
        else:
            return {"error": "This tool is only available to coordinators and managing directors."}

        compliance_score = _average_score(sessions)
        compliance_target = 90

        worker_scores: dict[str, list[float]] = {}
        worker_sessions_count: dict[str, int] = {}
        for session in sessions:
            wid = session.get("worker_id") or session.get("support_worker_id") or session.get("owner_user_id")
            if not wid:
                continue
            wid = str(wid)
            worker_sessions_count[wid] = worker_sessions_count.get(wid, 0) + 1
            if session.get("compliance_score") is not None:
                worker_scores.setdefault(wid, []).append(float(session["compliance_score"]))

        worker_map = {str(m.get("id")): m for m in team}
        workers_at_risk = []
        for wid, count in worker_sessions_count.items():
            scores = worker_scores.get(wid, [])
            if not scores:
                continue
            avg = round(sum(scores) / len(scores))
            if avg < 85:
                worker_info = worker_map.get(wid, {})
                workers_at_risk.append({
                    "full_name": worker_info.get("full_name") or "Worker",
                    "compliance_score": avg,
                    "sessions": count,
                })

        return {
            "scope": scope,
            "compliance_score": compliance_score,
            "compliance_target": compliance_target,
            "workers_at_risk": workers_at_risk,
        }

    @tool
    async def get_incident_summary() -> dict:
        """Get real incident-management statistics for the organisation: total
        incidents, how many are open, how many are overdue for NDIS reporting,
        and how many are critical severity. This is the REAL incident system —
        use it for any question like "how many incidents" or "any critical
        incidents" or "is there any incident". Do NOT use this for "incidents
        this month" questions about restrictive-practice flags — use
        get_rp_flag_count for that instead, it's a different, narrower metric."""
        org_id = get_user_organization_id(current_user)
        if not org_id:
            return {"error": "No organization membership found for this user."}
        if not (is_managing_director(current_user) or is_coordinator_role(current_user)):
            return {"error": "This tool is only available to coordinators and managing directors."}

        stats = await incident_service.get_incident_stats(org_id=org_id, current_user=current_user)
        return {"scope": "organisation-wide", **stats}

    @tool
    async def get_rp_flag_count() -> dict:
        """Get the count of sessions flagged for restrictive practice (RP) use
        within the current calendar month. This is a narrower proxy metric
        used on the dashboards as "incidents this month" — it is NOT the same
        as the real incident-management system. Use get_incident_summary
        instead for general incident questions; only use this if the question
        specifically asks about restrictive practice flags or dashboard
        "incidents this month" figures."""
        org_id = get_user_organization_id(current_user)
        if not org_id:
            return {"error": "No organization membership found for this user."}

        sessions = await session_service.get_sessions_for_dashboard(400, current_user)

        if is_managing_director(current_user):
            scope = "organisation-wide"
        elif is_coordinator_role(current_user):
            scope = "your team"
            supabase = get_supabase_admin()
            team_worker_ids = set(get_coordinator_team_ids(current_user, supabase))
            sessions = _filter_sessions_by_worker_ids(sessions, team_worker_ids)
        else:
            return {"error": "This tool is only available to coordinators and managing directors."}

        current_month_prefix = _today_iso()[:7]
        rp_flag_count = sum(
            1 for s in sessions
            if _has_rp_flag(s) and _date_part(s.get("session_date")).startswith(current_month_prefix)
        )
        return {"scope": scope, "rp_flag_count_this_month": rp_flag_count}

    @tool
    async def get_shift_coverage() -> dict:
        """Get who is currently on shift right now, based on scheduled shift
        start/end times. Organisation-wide for both coordinators and managing
        directors — there is no team-scoped shift view in the app today."""
        org_id = get_user_organization_id(current_user)
        if not org_id:
            return {"error": "No organization membership found for this user."}
        if not (is_managing_director(current_user) or is_coordinator_role(current_user)):
            return {"error": "This tool is only available to coordinators and managing directors."}

        supabase = get_supabase_admin()
        now = datetime.now(timezone.utc)
        window_start = (now - timedelta(hours=16)).isoformat()
        window_end = (now + timedelta(hours=16)).isoformat()

        try:
            rows = _execute_shift_query_with_legacy_fallback(
                supabase=supabase,
                org_id=org_id,
                limit=500,
                start_date=window_start,
                end_date=window_end,
                worker_id=None,
                status_filter=None,
            )
        except Exception:
            return {"error": "Could not load shift data right now."}

        on_shift = []
        matching_rows = []
        for row in rows:
            if row.get("status") != "scheduled":
                continue
            start = _parse_iso(row.get("scheduled_start"))
            end = _parse_iso(row.get("scheduled_end"))
            if start and end and start <= now <= end:
                matching_rows.append(row)

        # Resolve raw worker_id/participant_id into display names — matching
        # the pattern get_compliance_snapshot already uses for workers.
        team = await _team_members(org_id)
        worker_names = {str(m.get("id")): m.get("full_name") for m in team}
        participants = await participant_service.get_participants_list_light(current_user)
        participant_names = {str(p.get("id")): p.get("full_name") for p in participants}

        for row in matching_rows:
            worker_id = row.get("worker_id")
            participant_id = row.get("participant_id")
            on_shift.append({
                "worker_id": worker_id,
                "worker_name": worker_names.get(str(worker_id)) or "Unknown worker",
                "participant_id": participant_id,
                "participant_name": participant_names.get(str(participant_id)) or "Unknown participant",
                "scheduled_start": row.get("scheduled_start"),
                "scheduled_end": row.get("scheduled_end"),
            })

        return {"scope": "organisation-wide", "on_shift_now": on_shift, "count": len(on_shift)}

    @tool
    async def get_goal_achievement_rate() -> dict:
        """Get the percentage of participants with an active NDIS plan
        ("goal achievement rate"). Scoped to the whole organisation for a
        managing director, or to a coordinator's own team's participants."""
        org_id = get_user_organization_id(current_user)
        if not org_id:
            return {"error": "No organization membership found for this user."}

        participants = await participant_service.get_participants_list_light(current_user)

        if is_managing_director(current_user):
            scope = "organisation-wide"
        elif is_coordinator_role(current_user):
            scope = "your team"
            supabase = get_supabase_admin()
            team_worker_ids = set(get_coordinator_team_ids(current_user, supabase))
            participants = _filter_participants_by_worker_ids(participants, team_worker_ids)
        else:
            return {"error": "This tool is only available to coordinators and managing directors."}

        return {"scope": scope, "goal_achievement_rate_pct": _goal_achievement_rate(participants)}

    @tool
    async def get_retention_rate() -> dict:
        """Get staff retention rate (percentage of organisation members still
        active). Managing director only — there is no team-scoped retention
        metric anywhere in the app today."""
        if not is_managing_director(current_user):
            return {"error": "Retention rate is only available to managing directors."}
        org_id = get_user_organization_id(current_user)
        if not org_id:
            return {"error": "No organization membership found for this user."}

        supabase = get_supabase_admin()
        try:
            result = (
                supabase.table("organization_members")
                .select("user_id, is_active", count="exact")
                .eq("organization_id", org_id)
                .execute()
            )
            total = result.count or len(result.data or [])
            inactive = sum(1 for m in (result.data or []) if not m.get("is_active"))
        except Exception:
            return {"error": "Could not load retention data right now."}

        active = total - inactive
        retention_rate = round((active / total) * 100, 1) if total else 100.0
        return {"scope": "organisation-wide", "retention_rate_pct": retention_rate}

    @tool
    async def get_revenue_summary() -> dict:
        """Get billing/revenue summary. Returns a "this_month" field — use
        THAT for any "this month" / "current" revenue question, do not sum
        or pick from monthly_breakdown yourself. Also returns all-time
        totals and a full monthly_breakdown for historical questions.
        Organisation-wide for both coordinators and managing directors. All
        monetary figures are in AUD dollars (already converted from cents)."""
        try:
            revenue = await billing_service.get_revenue_report(current_user)
        except Exception:
            return {"error": "Could not load revenue data right now."}

        def cents_to_dollars(cents) -> float:
            return round((cents or 0) / 100, 2)

        monthly_dollars = [
            {
                "month": m.get("month"),
                "billed_aud": cents_to_dollars(m.get("billed")),
                "paid_aud": cents_to_dollars(m.get("paid")),
                "outstanding_aud": cents_to_dollars(m.get("outstanding")),
                "invoice_count": m.get("count"),
            }
            for m in (revenue.get("monthly") or [])
        ]
        current_month_key = _today_iso()[:7]
        current_month = next((m for m in monthly_dollars if m["month"] == current_month_key), {
            "month": current_month_key, "billed_aud": 0.0, "paid_aud": 0.0, "outstanding_aud": 0.0, "invoice_count": 0,
        })

        return {
            "scope": "organisation-wide",
            "this_month": current_month,
            "all_time_total_billed_aud": cents_to_dollars(revenue.get("total_billed_cents")),
            "all_time_total_paid_aud": cents_to_dollars(revenue.get("total_paid_cents")),
            "all_time_total_outstanding_aud": cents_to_dollars(revenue.get("total_outstanding_cents")),
            "all_time_invoice_count": revenue.get("invoice_count"),
            "monthly_breakdown": monthly_dollars,
        }

    @tool
    async def search_session_notes(query: str) -> dict:
        """Semantic search over past session notes for this organisation.
        Use this when asked to find, recall, or summarise past sessions or
        notes about a topic (not for current numeric stats — use the other
        tools for those)."""
        org_id = get_user_organization_id(current_user)
        if not org_id:
            return {"error": "No organization membership found for this user."}
        results = await rag_service.retrieve_similar_sessions(query_text=query, org_id=org_id, limit=5)
        return {"scope": "organisation-wide", "matches": results}

    @tool
    async def search_incident_history(query: str) -> dict:
        """Semantic search over past incident reports for this organisation.
        Use this to find similar past incidents by description, not for
        current incident counts/stats — use get_incident_summary for those."""
        org_id = get_user_organization_id(current_user)
        if not org_id:
            return {"error": "No organization membership found for this user."}
        results = await rag_service.retrieve_similar_incidents(query_text=query, org_id=org_id, limit=5)
        return {"scope": "organisation-wide", "matches": results}

    all_tools = [
        get_compliance_snapshot,
        get_incident_summary,
        get_rp_flag_count,
        get_shift_coverage,
        get_goal_achievement_rate,
        get_retention_rate,
        get_revenue_summary,
        search_session_notes,
        search_incident_history,
    ]

    for t in all_tools:
        original_coroutine = t.coroutine

        async def _audited(*args, _name=t.name, _orig=original_coroutine, **kwargs):
            result = await _orig(*args, **kwargs)
            await _log_tool_call(current_user, thread_id, _name, result)
            # content_and_artifact: the LLM sees `result` serialised as
            # message content same as before; the raw dict also travels as
            # the ToolMessage's .artifact, undisturbed by the model's prose,
            # so structured blocks (tables/charts) can be built deterministically.
            return result, result

        t.coroutine = _audited
        t.response_format = "content_and_artifact"

    return all_tools


def _parse_iso(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
