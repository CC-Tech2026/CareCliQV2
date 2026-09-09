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
from typing import Optional

from langchain_core.tools import tool

from ...core.access import (
    get_coordinator_team_ids,
    get_user_id,
    get_user_organization_id,
    has_org_wide_access,
    is_coordinator_role,
    is_managing_director,
)
from .. import (
    audit_service,
    billing_service,
    incident_service,
    participant_service,
    rag_service,
    session_service,
    shift_pdf_export_service,
)
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


def _match_by_name(records: list[dict], name: str, name_key: str = "full_name") -> Optional[dict]:
    """Find the best-matching record by name for tools that take a name
    instead of an ID — exact case-insensitive match first, then a
    substring match. Returns None if nothing matches."""
    needle = (name or "").strip().lower()
    if not needle:
        return None
    for r in records:
        if (r.get(name_key) or "").strip().lower() == needle:
            return r
    for r in records:
        if needle in (r.get(name_key) or "").strip().lower():
            return r
    return None


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
    async def get_participant_count() -> dict:
        """Get the total number of participants in the current caseload.
        Scoped to the whole organisation for a managing director, or to a
        coordinator's own team's participants. Use this ONLY for a "how
        many participants" style question. If the question asks WHO the
        participants are (by name), use get_participant_list instead —
        do not use this tool for that."""
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

        return {"scope": scope, "participant_count": len(participants)}

    @tool
    async def get_participant_list() -> dict:
        """Get the names of participants in the current caseload. Scoped to
        the whole organisation for a managing director, or to a
        coordinator's own team's participants. Use this ONLY for a "who
        are our participants" / "list our participants" style question —
        for a plain count, use get_participant_count instead."""
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

        return {
            "scope": scope,
            "participants": [
                {"full_name": p.get("full_name") or "Participant"} for p in participants
            ],
        }

    @tool
    async def get_active_worker_count() -> dict:
        """Get the number of currently active support workers. Scoped to
        the whole organisation for a managing director, or to a
        coordinator's own team. Use this ONLY for a "how many
        workers/staff" style question. If the question asks WHO the
        workers are (by name), use get_active_worker_list instead — do
        not use this tool for that."""
        org_id = get_user_organization_id(current_user)
        if not org_id:
            return {"error": "No organization membership found for this user."}

        if is_managing_director(current_user):
            scope = "organisation-wide"
            team = await _team_members(org_id)
        elif is_coordinator_role(current_user):
            scope = "your team"
            supabase = get_supabase_admin()
            team_worker_ids = set(get_coordinator_team_ids(current_user, supabase))
            team = await _team_members(org_id, team_worker_ids)
        else:
            return {"error": "This tool is only available to coordinators and managing directors."}

        active_workers = [m for m in team if m.get("role") == "support_worker" and m.get("is_active")]
        return {"scope": scope, "active_worker_count": len(active_workers)}

    @tool
    async def get_active_worker_list() -> dict:
        """Get the names of currently active support workers. Scoped to
        the whole organisation for a managing director, or to a
        coordinator's own team. Use this ONLY for a "who are our
        workers/staff" / "list our workers" style question — for a plain
        count, use get_active_worker_count instead."""
        org_id = get_user_organization_id(current_user)
        if not org_id:
            return {"error": "No organization membership found for this user."}

        if is_managing_director(current_user):
            scope = "organisation-wide"
            team = await _team_members(org_id)
        elif is_coordinator_role(current_user):
            scope = "your team"
            supabase = get_supabase_admin()
            team_worker_ids = set(get_coordinator_team_ids(current_user, supabase))
            team = await _team_members(org_id, team_worker_ids)
        else:
            return {"error": "This tool is only available to coordinators and managing directors."}

        active_workers = [m for m in team if m.get("role") == "support_worker" and m.get("is_active")]
        return {
            "scope": scope,
            "workers": [
                {"full_name": w.get("full_name") or "Worker"} for w in active_workers
            ],
        }

    @tool
    async def get_shift_progress_note(participant_name: str, shift_date: str) -> dict:
        """Get the progress note PDF a support worker wrote for ONE
        specific completed shift — one participant, one date (YYYY-MM-DD).
        Use this when the question names one participant and one date. For
        a date range or "all" notes, use get_participant_progress_notes_zip,
        get_worker_progress_notes_zip, or get_all_progress_notes_zip
        instead. Coordinators only see their own team's shifts; managing
        directors see the whole organisation."""
        org_id = get_user_organization_id(current_user)
        if not org_id:
            return {"error": "No organization membership found for this user."}
        if not (is_managing_director(current_user) or is_coordinator_role(current_user)):
            return {"error": "This tool is only available to coordinators and managing directors."}

        supabase = get_supabase_admin()
        team_worker_ids: Optional[set] = None
        if is_coordinator_role(current_user) and not is_managing_director(current_user):
            team_worker_ids = set(get_coordinator_team_ids(current_user, supabase))

        participants = await participant_service.get_participants_list_light(current_user)
        if team_worker_ids is not None:
            participants = _filter_participants_by_worker_ids(participants, team_worker_ids)
        participant = _match_by_name(participants, participant_name)
        if not participant:
            return {"error": f"No participant matching '{participant_name}' found."}

        try:
            rows = _execute_shift_query_with_legacy_fallback(
                supabase=supabase, org_id=org_id, limit=20,
                start_date=shift_date, end_date=f"{shift_date}T23:59:59",
                worker_id=None, status_filter="completed",
            )
        except Exception:
            return {"error": "Could not load shift data right now."}

        matches = [
            r for r in rows
            if str(r.get("participant_id")) == str(participant.get("id"))
            and (team_worker_ids is None or str(r.get("worker_id")) in team_worker_ids)
        ]
        if not matches:
            return {"error": f"No completed shift found for {participant.get('full_name')} on {shift_date}."}

        shift_refs = [(str(r["id"]), str(r["worker_id"])) for r in matches]
        if len(shift_refs) == 1:
            shift_id, worker_id = shift_refs[0]
            try:
                export = shift_pdf_export_service.create_shift_export(
                    shift_id, get_user_id(current_user), org_id,
                    is_coordinator=True, worker_id=worker_id,
                )
            except Exception:
                return {"error": "Could not prepare that download right now."}
            return {
                "label": f"Progress note — {participant.get('full_name')} — {shift_date}",
                "file_url": export.get("file_url"),
                "shift_count": 1,
            }

        return shift_pdf_export_service.create_bulk_shift_export(
            shift_refs, org_id,
            zip_label=f"Progress notes — {participant.get('full_name')} — {shift_date}",
        )

    @tool
    async def get_participant_progress_notes_zip(participant_name: str, date_from: str, date_to: str) -> dict:
        """Get a ZIP of every progress note (shift PDF) written for ONE
        participant within a date range. date_from and date_to are
        required, in YYYY-MM-DD format — if the user hasn't given a range,
        ask them for one rather than guessing. Coordinators only see their
        own team's shifts; managing directors see the whole organisation."""
        org_id = get_user_organization_id(current_user)
        if not org_id:
            return {"error": "No organization membership found for this user."}
        if not (is_managing_director(current_user) or is_coordinator_role(current_user)):
            return {"error": "This tool is only available to coordinators and managing directors."}

        supabase = get_supabase_admin()
        team_worker_ids: Optional[set] = None
        if is_coordinator_role(current_user) and not is_managing_director(current_user):
            team_worker_ids = set(get_coordinator_team_ids(current_user, supabase))

        participants = await participant_service.get_participants_list_light(current_user)
        if team_worker_ids is not None:
            participants = _filter_participants_by_worker_ids(participants, team_worker_ids)
        participant = _match_by_name(participants, participant_name)
        if not participant:
            return {"error": f"No participant matching '{participant_name}' found."}

        try:
            rows = _execute_shift_query_with_legacy_fallback(
                supabase=supabase, org_id=org_id, limit=200,
                start_date=date_from, end_date=f"{date_to}T23:59:59",
                worker_id=None, status_filter="completed",
            )
        except Exception:
            return {"error": "Could not load shift data right now."}

        matches = [
            r for r in rows
            if str(r.get("participant_id")) == str(participant.get("id"))
            and (team_worker_ids is None or str(r.get("worker_id")) in team_worker_ids)
        ]
        if not matches:
            return {"error": f"No completed shifts found for {participant.get('full_name')} between {date_from} and {date_to}."}

        shift_refs = [(str(r["id"]), str(r["worker_id"])) for r in matches]
        return shift_pdf_export_service.create_bulk_shift_export(
            shift_refs, org_id,
            zip_label=f"Progress notes — {participant.get('full_name')} — {date_from} to {date_to}",
        )

    @tool
    async def get_worker_progress_notes_zip(worker_name: str, date_from: str, date_to: str) -> dict:
        """Get a ZIP of every progress note (shift PDF) written by ONE
        support worker within a date range. date_from and date_to are
        required, in YYYY-MM-DD format — if the user hasn't given a range,
        ask them for one rather than guessing. Coordinators only see
        workers on their own team; managing directors see the whole
        organisation."""
        org_id = get_user_organization_id(current_user)
        if not org_id:
            return {"error": "No organization membership found for this user."}

        supabase = get_supabase_admin()
        if is_managing_director(current_user):
            team = await _team_members(org_id)
        elif is_coordinator_role(current_user):
            team_worker_ids = set(get_coordinator_team_ids(current_user, supabase))
            team = await _team_members(org_id, team_worker_ids)
        else:
            return {"error": "This tool is only available to coordinators and managing directors."}

        worker = _match_by_name(team, worker_name)
        if not worker:
            return {"error": f"No worker matching '{worker_name}' found."}

        try:
            rows = _execute_shift_query_with_legacy_fallback(
                supabase=supabase, org_id=org_id, limit=200,
                start_date=date_from, end_date=f"{date_to}T23:59:59",
                worker_id=str(worker.get("id")), status_filter="completed",
            )
        except Exception:
            return {"error": "Could not load shift data right now."}

        if not rows:
            return {"error": f"No completed shifts found for {worker.get('full_name')} between {date_from} and {date_to}."}

        shift_refs = [(str(r["id"]), str(worker.get("id"))) for r in rows]
        return shift_pdf_export_service.create_bulk_shift_export(
            shift_refs, org_id,
            zip_label=f"Progress notes — {worker.get('full_name')} — {date_from} to {date_to}",
        )

    @tool
    async def get_all_progress_notes_zip(date_from: str, date_to: str) -> dict:
        """Get a ZIP of every progress note (shift PDF) within a date
        range, across all participants. date_from and date_to are
        required, in YYYY-MM-DD format — if the user hasn't given a range,
        ask them for one rather than guessing. Coordinators get their own
        team's shifts; managing directors get the whole organisation. This
        can be a large download — only use it when the user clearly wants
        everything, not one participant or worker (use the other
        progress-note tools for those)."""
        org_id = get_user_organization_id(current_user)
        if not org_id:
            return {"error": "No organization membership found for this user."}

        supabase = get_supabase_admin()
        team_worker_ids: Optional[set] = None
        if is_managing_director(current_user):
            pass
        elif is_coordinator_role(current_user):
            team_worker_ids = set(get_coordinator_team_ids(current_user, supabase))
        else:
            return {"error": "This tool is only available to coordinators and managing directors."}

        try:
            rows = _execute_shift_query_with_legacy_fallback(
                supabase=supabase, org_id=org_id, limit=200,
                start_date=date_from, end_date=f"{date_to}T23:59:59",
                worker_id=None, status_filter="completed",
            )
        except Exception:
            return {"error": "Could not load shift data right now."}

        if team_worker_ids is not None:
            rows = [r for r in rows if str(r.get("worker_id")) in team_worker_ids]

        if not rows:
            return {"error": f"No completed shifts found between {date_from} and {date_to}."}

        shift_refs = [(str(r["id"]), str(r["worker_id"])) for r in rows]
        return shift_pdf_export_service.create_bulk_shift_export(
            shift_refs, org_id,
            zip_label=f"All progress notes — {date_from} to {date_to}",
        )

    @tool
    async def get_session_activity() -> dict:
        """Get recent session activity: how many sessions happened today,
        and how many this week (last 7 days). Scoped to the whole
        organisation for a managing director, or to a coordinator's own
        team. Use this for "sessions today/this week" type questions."""
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

        today = _today_iso()
        week_ago = (datetime.now(timezone.utc).date() - timedelta(days=7)).isoformat()
        todays_sessions = [s for s in sessions if _date_part(s.get("session_date")) == today]
        sessions_this_week = [s for s in sessions if _date_part(s.get("session_date")) >= week_ago]

        return {
            "scope": scope,
            "sessions_today": len(todays_sessions),
            "sessions_this_week": len(sessions_this_week),
        }

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
        """Semantic search over past session notes. Organisation-wide for a
        coordinator or managing director; a support worker only searches
        their own authored notes. Use this when asked to find, recall, or
        summarise past sessions or notes about a topic (not for current
        numeric stats — use the other tools for those)."""
        org_id = get_user_organization_id(current_user)
        if not org_id:
            return {"error": "No organization membership found for this user."}
        # Session notes are worker-owned (core/access.py: a support worker
        # sees their assigned participant's profile but not other workers'
        # session notes for that participant) — org-wide only for the
        # coordinator/managing_director tier, exactly like every direct
        # session-record access check elsewhere in the app.
        if has_org_wide_access(current_user):
            worker_ids, scope = None, "organisation-wide"
        else:
            worker_ids, scope = [get_user_id(current_user)], "your own notes"
        results = await rag_service.retrieve_similar_sessions(
            query_text=query, org_id=org_id, limit=5, worker_ids=worker_ids,
        )
        return {"scope": scope, "matches": results}

    @tool
    async def search_incident_history(query: str) -> dict:
        """Semantic search over past incident reports. Organisation-wide for
        a coordinator or managing director; a support worker only searches
        incidents they personally reported. Use this to find similar past
        incidents by description, not for current incident counts/stats —
        use get_incident_summary for those."""
        org_id = get_user_organization_id(current_user)
        if not org_id:
            return {"error": "No organization membership found for this user."}
        # Matches list_incidents()'s existing rule (incidents.py): org-wide
        # for coordinator/managing_director, reporter-only for a support
        # worker — see this module's docstring on why incidents are
        # org-wide rather than team-scoped for coordinators.
        if has_org_wide_access(current_user):
            worker_ids, scope = None, "organisation-wide"
        else:
            worker_ids, scope = [get_user_id(current_user)], "your own reports"
        results = await rag_service.retrieve_similar_incidents(
            query_text=query, org_id=org_id, limit=5, worker_ids=worker_ids,
        )
        return {"scope": scope, "matches": results}

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
        get_participant_count,
        get_participant_list,
        get_active_worker_count,
        get_active_worker_list,
        get_shift_progress_note,
        get_participant_progress_notes_zip,
        get_worker_progress_notes_zip,
        get_all_progress_notes_zip,
        get_session_activity,
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
