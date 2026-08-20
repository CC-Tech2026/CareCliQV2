from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.access import get_user_id, get_user_organization_id, has_org_wide_access, is_coordinator_role
from ..core.security import get_current_user
from ..schemas.incident import NDIS_NOTIFICATION_HOURS
from ..services import incident_service, onboarding_pipeline_alerts_service, participant_service, session_service
from ..services.supabase_client import get_supabase_admin

router = APIRouter(prefix="/hub", tags=["hub"])


def _get_org_id(user: dict) -> str | None:
    return get_user_organization_id(user)


def _require_coordinator(user: dict) -> str:
    if not is_coordinator_role(user):
        raise HTTPException(status_code=403, detail="Only coordinators can perform this action.")
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
        if not inc.get("ndis_reportable"):
            continue

        due_raw = inc.get("notification_due_at")
        if not due_raw:
            continue
        try:
            deadline = datetime.fromisoformat(str(due_raw).replace("Z", "+00:00"))
        except Exception:
            continue
        try:
            incident_dt = datetime.fromisoformat(str(inc.get("incident_date")).replace("Z", "+00:00"))
        except Exception:
            incident_dt = now

        severity_label = str(inc.get("severity") or "medium")
        total_hours = NDIS_NOTIFICATION_HOURS.get(severity_label, 240)
        total_days = max(1, round(total_hours / 24))
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

    today = date.today()
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

    today = date.today()

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

    type_groups: dict[str, list[dict]] = {}
    for row in rows:
        live = _live_status(row)
        if live not in ("expired", "expiring"):
            continue
        label = row.get("credential_type") or row.get("title") or "Credential"
        type_groups.setdefault(label, []).append({**row, "_live_status": live})

    alerts = []
    for label, creds in type_groups.items():
        count = len(creds)
        staff_names = [
            names_by_id.get(str(c["user_id"]), "Team member")
            for c in creds
            if c.get("user_id")
        ]

        min_days: int | None = None
        any_expired = False
        for c in creds:
            exp = c.get("expiry_date")
            if exp:
                try:
                    d = date.fromisoformat(str(exp)[:10])
                    days = (d - today).days
                    if min_days is None or days < min_days:
                        min_days = days
                    if days < 0:
                        any_expired = True
                except Exception:
                    pass

        if any_expired:
            severity = "critical"
        elif min_days is not None and min_days <= 14:
            severity = "critical"
        else:
            severity = "high"

        due_date_str: str | None = None
        if min_days is not None:
            due_date_str = (today + timedelta(days=min_days)).isoformat()

        noun = "credential" if count == 1 else "credentials"
        subj = "1 team member has" if count == 1 else f"{count} team members have"
        detail = f"{subj} {label} {noun} that {'is' if count == 1 else 'are'} {'expired' if any_expired else 'expiring soon'}."
        if any_expired:
            detail += " Immediate action required."

        alerts.append({
            "id": f"cred-{label.lower().replace(' ', '-').replace('/', '-')}",
            "title": f"{label} {'Expired' if any_expired else 'Expiring'}",
            "detail": detail,
            "severity": severity,
            "due_date": due_date_str,
            "affected_staff": staff_names[:5],
            "action_label": "Review Credentials",
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
    except Exception:
        return []

    alerts: list[dict] = []
    for row in rows:
        worker_id = row.get("worker_id")
        if worker_id not in (None, _UNASSIGNED_PLACEHOLDER_ID) and row.get("status") != "unassigned":
            continue
        try:
            start = datetime.fromisoformat(str(row.get("scheduled_start")).replace("Z", "+00:00"))
        except Exception:
            continue
        hours_until = (start - now).total_seconds() / 3600
        participant = row.get("participant_name") or "Unnamed participant"
        alerts.append({
            "id": f"unfilled-shift-{row.get('id')}",
            "title": f"Unfilled shift: {participant}",
            "detail": f"No worker assigned. Starts {start.strftime('%A')} at {start.strftime('%-I:%M%p').lower()}.",
            "severity": "critical" if hours_until <= 24 else "high",
            "due_date": start.date().isoformat(),
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
    except Exception:
        return []

    last_session_by_participant: dict[str, str] = {}
    for s in sessions:
        pid = s.get("patient_id")
        sdate = s.get("session_date")
        if not pid or not sdate:
            continue
        pid = str(pid)
        sdate = str(sdate)[:10]
        if pid not in last_session_by_participant or sdate > last_session_by_participant[pid]:
            last_session_by_participant[pid] = sdate

    today = date.today()
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
                f"Last session {last}, {days_since} days ago."
                if days_since is not None
                else "No session has ever been recorded for this participant."
            )
            title = (
                f"{name}: no contact in {days_since} days"
                if days_since is not None
                else f"{name}: no session on record"
            )
            alerts.append({
                "id": f"quiet-{pid}",
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
    return alerts[:10]


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

class OrgEventBody(BaseModel):
    title: str
    event_date: str
    duration: str = "1 hour"
    event_type: str = "meeting"
    location: Optional[str] = None
    participants_desc: Optional[str] = None


@router.get("/org-events")
async def list_org_events(current_user: dict = Depends(get_current_user)):
    """List upcoming org calendar events from the database."""
    org_id = _get_org_id(current_user)
    if not org_id:
        return []
    supabase = get_supabase_admin()
    try:
        today = date.today().isoformat()
        result = (
            supabase.table("org_events")
            .select("*")
            .eq("organization_id", org_id)
            .gte("event_date", today)
            .order("event_date", desc=False)
            .limit(20)
            .execute()
        )
        return result.data or []
    except Exception:
        return []


@router.post("/org-events", status_code=201)
async def create_org_event(body: OrgEventBody, current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    allowed_types = {"audit", "training", "meeting", "review"}
    if body.event_type not in allowed_types:
        raise HTTPException(status_code=422, detail=f"event_type must be one of: {', '.join(allowed_types)}")
    supabase = get_supabase_admin()
    payload = {
        **body.model_dump(),
        "organization_id": org_id,
        "created_by": get_user_id(current_user),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        result = supabase.table("org_events").insert(payload).execute()
        return result.data[0] if result.data else payload
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not create event: {e}")


@router.delete("/org-events/{event_id}", status_code=204)
async def delete_org_event(event_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        supabase.table("org_events").delete().eq("id", event_id).eq("organization_id", org_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not delete event: {e}")
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
        raise HTTPException(status_code=500, detail=f"Could not publish announcement: {e}")


@router.delete("/announcements/{announcement_id}", status_code=204)
async def delete_announcement(announcement_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    supabase = get_supabase_admin()
    try:
        supabase.table("announcements").delete().eq("id", announcement_id).eq("organization_id", org_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not delete announcement: {e}")
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
    today = date.today()

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
