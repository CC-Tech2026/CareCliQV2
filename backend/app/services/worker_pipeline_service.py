"""Worker Onboarding Pipeline — a read-only oversight board spanning
Interview through Active. Per the Managing Director Frontend reconciliation
(Aug 2026): this is the one genuinely missing piece — nothing in the app
unifies pre-hire (Interview, Offer letter) and post-hire (Credentials,
Training, Active) stages into a single view. Every column here reads from
an existing data model rather than a new one:

- Interview          -> applicant_service (Applicants Board)
- Offer letter        -> employee_onboarding_service (signature flow). Stays here
                         through "invited" too (invitations.py sets that status the
                         moment the login invite is sent) — a candidate isn't a real
                         worker yet at that point (no public.users row exists), so
                         they'd otherwise vanish from every column until they
                         actually accept the invite and log in.
- Credentials         -> onboarding_escalation_service.credentials_blocked,
                         the same mandatory-credential check used for the
                         rostering gate and the 3-day/14-day escalation.
- Training            -> worker_training_service.team_training_overdue_map
                         and induction_service.team_induction_incomplete_map
- Active               -> users.onboarding_completed

This board never writes anything — no drag-and-drop, no stage transitions.
Moving a candidate forward still happens on the pages that already own that
action (the Applicants Board, the Hires signature flow, the worker's own
checklist).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from . import applicant_service, employee_onboarding_service, induction_service
from . import onboarding_escalation_service as escalation
from . import worker_training_service as training
from .supabase_client import get_supabase_admin

OFFER_LETTER_STATUSES = ("draft", "awaiting_signatures", "signed", "invited")


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return "does not exist" in err or "42703" in err or "pgrst" in err or "could not find" in err


def get_pipeline_overview(organization_id: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    week_ago = (now - timedelta(days=7)).isoformat()
    month_ago = (now - timedelta(days=30)).isoformat()

    try:
        applicants = applicant_service.list_applicants(organization_id)
    except Exception:
        applicants = []
    interview = [a for a in applicants if a.get("stage") == "interview"]
    rejected_applicants = [a for a in applicants if a.get("stage") == "rejected"]

    try:
        hires = employee_onboarding_service.list_hires(organization_id)
    except Exception:
        hires = []
    offer_letter = [h for h in hires if h.get("status") in OFFER_LETTER_STATUSES]
    expired_offers = [h for h in hires if h.get("status") == "expired"]

    supabase = get_supabase_admin()
    try:
        workers_resp = (
            supabase.table("users")
            .select("id, full_name, email, role, is_active, onboarding_completed, joined_at, created_at")
            .eq("organization_id", organization_id)
            .eq("role", "support_worker")
            .execute()
        )
        workers = workers_resp.data or []
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            raise
        workers = []

    onboarding_workers = [w for w in workers if w.get("is_active") and not w.get("onboarding_completed")]
    worker_ids = [w["id"] for w in onboarding_workers]

    cred_blocked = escalation.credentials_blocked(worker_ids) if worker_ids else set()
    training_overdue_map = training.team_training_overdue_map(organization_id)
    induction_incomplete_map = induction_service.team_induction_incomplete_map(organization_id)

    credentials_col: list[dict[str, Any]] = []
    training_col: list[dict[str, Any]] = []
    for w in onboarding_workers:
        if w["id"] in cred_blocked:
            credentials_col.append({**w, "flag": "warn"})
        else:
            overdue = bool(training_overdue_map.get(w["id"])) or bool(induction_incomplete_map.get(w["id"]))
            training_col.append({**w, "flag": "warn" if overdue else "ok"})

    active_col = [
        w for w in workers
        if w.get("is_active") and w.get("onboarding_completed")
        and w.get("joined_at") and w["joined_at"] >= month_ago
    ]

    auto_deactivated_workers = [
        w for w in workers if not w.get("is_active") and not w.get("onboarding_completed")
    ]

    try:
        deactivated_resp = (
            supabase.table("onboarding_stage_reminders")
            .select("id, escalated_at")
            .eq("organization_id", organization_id)
            .not_.is_("escalated_at", "null")
            .gte("escalated_at", month_ago)
            .execute()
        )
        auto_deactivated_month = len(deactivated_resp.data or [])
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            raise
        auto_deactivated_month = 0

    starting_this_week = len([w for w in workers if w.get("joined_at") and w["joined_at"] >= week_ago])

    return {
        "kpis": {
            "in_pipeline": len(interview) + len(offer_letter),
            "credentials_overdue": len(credentials_col),
            "starting_this_week": starting_this_week,
            "auto_deactivated_month": auto_deactivated_month,
        },
        "columns": {
            "interview": interview,
            "offer_letter": offer_letter,
            "credentials": credentials_col,
            "training": training_col,
            "active": [{**w, "flag": "complete"} for w in active_col],
        },
        "not_proceeding": {
            "rejected_applicants": rejected_applicants,
            "expired_offers": expired_offers,
            "auto_deactivated_workers": auto_deactivated_workers,
        },
    }
