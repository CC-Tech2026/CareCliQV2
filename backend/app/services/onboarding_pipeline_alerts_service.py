"""Staff Onboarding pipeline — "who's stuck right now," as a queryable list.

The remind-then-escalate passes for each stage already exist
(applicant_stage_reminder_service.py, offer_letter_reminder_service.py,
onboarding_escalation_service.py) — they fire notifications on a schedule
but were never queryable as a live list. This reuses their exact
thresholds and tables (never re-deriving a different number for the same
concept) and reshapes the result into the same alert shape already proven
on the Governance and Care Delivery tabs, so the same GovernanceTriage
frontend component can render this too.

Category split: "urgent" when an automatic, consequential action (offer
auto-expiry, worker auto-deactivation) is 2 days or less away — a real
ticking clock. "exposure" for everything else that's just stuck without an
imminent automatic consequence.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from . import applicant_stage_reminder_service as applicant_reminders
from . import offer_letter_reminder_service as offer_reminders
from . import onboarding_escalation_service as escalation
from .supabase_client import get_supabase_admin

_URGENT_WITHIN_DAYS = 2


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return "does not exist" in err or "42703" in err or "pgrst" in err or "could not find" in err


def _days_since(iso_value: str, now: datetime) -> int | None:
    try:
        then = datetime.fromisoformat(str(iso_value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return max(0, (now - then).days)


def _applicant_alerts(org_id: str, now: datetime) -> list[dict[str, Any]]:
    try:
        rows = (
            get_supabase_admin()
            .table("applicants")
            .select("id, full_name, stage, stage_entered_at")
            .eq("organization_id", org_id)
            .in_("stage", ["applied", "interview"])
            .execute()
            .data
            or []
        )
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        raise

    stage_label = {"applied": "Applied", "interview": "Interview"}
    alerts: list[dict[str, Any]] = []
    for row in rows:
        days = _days_since(row.get("stage_entered_at"), now)
        if days is None or days < applicant_reminders.REMINDER_AFTER_DAYS:
            continue
        name = row.get("full_name") or "A candidate"
        label = stage_label.get(row["stage"], row["stage"])
        alerts.append({
            "id": f"applicant-stuck-{row['id']}",
            "title": f"{name}: stuck in {label} for {days} days",
            "detail": f"No stage change since day {days}. Worth a follow-up or a decision to move them on.",
            "severity": "critical" if days >= 7 else "high",
            "affected_staff": [],
            "action_label": "View Candidate",
            "source": "onboarding-applicant",
            "category": "exposure",
        })
    return alerts


def _hire_awaiting_signature_alerts(org_id: str, now: datetime) -> list[dict[str, Any]]:
    try:
        rows = (
            get_supabase_admin()
            .table("employee_onboarding")
            .select("id, full_name, employer_signed_at")
            .eq("organization_id", org_id)
            .eq("status", "awaiting_signatures")
            .execute()
            .data
            or []
        )
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        raise

    alerts: list[dict[str, Any]] = []
    for row in rows:
        days = _days_since(row.get("employer_signed_at"), now)
        if days is None or days < offer_reminders.REMINDER_AFTER_DAYS:
            continue
        name = row.get("full_name") or "A candidate"
        days_left = offer_reminders.EXPIRE_AFTER_DAYS - days
        urgent = days_left <= _URGENT_WITHIN_DAYS
        alerts.append({
            "id": f"hire-unsigned-{row['id']}",
            "title": f"{name}: offer unsigned for {days} days",
            "detail": (
                f"Auto-expires in {max(days_left, 0)} day{'s' if days_left != 1 else ''} "
                f"if still unsigned (day {days} of {offer_reminders.EXPIRE_AFTER_DAYS})."
            ),
            "severity": "critical" if urgent else "high",
            "due_date": (date.today().isoformat() if days_left <= 0 else None),
            "affected_staff": [],
            "action_label": "View Hire",
            "source": "onboarding-hire",
            "category": "urgent" if urgent else "exposure",
        })
    return alerts


def _hire_invited_alerts(org_id: str, now: datetime) -> list[dict[str, Any]]:
    try:
        rows = (
            get_supabase_admin()
            .table("employee_onboarding")
            .select("id, full_name, invited_at")
            .eq("organization_id", org_id)
            .eq("status", "invited")
            .execute()
            .data
            or []
        )
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        raise

    alerts: list[dict[str, Any]] = []
    for row in rows:
        days = _days_since(row.get("invited_at"), now)
        if days is None or days < offer_reminders.INVITE_REMINDER_AFTER_DAYS:
            continue
        name = row.get("full_name") or "A candidate"
        days_left = offer_reminders.INVITE_EXPIRE_AFTER_DAYS - days
        urgent = days_left <= _URGENT_WITHIN_DAYS
        alerts.append({
            "id": f"hire-invited-{row['id']}",
            "title": f"{name}: hasn't logged in for {days} days",
            "detail": (
                f"Invite link expires in {max(days_left, 0)} day{'s' if days_left != 1 else ''} "
                f"(day {days} of {offer_reminders.INVITE_EXPIRE_AFTER_DAYS}). A fresh invite will be needed after that."
            ),
            "severity": "critical" if urgent else "high",
            "affected_staff": [],
            "action_label": "View Hire",
            "source": "onboarding-hire",
            "category": "urgent" if urgent else "exposure",
        })
    return alerts


def _worker_stage_blocked_alerts(org_id: str, now: datetime) -> list[dict[str, Any]]:
    try:
        rows = (
            get_supabase_admin()
            .table("onboarding_stage_reminders")
            .select("id, worker_id, stage, first_flagged_at")
            .eq("organization_id", org_id)
            .is_("escalated_at", "null")
            .execute()
            .data
            or []
        )
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        raise
    if not rows:
        return []

    worker_ids = list({str(r["worker_id"]) for r in rows if r.get("worker_id")})
    names_by_id: dict[str, str] = {}
    if worker_ids:
        try:
            users = (
                get_supabase_admin()
                .table("users")
                .select("id, full_name, email")
                .in_("id", worker_ids)
                .execute()
                .data
                or []
            )
            names_by_id = {str(u["id"]): u.get("full_name") or u.get("email") or "Team member" for u in users}
        except Exception:
            names_by_id = {}

    stage_label = {"credentials": "Credentials", "training": "Training"}
    alerts: list[dict[str, Any]] = []
    for row in rows:
        days = _days_since(row.get("first_flagged_at"), now)
        if days is None or days < escalation.REMINDER_AFTER_DAYS:
            continue
        wid = str(row.get("worker_id") or "")
        name = names_by_id.get(wid, "A worker")
        label = stage_label.get(row["stage"], row["stage"])
        days_left = escalation.ESCALATE_AFTER_DAYS - days
        urgent = days_left <= _URGENT_WITHIN_DAYS
        alerts.append({
            "id": f"worker-blocked-{row['id']}",
            "title": f"{name}: blocked on {label} for {days} days",
            "detail": (
                f"Automatically set inactive in {max(days_left, 0)} day{'s' if days_left != 1 else ''} "
                f"if still blocked (day {days} of {escalation.ESCALATE_AFTER_DAYS})."
            ),
            "severity": "critical" if urgent else "high",
            "affected_staff": [name],
            "action_label": "View Worker",
            "source": "onboarding-worker",
            "category": "urgent" if urgent else "exposure",
        })
    return alerts


def get_onboarding_stuck_alerts(organization_id: str) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    alerts = (
        _applicant_alerts(organization_id, now)
        + _hire_awaiting_signature_alerts(organization_id, now)
        + _hire_invited_alerts(organization_id, now)
        + _worker_stage_blocked_alerts(organization_id, now)
    )
    category_order = {"urgent": 0, "exposure": 1}
    severity_order = {"critical": 0, "high": 1, "medium": 2, "info": 3, "positive": 4}
    alerts.sort(key=lambda a: (category_order.get(a.get("category"), 2), severity_order.get(a["severity"], 5)))
    return alerts
