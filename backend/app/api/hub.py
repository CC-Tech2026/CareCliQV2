from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.errors import internal_error_detail
from ..core.access import get_user_id, get_user_organization_id, has_org_wide_access
from ..core.security import get_current_user
from ..core.timezone import app_today, shift_local_date, request_timezone, user_timezone
from ..schemas.incident import effective_ndis_reportable, notification_clock_start
from ..services import incident_service, meeting_invite_service, onboarding_pipeline_alerts_service, participant_service, session_service
from ..services.supabase_client import get_supabase_admin
from ..services.vault_service import REQUIRED_CREDENTIAL_LABELS

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/hub", tags=["hub"])


def _get_org_id(user: dict) -> str | None:
    return get_user_organization_id(user)


def _require_coordinator(user: dict) -> str:
    if not has_org_wide_access(user):
        raise HTTPException(status_code=403, detail="Only coordinators and managing directors can perform this action.")
    org_id = _get_org_id(user)
    if not org_id:
        raise HTTPException(status_code=403, detail="Organisation membership required.")
    return org_id


# ── Organisation Info ─────────────────────────────────────────────────────────

@router.get("/org")
async def get_org_info(current_user: dict = Depends(get_current_user)):
    """Return the current user's organisation name."""
    org_id = _get_org_id(current_user)
    if not org_id:
        return {"organization_name": None}
    supabase = get_supabase_admin()
    try:
        res = (
            supabase.table("organizations")
            .select("name")
            .eq("organization_id", org_id)
            .single()
            .execute()
        )
        return {"organization_name": (res.data or {}).get("name")}
    except Exception:
        return {"organization_name": None}


# ── Compliance Alerts ─────────────────────────────────────────────────────────
#
# Two categories, matching the governance triage spec:
#   "urgent"   — needs action today/this week (has a real deadline attached)
#   "exposure" — will become an audit finding or compliance failure if ignored


async def _incident_clock_alerts(org_id: str, current_user: dict) -> list[dict]:
    """Open, NDIS-reportable incidents with their notification deadline."""
    try:
        incidents = await incident_service.get_all_incidents(
            limit=200, org_id=org_id, current_user=current_user,
        )
    except Exception:
        return []

    now = datetime.now(timezone.utc)
    alerts: list[dict] = []

    for inc in incidents:
        if inc.get("status") not in ("reported", "under_investigation"):
            continue
        if not effective_ndis_reportable(inc):
            continue

        due_raw = inc.get("notification_due_at")
        if not due_raw:
            continue
        try:
            deadline = datetime.fromisoformat(str(due_raw).replace("Z", "+00:00"))
        except Exception:
            continue
        incident_dt = notification_clock_start(inc) or now
        total_days = max(1, round((deadline - incident_dt).total_seconds() / 86400))
        elapsed_days = min(total_days, max(1, (now - incident_dt).days + 1))
        overdue = bool(inc.get("overdue"))
        due_label = deadline.strftime("%A") if 0 <= (deadline.date() - now.date()).days <= 6 else deadline.strftime("%d %b")

        title = inc.get("title") or "Incident"
        participant = inc.get("participant_name") or ""
        who = f" ({participant})" if participant else ""

        if overdue:
            alert_severity = "critical"
            detail = f"NDIS notification is overdue.{who}"
        elif elapsed_days >= total_days:
            alert_severity = "critical"
            detail = f"Day {elapsed_days} of {total_days}, notification due {due_label}.{who}"
        else:
            alert_severity = "high"
            detail = f"Day {elapsed_days} of {total_days}, notification due {due_label}.{who}"

        alerts.append({
            "id": f"incident-{inc.get('id')}",
            "title": f"Reportable incident: {title}",
            "detail": detail,
            "severity": alert_severity,
            "due_date": deadline.date().isoformat(),
            "affected_staff": [],
            "action_label": "Open Incident",
            "source": "incidents",
            "incident_id": str(inc["id"]),
            "category": "urgent",
        })

    return alerts


async def _invoice_aging_alerts(org_id: str) -> list[dict]:
    """Invoices past their due date and not yet paid."""
    supabase = get_supabase_admin()
    try:
        result = (
            supabase.table("invoices")
            .select("id, recipient_name, total_cents, due_date, status")
            .eq("organization_id", org_id)
            .in_("status", ["issued", "overdue"])
            .execute()
        )
        rows: list[dict] = result.data or []
    except Exception:
        return []

    today = app_today()
    alerts: list[dict] = []

    for row in rows:
        due_raw = row.get("due_date")
        if not due_raw:
            continue
        try:
            due_date = date.fromisoformat(str(due_raw)[:10])
        except Exception:
            continue
        days_overdue = (today - due_date).days
        if days_overdue <= 0:
            continue

        amount = (row.get("total_cents") or 0) / 100
        alerts.append({
            "id": f"invoice-{row.get('id')}",
            "title": f"Invoice overdue: {row.get('recipient_name') or 'Unknown recipient'}",
            "detail": f"${amount:,.0f} outstanding, {days_overdue} day{'s' if days_overdue != 1 else ''} past terms.",
            "severity": "critical" if days_overdue > 30 else "high",
            "due_date": due_date.isoformat(),
            "affected_staff": [],
            "action_label": "View Invoice",
            "source": "invoices",
            "invoice_id": str(row["id"]),
            "category": "urgent",
            "_days_overdue": days_overdue,
        })

    alerts.sort(key=lambda a: a["_days_overdue"], reverse=True)
    for a in alerts:
        a.pop("_days_overdue", None)
    return alerts[:10]


