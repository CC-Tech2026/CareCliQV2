"""Shift verification gate — coordinator review before budget deduction.

record_session_budget_usage() used to deduct plan_budgets.used_amount
automatically on session save, with no review and hardcoded rates. This
module replaces that with an explicit, audited coordinator confirmation
per completed shift, sourced from the real NDIS price catalogue.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from ..core.ndis_categories import support_category_number_label
from ..core.timezone import app_today, parse_shift_datetime, participant_timezone
from . import agreement_support_service, ndis_pricing_service
from .funding_service import get_plan_for_participant, record_verified_shift_budget_usage
from .schads_engine import _day_type, _get_public_holidays
from .shift_validation_service import compute_shift_validation
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

HOURS_VARIANCE_FLAG_THRESHOLD = 0.15  # >15% off scheduled duration gets flagged

# ndis_price_items.support_purpose ("Core Supports" | "Capacity Building") ->
# plan_budgets.category ("core" | "capacity_building" | "capital"). These are
# different taxonomies in this codebase — see ndis_categories.py for the
# unrelated "_supports"-suffixed grouping, which doesn't match plan_budgets.
_SUPPORT_PURPOSE_TO_BUDGET_CATEGORY = {
    "core supports": "core",
    "capacity building": "capacity_building",
}

# Fallback when support_purpose/category_number are empty — true for every
# row in this org's currently-loaded catalogue as of 2026-06 (see
# ndis_pricing_service.list_organization_categories' docstring for the same
# gap). Derived from the item_code's leading NDIS support-category-number
# segment (e.g. "01" in "01_011_0107_1_1"), per the published NDIS Support
# Category list: 01-04 Core Supports, 05-06 Capital Supports, 07-15 Capacity
# Building. Best-effort only — flag to a human if it ever looks wrong for a
# specific item, since this determines which plan budget gets debited.
_ITEM_CODE_PREFIX_TO_BUDGET_CATEGORY = {
    "01": "core", "02": "core", "03": "core", "04": "core",
    "05": "capital", "06": "capital",
    "07": "capacity_building", "08": "capacity_building", "09": "capacity_building",
    "10": "capacity_building", "11": "capacity_building", "12": "capacity_building",
    "13": "capacity_building", "14": "capacity_building", "15": "capacity_building",
}


def _safe_rows(data: Any) -> list[dict[str, Any]]:
    if not isinstance(data, list):
        return []
    return [r for r in data if isinstance(r, dict)]


def support_purpose_to_budget_category(support_purpose: Optional[str]) -> Optional[str]:
    return _SUPPORT_PURPOSE_TO_BUDGET_CATEGORY.get(str(support_purpose or "").strip().lower())


def resolve_price_item_budget_category(item: dict[str, Any]) -> Optional[str]:
    """plan_budgets.category for a price item — support_purpose when populated,
    else the item_code's support-category-number prefix."""
    category = support_purpose_to_budget_category(item.get("support_purpose"))
    if category:
        return category
    prefix = str(item.get("item_code") or "").split("_")[0]
    return _ITEM_CODE_PREFIX_TO_BUDGET_CATEGORY.get(prefix)


def _scheduled_minutes(shift: dict[str, Any]) -> Optional[float]:
    start = shift.get("scheduled_start")
    end = shift.get("scheduled_end")
    if not start or not end:
        return None
    try:
        delta = parse_shift_datetime(end) - parse_shift_datetime(start)
        return delta.total_seconds() / 60
    except Exception:
        return None


def _actual_minutes(shift: dict[str, Any]) -> Optional[float]:
    """Time actually worked: clock-in to clock-out. shifts.duration_minutes is
    set from the *scheduled* times when the shift is created and never
    updated, so it's only a fallback for old rows with no clock times —
    reading it first billed the scheduled length and made the hours check
    compare the schedule with itself."""
    clocked_in = shift.get("clocked_in_at")
    clocked_out = shift.get("clocked_out_at")
    if clocked_in and clocked_out:
        try:
            minutes = (parse_shift_datetime(clocked_out) - parse_shift_datetime(clocked_in)).total_seconds() / 60
            if minutes > 0:
                return minutes
        except Exception:
            pass
    duration = shift.get("duration_minutes")
    if duration is not None:
        try:
            return float(duration)
        except Exception:
            pass
    return None


def billable_minutes(shift: dict[str, Any], approve_extra_time: bool = False) -> dict[str, Any]:
    """Minutes to bill: the time worked, but no more than scheduled unless a
    coordinator approves the extra time. Shorter shifts bill what was worked."""
    worked = _actual_minutes(shift)
    scheduled = _scheduled_minutes(shift)
    extra = max(0.0, worked - scheduled) if worked is not None and scheduled else 0.0
    # Whole minutes: a few seconds over the schedule isn't "extra time".
    has_extra = round(extra) >= 1
    if worked is None:
        billable = None
    elif has_extra and not approve_extra_time:
        billable = scheduled
    else:
        billable = worked
    return {
        "worked_minutes": round(worked, 1) if worked is not None else None,
        "scheduled_minutes": round(scheduled, 1) if scheduled is not None else None,
        "extra_minutes": round(extra, 1) if has_extra else 0,
        "billable_minutes": round(billable, 1) if billable is not None else None,
        "capped_at_scheduled": bool(has_extra and not approve_extra_time),
        "extra_time_approved": bool(has_extra and approve_extra_time),
    }


