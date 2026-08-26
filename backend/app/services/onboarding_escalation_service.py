"""Onboarding stage recovery-loop reminders + auto-inactive escalation.

Per the Employee Onboarding Pipeline doc (Aug 2026): a new hire blocked on
Credentials or Training gets a reminder after 3 days, then is automatically
set inactive after 14 days if still blocked. Mirrors the remind-then-escalate
shape already used by screening_recheck_service.py and
medication_reminder_service.py, reusing this scheduler rather than a new
timer mechanism.

"Blocked" means the worker's own action is outstanding — missing or rejected
mandatory credentials, or overdue mandatory training. A credential sitting in
pending_review is *not* blocked in this sense: the worker already acted and
it's the coordinator's turn, so it isn't fair to nudge/escalate the worker
for it.

If the worker resolves the block before either threshold, the tracking row
is deleted so a future block on the same stage starts its own fresh window
— the recovery loop this implements is just "stop the clock and let the
normal review path continue," not a special code path of its own.

Scope note: only Credentials and Training are wired here. The source doc's
Interview/Offer stages don't correspond to anything built in CareCliQ (no
candidate/interview/offer pipeline exists — "offer_letter" is only a
document type in the existing internal-hire flow) and are out of scope.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from .notification_service import _org_coordinator_user_ids, notify_worker
from .supabase_client import get_supabase_admin
from . import worker_training_service as training

logger = logging.getLogger(__name__)

REMINDER_AFTER_DAYS = 3
ESCALATE_AFTER_DAYS = 14

# Mirrors REQUIRED_CREDENTIAL_TYPES in
# artifacts/frontend/src/components/team/WorkerDetail.tsx — there's no shared
# backend/frontend constant source yet, so this is kept in sync manually.
REQUIRED_CREDENTIAL_TYPES = [
    "ndis_screening", "wwcc", "code_of_conduct", "first_aid",
    "cpr", "manual_handling", "infection_control", "medication_admin",
]

_STAGE_MESSAGE = {
    "credentials": "submit your outstanding mandatory credentials",
    "training": "complete your mandatory training",
}


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return "does not exist" in err or "42703" in err or "pgrst" in err or "could not find" in err


def _onboarding_workers(organization_id: str) -> list[dict[str, Any]]:
    try:
        result = (
            get_supabase_admin()
            .table("users")
            .select("id, onboarding_completed")
            .eq("organization_id", organization_id)
            .eq("role", "support_worker")
            .eq("is_active", True)
            .execute()
        )
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        logger.warning("Onboarding worker query failed: %s", exc)
        return []
    return [r for r in (result.data or []) if not r.get("onboarding_completed")]


def credentials_blocked(worker_ids: list[str]) -> set[str]:
    if not worker_ids:
        return set()
    try:
        result = (
            get_supabase_admin()
            .table("credentials")
            .select("user_id, credential_type, status")
            .in_("user_id", worker_ids)
            .in_("credential_type", REQUIRED_CREDENTIAL_TYPES)
            .execute()
        )
        rows = result.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return set()
        logger.warning("Credential block query failed: %s", exc)
        return set()

    by_worker: dict[str, dict[str, str]] = {}
    for row in rows:
        uid = str(row.get("user_id") or "")
        ctype = row.get("credential_type")
        if uid and ctype:
            by_worker.setdefault(uid, {})[ctype] = row.get("status")

    blocked: set[str] = set()
    for uid in worker_ids:
        statuses = by_worker.get(uid, {})
        for ctype in REQUIRED_CREDENTIAL_TYPES:
            if statuses.get(ctype) in (None, "rejected"):
                blocked.add(uid)
                break
    return blocked


def mandatory_credentials_approved(worker_ids: list[str]) -> set[str]:
    """Workers whose mandatory credentials are ALL status == 'valid'.

    Stricter than credentials_blocked() above, and answers a different
    question. credentials_blocked() treats pending_review as "not blocked"
    so the worker isn't nagged/escalated while it's the coordinator's turn -
    correct for the reminder system, but wrong for deciding whether a worker
    has actually cleared the Screening/Credentials pipeline stage. A worker
    who has submitted everything but is still awaiting coordinator review
    hasn't cleared it yet; this is the check worker_pipeline_service.py uses
    to decide Screening/Credentials vs Training column placement.
    """
    if not worker_ids:
        return set()
    try:
        result = (
            get_supabase_admin()
            .table("credentials")
            .select("user_id, credential_type, status")
            .in_("user_id", worker_ids)
            .in_("credential_type", REQUIRED_CREDENTIAL_TYPES)
            .execute()
        )
        rows = result.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return set()
        logger.warning("Credential approval query failed: %s", exc)
        return set()

    by_worker: dict[str, dict[str, str]] = {}
    for row in rows:
        uid = str(row.get("user_id") or "")
        ctype = row.get("credential_type")
        if uid and ctype:
            by_worker.setdefault(uid, {})[ctype] = row.get("status")

    approved: set[str] = set()
    for uid in worker_ids:
        statuses = by_worker.get(uid, {})
        if all(statuses.get(ctype) == "valid" for ctype in REQUIRED_CREDENTIAL_TYPES):
            approved.add(uid)
    return approved


def _upsert_stage_flags(organization_id: str, stage: str, blocked_worker_ids: set[str]) -> None:
    if not blocked_worker_ids:
        return
    try:
        existing = (
            get_supabase_admin()
            .table("onboarding_stage_reminders")
            .select("worker_id")
            .eq("organization_id", organization_id)
            .eq("stage", stage)
            .in_("worker_id", list(blocked_worker_ids))
            .execute()
        )
        already_tracked = {str(r["worker_id"]) for r in (existing.data or [])}
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return
        logger.warning("Onboarding stage flag lookup failed: %s", exc)
        already_tracked = set()

    new_ids = blocked_worker_ids - already_tracked
    if not new_ids:
        return
    now = datetime.now(timezone.utc).isoformat()
    records = [
        {"worker_id": wid, "organization_id": organization_id, "stage": stage, "first_flagged_at": now}
        for wid in new_ids
    ]
    try:
        get_supabase_admin().table("onboarding_stage_reminders").insert(records).execute()
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            logger.warning("Onboarding stage flag insert failed for stage %s: %s", stage, exc)


def _clear_resolved_stage_flags(organization_id: str, stage: str, blocked_worker_ids: set[str]) -> None:
    """Delete tracking rows for workers no longer blocked on this stage."""
    try:
        existing = (
            get_supabase_admin()
            .table("onboarding_stage_reminders")
            .select("id, worker_id")
            .eq("organization_id", organization_id)
            .eq("stage", stage)
            .execute()
        )
        rows = existing.data or []
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            logger.warning("Onboarding stage flag lookup failed: %s", exc)
        return

    resolved_ids = [r["id"] for r in rows if str(r.get("worker_id")) not in blocked_worker_ids]
    if resolved_ids:
        try:
            get_supabase_admin().table("onboarding_stage_reminders").delete().in_("id", resolved_ids).execute()
        except Exception as exc:
            logger.warning("Onboarding stage flag cleanup failed: %s", exc)


async def _process_due_reminders() -> tuple[int, int]:
    now = datetime.now(timezone.utc)
    reminder_cutoff = now - timedelta(days=REMINDER_AFTER_DAYS)
    escalate_cutoff = now - timedelta(days=ESCALATE_AFTER_DAYS)

    try:
        result = (
            get_supabase_admin()
            .table("onboarding_stage_reminders")
            .select("id, worker_id, organization_id, stage, first_flagged_at, reminder_sent_at")
            .is_("escalated_at", "null")
            .execute()
        )
        rows = result.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return 0, 0
        logger.warning("Onboarding escalation query failed: %s", exc)
        return 0, 0

    reminded = 0
    escalated = 0

    for row in rows:
        try:
            flagged_at = datetime.fromisoformat(str(row["first_flagged_at"]).replace("Z", "+00:00"))
        except ValueError:
            continue
        worker_id = str(row["worker_id"])
        org_id = str(row["organization_id"])
        stage = row["stage"]
        row_id = row["id"]

        if flagged_at <= escalate_cutoff:
            try:
                supabase = get_supabase_admin()
                supabase.table("users").update({"is_active": False}).eq("id", worker_id).eq(
                    "organization_id", org_id
                ).execute()
                supabase.table("organization_members").update({"is_active": False}).eq(
                    "user_id", worker_id
                ).eq("organization_id", org_id).execute()
                supabase.table("onboarding_stage_reminders").update(
                    {"escalated_at": now.isoformat()}
                ).eq("id", row_id).execute()
                escalated += 1
                for coord_id in _org_coordinator_user_ids(org_id):
                    await notify_worker(
                        user_id=coord_id,
                        org_id=org_id,
                        event="onboarding_stage_auto_inactive",
                        title="New hire set inactive — onboarding stalled",
                        message=(
                            f"A new hire was automatically set inactive after "
                            f"{ESCALATE_AFTER_DAYS} days without action on {stage}. "
                            "Reactivate them once they're ready to continue."
                        ),
                        reference_key=f"onboarding_escalation:{row_id}",
                        severity="high",
                        alert_type="onboarding_escalation",
                    )
            except Exception as exc:
                logger.warning("Onboarding escalation failed for %s/%s: %s", worker_id, stage, exc)
            continue

        if flagged_at <= reminder_cutoff and not row.get("reminder_sent_at"):
            try:
                outcome = await notify_worker(
                    user_id=worker_id,
                    org_id=org_id,
                    event="onboarding_stage_reminder",
                    title="Action needed to finish onboarding",
                    message=f"Please {_STAGE_MESSAGE.get(stage, 'complete this step')} to continue your onboarding.",
                    reference_key=f"onboarding_reminder:{row_id}",
                    severity="medium",
                    alert_type="onboarding_reminder",
                )
                get_supabase_admin().table("onboarding_stage_reminders").update(
                    {"reminder_sent_at": now.isoformat()}
                ).eq("id", row_id).execute()
                if outcome.get("in_app") or outcome.get("email") or outcome.get("push"):
                    reminded += 1
            except Exception as exc:
                logger.warning("Onboarding reminder failed for %s/%s: %s", worker_id, stage, exc)

    return reminded, escalated


async def run_onboarding_escalation_pass() -> dict[str, int]:
    try:
        orgs_result = get_supabase_admin().table("organizations").select("id").execute()
        org_ids = [str(o["id"]) for o in (orgs_result.data or [])]
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return {"reminders": 0, "escalations": 0}
        logger.warning("Onboarding escalation org query failed: %s", exc)
        return {"reminders": 0, "escalations": 0}

    for org_id in org_ids:
        workers = _onboarding_workers(org_id)
        if not workers:
            continue
        worker_ids = [str(w["id"]) for w in workers]

        cred_blocked = credentials_blocked(worker_ids)
        _upsert_stage_flags(org_id, "credentials", cred_blocked)
        _clear_resolved_stage_flags(org_id, "credentials", cred_blocked)

        overdue_map = training.team_training_overdue_map(org_id)
        training_blocked = {wid for wid in worker_ids if overdue_map.get(wid)}
        _upsert_stage_flags(org_id, "training", training_blocked)
        _clear_resolved_stage_flags(org_id, "training", training_blocked)

    reminded, escalated = await _process_due_reminders()
    return {"reminders": reminded, "escalations": escalated}
