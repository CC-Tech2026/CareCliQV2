"""Shift verification gate — coordinator review before budget deduction.

record_session_budget_usage() used to deduct plan_budgets.used_amount
automatically on session save, with no review and hardcoded rates. This
module replaces that with an explicit, audited coordinator confirmation
per completed shift, sourced from the real NDIS price catalogue.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any, Optional

from ..core.timezone import app_today, parse_shift_datetime, participant_timezone
from . import ndis_pricing_service
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
    duration = shift.get("duration_minutes")
    if duration is not None:
        try:
            return float(duration)
        except Exception:
            pass
    clocked_in = shift.get("clocked_in_at")
    clocked_out = shift.get("clocked_out_at")
    if not clocked_in or not clocked_out:
        return None
    try:
        delta = parse_shift_datetime(clocked_out) - parse_shift_datetime(clocked_in)
        return delta.total_seconds() / 60
    except Exception:
        return None


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
    if not task_ids:
        logger.warning(
            "shift_verification: no shift_tasks for shift %s — task_completions skipped",
            shift.get("id"),
        )
        return []

    tasks_result = (
        supabase.table("participant_tasks")
        .select("id, participant_id")
        .in_("id", task_ids)
        .eq("organization_id", organization_id)
        .eq("participant_id", participant_id)
        .execute()
    )
    task_rows = _safe_rows(tasks_result.data)
    if not task_rows:
        return []

    verified_task_ids = [str(row["id"]) for row in task_rows if row.get("id")]
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
    apportioned_minutes = max(1, int(round(actual_minutes / task_count))) if task_count else int(round(actual_minutes))
    apportioned_amount = round(billed_amount / task_count, 2) if task_count else round(billed_amount, 2)

    payload_template = {
        "shift_id": str(shift.get("id")),
        "participant_id": participant_id,
        "organization_id": organization_id,
        "completed_by": coordinator_id,
        "completion_date": completion_date,
        "duration_minutes": apportioned_minutes,
        "evidence_type": "notes",
        "evidence_verified": True,
        "verified_by": coordinator_id,
        "verified_at": verified_at,
        "status": "verified",
        "price_item_code": price_item_code,
        "billed_amount": apportioned_amount,
        "updated_at": verified_at,
    }

    upserted: list[dict[str, Any]] = []
    for task_id in verified_task_ids:
        existing = existing_by_task_id.get(task_id)
        if existing and existing.get("id"):
            resp = (
                supabase.table("task_completions")
                .update(payload_template)
                .eq("id", str(existing["id"]))
                .execute()
            )
            rows = _safe_rows(resp.data)
            if rows:
                upserted.append(rows[0])
            continue

        insert_payload = {
            **payload_template,
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

    any_flagged = bool(
        evidence_check["flagged"] or force_ended_check["flagged"] or hours_check["flagged"]
    )

    return {
        "evidence": evidence_check,
        "hours_sanity": hours_check,
        "force_ended": force_ended_check,
        "any_flagged": any_flagged,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


def _get_session_for_shift(shift: dict[str, Any]) -> Optional[dict[str, Any]]:
    session_id = shift.get("session_id")
    if not session_id:
        return None
    supabase = get_supabase_admin()
    try:
        result = (
            supabase.table("sessions")
            .select("id, end_validation, status")
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
    "duration_minutes, status, session_id, tasks, expected_price_item_code"
)


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

    verified_result = (
        supabase.table("shift_verifications")
        .select("shift_id")
        .eq("organization_id", org_id)
        .execute()
    )
    verified_shift_ids = {
        str(row.get("shift_id")) for row in _safe_rows(verified_result.data)
    }

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
                "participant_id": shift.get("participant_id"),
                "participant_name": shift.get("participant_name"),
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
            "item_code, name, description, unit, support_purpose, day_type, "
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
        out.append(
            {
                "item_code": item.get("item_code"),
                "name": item.get("name"),
                "description": item.get("description"),
                "unit": item.get("unit"),
                "support_purpose": item.get("support_purpose"),
                "support_category": category,
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
) -> dict[str, Any]:
    """Recompute checks server-side, resolve the coordinator-chosen price
    item, insert the audit row, and deduct from plan_budgets. Rejects shifts
    that are not completed or are already verified."""
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

    existing = (
        supabase.table("shift_verifications")
        .select("id")
        .eq("shift_id", shift_id)
        .execute()
    )
    if _safe_rows(existing.data):
        raise ValueError("This shift has already been verified.")

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
    hourly_rate = float(price.get("effective_price") or 0)
    actual_minutes = _actual_minutes(shift)
    if actual_minutes is None or actual_minutes <= 0:
        raise ValueError(
            "Shift has no usable actual duration (clock times or duration_minutes "
            "is missing or invalid) — cannot bill. Check the shift record."
        )
    # "E" (per-event) items are a flat fee regardless of how long the shift
    # ran — e.g. a $735.80 establishment fee stays $735.80, not scaled by
    # hours worked the way an "H" (hourly) item's rate is. actual_minutes is
    # still tracked below for the shift's own duration record either way.
    if str(price.get("unit") or "").upper() == "E":
        billed_amount = round(hourly_rate, 2)
    else:
        billed_amount = round((actual_minutes / 60) * hourly_rate, 2)

    session = _get_session_for_shift(shift)
    checks = compute_verification_checks(shift, session)

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
    verification_rows = _safe_rows(insert_result.data)
    verification = verification_rows[0] if verification_rows else None

    current_used = float(matching_budget.get("used_amount") or 0)
    new_used = round(current_used + billed_amount, 2)
    supabase.table("plan_budgets").update({"used_amount": new_used}).eq(
        "id", matching_budget["id"]
    ).execute()

    if verification and verification.get("id"):
        record_verified_shift_budget_usage(
            plan_id=str(plan["id"]),
            shift_verification_id=str(verification["id"]),
            session_id=str(session.get("id")) if session and session.get("id") else None,
            category=category,
            amount=billed_amount,
            hourly_rate=hourly_rate,
            duration_minutes=int(round(actual_minutes)),
            price_item_code=str(price.get("item_code") or price_item_code),
        )

    task_completions = _upsert_task_completions_for_verified_shift(
        supabase,
        shift=shift,
        participant_id=str(participant_id),
        organization_id=org_id,
        coordinator_id=coordinator_id,
        price_item_code=str(price.get("item_code") or price_item_code),
        billed_amount=billed_amount,
        actual_minutes=actual_minutes,
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
        "task_completions": task_completions,
    }
    if day_type_warning:
        result["day_type_warning"] = day_type_warning
    if expected_item_warning:
        result["expected_item_warning"] = expected_item_warning
    return result