@router.get("/compliance-alerts")
async def get_compliance_alerts(current_user: dict = Depends(get_current_user)):
    """
    Return governance triage alerts: credential expiry (exposure), open reportable
    incidents against their notification clock (urgent), and overdue invoices (urgent).
    Coordinators and managing directors see the full org view; workers see only
    their own credentials (incidents/invoices are org-wide concerns, so they're
    skipped for the individual-worker view).
    """
    supabase = get_supabase_admin()
    org_id = _get_org_id(current_user)
    org_wide = has_org_wide_access(current_user) and bool(org_id)

    try:
        if org_wide:
            cred_res = (
                supabase.table("credentials")
                .select("id, credential_type, title, expiry_date, status, user_id")
                .eq("organization_id", org_id)
                .execute()
            )
            rows: list[dict] = cred_res.data or []

            user_ids = list({str(r["user_id"]) for r in rows if r.get("user_id")})
            names_by_id: dict[str, str] = {}
            if user_ids:
                u_res = (
                    supabase.table("users")
                    .select("id, full_name, email")
                    .in_("id", user_ids)
                    .eq("organization_id", org_id)
                    .execute()
                )
                for u in u_res.data or []:
                    names_by_id[str(u["id"])] = (
                        u.get("full_name") or u.get("email") or "Team member"
                    )
        else:
            uid = get_user_id(current_user)
            cred_res = (
                supabase.table("credentials")
                .select("id, credential_type, title, expiry_date, status, user_id")
                .eq("user_id", uid)
                .execute()
            )
            rows = cred_res.data or []
            names_by_id = {}
    except Exception:
        return []

    today = app_today()

    def _live_status(row: dict) -> str:
        exp = row.get("expiry_date")
        s = row.get("status") or "valid"
        if s in ("rejected", "pending_review"):
            return s
        if not exp:
            return s
        try:
            d = date.fromisoformat(str(exp)[:10])
            if d < today:
                return "expired"
            if (d - today).days <= 30:
                return "expiring"
        except Exception:
            pass
        return "valid"

    alerts = []
    for row in rows:
        live = _live_status(row)
        if live not in ("expired", "expiring"):
            continue
        credential_type = str(row.get("credential_type") or "")
        label = (
            REQUIRED_CREDENTIAL_LABELS.get(credential_type)
            or row.get("title")
            or (credential_type.replace("_", " ").capitalize() if credential_type else "Credential")
        )
        worker_id = str(row.get("user_id") or "")
        name = names_by_id.get(worker_id, "Team member")
        expiry = str(row.get("expiry_date") or "")[:10]
        try:
            expiry_date = date.fromisoformat(expiry) if expiry else None
        except ValueError:
            expiry_date = None
        days = (expiry_date - today).days if expiry_date else None
        # "20 Nov 2026", the way dates read everywhere else in the app.
        expiry_text = f"{expiry_date.day} {expiry_date:%b %Y}" if expiry_date else "an unknown date"
        alerts.append({
            "id": f"cred-{row['id']}",
            "credential_id": str(row["id"]),
            "worker_id": worker_id,
            "title": f"{name}: {label}",
            "detail": f"Expired on {expiry_text}. Review the credential and arrange renewal." if live == "expired" else f"Expires on {expiry_text}. Follow up the renewal before then.",
            "severity": "critical" if live == "expired" or (days is not None and days <= 14) else "high",
            "due_date": expiry or None,
            "affected_staff": [name],
            "action_label": "Review staff credential",
            "source": "credentials",
            "category": "exposure",
        })

    if org_wide:
        incident_alerts = await _incident_clock_alerts(org_id, current_user)
        invoice_alerts = await _invoice_aging_alerts(org_id)
        alerts = incident_alerts + invoice_alerts + alerts

    category_order = {"urgent": 0, "exposure": 1}
    severity_order = {"critical": 0, "high": 1, "medium": 2, "info": 3, "positive": 4}
    alerts.sort(key=lambda a: (category_order.get(a.get("category"), 2), severity_order.get(a["severity"], 5)))
    return alerts


# ── Care Alerts ────────────────────────────────────────────────────────────────
#
# Sibling to /compliance-alerts, same shape and same two categories, but scoped to
# care delivery and participant engagement — not compliance/credentialing. Deliberately
# does not touch incidents, credentials, or invoices; those stay on the governance tab.

