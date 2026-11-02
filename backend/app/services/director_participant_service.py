"""The managing director's view of one participant.

The coordinator works a participant's record day to day; the director
oversees it. This service gathers what the director needs to make calls
(funding against time, delivery, quality, risk, the care team) into one
summary, works out which of those need a decision, and carries out the
director-only actions: changing the care team, suspending, resuming or ending
services, the participant's documents, and the record's audit trail.
"""

from __future__ import annotations

import logging
import mimetypes
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4

from fastapi import HTTPException

from ..core.errors import internal_error_detail
from ..core.timezone import request_timezone
from . import audit_service, funding_service, medication_document_service, participant_intake_service, participant_service
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

DOCUMENTS_BUCKET = "participant-documents"
DOCUMENTS_TABLE = "participant_documents"
MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
ALLOWED_DOCUMENT_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/msword": ".doc",
}

# Where each kind of document lives. Medication paperwork goes to the
# medication store so it can be read into the medication chart; everything
# else is a participant document.
DOCUMENT_CATEGORIES: dict[str, str] = {
    "gp_letter": "GP letter",
    "clinical_assessment": "Clinical assessment report",
    "behaviour_support_plan": "Behaviour support plan",
    "risk_assessment": "Risk assessment",
    "hospital_discharge": "Hospital discharge summary",
    "therapy_report": "Therapy report",
    "ndis_plan": "NDIS plan",
    "consent": "Consent form",
    "other": "Other document",
}
MEDICATION_CATEGORIES: dict[str, str] = {
    "prescription": "Prescription",
    "medication_management_plan": "Medication management plan",
    "pharmacy_authority": "Pharmacy authority",
}

SCHEDULED_STATUSES = ("unassigned", "scheduled")
OPEN_INCIDENT_STATUSES = {"open", "reported", "under_investigation", "investigating", "in_progress", "pending"}
SERIOUS_SEVERITIES = {"high", "critical", "severe"}

# Plain words for the audit trail.
AUDIT_LABELS: dict[str, str] = {
    "participant.created": "Created the participant record",
    "participant.updated": "Updated the participant's details",
    "participant.plan_management_type_changed": "Changed how the plan is managed",
    "participant.records_exported": "Exported the participant's records",
    "participant.team_changed": "Changed the care team",
    "participant.services_suspended": "Suspended services",
    "participant.services_resumed": "Resumed services",
    "participant.services_ended": "Ended services",
    "participant.document_uploaded": "Uploaded a document",
    "participant.document_viewed": "Opened a document",
    "participant.document_archived": "Archived a document",
    "participant_portal.access_granted": "Gave portal access",
    "participant_portal.access_revoked": "Removed portal access",
    "participant_portal.invite_resent": "Resent a portal invitation",
    "participant_portal.invite_accepted": "Accepted a portal invitation",
    "participant_portal.identity_verified": "Verified their identity for the portal",
    "participant_portal.identity_failed": "Failed a portal identity check",
    "participant_portal.not_using_recorded": "Recorded that the portal isn't being used",
    "worker.participant.viewed": "Viewed the participant's profile",
    "worker.sessions.viewed": "Viewed the participant's shift notes",
    "worker.safety_protocol.acknowledged": "Acknowledged the safety plan",
}


PORTAL_PAGES: dict[str, str] = {
    "ndis_plan": "NDIS plan",
    "service_agreement": "service agreement",
    "overview": "home page",
    "invoices": "invoices",
    "schedule": "schedule",
    "documents": "documents",
}