def _completion_date_for_shift(shift: dict[str, Any]) -> str:
    """Calendar day the shift belongs to, in the participant's branch zone.
    (Taking .date() of the UTC instant filed anything before ~9:30 AM
    local under the previous day.)"""
    tz = participant_timezone(shift, organization_id=shift.get("organization_id"))
    for key in ("scheduled_start", "clocked_out_at", "clocked_in_at", "created_at"):
        value = shift.get(key)
        if not value:
            continue
        try:
            return parse_shift_datetime(value).astimezone(tz).date().isoformat()
        except Exception:
            continue
    return app_today(tz).isoformat()


def _upsert_task_completions_for_verified_shift(
    supabase: Any,
    *,
    shift: dict[str, Any],
    participant_id: str,
    organization_id: str,
    coordinator_id: str,
    price_item_code: str,
    billed_amount: float,
    actual_minutes: float,
    verified_at: str,
    completion_date: str,
) -> list[dict[str, Any]]:
    shift_task_result = (
        supabase.table("shift_tasks")
        .select("task_id")
        .eq("shift_id", str(shift.get("id")))
        .eq("organization_id", organization_id)
        .execute()
    )
    shift_task_rows = _safe_rows(shift_task_result.data)
    task_ids = [str(row.get("task_id")) for row in shift_task_rows if row.get("task_id")]

    verified_task_ids: list[str] = []
    if task_ids:
        tasks_result = (
            supabase.table("participant_tasks")
            .select("id, participant_id")
            .in_("id", task_ids)
            .eq("organization_id", organization_id)
            .eq("participant_id", participant_id)
            .execute()
        )
        task_rows = _safe_rows(tasks_result.data)
        verified_task_ids = [str(row["id"]) for row in task_rows if row.get("id")]

    payload_template = {
        "shift_id": str(shift.get("id")),
        "participant_id": participant_id,
        "organization_id": organization_id,
        "completed_by": coordinator_id,
        "completion_date": completion_date,
        "evidence_type": "notes",
        "evidence_verified": True,
        "verified_by": coordinator_id,
        "verified_at": verified_at,
        "status": "verified",
        "price_item_code": price_item_code,
        "updated_at": verified_at,
    }

    if not verified_task_ids:
        # No tasks were linked to this shift — tasks are optional at creation,
        # so this is the common case, not an error. Bill the shift itself as
        # one completion (task_id null, migration 216) rather than silently
        # producing nothing for the invoicing pipeline to find later.
        existing_result = (
            supabase.table("task_completions")
            .select("id")
            .eq("shift_id", str(shift.get("id")))
            .is_("task_id", "null")
            .execute()
        )
        existing_rows = _safe_rows(existing_result.data)
        row_payload = {
            **payload_template,
            "duration_minutes": int(round(actual_minutes)),
            "billed_amount": round(billed_amount, 2),
        }
        if existing_rows:
            resp = (
                supabase.table("task_completions")
                .update(row_payload)
                .eq("id", str(existing_rows[0]["id"]))
                .execute()
            )
        else:
            resp = (
                supabase.table("task_completions")
                .insert({**row_payload, "task_id": None, "created_at": verified_at})
                .execute()
            )
        return _safe_rows(resp.data)

    existing_result = (
        supabase.table("task_completions")
        .select("id, task_id")
        .eq("shift_id", str(shift.get("id")))
        .in_("task_id", verified_task_ids)
        .execute()
    )
    existing_rows = _safe_rows(existing_result.data)
    existing_by_task_id = {str(row.get("task_id")): row for row in existing_rows if row.get("task_id")}

    task_count = len(verified_task_ids)
    apportioned_minutes = max(1, int(round(actual_minutes / task_count)))
    apportioned_amount = round(billed_amount / task_count, 2)

    upserted: list[dict[str, Any]] = []
    for task_id in verified_task_ids:
        row_payload = {
            **payload_template,
            "duration_minutes": apportioned_minutes,
            "billed_amount": apportioned_amount,
        }
        existing = existing_by_task_id.get(task_id)
        if existing and existing.get("id"):
            resp = (
                supabase.table("task_completions")
                .update(row_payload)
                .eq("id", str(existing["id"]))
                .execute()
            )
            rows = _safe_rows(resp.data)
            if rows:
                upserted.append(rows[0])
            continue

        insert_payload = {
            **row_payload,
            "task_id": task_id,
            "created_at": verified_at,
        }
        resp = supabase.table("task_completions").insert(insert_payload).execute()
        rows = _safe_rows(resp.data)
        if rows:
            upserted.append(rows[0])
    return upserted


def _hours_sanity_check(shift: dict[str, Any]) -> dict[str, Any]:
    scheduled = _scheduled_minutes(shift)
    actual = _actual_minutes(shift)

    if scheduled is None or actual is None or scheduled <= 0:
        return {
            "status": "unknown",
            "scheduled_minutes": scheduled,
            "actual_minutes": actual,
            "variance_pct": None,
            "flagged": False,
            "reason": "Missing scheduled or actual shift times.",
        }

    variance_pct = abs(actual - scheduled) / scheduled
    flagged = variance_pct > HOURS_VARIANCE_FLAG_THRESHOLD

    return {
        "status": "flagged" if flagged else "ok",
        "scheduled_minutes": round(scheduled, 1),
        "actual_minutes": round(actual, 1),
        "variance_pct": round(variance_pct * 100, 1),
        "flagged": flagged,
        "reason": (
            f"Actual duration differs from scheduled by {round(variance_pct * 100, 1)}%."
            if flagged
            else None
        ),
    }