# Unassigned shifts have been created two different ways in this codebase over time
# (a placeholder all-zero worker_id from the older create_unassigned_shift path, and
# a real NULL worker_id + status='unassigned' from the newer unassign_worker path) —
# check for all three so neither path is silently missed.
_UNASSIGNED_PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000"


async def _unfilled_shift_alerts(org_id: str) -> list[dict]:
    """Shifts in the next 72 hours with no real worker assigned."""
    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(hours=72)
    try:
        result = (
            supabase.table("shifts")
            .select("id, participant_name, scheduled_start, worker_id, status")
            .eq("organization_id", org_id)
            .gte("scheduled_start", now.isoformat())
            .lte("scheduled_start", horizon.isoformat())
            .execute()
        )
        rows: list[dict] = result.data or []
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Care alerts could not be loaded. Please try again.") from exc

    alerts: list[dict] = []
    for row in rows:
        if row.get("status") in ("cancelled", "completed"):
            continue
        worker_id = row.get("worker_id")
        if worker_id not in (None, _UNASSIGNED_PLACEHOLDER_ID) and row.get("status") != "unassigned":
            continue
        try:
            start = datetime.fromisoformat(str(row.get("scheduled_start")).replace("Z", "+00:00"))
        except Exception:
            continue
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        hours_until = (start - now).total_seconds() / 3600
        local_start = start.astimezone(request_timezone())
        start_label = local_start.strftime("%I:%M%p").lstrip("0").lower()
        participant = row.get("participant_name") or "Unnamed participant"
        alerts.append({
            "id": f"unfilled-shift-{row.get('id')}",
            "shift_id": str(row["id"]),
            "title": f"Unfilled shift: {participant}",
            "detail": f"No worker assigned. Starts {local_start.strftime('%A')} at {start_label}.",
            "severity": "critical" if hours_until <= 24 else "high",
            "due_date": local_start.date().isoformat(),
            "affected_staff": [],
            "action_label": "Assign Worker",
            "source": "shifts",
            "category": "urgent",
            "_hours_until": hours_until,
        })

    alerts.sort(key=lambda a: a["_hours_until"])
    for a in alerts:
        a.pop("_hours_until", None)
    return alerts


async def _care_sessions_and_team(org_id: str, current_user: dict) -> tuple[list[dict], dict[str, str]]:
    sessions = await session_service.get_sessions_for_dashboard(2000, current_user)
    supabase = get_supabase_admin()
    try:
        members = (
            supabase.table("organization_members")
            .select("user_id")
            .eq("organization_id", org_id)
            .eq("is_active", "true")
            .execute()
        )
        member_ids = [str(m["user_id"]) for m in (members.data or []) if m.get("user_id")]
        names_by_id: dict[str, str] = {}
        if member_ids:
            u_res = supabase.table("users").select("id, full_name, email").in_("id", member_ids).execute()
            for u in u_res.data or []:
                names_by_id[str(u["id"])] = u.get("full_name") or u.get("email") or "Team member"
    except Exception:
        names_by_id = {}
    return sessions, names_by_id


async def _worker_note_specificity_alerts(sessions: list[dict], names_by_id: dict[str, str]) -> list[dict]:
    """Workers whose average note-compliance score is trending low.

    Note: sessions.compliance_score (used here) measures note quality/specificity,
    computed by compliance_engine.py — a different metric from the task-evidence
    completion score used elsewhere (worker_performance_dashboard_service.py). Don't
    conflate the two; this alert is specifically about note quality.
    """
    scores_by_worker: dict[str, list[float]] = {}
    for s in sessions:
        wid = s.get("worker_id") or s.get("owner_user_id")
        if not wid or s.get("compliance_score") is None:
            continue
        try:
            scores_by_worker.setdefault(str(wid), []).append(float(s["compliance_score"]))
        except (TypeError, ValueError):
            continue

    alerts: list[dict] = []
    for wid, scores in scores_by_worker.items():
        if wid not in names_by_id:
            continue  # not a current active team member — nothing actionable to show
        if len(scores) < 4:
            continue
        avg = sum(scores) / len(scores)
        if avg >= 70:
            continue
        name = names_by_id[wid]
        alerts.append({
            "id": f"note-specificity-{wid}",
            "worker_id": wid,
            "title": f"{name}: {round(avg)}% note specificity",
            "detail": f"Average compliance score across the last {len(scores)} sessions.",
            "severity": "critical" if avg < 55 else "high",
            "affected_staff": [name],
            "action_label": "View Worker",
            "source": "worker-notes",
            "category": "exposure",
        })

    alerts.sort(key=lambda a: a["title"])
    return alerts