def _is_missing_schema(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg or "pgrst204" in msg or "42703" in msg


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _to_date(value: Any) -> Optional[date]:
    if not value:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except ValueError:
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError:
            return None


def _rows(table: str, select: str, **eq: Any) -> list[dict[str, Any]]:
    """Rows from one table, or [] if the table or a column isn't there yet."""
    try:
        query = get_supabase_admin().table(table).select(select)
        for key, value in eq.items():
            query = query.eq(key, value)
        return query.execute().data or []
    except Exception as exc:
        logger.warning("director participant: could not read %s: %s", table, exc)
        return []


def _names(user_ids: set[str], org_id: str) -> dict[str, dict[str, Any]]:
    ids = sorted(i for i in user_ids if i)
    if not ids:
        return {}
    try:
        rows = (
            get_supabase_admin().table("users").select("id, full_name, email, role")
            .in_("id", ids).eq("organization_id", org_id).execute()
        ).data or []
    except Exception as exc:
        logger.warning("director participant: user lookup failed: %s", exc)
        return {}
    return {r["id"]: r for r in rows}


def _person(user_id: Optional[str], people: dict[str, dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not user_id:
        return None
    row = people.get(user_id)
    return {"id": user_id, "name": (row or {}).get("full_name") or "Former staff member"}


async def require_participant(participant_id: str, org_id: str, current_user: dict) -> dict[str, Any]:
    participant = await participant_service.get_participant_by_id(participant_id, current_user)
    if not participant or str(participant.get("organization_id")) != str(org_id):
        raise HTTPException(status_code=404, detail="Participant not found.")
    return participant


def intake_for_participant(participant_id: str, org_id: str) -> Optional[dict[str, Any]]:
    rows = _rows(participant_intake_service.TABLE, "*", organization_id=org_id, participant_id=participant_id)
    if not rows:
        return None
    return sorted(rows, key=lambda r: r.get("updated_at") or "", reverse=True)[0]


# ── The summary ──────────────────────────────────────────────────────────────

def _funding(budget: dict[str, Any], plan_start: Optional[date], plan_end: Optional[date], today: date) -> dict[str, Any]:
    total = float(budget.get("total_funding") or budget.get("total_allocated") or 0)
    used = float(budget.get("total_used") or 0)
    percent_used = round(used / total * 100, 1) if total else None
    percent_time = None
    if plan_start and plan_end and plan_end > plan_start:
        elapsed = (min(max(today, plan_start), plan_end) - plan_start).days
        percent_time = round(elapsed / (plan_end - plan_start).days * 100, 1)
    categories = [
        {
            "category": b.get("category"),
            "label": b.get("category_label") or b.get("category") or "Budget",
            "allocated": float(b.get("allocated") or 0),
            "used": float(b.get("used") or 0),
            "remaining": float(b.get("remaining") or 0),
            "percent_used": b.get("percent_used"),
            "overspent": bool(b.get("overspent")),
        }
        for b in budget.get("budgets") or []
    ]
    return {
        "has_plan": bool(budget.get("has_plan")),
        "plan_number": budget.get("plan_number"),
        "total": total,
        "used": used,
        "remaining": float(budget.get("total_remaining") or max(total - used, 0)),
        "percent_used": percent_used,
        "percent_time_elapsed": percent_time,
        "ahead_by": round(percent_used - percent_time, 1) if percent_used is not None and percent_time is not None else None,
        "categories": categories,
    }


def _delivery(shifts: list[dict[str, Any]], people: dict[str, dict[str, Any]], now: datetime) -> dict[str, Any]:
    past_cutoff = now - timedelta(days=30)
    soon_cutoff = now + timedelta(days=14)

    def start_of(s: dict[str, Any]) -> Optional[datetime]:
        try:
            return datetime.fromisoformat(str(s.get("scheduled_start")).replace("Z", "+00:00"))
        except ValueError:
            return None

    completed = cancelled = 0
    minutes = 0
    upcoming: list[dict[str, Any]] = []
    last_completed: Optional[datetime] = None
    for s in shifts:
        start = start_of(s)
        if not start:
            continue
        status = s.get("status")
        if past_cutoff <= start <= now:
            if status == "completed":
                completed += 1
                minutes += int(s.get("duration_minutes") or 0)
            elif status == "cancelled":
                cancelled += 1
        if status == "completed" and (last_completed is None or start > last_completed):
            last_completed = start
        if now < start <= soon_cutoff and status in SCHEDULED_STATUSES:
            upcoming.append(s)
    upcoming.sort(key=lambda s: s.get("scheduled_start") or "")
    unfilled = [s for s in upcoming if not s.get("worker_id") or s.get("status") == "unassigned"]
    next_shift = upcoming[0] if upcoming else None
    return {
        "completed_30d": completed,
        "cancelled_30d": cancelled,
        "hours_30d": round(minutes / 60, 1),
        "upcoming_14d": len(upcoming),
        "unfilled_14d": len(unfilled),
        "next_shift": {
            "id": next_shift["id"],
            "start": next_shift.get("scheduled_start"),
            "end": next_shift.get("scheduled_end"),
            "worker": _person(next_shift.get("worker_id"), people),
        } if next_shift else None,
        "last_shift_at": last_completed.isoformat() if last_completed else None,
    }


def _quality(sessions: list[dict[str, Any]], now: datetime) -> dict[str, Any]:
    cutoff = (now - timedelta(days=30)).date()
    recent = [s for s in sessions if (_to_date(s.get("session_date")) or date.min) >= cutoff]
    scores = [float(s["compliance_score"]) for s in recent if s.get("compliance_score") is not None]
    attention = [
        s for s in recent
        if s.get("compliance_status") not in (None, "compliant") or (s.get("compliance_score") is not None and float(s["compliance_score"]) < 80)
    ]
    return {
        "notes_30d": len(recent),
        "average_score": round(sum(scores) / len(scores), 1) if scores else None,
        "needs_attention_30d": len(attention),
    }


def _risk(incidents: list[dict[str, Any]], complaints: list[dict[str, Any]]) -> dict[str, Any]:
    open_incidents = [i for i in incidents if (i.get("status") or "").lower() in OPEN_INCIDENT_STATUSES]
    open_complaints = [c for c in complaints if c.get("status") in ("open", "in_review")]
    latest = sorted(incidents, key=lambda i: i.get("incident_date") or "", reverse=True)

    def incident(i: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": i["id"], "title": i.get("title") or "Incident", "severity": i.get("severity"),
            "status": i.get("status"), "date": i.get("incident_date"),
            "reference": i.get("reference_number"), "ndis_reportable": bool(i.get("ndis_reportable")),
        }

    return {
        "incidents_total": len(incidents),
        "incidents_open": [incident(i) for i in open_incidents],
        "latest_incident": incident(latest[0]) if latest else None,
        "complaints_total": len(complaints),
        "complaints_open": [
            {"id": c["id"], "subject": c.get("subject"), "status": c.get("status"), "filed_at": c.get("filed_at")}
            for c in open_complaints
        ],
    }


def _medication(meds: list[dict[str, Any]]) -> dict[str, Any]:
    current = [m for m in meds if m.get("status") not in ("rejected", "discontinued", "ceased", "archived")]
    return {
        "active": sum(1 for m in current if m.get("status") == "active"),
        "pending_verification": sum(1 for m in current if m.get("status") in ("pending", "pending_verification", "draft")),
        "high_risk": sum(1 for m in current if m.get("is_high_risk")),
        "prn": sum(1 for m in current if m.get("is_prn")),
    }


def _agreement(agreements: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not agreements:
        return None
    order = {"active": 0, "signed": 1, "sent": 2, "draft": 3}
    best = sorted(agreements, key=lambda a: (order.get(a.get("status"), 9), -(len(a.get("end_date") or ""))))[0]
    return {
        "id": best["id"], "status": best.get("status"), "number": best.get("agreement_number"),
        "start_date": best.get("start_date"), "end_date": best.get("end_date"),
        "signed_date": best.get("signed_date"),
    }


def decisions_for(summary: dict[str, Any], today: date) -> list[dict[str, Any]]:
    """What needs the director's call, most urgent first. Pure: built from the
    summary alone so the rules can be tested without a database."""
    out: list[dict[str, Any]] = []

    def add(key: str, tone: str, title: str, detail: str, action: str) -> None:
        out.append({"key": key, "tone": tone, "title": title, "detail": detail, "action": action})

    participant = summary.get("participant") or {}
    plan_end = _to_date(participant.get("plan_end_date"))
    if plan_end:
        days = (plan_end - today).days
        review = _to_date(participant.get("upcoming_review_date"))
        review_note = (
            f"A plan review is set for {review.day} {review.strftime('%b %Y')}."
            if review and review >= today else "No plan review is booked."
        )
        if days < 0:
            add("plan_ended", "danger", "The NDIS plan has ended", f"It ended {-days} days ago. Supports can't be claimed against it.", "plan")
        elif days <= 90:
            add("plan_ending", "danger" if days <= 30 else "warning", f"Plan ends in {days} days", review_note, "plan")

    funding = summary.get("funding") or {}
    for cat in funding.get("categories") or []:
        if cat.get("overspent"):
            add(f"overspent_{cat.get('category')}", "danger", f"{cat['label']} is overspent", "More has been delivered than this budget holds.", "funding")
    ahead = funding.get("ahead_by")
    if ahead is not None and ahead >= 10 and funding.get("percent_used") is not None:
        add(
            "spending_ahead", "danger" if ahead >= 25 else "warning",
            f"Spending is ahead of the plan by {round(ahead)} points",
            f"{round(funding['percent_used'])}% of the funding is used with {round(funding.get('percent_time_elapsed') or 0)}% of the plan's time gone.",
            "funding",
        )

    risk = summary.get("risk") or {}
    for incident in (risk.get("incidents_open") or [])[:3]:
        serious = incident.get("ndis_reportable") or (incident.get("severity") or "").lower() in SERIOUS_SEVERITIES
        add(
            f"incident_{incident['id']}", "danger" if serious else "warning",
            f"Open incident: {incident['title']}",
            ("NDIS reportable. " if incident.get("ndis_reportable") else "") + "Still being investigated.",
            "incident",
        )
    for complaint in (risk.get("complaints_open") or [])[:3]:
        add(f"complaint_{complaint['id']}", "warning", f"Complaint in review: {complaint.get('subject') or 'Complaint'}", "Waiting on a response to the participant.", "complaint")

    delivery = summary.get("delivery") or {}
    if delivery.get("unfilled_14d"):
        n = delivery["unfilled_14d"]
        add("unfilled", "danger", f"{n} upcoming shift{'s have' if n != 1 else ' has'} no worker", "In the next 14 days.", "roster")

    team = summary.get("team") or {}
    if not team.get("main_worker"):
        add("no_main_worker", "warning", "No main worker", "Nobody is set as this participant's main support worker.", "team")
    elif not team.get("backups"):
        add("no_backup", "warning", "No backup worker", "If the main worker is away, no one familiar can step in.", "team")
    if not team.get("coordinator"):
        add("no_coordinator", "warning", "No coordinator", "Nobody is responsible for this participant day to day.", "team")

    agreement = summary.get("agreement")
    if not agreement:
        add("no_agreement", "danger", "No service agreement", "Supports shouldn't be delivered or claimed without one.", "agreement")
    else:
        end = _to_date(agreement.get("end_date"))
        if agreement.get("status") not in ("active", "signed"):
            add("agreement_unsigned", "warning", "Service agreement isn't signed", f"It's {agreement.get('status') or 'not active'}.", "agreement")
        elif end and (end - today).days <= 30:
            days = (end - today).days
            add("agreement_ending", "danger" if days < 0 else "warning",
                "Service agreement has ended" if days < 0 else f"Service agreement ends in {days} days",
                "Renew it so supports can keep being delivered.", "agreement")

    quality = summary.get("quality") or {}
    if quality.get("needs_attention_30d"):
        n = quality["needs_attention_30d"]
        add("notes", "warning", f"{n} shift note{'s need' if n != 1 else ' needs'} attention", "From the last 30 days.", "quality")

    medication = summary.get("medication") or {}
    if medication.get("pending_verification"):
        n = medication["pending_verification"]
        add("meds_pending", "warning", f"{n} medication{'s are' if n != 1 else ' is'} waiting to be verified", "Workers can't give unverified medication.", "medication")

    rank = {"danger": 0, "warning": 1}
    return sorted(out, key=lambda d: rank.get(d["tone"], 2))


async def build_overview(participant_id: str, org_id: str, current_user: dict) -> dict[str, Any]:
    participant = await require_participant(participant_id, org_id, current_user)
    now = _now()
    # "Today" where the director is, so day counts match what they see.
    today = now.astimezone(request_timezone()).date()

    intake = intake_for_participant(participant_id, org_id)
    allocations = [a for a in _rows("practitioner_allocations", "id, user_id, allocated_role, is_active", patient_id=participant_id, organization_id=org_id) if a.get("is_active") is not False]
    shifts = _rows("shifts", "id, worker_id, scheduled_start, scheduled_end, status, duration_minutes", participant_id=participant_id, organization_id=org_id)
    sessions = _rows("sessions", "id, session_date, compliance_score, compliance_status, status", patient_id=participant_id, organization_id=org_id)
    incidents = _rows("incidents", "id, title, severity, status, incident_date, reference_number, ndis_reportable", participant_id=participant_id, organization_id=org_id)
    complaints = _rows("participant_complaints", "id, subject, status, filed_at", participant_id=participant_id, organization_id=org_id)
    meds = _rows("medications", "id, status, is_prn, is_high_risk", participant_id=participant_id, organization_id=org_id)
    agreements = _rows("service_agreements", "id, status, agreement_number, start_date, end_date, signed_date", participant_id=participant_id, organization_id=org_id)

    main_id = participant.get("assigned_worker_id")
    coordinator_id = participant.get("care_coordinator_id")
    people = _names(
        {main_id, coordinator_id} | {a["user_id"] for a in allocations} | {s.get("worker_id") for s in shifts},
        org_id,
    )
    backups = [
        {"id": a["user_id"], "name": (people.get(a["user_id"]) or {}).get("full_name") or "Former staff member", "allocation_id": a["id"]}
        for a in allocations
        if a.get("user_id") != main_id and a.get("allocated_role", "support_worker") == "support_worker"
    ]

    try:
        budget = await funding_service.get_budget_summary(participant_id)
    except Exception as exc:
        logger.warning("director participant: budget summary failed: %s", exc)
        budget = {}

    try:
        from . import participant_portal_access_service
        portal = participant_portal_access_service.portal_summary(participant_id, org_id)
        portal = {
            "status": portal.get("status"),
            "people": [
                {"name": a.get("full_name"), "relationship": a.get("relationship"), "status": a.get("status")}
                for a in portal.get("access") or [] if a.get("status") != "revoked"
            ],
        }
    except Exception as exc:
        logger.warning("director participant: portal summary failed: %s", exc)
        portal = {"status": None, "people": []}

    summary: dict[str, Any] = {
        "participant": {
            k: participant.get(k) for k in (
                "id", "full_name", "preferred_name", "ndis_number", "date_of_birth", "phone", "email",
                "address", "primary_disability", "risk_level", "plan_status", "plan_start_date", "plan_end_date",
                "plan_management_type", "upcoming_review_date", "service_category", "profile_photo_url",
            )
        },
        "intake": {
            k: (intake or {}).get(k) for k in (
                "id", "status", "activated_at", "suspended_reason", "suspended_at", "reactivated_at",
                "exit_reason", "exited_at", "last_service_date", "service_category",
            )
        } if intake else None,
        "team": {
            "coordinator": _person(coordinator_id, people),
            "main_worker": _person(main_id, people),
            "backups": backups,
        },
        "funding": _funding(budget or {}, _to_date(participant.get("plan_start_date")), _to_date(participant.get("plan_end_date")), today),
        "delivery": _delivery(shifts, people, now),
        "quality": _quality(sessions, now),
        "risk": _risk(incidents, complaints),
        "medication": _medication(meds),
        "agreement": _agreement(agreements),
        "portal": portal,
    }
    summary["decisions"] = decisions_for(summary, today)
    return summary


# ── Care team ────────────────────────────────────────────────────────────────

def _staff_member(user_id: str, org_id: str, roles: set[str], what: str) -> dict[str, Any]:
    rows = _rows("users", "id, full_name, role, is_active", id=user_id, organization_id=org_id)
    if not rows or rows[0].get("role") not in roles or rows[0].get("is_active") is False:
        raise HTTPException(status_code=422, detail=f"Choose an active {what} in your organisation.")
    return rows[0]


async def change_team(
    participant_id: str,
    org_id: str,
    current_user: dict,
    *,
    coordinator_id: Optional[str],
    main_worker_id: Optional[str],
    backup_worker_ids: list[str],
) -> dict[str, Any]:
    participant = await require_participant(participant_id, org_id, current_user)
    actor = str(current_user.get("id") or current_user.get("sub") or "")
    supabase = get_supabase_admin()

    if coordinator_id:
        _staff_member(coordinator_id, org_id, {"support_coordinator", "managing_director"}, "coordinator")
    if main_worker_id:
        _staff_member(main_worker_id, org_id, {"support_worker"}, "support worker")
    backups = [b for b in dict.fromkeys(backup_worker_ids) if b and b != main_worker_id]
    for worker_id in backups:
        _staff_member(worker_id, org_id, {"support_worker"}, "support worker")

    before = await build_team_snapshot(participant, org_id)
    supabase.table("participants").update({
        "care_coordinator_id": coordinator_id,
        "assigned_worker_id": main_worker_id,
    }).eq("id", participant_id).eq("organization_id", org_id).execute()

    # Allocations: the main worker and the backups are allocated; anyone else
    # who was is taken off (deactivated, so the history stays).
    wanted = set(backups) | ({main_worker_id} if main_worker_id else set())
    current = _rows("practitioner_allocations", "id, user_id, allocated_role, is_active", patient_id=participant_id, organization_id=org_id)
    current_workers = {a["user_id"]: a for a in current if a.get("allocated_role", "support_worker") == "support_worker"}
    for user_id, row in current_workers.items():
        if user_id not in wanted and row.get("is_active") is not False:
            supabase.table("practitioner_allocations").update({"is_active": False}).eq("id", row["id"]).execute()
        elif user_id in wanted and row.get("is_active") is False:
            supabase.table("practitioner_allocations").update({"is_active": True, "assigned_by": actor or None}).eq("id", row["id"]).execute()
    for user_id in wanted - set(current_workers):
        supabase.table("practitioner_allocations").insert({
            "patient_id": participant_id, "user_id": user_id, "allocated_role": "support_worker",
            "is_active": True, "assigned_by": actor or None, "organization_id": org_id,
        }).execute()

    after = {"coordinator_id": coordinator_id, "main_worker_id": main_worker_id, "backup_worker_ids": sorted(backups)}
    await audit_service.log_action(
        action_type="participant.team_changed", entity_type="participant", entity_id=participant_id,
        user_id=actor, organization_id=org_id, before_state=before, after_state=after,
    )
    return after


async def build_team_snapshot(participant: dict[str, Any], org_id: str) -> dict[str, Any]:
    allocations = _rows("practitioner_allocations", "user_id, allocated_role, is_active", patient_id=participant["id"], organization_id=org_id)
    main = participant.get("assigned_worker_id")
    return {
        "coordinator_id": participant.get("care_coordinator_id"),
        "main_worker_id": main,
        "backup_worker_ids": sorted(
            a["user_id"] for a in allocations
            if a.get("is_active") is not False and a.get("user_id") != main and a.get("allocated_role", "support_worker") == "support_worker"
        ),
    }


# ── Services: suspend, resume, end ───────────────────────────────────────────

async def change_services(
    participant_id: str,
    org_id: str,
    current_user: dict,
    *,
    action: str,
    reason: Optional[str],
    last_service_date: Optional[str],
    cancel_future_shifts: bool,
    revoke_portal_access: bool,
) -> dict[str, Any]:
    await require_participant(participant_id, org_id, current_user)
    intake = intake_for_participant(participant_id, org_id)
    if not intake:
        raise HTTPException(status_code=409, detail="This participant has no onboarding record to update.")
    actor = str(current_user.get("id") or current_user.get("sub") or "")
    reason = (reason or "").strip()
    status_now = intake.get("status")

    if action == "suspend":
        if not reason:
            raise HTTPException(status_code=422, detail="Give a reason for suspending services.")
        updated = await participant_intake_service.update_intake(
            intake["id"], org_id, {"status": "inactive", "suspended_reason": reason}, current_user,
        )
        await audit_service.log_action(
            action_type="participant.services_suspended", entity_type="participant", entity_id=participant_id,
            user_id=actor, organization_id=org_id, details={"reason": reason},
        )
        return {"intake": updated, "cancelled_shifts": 0}

    if action == "resume":
        updated = await participant_intake_service.update_intake(intake["id"], org_id, {"status": "active"}, current_user)
        get_supabase_admin().table(participant_intake_service.TABLE).update(
            {"reactivated_at": _now().isoformat()}
        ).eq("id", intake["id"]).eq("organization_id", org_id).execute()
        await audit_service.log_action(
            action_type="participant.services_resumed", entity_type="participant", entity_id=participant_id,
            user_id=actor, organization_id=org_id,
        )
        return {"intake": updated, "cancelled_shifts": 0}

    if action != "end":
        raise HTTPException(status_code=422, detail="Unknown action.")
    if status_now not in ("active", "inactive"):
        raise HTTPException(status_code=409, detail="Only a participant receiving or paused from services can be exited.")
    if not reason:
        raise HTTPException(status_code=422, detail="Give a reason for ending services.")
    last_day = _to_date(last_service_date) or _now().date()

    try:
        resp = (
            get_supabase_admin().table(participant_intake_service.TABLE)
            .update({
                "status": "exited", "exit_reason": reason, "exited_at": _now().isoformat(),
                "last_service_date": last_day.isoformat(), "updated_at": _now().isoformat(),
            })
            .eq("id", intake["id"]).eq("organization_id", org_id).execute()
        )
    except Exception as exc:
        if _is_missing_schema(exc) or "check constraint" in str(exc).lower() or "23514" in str(exc):
            raise HTTPException(
                status_code=503,
                detail="Ending services needs a database update that hasn't been applied yet (migration 247).",
            ) from exc
        raise HTTPException(status_code=500, detail=internal_error_detail("Could not end services", exc)) from exc

    # The plan_status check allows active, pending, review and completed.
    try:
        get_supabase_admin().table("participants").update({"plan_status": "completed"}).eq("id", participant_id).eq("organization_id", org_id).execute()
    except Exception as exc:
        logger.warning("director participant: could not close plan status for %s: %s", participant_id, exc)

    cancelled = 0
    if cancel_future_shifts:
        cutoff = datetime.combine(last_day + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc).isoformat()
        future = [
            s for s in _rows("shifts", "id, status, scheduled_start", participant_id=participant_id, organization_id=org_id)
            if s.get("status") in SCHEDULED_STATUSES and (s.get("scheduled_start") or "") >= cutoff
        ]
        for shift in future:
            try:
                get_supabase_admin().table("shifts").update({
                    "status": "cancelled", "cancellation_reason": f"Services ended: {reason}",
                    "updated_at": _now().isoformat(),
                }).eq("id", shift["id"]).eq("organization_id", org_id).execute()
                cancelled += 1
            except Exception as exc:
                logger.warning("director participant: could not cancel shift %s: %s", shift["id"], exc)

    revoked = 0
    if revoke_portal_access:
        from . import participant_portal_access_service
        for row in _rows("participant_portal_access", "id, status", participant_id=participant_id, organization_id=org_id):
            if row.get("status") != "revoked":
                try:
                    await participant_portal_access_service.revoke_access(
                        access_id=row["id"], org_id=org_id, actor_id=actor, reason=f"Services ended: {reason}",
                    )
                    revoked += 1
                except Exception as exc:
                    logger.warning("director participant: could not revoke portal access %s: %s", row["id"], exc)

    await audit_service.log_action(
        action_type="participant.services_ended", entity_type="participant", entity_id=participant_id,
        user_id=actor, organization_id=org_id,
        details={"reason": reason, "last_service_date": last_day.isoformat(), "cancelled_shifts": cancelled, "portal_access_removed": revoked},
    )
    return {"intake": (resp.data or [intake])[0], "cancelled_shifts": cancelled, "portal_access_removed": revoked}


# ── Documents ────────────────────────────────────────────────────────────────

def _refresh_vault(org_id: str, category: str) -> None:
    """The vault caches each folder for a few minutes; drop it so a document
    imported or archived here shows there straight away."""
    try:
        from . import vault_service
        vault_service.forget_category_docs(org_id, category)
    except Exception as exc:
        logger.warning("director participant: vault cache refresh failed: %s", exc)


def list_documents(participant_id: str, org_id: str) -> dict[str, Any]:
    available = True
    try:
        own = (
            get_supabase_admin().table(DOCUMENTS_TABLE).select("*")
            .eq("participant_id", participant_id).eq("organization_id", org_id)
            .is_("archived_at", "null").order("uploaded_at", desc=True).execute()
        ).data or []
    except Exception as exc:
        if not _is_missing_schema(exc):
            raise
        own, available = [], False
    meds = [
        d for d in medication_document_service.list_documents_for_participant(participant_id, org_id)
        if d.get("document_type") != "verification_photo" and not d.get("superseded_at")
    ]
    people = _names({d.get("uploaded_by") for d in own + meds}, org_id)

    def uploader(user_id: Optional[str]) -> Optional[str]:
        return (people.get(user_id or "") or {}).get("full_name")

    documents = [
        {
            "id": d["id"], "source": "participant", "category": d.get("category"),
            "category_label": DOCUMENT_CATEGORIES.get(d.get("category") or "", "Document"),
            "title": d.get("title") or d.get("file_name"), "document_date": d.get("document_date"),
            "author": d.get("author"), "notes": d.get("notes"), "file_name": d.get("file_name"),
            "file_type": d.get("file_type"), "file_size": d.get("file_size"),
            "uploaded_at": d.get("uploaded_at"), "uploaded_by": uploader(d.get("uploaded_by")),
        }
        for d in own
    ] + [
        {
            "id": d["id"], "source": "medication", "category": d.get("document_type"),
            "category_label": MEDICATION_CATEGORIES.get(d.get("document_type") or "", "Medication document"
                                                        if d.get("document_type") != "gp_letter" else "GP letter"),
            "title": d.get("file_name"), "document_date": None, "author": None, "notes": None,
            "file_name": d.get("file_name"), "file_type": d.get("file_type"), "file_size": d.get("file_size"),
            "uploaded_at": d.get("uploaded_at"), "uploaded_by": uploader(d.get("uploaded_by")),
            "extraction_status": d.get("extraction_status"),
        }
        for d in meds
    ]
    documents.sort(key=lambda d: d.get("uploaded_at") or "", reverse=True)
    return {"documents": documents, "available": available}


async def upload_document(
    participant_id: str,
    org_id: str,
    current_user: dict,
    *,
    file_bytes: bytes,
    filename: str,
    content_type: str,
    category: str,
    title: Optional[str],
    document_date: Optional[str],
    author: Optional[str],
    notes: Optional[str],
) -> dict[str, Any]:
    await require_participant(participant_id, org_id, current_user)
    actor = str(current_user.get("id") or current_user.get("sub") or "")

    if category in MEDICATION_CATEGORIES:
        result = await medication_document_service.upload_document(
            participant_id, org_id, actor, file_bytes=file_bytes, filename=filename,
            content_type=content_type, document_type=category,
        )
        await audit_service.log_action(
            action_type="participant.document_uploaded", entity_type="participant", entity_id=participant_id,
            user_id=actor, organization_id=org_id,
            details={"document_id": result["document"]["id"], "category": category, "file_name": filename, "store": "medication"},
        )
        _refresh_vault(org_id, "medication_records")
        return {"source": "medication", **result}

    if category not in DOCUMENT_CATEGORIES:
        raise HTTPException(status_code=422, detail="Choose what kind of document this is.")
    resolved = content_type or mimetypes.guess_type(filename)[0] or ""
    if resolved not in ALLOWED_DOCUMENT_TYPES:
        raise HTTPException(status_code=422, detail="Upload a PDF, Word document, or a JPEG, PNG or WEBP image.")
    if len(file_bytes) > MAX_DOCUMENT_BYTES:
        raise HTTPException(status_code=413, detail="Documents must be 20MB or smaller.")
    if not file_bytes:
        raise HTTPException(status_code=422, detail="The file is empty.")

    document_id = str(uuid4())
    path = f"{org_id}/{participant_id}/{document_id}{ALLOWED_DOCUMENT_TYPES[resolved]}"
    record = {
        "id": document_id, "organization_id": org_id, "participant_id": participant_id,
        "category": category, "title": (title or "").strip() or filename,
        "document_date": (_to_date(document_date) or None) and _to_date(document_date).isoformat(),
        "author": (author or "").strip() or None, "notes": (notes or "").strip() or None,
        "file_path": path, "file_name": filename, "file_type": resolved, "file_size": len(file_bytes),
        "uploaded_by": actor or None,
    }
    supabase = get_supabase_admin()
    try:
        supabase.table(DOCUMENTS_TABLE).select("id").limit(1).execute()
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Participant documents need a database update that hasn't been applied yet (migration 247).") from exc
        raise
    try:
        supabase.storage.from_(DOCUMENTS_BUCKET).upload(path, file_bytes, {"content-type": resolved, "upsert": "false"})
    except Exception as exc:
        raise HTTPException(status_code=502, detail=internal_error_detail("Document storage is not available", exc)) from exc
    row = (supabase.table(DOCUMENTS_TABLE).insert(record).execute().data or [record])[0]

    try:
        from .compliance_evidence_service import record_file_evidence_metadata
        record_file_evidence_metadata(
            evidence_id=document_id, organization_id=org_id, uploaded_by=actor, raw_bytes=file_bytes,
            mime_type=resolved, storage_path=path, storage_provider="supabase", evidence_type="document",
            file_url=None, shift_id=None,
        )
    except Exception as exc:
        logger.warning("director participant: evidence metadata failed for %s: %s", document_id, exc)

    await audit_service.log_action(
        action_type="participant.document_uploaded", entity_type="participant", entity_id=participant_id,
        user_id=actor, organization_id=org_id,
        details={"document_id": document_id, "category": category, "title": record["title"], "file_name": filename},
    )
    _refresh_vault(org_id, "participant_documents")
    return {"source": "participant", "document": row}


async def document_link(participant_id: str, org_id: str, current_user: dict, *, source: str, document_id: str) -> dict[str, Any]:
    await require_participant(participant_id, org_id, current_user)
    table, bucket = (DOCUMENTS_TABLE, DOCUMENTS_BUCKET) if source == "participant" else ("medication_documents", medication_document_service.BUCKET)
    rows = _rows(table, "id, file_path, file_name", id=document_id, participant_id=participant_id, organization_id=org_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Document not found.")
    try:
        signed = get_supabase_admin().storage.from_(bucket).create_signed_url(rows[0]["file_path"], 600)
        url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=internal_error_detail("Could not open the document", exc)) from exc
    if not url:
        raise HTTPException(status_code=502, detail="Could not open the document.")
    await audit_service.log_action(
        action_type="participant.document_viewed", entity_type="participant", entity_id=participant_id,
        user_id=str(current_user.get("id") or current_user.get("sub") or ""), organization_id=org_id,
        details={"document_id": document_id, "file_name": rows[0].get("file_name"), "store": source},
    )
    return {"url": url, "file_name": rows[0].get("file_name")}


async def archive_document(participant_id: str, org_id: str, current_user: dict, *, document_id: str, reason: str) -> None:
    await require_participant(participant_id, org_id, current_user)
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Say why this document is being archived.")
    actor = str(current_user.get("id") or current_user.get("sub") or "")
    resp = (
        get_supabase_admin().table(DOCUMENTS_TABLE)
        .update({"archived_at": _now().isoformat(), "archived_by": actor or None, "archive_reason": reason})
        .eq("id", document_id).eq("participant_id", participant_id).eq("organization_id", org_id)
        .is_("archived_at", "null").execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Document not found.")
    await audit_service.log_action(
        action_type="participant.document_archived", entity_type="participant", entity_id=participant_id,
        user_id=actor, organization_id=org_id, details={"document_id": document_id, "reason": reason},
    )
    _refresh_vault(org_id, "participant_documents")


# ── Audit trail ──────────────────────────────────────────────────────────────

def describe_audit_entry(entry: dict[str, Any]) -> str:
    action = entry.get("action_type") or ""
    label = AUDIT_LABELS.get(action)
    details = entry.get("details") or {}
    if action == "participant.document_uploaded" and details.get("title"):
        return f"Uploaded {details['title']}"
    if action in ("participant.document_viewed",) and details.get("file_name"):
        return f"Opened {details['file_name']}"
    if action in ("participant.services_suspended", "participant.services_ended") and details.get("reason"):
        return f"{label}: {details['reason']}"
    if label:
        return label
    # The participant or family looking at something in the portal
    # (participant_portal.{what}_viewed).
    if action.startswith("participant_portal.") and action.endswith("_viewed"):
        what = action[len("participant_portal."):-len("_viewed")]
        return f"Viewed their {PORTAL_PAGES.get(what, what.replace('_', ' '))} in the portal"
    return action.replace("participant.", "").replace("participant_portal.", "portal ").replace("_", " ").replace(".", " ").capitalize() or "Changed the record"


async def audit_trail(participant_id: str, org_id: str, current_user: dict, *, limit: int = 100) -> list[dict[str, Any]]:
    await require_participant(participant_id, org_id, current_user)
    entries = await audit_service.get_entity_audit_trail("participant", participant_id, org_id)
    return [
        {
            "id": e.get("id"), "when": e.get("created_at"), "who": e.get("actor_name") or "System",
            "what": describe_audit_entry(e), "action_type": e.get("action_type"),
            "kind": "view" if (e.get("action_type") or "").endswith(("viewed",)) else "change",
        }
        for e in entries[:limit]
    ]
