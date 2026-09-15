"""Worker Onboarding Pipeline — a read-only oversight board spanning
Interview through Active. Per the Managing Director Frontend reconciliation
(Aug 2026): this is the one genuinely missing piece — nothing in the app
unifies pre-hire (Interview, Offer letter) and post-hire (Screening/Credentials,
Training, Active) stages into a single view. Every column here reads from
an existing data model rather than a new one:

- Interview          -> applicant_service (Applicants Board)
- Offer letter        -> employee_onboarding_service (signature flow). Stays here
                         through "invited" too (invitations.py sets that status the
                         moment the login invite is sent) — a candidate isn't a real
                         worker yet at that point (no public.users row exists), so
                         they'd otherwise vanish from every column until they
                         actually accept the invite and log in.
- Screening/Credentials -> a worker lands here as soon as they've logged in and
                         started self-service setup, and stays here until ALL
                         mandatory credential types (onboarding_escalation_service
                         .mandatory_credentials_approved) are verified valid by a
                         coordinator — not merely submitted. Not every credential
                         type gates this, only the mandatory ones; optional ones
                         (driver's licence, vehicle rego, etc.) can be completed
                         after moving on. credentials_blocked() (a looser missing
                         /rejected-only check, used for the 3-day/14-day reminder
                         escalation) only decides the in-column warn/ok flag here,
                         not which column a worker is placed in.
- Training            -> worker_training_service.team_training_overdue_map
                         and induction_service.team_induction_incomplete_map
- Active               -> users.onboarding_completed, which this module also
                         auto-sets the moment credentials+training+induction
                         are objectively done (see _mark_onboarding_completed)
                         — the web app has a fuller onboarding checklist that
                         normally sets this flag once a worker ticks every
                         item (including non-gating acknowledgements like
                         reading the note-writing guide), but mobile-only
                         workers have no way to reach that page at all, so
                         without this they'd stay stuck in Training forever
                         no matter how complete their setup actually was.

This board never does a user-facing stage transition — no drag-and-drop.
Moving a candidate through Interview/Offer/Hires still only happens on the
pages that already own that action (the Applicants Board, the Hires
signature flow). The one exception is the auto-completion above, which is a
system-derived status correction, not a manual move.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from . import applicant_service, employee_onboarding_service, induction_service
from . import onboarding_escalation_service as escalation
from . import worker_training_service as training
from .supabase_client import get_supabase_admin

OFFER_LETTER_STATUSES = ("draft", "awaiting_signatures", "signed", "invited")

STAGE_ORDER = ("interview", "offer_letter", "credentials", "training", "active")
STAGE_LABELS = {
    "interview": "Interview",
    "offer_letter": "Offer letter",
    "credentials": "Screening & Credentials",
    "training": "Training",
    "active": "Active",
}


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return "does not exist" in err or "42703" in err or "pgrst" in err or "could not find" in err


def _mark_onboarding_completed(worker_ids: list[str]) -> None:
    """Best-effort — a failed write here just means the next read of this
    board (or of /onboarding/me/completion-status on mobile) retries it."""
    if not worker_ids:
        return
    try:
        get_supabase_admin().table("users").update(
            {"onboarding_completed": True, "onboarding_complete": True}
        ).in_("id", worker_ids).execute()
    except Exception:
        pass


def _classify_mid_onboarding(
    cred_approved: bool, cred_blocked: bool, training_or_induction_overdue: bool
) -> tuple[str, str]:
    """(stage, flag) for a worker still mid-onboarding (not yet Active). Factored out
    of get_pipeline_overview's per-worker loop so get_pipeline_for_worker (single
    worker) can reuse the exact same placement logic rather than a second copy."""
    if not cred_approved:
        return "credentials", "warn" if cred_blocked else "ok"
    return "training", "warn" if training_or_induction_overdue else "ok"


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
            .select("id, full_name, email, role, is_active, onboarding_completed, created_at")
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

    # cred_blocked: worker's own action outstanding (missing/rejected mandatory
    # credential) - used only for the in-column "warn" flag below.
    # cred_approved: ALL mandatory credentials verified valid - the gate that
    # actually moves a worker from Screening/Credentials into Training. A
    # worker who has submitted everything but is still awaiting coordinator
    # review is neither blocked nor approved, so stays in Screening/Credentials
    # with an "ok" flag (nothing outstanding on their end).
    cred_blocked = escalation.credentials_blocked(worker_ids) if worker_ids else set()
    cred_approved = escalation.mandatory_credentials_approved(worker_ids) if worker_ids else set()
    training_overdue_map = training.team_training_overdue_map(organization_id)
    induction_incomplete_map = induction_service.team_induction_incomplete_map(organization_id)

    credentials_col: list[dict[str, Any]] = []
    training_col: list[dict[str, Any]] = []
    newly_ready_ids: list[str] = []
    for w in onboarding_workers:
        overdue = bool(training_overdue_map.get(w["id"])) or bool(induction_incomplete_map.get(w["id"]))
        if w["id"] in cred_approved and not overdue:
            # Objectively ready (mandatory credentials verified, training and
            # induction current) but onboarding_completed was never set —
            # always true for a worker who onboarded entirely through the
            # mobile app, which has no equivalent of the web-only full
            # checklist that normally flips this flag. Mutating `w` in place
            # here means the active_col comprehension below picks it up
            # immediately, not just on the next load.
            newly_ready_ids.append(w["id"])
            w["onboarding_completed"] = True
            continue
        stage, flag = _classify_mid_onboarding(w["id"] in cred_approved, w["id"] in cred_blocked, overdue)
        (credentials_col if stage == "credentials" else training_col).append({**w, "flag": flag})
    _mark_onboarding_completed(newly_ready_ids)

    active_col = [w for w in workers if w.get("is_active") and w.get("onboarding_completed")]

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

    starting_this_week = len([w for w in workers if w.get("created_at") and w["created_at"] >= week_ago])

    return {
        "kpis": {
            "in_pipeline": len(interview) + len(offer_letter),
            # Genuinely blocked (missing/rejected), not the whole Screening/Credentials
            # column - that column also holds workers who submitted everything and
            # are just waiting on coordinator approval, which isn't "overdue".
            "credentials_overdue": len([w for w in credentials_col if w["flag"] == "warn"]),
            "starting_this_week": starting_this_week,
            "auto_deactivated_month": auto_deactivated_month,
        },
        "columns": {
            "interview": interview,
            "offer_letter": offer_letter,
            "credentials": credentials_col,
            "training": training_col,
            "active": [{**w, "joined_at": w.get("created_at"), "flag": "complete"} for w in active_col],
        },
        "not_proceeding": {
            "rejected_applicants": rejected_applicants,
            "expired_offers": expired_offers,
            "auto_deactivated_workers": auto_deactivated_workers,
        },
    }


def get_pipeline_for_worker(worker_id: str, organization_id: str) -> dict[str, Any] | None:
    """Single-worker mirror of get_pipeline_overview, for the worker-facing "My
    Onboarding" progress view. A worker calling this is always already logged
    in (has a users row) - Interview and Offer letter, which by definition
    happen before a users row exists, are always already behind them, so
    they're shown as completed stepper steps for context rather than looked
    up from applicants/employee_onboarding.

    Returns None if the worker has no users row in this organization (should
    not happen for an authenticated caller, but the endpoint treats it as a
    404 rather than assuming shape).
    """
    supabase = get_supabase_admin()
    try:
        resp = (
            supabase.table("users")
            .select("id, full_name, email, is_active, onboarding_completed, created_at")
            .eq("id", worker_id)
            .eq("organization_id", organization_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        raise
    if not rows:
        return None
    worker = rows[0]

    # A worker set inactive without completing onboarding (auto-deactivated by
    # onboarding_escalation_service after 14 days stalled) is layered on top of
    # whichever stage they were blocked on, not a 6th stage of its own - the
    # stepper still shows where they were, with a separate "paused" flag.
    deactivated = not worker.get("is_active") and not worker.get("onboarding_completed")

    outstanding: list[str] = []
    if worker.get("is_active") and worker.get("onboarding_completed"):
        current_stage = "active"
    else:
        cred_approved = bool(escalation.mandatory_credentials_approved([worker_id]))
        cred_blocked = bool(escalation.credentials_blocked([worker_id]))
        training_overdue = training.is_training_overdue(worker_id, organization_id)
        induction_incomplete = induction_service.is_induction_incomplete(worker_id, organization_id)
        if worker.get("is_active") and cred_approved and not training_overdue and not induction_incomplete:
            # See _mark_onboarding_completed in get_pipeline_overview — same
            # auto-completion, just computed for one worker instead of a
            # whole org's board.
            _mark_onboarding_completed([worker_id])
            current_stage = "active"
        else:
            current_stage, _flag = _classify_mid_onboarding(
                cred_approved, cred_blocked, training_overdue or induction_incomplete
            )
        if current_stage == "credentials" and cred_blocked:
            outstanding.append("Submit your outstanding mandatory credentials")
        elif current_stage == "training":
            if training_overdue:
                outstanding.append("Complete your overdue training module(s)")
            if induction_incomplete:
                outstanding.append("Complete your remaining induction items")

    current_index = STAGE_ORDER.index(current_stage)
    stages = [
        {
            "key": key,
            "label": STAGE_LABELS[key],
            "status": "complete" if i < current_index else "current" if i == current_index else "upcoming",
        }
        for i, key in enumerate(STAGE_ORDER)
    ]

    return {
        "current_stage": current_stage,
        "stages": stages,
        "outstanding_items": outstanding,
        "deactivated": deactivated,
    }