async def _participant_quiet_alerts(
    org_id: str, current_user: dict, sessions: list[dict], threshold_days: int = 14,
) -> list[dict]:
    """Participants with no session recorded in threshold_days."""
    try:
        participants = await participant_service.get_participants_list_light(current_user)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Care alerts could not be loaded. Please try again.") from exc

    last_session_by_participant: dict[str, str] = {}
    for s in sessions:
        pid = s.get("patient_id")
        sdate = s.get("session_date")
        if not pid or not sdate:
            continue
        pid = str(pid)
        sdate = (shift_local_date(sdate) or date.fromisoformat(str(sdate)[:10])).isoformat()
        if pid not in last_session_by_participant or sdate > last_session_by_participant[pid]:
            last_session_by_participant[pid] = sdate

    today = app_today()
    alerts: list[dict] = []
    for p in participants:
        if p.get("is_purged"):
            continue
        pid = str(p.get("id") or "")
        if not pid:
            continue
        name = p.get("full_name") or "Participant"
        last = last_session_by_participant.get(pid)
        if last:
            try:
                days_since = (today - date.fromisoformat(last)).days
            except Exception:
                continue
        else:
            days_since = None  # never had a recorded session — flag distinctly below

        if days_since is None or days_since >= threshold_days:
            detail = (
                # "25 Oct 2026", not "2026-10-25".
                f"Last session {date.fromisoformat(last).strftime('%d %b %Y').lstrip('0')}, {days_since} days ago."
                if days_since is not None
                else "No session found in the recent records reviewed. Check the participant profile for earlier records or other contact."
            )
            title = (
                f"{name}: no recorded session in {days_since} days"
                if days_since is not None
                else f"{name}: check recent contact"
            )
            alerts.append({
                "id": f"quiet-{pid}",
                "participant_id": pid,
                "title": title,
                "detail": detail,
                "severity": "critical" if (days_since or 999) >= threshold_days * 2 else "high",
                "affected_staff": [],
                "action_label": "View Participant",
                "source": "participants",
                "category": "exposure",
                "_days_since": days_since if days_since is not None else 9999,
            })

    alerts.sort(key=lambda a: a["_days_since"], reverse=True)
    for a in alerts:
        a.pop("_days_since", None)
    return alerts


@router.get("/care-alerts")
async def get_care_alerts(current_user: dict = Depends(get_current_user)):
    """
    Care-delivery triage alerts: unfilled shifts in the next 72 hours (urgent),
    participants with no recorded contact in 14+ days (exposure), and workers whose
    note specificity is trending low (exposure). Coordinators and managing directors
    only — this is an org-wide operational view, not something an individual worker
    needs to see about themselves.
    """
    org_id = _get_org_id(current_user)
    if not (has_org_wide_access(current_user) and org_id):
        return []

    sessions, names_by_id = await _care_sessions_and_team(org_id, current_user)

    unfilled = await _unfilled_shift_alerts(org_id)
    quiet = await _participant_quiet_alerts(org_id, current_user, sessions)
    low_specificity = await _worker_note_specificity_alerts(sessions, names_by_id)

    alerts = unfilled + quiet + low_specificity
    category_order = {"urgent": 0, "exposure": 1}
    severity_order = {"critical": 0, "high": 1, "medium": 2, "info": 3, "positive": 4}
    alerts.sort(key=lambda a: (category_order.get(a.get("category"), 2), severity_order.get(a["severity"], 5)))
    return alerts


# ── Staff Onboarding Alerts ─────────────────────────────────────────────────────

@router.get("/onboarding-alerts")
async def get_onboarding_alerts(current_user: dict = Depends(get_current_user)):
    """
    Staff Onboarding triage alerts: candidates stuck in Applied/Interview,
    hires with an unsigned offer or who haven't logged in after being invited,
    and workers blocked on Credentials/Training — reusing the exact thresholds
    the existing reminder/escalation passes already use, just exposed as a
    live list instead of only ever firing one-off notifications. Coordinators
    and managing directors only, same as the Worker Onboarding Pipeline board
    this sits above.
    """
    org_id = _get_org_id(current_user)
    if not (has_org_wide_access(current_user) and org_id):
        return []
    return onboarding_pipeline_alerts_service.get_onboarding_stuck_alerts(org_id)


# ── Organisation Events ───────────────────────────────────────────────────────

ORG_EVENT_TYPES = {"audit", "training", "meeting", "review"}
# Meetings held with a participant. They are all event_type "meeting".
PARTICIPANT_MEETING_KINDS = {
    "intake", "service_agreement", "plan_review", "goal_review",
    "check_in", "care_team", "incident_followup",
}
# How a meeting happens. A video call's invite goes out from the organiser's
# own Google Calendar or Outlook, which adds the Meet or Teams link; in-person
# and phone meetings are emailed as calendar invites by CareCliQ.
MEETING_MODES = {"in_person", "phone", "video"}


class MeetingAttendee(BaseModel):
    email: str
    name: Optional[str] = None
    role: Optional[str] = None