def compute_verification_checks(
    shift: dict[str, Any],
    session: Optional[dict[str, Any]],
) -> dict[str, Any]:
    """Read-only: recompute the checks shown to the coordinator. Never trust a
    client-held copy — this is called fresh both for the queue listing and
    again server-side at confirm time."""

    end_validation = (session or {}).get("end_validation")
    if not isinstance(end_validation, dict) or not end_validation:
        # Defensive fallback for shifts whose session row predates migration
        # 052 (end_validation) or never linked a session.
        end_validation = compute_shift_validation(shift.get("tasks") or [])

    evidence_check = {
        "compliance_score": end_validation.get("compliance_score"),
        "low_compliance": bool(end_validation.get("low_compliance")),
        "tasks_completed": end_validation.get("tasks_completed"),
        "tasks_total": end_validation.get("tasks_total"),
        "mandatory_total": end_validation.get("mandatory_total"),
        "mandatory_with_evidence": end_validation.get("mandatory_with_evidence"),
        "mandatory_without_evidence": end_validation.get("mandatory_without_evidence"),
        "flagged_tasks": end_validation.get("flagged_tasks") or [],
        "flagged": bool(end_validation.get("low_compliance")),
    }

    force_ended = bool(end_validation.get("force_ended"))
    auto_ended = bool(end_validation.get("auto_ended"))
    end_reason = end_validation.get("end_reason")
    force_ended_check = {
        "force_ended": force_ended,
        "auto_ended": auto_ended,
        "end_reason": end_reason,
        "flagged": force_ended,
        "reason": (
            end_reason
            or (
                "Shift was automatically ended by the system — the worker did not end it."
                if auto_ended
                else "Shift was force-ended with incomplete mandatory tasks."
                if force_ended
                else None
            )
        ),
    }

    hours_check = _hours_sanity_check(shift)

    # A shift can't be verified (and billed) without the worker's progress note.
    note_present = bool(session_note_text(session))
    note_check = {
        "present": note_present,
        "flagged": not note_present,
        "reason": None if note_present else "No progress note has been written for this shift.",
    }

    billing = billable_minutes(shift)
    extra_time_check = {
        **billing,
        "flagged": billing["extra_minutes"] > 0,
        "reason": (
            f"Worked {round(billing['extra_minutes'])} min longer than scheduled — billed at the "
            "scheduled time unless you approve the extra time."
            if billing["extra_minutes"] > 0
            else None
        ),
    }

    any_flagged = bool(
        evidence_check["flagged"] or force_ended_check["flagged"] or hours_check["flagged"]
        or note_check["flagged"] or extra_time_check["flagged"]
    )

    return {
        "evidence": evidence_check,
        "hours_sanity": hours_check,
        "force_ended": force_ended_check,
        "note": note_check,
        "extra_time": extra_time_check,
        "any_flagged": any_flagged,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


def session_note_text(session: Optional[dict[str, Any]]) -> Optional[str]:
    """The finished note as the session's legal record: the English
    translation, else the note as submitted (session_service computes
    legal_record_text the same way when it reads a session — the stored
    column is never filled in), else the plain notes field older sessions
    used."""
    session = session or {}
    for key in ("translated_english_note", "compliance_input_text", "notes"):
        text = str(session.get(key) or "").strip()
        if text:
            return text
    return None


def _get_session_for_shift(shift: dict[str, Any]) -> Optional[dict[str, Any]]:
    session_id = shift.get("session_id")
    if not session_id:
        return None
    supabase = get_supabase_admin()
    try:
        result = (
            supabase.table("sessions")
            .select(
                "id, end_validation, status, translated_english_note, compliance_input_text, notes, "
                "original_language_input, detected_language, compliance_score"
            )
            .eq("id", str(session_id))
            .execute()
        )
        rows = _safe_rows(result.data)
        return rows[0] if rows else None
    except Exception as exc:
        logger.warning("Could not fetch session %s for shift verification: %s", session_id, exc)
        return None


_SHIFT_COLUMNS = (
    "id, organization_id, participant_id, participant_name, worker_id, "
    "scheduled_start, scheduled_end, clocked_in_at, clocked_out_at, "
    "duration_minutes, status, session_id, tasks, expected_price_item_code, clock_in_verified, clock_in_method, shift_type, "
    "service_agreement_support_id"
)


def _agreement_assessment(
    shift: dict[str, Any], billed_code: Optional[str], billing: dict[str, Any]
) -> Optional[dict[str, Any]]:
    """The shift checked against the participant's service agreement, using
    the time it's billed for: from clock-in (else the scheduled start) for
    the billable minutes."""
    start_raw = shift.get("clocked_in_at") or shift.get("scheduled_start")
    minutes = billing.get("billable_minutes") or _scheduled_minutes(shift)
    if not start_raw or not minutes:
        return None
    tz = participant_timezone(shift, organization_id=shift.get("organization_id"))
    start = parse_shift_datetime(start_raw).astimezone(tz)
    return agreement_support_service.assess_for_verification(
        shift,
        billed_code=billed_code,
        local_start=start,
        local_end=start + timedelta(minutes=float(minutes)),
        holidays=_get_public_holidays(get_supabase_admin()),
        billable_minutes=billing.get("billable_minutes"),
    )


def _rate_for(price: dict[str, Any], assessment: Optional[dict[str, Any]]) -> tuple[float, str]:
    """The rate billed and where it came from: the participant's agreed rate
    for the line's own code, else the organisation's price, else the
    catalogue (resolve_price already orders those two)."""
    if assessment and assessment.get("agreed_rate") is not None:
        return float(assessment["agreed_rate"]), "agreement"
    return float(price.get("effective_price") or 0), str(price.get("price_source") or "catalogue")


def _price_limit(item_code: str, on: str) -> Optional[float]:
    cents = ndis_pricing_service.price_limit_cents(
        ndis_pricing_service.load_price_limit_rows([item_code]), item_code, on,
    )
    return cents / 100 if cents is not None else None


def _is_missing_column(exc: Exception) -> bool:
    text = str(exc).lower()
    return "reversed_at" in text or "42703" in text or "does not exist" in text


def _apply_budget_change(
    *,
    budget: dict[str, Any],
    plan_id: str,
    amount: float,
    category: str,
    hourly_rate: float,
    duration_minutes: int,
    description: str,
    verification_id: Optional[str],
    session_id: Optional[str],
) -> float:
    """Move plan_budgets.used_amount by `amount` (negative to refund) and write
    the matching budget_usage ledger row in one transaction (233,
    apply_plan_budget_change). Returns the new used amount."""
    supabase = get_supabase_admin()
    try:
        result = supabase.rpc("apply_plan_budget_change", {
            "p_budget_id": str(budget["id"]),
            "p_amount": round(amount, 2),
            "p_category": category,
            "p_hourly_rate": round(hourly_rate, 2),
            "p_duration_minutes": int(duration_minutes),
            "p_description": description,
            "p_verification_id": verification_id,
            "p_session_id": session_id,
        }).execute()
        value = result.data[0] if isinstance(result.data, list) and result.data else result.data
        if isinstance(value, dict):
            value = next(iter(value.values()), None)
        return float(value) if value is not None else round(float(budget.get("used_amount") or 0) + amount, 2)
    except Exception as exc:
        if "apply_plan_budget_change" not in str(exc) and "PGRST202" not in str(exc):
            raise
        # Migration 233 not applied yet: the old two-step write.
        logger.warning("apply_plan_budget_change unavailable, using non-atomic budget update: %s", exc)
    new_used = round(float(budget.get("used_amount") or 0) + amount, 2)
    supabase.table("plan_budgets").update({"used_amount": new_used}).eq("id", budget["id"]).execute()
    supabase.table("budget_usage").insert({
        "plan_id": plan_id,
        "session_id": session_id,
        "category": category,
        "amount": round(amount, 2),
        "hourly_rate": round(hourly_rate, 2),
        "duration_minutes": int(duration_minutes),
        "description": description,
        "shift_verification_id": verification_id,
    }).execute()
    return new_used


def _active_verified_shift_ids(org_id: str) -> set[str]:
    """Shifts with a verification that hasn't been reversed (233). Before that
    migration there are no reversals, so every verification is active."""
    supabase = get_supabase_admin()
    try:
        rows = (
            supabase.table("shift_verifications").select("shift_id")
            .eq("organization_id", org_id).is_("reversed_at", "null").execute()
        ).data
    except Exception as exc:
        if not _is_missing_column(exc):
            raise
        rows = supabase.table("shift_verifications").select("shift_id").eq("organization_id", org_id).execute().data
    return {str(row.get("shift_id")) for row in _safe_rows(rows)}


def _active_verification(shift_id: str) -> Optional[dict[str, Any]]:
    supabase = get_supabase_admin()
    columns = "id, shift_id, organization_id, participant_id, support_category, billed_amount, hourly_rate_applied, checks_run"
    try:
        rows = (
            supabase.table("shift_verifications").select(columns)
            .eq("shift_id", shift_id).is_("reversed_at", "null").limit(1).execute()
        ).data
    except Exception as exc:
        if not _is_missing_column(exc):
            raise
        rows = supabase.table("shift_verifications").select(columns).eq("shift_id", shift_id).limit(1).execute().data
    found = _safe_rows(rows)
    return found[0] if found else None


def list_pending_verifications(org_id: str) -> list[dict[str, Any]]:
    """Completed shifts in this org that have no shift_verifications row yet."""
    supabase = get_supabase_admin()

    shifts_result = (
        supabase.table("shifts")
        .select(_SHIFT_COLUMNS)
        .eq("organization_id", org_id)
        .eq("status", "completed")
        .order("clocked_out_at", desc=True)
        .execute()
    )
    shifts = _safe_rows(shifts_result.data)
    if not shifts:
        return []

    verified_shift_ids = _active_verified_shift_ids(org_id)

    pending = [s for s in shifts if str(s.get("id")) not in verified_shift_ids]
    if not pending:
        return []

    worker_ids = sorted({str(s["worker_id"]) for s in pending if s.get("worker_id")})
    worker_names: dict[str, str] = {}
    if worker_ids:
        try:
            users_result = (
                supabase.table("users")
                .select("id, full_name")
                .in_("id", worker_ids)
                .eq("organization_id", org_id)
                .execute()
            )
            worker_names = {
                str(row.get("id")): row.get("full_name") or "Unknown worker"
                for row in _safe_rows(users_result.data)
            }
        except Exception as exc:
            logger.warning("Could not fetch worker names for verification queue: %s", exc)

    out: list[dict[str, Any]] = []
    for shift in pending:
        session = _get_session_for_shift(shift)
        checks = compute_verification_checks(shift, session)
        out.append(
            {
                "shift_id": shift.get("id"),
                "clock_in_location_verified": shift.get("clock_in_method") == "gps" and shift.get("clock_in_verified") is True,
                "session_note": session_note_text(session),
                "tasks": [task for task in (shift.get("tasks") or []) if isinstance(task, dict)],
                "original_language_input": (session or {}).get("original_language_input"),
                "detected_language": (session or {}).get("detected_language"),
                "compliance_score": (session or {}).get("compliance_score"),
                "participant_id": shift.get("participant_id"),
                "participant_name": shift.get("participant_name"),
                "shift_type": shift.get("shift_type"),
                "worker_id": shift.get("worker_id"),
                "worker_name": worker_names.get(str(shift.get("worker_id") or ""), "Unknown worker"),
                "scheduled_start": shift.get("scheduled_start"),
                "scheduled_end": shift.get("scheduled_end"),
                "clocked_in_at": shift.get("clocked_in_at"),
                "clocked_out_at": shift.get("clocked_out_at"),
                "duration_minutes": shift.get("duration_minutes"),
                "checks": checks,
                # Participant's branch zone — the coordinator verifies (and
                # bills) this shift's times in it, not their own.
                "timezone": str(participant_timezone(shift, organization_id=shift.get("organization_id"))),
                "expected_price_item_code": shift.get("expected_price_item_code"),
            }
        )
    return out


async def list_price_item_options(shift_id: str, org_id: str) -> list[dict[str, Any]]:
    """Candidate ndis_price_items rows for this shift's participant's plan,
    for the coordinator's manual price-item dropdown."""
    supabase = get_supabase_admin()

    shift_result = (
        supabase.table("shifts")
        .select("id, organization_id, participant_id")
        .eq("id", shift_id)
        .execute()
    )
    shift_rows = _safe_rows(shift_result.data)
    if not shift_rows or str(shift_rows[0].get("organization_id") or "") != str(org_id):
        return []

    participant_id = shift_rows[0].get("participant_id")
    if not participant_id:
        return []
    return await list_price_item_options_for_participant(str(participant_id), org_id)


async def list_price_item_options_for_participant(participant_id: str, org_id: str) -> list[dict[str, Any]]:
    """Candidate ndis_price_items rows for a participant's plan — same
    filtering list_price_item_options uses for an existing shift, but keyed
    directly by participant so a coordinator can record an expected item
    before any shift exists yet."""
    supabase = get_supabase_admin()
    allowed_categories: Optional[set[str]] = None
    if participant_id:
        plan = await get_plan_for_participant(str(participant_id))
        if plan:
            budgets = plan.get("plan_budgets") or []
            categories = {
                str(b.get("category")) for b in budgets if isinstance(b, dict) and b.get("category")
            }
            if categories:
                allowed_categories = categories

    items_result = (
        supabase.table("ndis_price_items")
        .select(
            "item_code, name, description, unit, support_purpose, category_number, day_type, "
            "time_type, support_intensity, price_national, price_remote, price_very_remote"
        )
        .eq("organization_id", org_id)
        .is_("valid_to", "null")
        .execute()
    )
    items = _safe_rows(items_result.data)

    out: list[dict[str, Any]] = []
    for item in items:
        category = resolve_price_item_budget_category(item)
        if allowed_categories is not None and category not in allowed_categories:
            continue
        category_number = item.get("category_number")
        out.append(
            {
                "item_code": item.get("item_code"),
                "name": item.get("name"),
                "description": item.get("description"),
                "unit": item.get("unit"),
                "support_purpose": item.get("support_purpose"),
                "support_category": category,
                # The real NDIS Support Category (e.g. "01" / "Assistance with
                # Daily Life") — finer-grained than support_category's 3-bucket
                # split above, for grouping the picker so 357 items across 13
                # categories aren't one flat list.
                "category_number": category_number,
                "category_label": support_category_number_label(category_number),
                "day_type": item.get("day_type"),
                "time_type": item.get("time_type"),
                "support_intensity": item.get("support_intensity"),
                "price_national": item.get("price_national"),
            }
        )
    return out


async def verify_shift(
    shift_id: str,
    coordinator_id: str,
    price_item_code: str,
    org_id: str,
    approve_extra_time: bool = False,
    extra_time_reason: Optional[str] = None,
    agreement_reason: Optional[str] = None,
) -> dict[str, Any]:
    """Recompute checks server-side, resolve the coordinator-chosen price
    item, insert the audit row, and deduct from plan_budgets. Rejects shifts
    that are not completed, are already verified, or have no progress note.
    Bills the time worked, capped at the scheduled time unless the
    coordinator approves the extra time with a reason.

    Checks the shift against the service agreement (stage 3c): anything
    outside it needs a reason, the agreed rate applies to the line's own
    code, and no rate above the NDIS price limit is charged."""
    supabase = get_supabase_admin()

    shift_result = (
        supabase.table("shifts")
        .select(_SHIFT_COLUMNS)
        .eq("id", shift_id)
        .execute()
    )
    shift_rows = _safe_rows(shift_result.data)
    if not shift_rows:
        raise ValueError("Shift not found.")
    shift = shift_rows[0]

    if str(shift.get("organization_id") or "") != str(org_id):
        raise ValueError("Shift does not belong to your organisation.")
    if shift.get("status") != "completed":
        raise ValueError("Only completed shifts can be verified.")

    completion_date = _completion_date_for_shift(shift)

    if _active_verification(shift_id):
        raise ValueError("This shift has already been verified.")

    session = _get_session_for_shift(shift)
    if not session_note_text(session):
        raise ValueError(
            "This shift has no progress note. Ask the worker to write it before the shift is verified."
        )

    billing = billable_minutes(shift, approve_extra_time=approve_extra_time)
    reason = (extra_time_reason or "").strip()
    if billing["extra_time_approved"] and len(reason) < 5:
        raise ValueError("Give a reason for approving the extra time (at least 5 characters).")

    agreement_check_error: Optional[str] = None
    try:
        assessment = _agreement_assessment(shift, price_item_code, billing)
    except Exception as exc:
        # Don't stop verification, but record that the check didn't run.
        logger.warning("Agreement check failed for shift %s: %s", shift_id, exc, exc_info=True)
        assessment = None
        agreement_check_error = str(exc)[:300]
    agreement_reason = (agreement_reason or "").strip()
    if assessment and assessment["issues"] and len(agreement_reason) < 5:
        raise ValueError(
            "This shift doesn't match the service agreement: "
            + " ".join(issue["message"] for issue in assessment["issues"])
            + " Give a reason to bill it anyway (at least 5 characters)."
        )

    participant_id = shift.get("participant_id")
    if not participant_id:
        raise ValueError("Shift has no linked participant — cannot verify.")

    plan = await get_plan_for_participant(str(participant_id))
    if not plan:
        raise ValueError("Participant has no active NDIS plan — cannot deduct budget.")

    # location_type intentionally omitted (defaults to "national") — this org
    # has no remote/very-remote participants; revisit if that ever changes.
    price = await ndis_pricing_service.resolve_price(
        price_item_code, org_id, as_of_date=completion_date,
    )
    if not price:
        raise ValueError(f"Price item '{price_item_code}' could not be resolved.")

    day_type_warning: Optional[str] = None
    if assessment and assessment.get("billed_band"):
        # A time-banded item: checked against every band the shift ran in.
        day_type_warning = assessment.get("band_warning")
    else:
        try:
            # schads_engine._day_type returns lowercase snake_case
            # ("weekday"/"saturday"/"sunday"/"public_holiday"); ndis_price_items.day_type
            # is free-text from the imported Price Guide (e.g. "Weekday", "Public Holiday")
            # — normalise both before comparing so casing/spacing never triggers a
            # false-positive warning.
            actual_day_type = _day_type(date.fromisoformat(completion_date), _get_public_holidays(supabase))
            expected_day_type_raw = price.get("day_type")
            expected_day_type = (
                str(expected_day_type_raw).strip().lower().replace(" ", "_") if expected_day_type_raw else None
            )
            if expected_day_type and actual_day_type and expected_day_type != actual_day_type:
                day_type_warning = (
                    f"Selected item '{price_item_code}' is priced as {expected_day_type_raw}, "
                    f"but the shift's service date ({completion_date}) is a {actual_day_type.replace('_', ' ')}."
                )
        except Exception:
            logger.warning("shift_verification: day-type check failed for shift %s", shift_id, exc_info=True)

    expected_item_warning: Optional[str] = None
    expected_price_item_code = shift.get("expected_price_item_code")
    if expected_price_item_code and expected_price_item_code != price_item_code:
        expected_item_warning = (
            f"This shift was expected to be billed as '{expected_price_item_code}' "
            f"but '{price_item_code}' was selected instead."
        )

    category = resolve_price_item_budget_category(price)
    if not category:
        raise ValueError(
            f"Price item '{price_item_code}' could not be mapped to a budget category "
            f"(support_purpose and item code prefix both unrecognised) — cannot deduct budget."
        )

    # ndis_price_items prices (and resolve_price's effective_price) are plain
    # dollar amounts — same convention as billing.tsx, NdisPriceEditor.tsx and
    # billing_service.py; plan_budgets amounts are also plain dollars.
    hourly_rate, rate_source = _rate_for(price, assessment)
    item_code = str(price.get("item_code") or price_item_code)
    # Checked before anything is charged; invoicing and claims check again.
    limit = _price_limit(item_code, completion_date)
    if limit is not None and round(hourly_rate * 100) > round(limit * 100):
        raise ValueError(
            f"The rate for {item_code} (${hourly_rate:.2f}) is above the NDIS price limit of ${limit:.2f}. "
            "Nothing was charged. Correct the rate first."
        )
    billed_minutes = billing["billable_minutes"]
    if billed_minutes is None or billed_minutes <= 0:
        raise ValueError(
            "Shift has no usable worked time (clock-in/clock-out missing or invalid) — "
            "cannot bill. Check the shift record."
        )
    # "E" (per-event) items are a flat fee regardless of how long the shift
    # ran — e.g. a $735.80 establishment fee stays $735.80, not scaled by
    # hours worked the way an "H" (hourly) item's rate is. billed_minutes is
    # still tracked below for the shift's own duration record either way.
    if str(price.get("unit") or "").upper() == "E":
        billed_amount = round(hourly_rate, 2)
    else:
        billed_amount = round((billed_minutes / 60) * hourly_rate, 2)

    checks = compute_verification_checks(shift, session)
    # What was billed and why — part of the audit snapshot.
    checks["billing"] = {**billing, "extra_time_reason": reason or None, "rate_source": rate_source}
    if assessment:
        checks["agreement"] = {**assessment, "reason": agreement_reason or None}
    elif agreement_check_error:
        checks["agreement"] = {"check_failed": agreement_check_error}

    now = datetime.now(timezone.utc).isoformat()

    budgets = plan.get("plan_budgets") or []
    matching_budget = next(
        (b for b in budgets if isinstance(b, dict) and str(b.get("category")) == category),
        None,
    )
    if not matching_budget:
        raise ValueError(
            f"Participant's plan has no '{category}' budget line for this price item's support category."
        )

    try:
        insert_result = (
            supabase.table("shift_verifications")
            .insert(
                {
                    "shift_id": shift_id,
                    "organization_id": org_id,
                    "participant_id": str(participant_id),
                    "checks_run": checks,
                    "price_item_code": price.get("item_code"),
                    "support_category": category,
                    "hourly_rate_applied": hourly_rate,
                    "billed_amount": billed_amount,
                    "verified_by": coordinator_id,
                    "verified_at": now,
                }
            )
            .execute()
        )
    except Exception as exc:
        # The database allows one active verification per shift — a second
        # click (or another coordinator) got there first.
        if "duplicate" in str(exc).lower() or "23505" in str(exc):
            raise ValueError("This shift has already been verified.") from exc
        raise
    verification_rows = _safe_rows(insert_result.data)
    verification = verification_rows[0] if verification_rows else None
    if not verification or not verification.get("id"):
        raise ValueError("The verification couldn't be saved. Nothing was charged — try again.")

    session_id = str(session.get("id")) if session and session.get("id") else None
    try:
        new_used = _apply_budget_change(
            budget=matching_budget,
            plan_id=str(plan["id"]),
            amount=billed_amount,
            category=category,
            hourly_rate=hourly_rate,
            duration_minutes=int(round(billed_minutes)),
            description=f"Shift verification: {item_code} ({int(round(billed_minutes))} min)",
            verification_id=str(verification["id"]),
            session_id=session_id,
        )
    except Exception as exc:
        # Don't leave a verified shift whose budget was never charged.
        supabase.table("shift_verifications").delete().eq("id", str(verification["id"])).execute()
        logger.error("Budget charge failed for shift %s; verification rolled back: %s", shift_id, exc)
        raise ValueError("The plan budget couldn't be charged, so the shift wasn't verified. Try again.") from exc

    # Hours count against the line the actual times matched; the change is
    # already recorded in checks_run.agreement.
    if assessment and assessment.get("line_changed"):
        try:
            supabase.table("shifts").update(
                {"service_agreement_support_id": assessment["matched_line"]["id"]}
            ).eq("id", shift_id).execute()
        except Exception as exc:
            logger.warning("Could not move shift %s to its matched agreement line: %s", shift_id, exc)

    task_completions = _upsert_task_completions_for_verified_shift(
        supabase,
        shift=shift,
        participant_id=str(participant_id),
        organization_id=org_id,
        coordinator_id=coordinator_id,
        price_item_code=item_code,
        billed_amount=billed_amount,
        actual_minutes=billed_minutes,
        verified_at=now,
        completion_date=completion_date,
    )

    result: dict[str, Any] = {
        "verification": verification,
        "checks": checks,
        "billed_amount": billed_amount,
        "hourly_rate_applied": hourly_rate,
        "support_category": category,
        "new_used_amount": new_used,
        "billing": checks["billing"],
        "task_completions": task_completions,
    }
    if day_type_warning:
        result["day_type_warning"] = day_type_warning
    if expected_item_warning:
        result["expected_item_warning"] = expected_item_warning
    if "agreement" in checks:
        result["agreement"] = checks["agreement"]
    result["rate_source"] = rate_source
    return result


async def preview_verification(
    shift_id: str,
    org_id: str,
    price_item_code: Optional[str] = None,
    approve_extra_time: bool = False,
) -> dict[str, Any]:
    """What verifying would bill, before anything is charged: the code the
    time band suggests, the agreement line it counts against, anything that
    needs a reason, the rate and where it comes from, and the price limit."""
    supabase = get_supabase_admin()
    shift = (_safe_rows(supabase.table("shifts").select(_SHIFT_COLUMNS).eq("id", shift_id).execute().data) or [None])[0]
    if not shift or str(shift.get("organization_id") or "") != str(org_id):
        raise ValueError("Shift not found.")
    billing = billable_minutes(shift, approve_extra_time=approve_extra_time)
    assessment = _agreement_assessment(shift, price_item_code, billing)
    code = price_item_code or (assessment or {}).get("suggested_code") or shift.get("expected_price_item_code")
    out: dict[str, Any] = {
        "price_item_code": code,
        "agreement": assessment,
        "rate": None,
        "rate_source": None,
        "price_limit": None,
        "over_limit": False,
    }
    if not code:
        return out
    completion_date = _completion_date_for_shift(shift)
    price = await ndis_pricing_service.resolve_price(code, org_id, as_of_date=completion_date)
    if price:
        rate, source = _rate_for(price, assessment)
        limit = _price_limit(str(code), completion_date)
        out.update({
            "rate": rate,
            "rate_source": source,
            "unit": price.get("unit"),
            "price_limit": limit,
            "over_limit": limit is not None and round(rate * 100) > round(limit * 100),
        })
    return out


async def reverse_verification(
    shift_id: str,
    coordinator_id: str,
    org_id: str,
    reason: str,
) -> dict[str, Any]:
    """Undo a verification made in error (wrong support item, wrong time).

    Refuses once any of the shift's billed work is on an invoice — cancel the
    invoice first. Otherwise refunds the plan budget (a negative ledger row,
    so budget_usage stays append-only), returns the shift's task completions
    to "submitted", and marks the verification reversed. The row stays as
    history and the shift goes back into the verification queue."""
    reason = (reason or "").strip()
    if len(reason) < 5:
        raise ValueError("Give a reason for reversing this verification (at least 5 characters).")

    supabase = get_supabase_admin()
    try:
        supabase.table("shift_verifications").select("reversed_at").limit(1).execute()
    except Exception as exc:
        if _is_missing_column(exc):
            # Without migration 233 the reversal can't be recorded — stop
            # before refunding anything.
            raise ValueError("Reversing verifications needs database migration 233. Apply it first.") from exc
        raise

    verification = _active_verification(shift_id)
    if not verification or str(verification.get("organization_id") or "") != str(org_id):
        raise ValueError("This shift has no verification to reverse.")

    invoiced = _safe_rows(
        supabase.table("task_completions").select("id, invoice_id")
        .eq("shift_id", shift_id).not_.is_("invoice_id", "null").limit(1).execute().data
    )
    if invoiced:
        raise ValueError("This shift is already on an invoice. Cancel that invoice first, then reverse the verification.")

    # Refund the plan that was actually charged (from the verification's own
    # ledger row), not whatever plan is current now.
    charges = _safe_rows(
        supabase.table("budget_usage").select("plan_id, category, amount, session_id")
        .eq("shift_verification_id", str(verification["id"])).execute().data
    )
    charged = round(sum(float(c.get("amount") or 0) for c in charges), 2)
    if charged > 0:
        plan_id = str(charges[0]["plan_id"])
        category = str(charges[0].get("category") or verification.get("support_category") or "")
        budget_rows = _safe_rows(
            supabase.table("plan_budgets").select("id, used_amount")
            .eq("plan_id", plan_id).eq("category", category).limit(1).execute().data
        )
        if not budget_rows:
            raise ValueError("The plan budget this shift was charged to no longer exists — reverse it manually.")
        _apply_budget_change(
            budget=budget_rows[0],
            plan_id=plan_id,
            amount=-charged,
            category=category,
            hourly_rate=float(verification.get("hourly_rate_applied") or 0),
            duration_minutes=0,
            description=f"Reversal of shift verification: {reason}",
            verification_id=str(verification["id"]),
            session_id=charges[0].get("session_id"),
        )

    now = datetime.now(timezone.utc).isoformat()
    supabase.table("task_completions").update({
        "status": "submitted",
        "evidence_verified": False,
        "verified_by": None,
        "verified_at": None,
        "billed_amount": None,
        "price_item_code": None,
        "updated_at": now,
    }).eq("shift_id", shift_id).eq("status", "verified").is_("invoice_id", "null").execute()

    supabase.table("shift_verifications").update({
        "reversed_at": now,
        "reversed_by": coordinator_id,
        "reversal_reason": reason,
    }).eq("id", str(verification["id"])).execute()

    return {"shift_id": shift_id, "verification_id": verification["id"], "refunded_amount": charged, "reversed_at": now}


def list_recent_verifications(org_id: str, days: int = 30) -> list[dict[str, Any]]:
    """Verifications in the last `days`, newest first, with what's needed to
    decide whether one can still be reversed (not yet on an invoice)."""
    from datetime import timedelta

    supabase = get_supabase_admin()
    since = (datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 365)))).isoformat()
    columns = "id, shift_id, participant_id, price_item_code, billed_amount, verified_by, verified_at, checks_run"
    try:
        rows = _safe_rows(
            supabase.table("shift_verifications").select(columns)
            .eq("organization_id", org_id).is_("reversed_at", "null")
            .gte("verified_at", since).order("verified_at", desc=True).limit(200).execute().data
        )
    except Exception as exc:
        if not _is_missing_column(exc):
            raise
        rows = _safe_rows(
            supabase.table("shift_verifications").select(columns)
            .eq("organization_id", org_id).gte("verified_at", since)
            .order("verified_at", desc=True).limit(200).execute().data
        )
    if not rows:
        return []

    shift_ids = [str(r["shift_id"]) for r in rows]
    shifts = {
        str(s["id"]): s for s in _safe_rows(
            supabase.table("shifts").select("id, participant_name, worker_id, scheduled_start")
            .in_("id", shift_ids).eq("organization_id", org_id).execute().data
        )
    }
    invoiced = {
        str(t["shift_id"]) for t in _safe_rows(
            supabase.table("task_completions").select("shift_id")
            .in_("shift_id", shift_ids).not_.is_("invoice_id", "null").execute().data
        )
    }
    user_ids = sorted({str(x) for r in rows for x in (r.get("verified_by"),) if x}
                      | {str(s.get("worker_id")) for s in shifts.values() if s.get("worker_id")})
    names = {
        str(u["id"]): u.get("full_name") for u in _safe_rows(
            supabase.table("users").select("id, full_name").in_("id", user_ids).execute().data
        )
    } if user_ids else {}

    out = []
    for r in rows:
        shift = shifts.get(str(r["shift_id"]), {})
        billing = (r.get("checks_run") or {}).get("billing") or {}
        out.append({
            "shift_id": r["shift_id"],
            "participant_name": shift.get("participant_name"),
            "worker_name": names.get(str(shift.get("worker_id") or "")),
            "scheduled_start": shift.get("scheduled_start"),
            "price_item_code": r.get("price_item_code"),
            "billed_amount": r.get("billed_amount"),
            "billed_minutes": billing.get("billable_minutes"),
            "extra_time_approved": bool(billing.get("extra_time_approved")),
            "verified_at": r.get("verified_at"),
            "verified_by_name": names.get(str(r.get("verified_by") or "")),
            "invoiced": str(r["shift_id"]) in invoiced,
        })
    return out