class OrgEventBody(BaseModel):
    title: str
    event_date: str
    duration: str = "1 hour"
    event_type: str = "meeting"
    location: Optional[str] = None
    participants_desc: Optional[str] = None
    start_time: Optional[str] = None  # "HH:MM", 24h — positions the event in the Week/Day hour grid
    participant_id: Optional[str] = None
    # Someone still in participant onboarding (no participant record yet),
    # e.g. the Meet & Greet booked from their onboarding page.
    intake_id: Optional[str] = None
    meeting_kind: Optional[str] = None
    meeting_mode: Optional[str] = None
    easy_capture: bool = False
    attendees: list[MeetingAttendee] = []
    # Email the attendees a calendar invite (in-person and phone meetings).
    send_invites: bool = True


async def _validated_event_payload(body: OrgEventBody, current_user: dict) -> dict:
    """Checks the booking fits together and returns the row to store."""
    if body.event_type not in ORG_EVENT_TYPES:
        raise HTTPException(status_code=422, detail=f"event_type must be one of: {', '.join(sorted(ORG_EVENT_TYPES))}")
    if not body.title.strip():
        raise HTTPException(status_code=422, detail="Give the meeting a title.")
    if body.meeting_kind is not None:
        if body.meeting_kind not in PARTICIPANT_MEETING_KINDS:
            raise HTTPException(status_code=422, detail="Unknown meeting type.")
        if body.event_type != "meeting":
            raise HTTPException(status_code=422, detail="A participant meeting must be a meeting.")
        if not body.participant_id and not body.intake_id:
            raise HTTPException(status_code=422, detail="Choose the participant this meeting is with.")
    elif body.intake_id:
        raise HTTPException(status_code=422, detail="Choose what kind of meeting this is.")
    if body.meeting_mode is not None and body.meeting_mode not in MEETING_MODES:
        raise HTTPException(status_code=422, detail="Unknown meeting format.")
    if body.easy_capture and (body.meeting_mode != "in_person" or not (body.participant_id or body.intake_id)):
        raise HTTPException(status_code=422, detail="Easy Capture is for in-person meetings with a participant.")
    try:
        attendees = meeting_invite_service.normalise_attendees([a.model_dump() for a in body.attendees])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    participant_id = body.participant_id
    if body.intake_id:
        intake = _find_intake(body.intake_id, _get_org_id(current_user))
        if not intake:
            raise HTTPException(status_code=404, detail="Participant onboarding not found.")
        made = intake.get("participant_id")
        if participant_id and made and str(made) != str(participant_id):
            raise HTTPException(status_code=422, detail="That onboarding is for a different participant.")
        # Once they're activated, the meeting is theirs as a participant too.
        participant_id = participant_id or (str(made) if made else None)

    if participant_id:
        participant = await participant_service.get_participant_by_id(participant_id, current_user)
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found.")

    row = body.model_dump(exclude={"send_invites"})
    return {**row, "participant_id": participant_id, "title": body.title.strip(), "attendees": attendees}


def _find_intake(intake_id: str, org_id: str | None) -> dict | None:
    """The onboarding record in this organisation, or None."""
    if not org_id:
        return None
    try:
        rows = (
            get_supabase_admin().table("participant_intakes")
            .select("id, full_name, email, participant_id, web_intake")
            .eq("id", intake_id).eq("organization_id", org_id).limit(1).execute().data
        ) or []
    except Exception as exc:
        logger.warning("Onboarding lookup failed for %s: %s", intake_id, exc)
        return None
    return rows[0] if rows else None


def _with_participant_names(supabase, rows: list[dict]) -> list[dict]:
    """Adds participant_name: the participant's, or for someone still in
    onboarding, the name on their intake."""
    ids = sorted({str(r["participant_id"]) for r in rows if r.get("participant_id")})
    names: dict[str, str] = {}
    if ids:
        try:
            result = supabase.table("participants").select("id, full_name").in_("id", ids).execute()
            names = {str(p["id"]): p.get("full_name") or "" for p in result.data or []}
        except Exception:
            names = {}
    intake_ids = sorted({str(r["intake_id"]) for r in rows if r.get("intake_id") and not r.get("participant_id")})
    intake_names: dict[str, str] = {}
    if intake_ids:
        try:
            result = supabase.table("participant_intakes").select("id, full_name").in_("id", intake_ids).execute()
            intake_names = {str(p["id"]): p.get("full_name") or "" for p in result.data or []}
        except Exception:
            intake_names = {}
    return [
        {
            **r,
            "participant_name": names.get(str(r.get("participant_id") or ""))
            or intake_names.get(str(r.get("intake_id") or ""))
            or None,
        }
        for r in rows
    ]


@router.get("/org-events")
async def list_org_events(
    start: Optional[date] = None,
    end: Optional[date] = None,
    intake_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Org calendar events. With start and end (the Calendar's visible range),
    everything in that range; with intake_id, every meeting booked for that
    person in onboarding; with neither, the next 20 upcoming."""
    org_id = _get_org_id(current_user)
    if not org_id:
        return []
    supabase = get_supabase_admin()
    try:
        query = supabase.table("org_events").select("*").eq("organization_id", org_id)
        if intake_id:
            query = query.eq("intake_id", intake_id).limit(50)
        elif start and end:
            query = query.gte("event_date", start.isoformat()).lte("event_date", end.isoformat()).limit(500)
        else:
            query = query.gte("event_date", app_today().isoformat()).limit(20)
        result = query.order("event_date", desc=False).execute()
        return _with_participant_names(supabase, result.data or [])
    except Exception:
        return []


def _require_org_wide(user: dict) -> str:
    """Coordinator or MD, org-wide — used for the calendar's own meetings
    (audit/training/meeting/review), which the MD creates directly from the
    Calendar page, unlike the coordinator-only actions elsewhere in this file."""
    if not has_org_wide_access(user):
        raise HTTPException(status_code=403, detail="Coordinator or managing director access required.")
    org_id = _get_org_id(user)
    if not org_id:
        raise HTTPException(status_code=403, detail="Organisation membership required.")
    return org_id


def _organiser(supabase, user: dict) -> dict:
    """Name and email of the person booking: the invite's organiser."""
    user_id = get_user_id(user)
    try:
        rows = supabase.table("users").select("full_name, email").eq("id", user_id).limit(1).execute().data or []
    except Exception:
        rows = []
    row = rows[0] if rows else {}
    return {"name": row.get("full_name") or user.get("full_name") or "", "email": row.get("email") or user.get("email") or ""}


def _org_name(supabase, org_id: str) -> str:
    try:
        res = supabase.table("organizations").select("name").eq("organization_id", org_id).limit(1).execute()
        return ((res.data or [{}])[0].get("name")) or "Your provider"
    except Exception:
        return "Your provider"


def _invites_go_by_email(row: dict) -> bool:
    """Video calls are sent from the organiser's own calendar instead."""
    return row.get("meeting_mode") != "video"


async def _send(supabase, row: dict, *, user: dict, org_id: str, attendees: list[dict], method: str, update: bool = False) -> dict:
    organiser = _organiser(supabase, user)
    if not organiser["email"]:
        return {"sent": [], "failed": [a["email"] for a in attendees], "email_off": False}
    return await meeting_invite_service.send_invites(
        row,
        attendees=attendees,
        organizer=organiser,
        method=method,
        sequence=int(row.get("invite_sequence") or 0),
        tz=user_timezone(get_user_id(user), org_id, supabase=supabase),
        org_name=_org_name(supabase, org_id),
        update=update,
    )


def _merge_results(*results: dict) -> dict:
    return {
        "sent": [e for r in results for e in r.get("sent", [])],
        "failed": [e for r in results for e in r.get("failed", [])],
        "email_off": any(r.get("email_off") for r in results),
    }


@router.get("/org-events/invitees")
async def meeting_invitees(
    participant_id: Optional[str] = None,
    intake_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Who to suggest inviting: you, and for a participant meeting the
    participant, their nominee/family contacts and their support workers.
    For someone still in onboarding, the people on their intake form."""
    org_id = _require_org_wide(current_user)
    supabase = get_supabase_admin()
    if intake_id:
        intake = _find_intake(intake_id, org_id)
        if not intake:
            raise HTTPException(status_code=404, detail="Participant onboarding not found.")
        if not intake.get("participant_id"):
            return meeting_invite_service.intake_invitees(intake, _organiser(supabase, current_user))
        # Already activated: their participant record has the fuller list.
        participant_id = str(intake["participant_id"])
    if participant_id:
        participant = await participant_service.get_participant_by_id(participant_id, current_user)
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found.")
    return meeting_invite_service.suggested_invitees(supabase, org_id, participant_id, _organiser(supabase, current_user))


@router.post("/org-events", status_code=201)
async def create_org_event(body: OrgEventBody, current_user: dict = Depends(get_current_user)):
    org_id = _require_org_wide(current_user)
    payload = {
        **await _validated_event_payload(body, current_user),
        "organization_id": org_id,
        "created_by": get_user_id(current_user),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    supabase = get_supabase_admin()
    try:
        result = supabase.table("org_events").insert(payload).execute()
        row = _with_participant_names(supabase, [result.data[0] if result.data else payload])[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=internal_error_detail("Could not create event", e))

    invites = {"sent": [], "failed": [], "email_off": False}
    if body.send_invites and row.get("id") and row.get("attendees") and _invites_go_by_email(row):
        invites = await _send(supabase, row, user=current_user, org_id=org_id, attendees=row["attendees"], method="REQUEST")
        if invites["sent"]:
            sent_at = datetime.now(timezone.utc).isoformat()
            try:
                supabase.table("org_events").update({"invites_sent_at": sent_at}).eq("id", row["id"]).execute()
                row["invites_sent_at"] = sent_at
            except Exception as exc:
                logger.warning("Recording invites_sent_at failed for %s: %s", row["id"], exc)
    return {**row, "invites": invites}


def _existing_event(supabase, event_id: str, org_id: str) -> dict:
    try:
        rows = supabase.table("org_events").select("*").eq("id", event_id).eq("organization_id", org_id).limit(1).execute().data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=internal_error_detail("Could not load event", e))
    if not rows:
        raise HTTPException(status_code=404, detail="Event not found.")
    return rows[0]


@router.put("/org-events/{event_id}")
async def update_org_event(event_id: str, body: OrgEventBody, current_user: dict = Depends(get_current_user)):
    """Reschedule or edit a booked event. Anyone already invited gets the
    updated invite; anyone taken off the list gets a cancellation."""
    org_id = _require_org_wide(current_user)
    supabase = get_supabase_admin()
    before = _existing_event(supabase, event_id, org_id)
    payload = {
        **await _validated_event_payload(body, current_user),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    was_invited = bool(before.get("invites_sent_at")) and _invites_go_by_email(before)
    by_email = _invites_go_by_email(payload)
    will_invite = by_email and bool(payload["attendees"]) and (was_invited or body.send_invites)
    if was_invited or will_invite:
        # Calendars only take a change whose SEQUENCE is higher than the last.
        payload["invite_sequence"] = int(before.get("invite_sequence") or 0) + 1

    try:
        result = supabase.table("org_events").update(payload).eq("id", event_id).eq("organization_id", org_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=internal_error_detail("Could not update event", e))
    if not result.data:
        raise HTTPException(status_code=404, detail="Event not found.")
    row = _with_participant_names(supabase, result.data)[0]

    # Everyone who had the invite and isn't on the new list (or every one of
    # them, if the meeting became a video call sent from a calendar app) gets
    # a cancellation for the version they have.
    keep = {a["email"].lower() for a in payload["attendees"]} if will_invite else set()
    dropped = [a for a in (before.get("attendees") or []) if str(a.get("email", "")).lower() not in keep] if was_invited else []
    results = []
    if dropped:
        cancelled = {**row, **{k: before.get(k) for k in ("event_date", "start_time", "duration", "location", "meeting_mode")}}
        results.append(await _send(supabase, cancelled, user=current_user, org_id=org_id, attendees=dropped, method="CANCEL"))
    if will_invite:
        results.append(await _send(supabase, row, user=current_user, org_id=org_id, attendees=payload["attendees"], method="REQUEST", update=was_invited))
    invites = _merge_results(*results) if results else {"sent": [], "failed": [], "email_off": False}

    if will_invite:
        sent_at = datetime.now(timezone.utc).isoformat() if invites["sent"] else before.get("invites_sent_at")
    else:
        sent_at = None
    if sent_at != row.get("invites_sent_at"):
        try:
            supabase.table("org_events").update({"invites_sent_at": sent_at}).eq("id", event_id).execute()
            row["invites_sent_at"] = sent_at
        except Exception as exc:
            logger.warning("Recording invites_sent_at failed for %s: %s", event_id, exc)
    return {**row, "invites": invites}


@router.delete("/org-events/{event_id}", status_code=204)
async def delete_org_event(event_id: str, current_user: dict = Depends(get_current_user)):
    """Cancels the meeting. If invites went out, everyone invited is sent a
    cancellation, which takes it off their calendars."""
    org_id = _require_org_wide(current_user)
    supabase = get_supabase_admin()
    before = _existing_event(supabase, event_id, org_id)
    if before.get("invites_sent_at") and _invites_go_by_email(before) and before.get("attendees"):
        cancelled = {**_with_participant_names(supabase, [before])[0], "invite_sequence": int(before.get("invite_sequence") or 0) + 1}
        await _send(supabase, cancelled, user=current_user, org_id=org_id, attendees=before["attendees"], method="CANCEL")
    try:
        supabase.table("org_events").delete().eq("id", event_id).eq("organization_id", org_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=internal_error_detail("Could not delete event", e))
    return None


# ── Announcements ─────────────────────────────────────────────────────────────

class AnnouncementBody(BaseModel):
    title: str
    body: str
    severity: str = "info"
    category: str = "Announcement"


_VALID_SEVERITIES = {"critical", "high", "medium", "info", "positive"}


@router.get("/announcements")
async def list_announcements(current_user: dict = Depends(get_current_user)):
    """List org-wide announcements — readable by any org member."""
    org_id = _get_org_id(current_user)
    if not org_id:
        return []
    supabase = get_supabase_admin()
    try:
        result = (
            supabase.table("announcements")
            .select("*")
            .eq("organization_id", org_id)
            .order("created_at", desc=True)
            .limit(20)
            .execute()
        )
        return result.data or []
    except Exception:
        return []


@router.post("/announcements", status_code=201)
async def create_announcement(body: AnnouncementBody, current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    if body.severity not in _VALID_SEVERITIES:
        raise HTTPException(status_code=422, detail=f"severity must be one of: {', '.join(_VALID_SEVERITIES)}")
    supabase = get_supabase_admin()
    payload = {
        **body.model_dump(),
        "organization_id": org_id,
        "created_by": get_user_id(current_user),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        result = supabase.table("announcements").insert(payload).execute()
        return result.data[0] if result.data else payload
    except Exception as e:
        raise HTTPException(status_code=500, detail=internal_error_detail("Could not publish announcement", e))


@router.delete("/announcements/{announcement_id}", status_code=204)
async def delete_announcement(announcement_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        supabase.table("announcements").delete().eq("id", announcement_id).eq("organization_id", org_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=internal_error_detail("Could not delete announcement", e))
    return None


# ── Staff Community ───────────────────────────────────────────────────────────

@router.get("/community")
async def get_community(current_user: dict = Depends(get_current_user)):
    """
    Return staff community highlights: new starters (joined ≤30 days ago),
    work anniversaries (±7 days of annual date), and birthdays (±1 day / next 7 days)
    derived from the organization_members and users tables.
    """
    org_id = _get_org_id(current_user)
    if not org_id:
        return []
    supabase = get_supabase_admin()
    today = app_today()

    try:
        mem_res = (
            supabase.table("organization_members")
            .select("user_id, joined_at, is_active")
            .eq("organization_id", org_id)
            .execute()
        )
        members: list[dict] = [r for r in (mem_res.data or []) if r.get("is_active") is not False]
    except Exception:
        members = []

    user_ids = [str(r["user_id"]) for r in members if r.get("user_id")]

    if not user_ids:
        try:
            u_res = (
                supabase.table("users")
                .select("id, full_name, email, date_of_birth, created_at")
                .eq("organization_id", org_id)
                .execute()
            )
            user_rows = u_res.data or []
        except Exception:
            return []

        items = []
        for u in user_rows:
            uid = str(u.get("id") or "")
            name = u.get("full_name") or u.get("email") or "Team member"
            initials = "".join(p[0].upper() for p in name.split()[:2])
            joined_str = u.get("created_at")
            if joined_str:
                try:
                    j = date.fromisoformat(str(joined_str)[:10])
                    if (today - j).days <= 30:
                        items.append({
                            "id": f"new-{uid}",
                            "type": "new_starter",
                            "name": name,
                            "detail": f"{name} recently joined the team. Welcome aboard!",
                            "date": j.isoformat(),
                            "avatar": initials,
                        })
                    years = today.year - j.year
                    ann = j.replace(year=today.year)
                    if -3 <= (ann - today).days <= 7 and years > 0:
                        items.append({
                            "id": f"ann-{uid}",
                            "type": "anniversary",
                            "name": name,
                            "detail": f"{name} celebrates {years} year{'s' if years > 1 else ''} with the organisation. Thank you for your dedication!",
                            "date": ann.isoformat(),
                            "avatar": initials,
                        })
                except Exception:
                    pass
        items.sort(key=lambda x: x.get("date") or "", reverse=True)
        return items

    try:
        u_res = (
            supabase.table("users")
            .select("id, full_name, email, date_of_birth")
            .in_("id", user_ids)
            .eq("organization_id", org_id)
            .execute()
        )
        profiles: dict[str, dict] = {
            str(u["id"]): u for u in (u_res.data or []) if u.get("id")
        }
    except Exception:
        profiles = {}

    joined_by_uid: dict[str, str | None] = {
        str(r["user_id"]): r.get("joined_at") for r in members if r.get("user_id")
    }

    items = []
    for uid, profile in profiles.items():
        name = profile.get("full_name") or profile.get("email") or "Team member"
        initials = "".join(p[0].upper() for p in name.split()[:2])

        joined_str = joined_by_uid.get(uid)
        if joined_str:
            try:
                j = date.fromisoformat(str(joined_str)[:10])
                days_since = (today - j).days
                if days_since <= 30:
                    items.append({
                        "id": f"new-{uid}",
                        "type": "new_starter",
                        "name": name,
                        "detail": f"{name} recently joined the team. Welcome aboard!",
                        "date": j.isoformat(),
                        "avatar": initials,
                    })
                years = today.year - j.year
                ann = j.replace(year=today.year)
                days_to_ann = (ann - today).days
                if -3 <= days_to_ann <= 7 and years > 0:
                    items.append({
                        "id": f"ann-{uid}",
                        "type": "anniversary",
                        "name": name,
                        "detail": f"{name} celebrates {years} year{'s' if years > 1 else ''} with the organisation. Thank you for your dedication!",
                        "date": ann.isoformat(),
                        "avatar": initials,
                    })
            except Exception:
                pass

        dob_str = profile.get("date_of_birth")
        if dob_str:
            try:
                dob = date.fromisoformat(str(dob_str)[:10])
                bday = dob.replace(year=today.year)
                days_to_bday = (bday - today).days
                if -1 <= days_to_bday <= 7:
                    suffix = "!" if days_to_bday <= 0 else " coming up soon!"
                    items.append({
                        "id": f"bday-{uid}",
                        "type": "birthday",
                        "name": name,
                        "detail": f"Wishing {name} a wonderful birthday{suffix}",
                        "date": bday.isoformat(),
                        "avatar": initials,
                    })
            except Exception:
                pass

    items.sort(key=lambda x: x.get("date") or "", reverse=True)
    return items
