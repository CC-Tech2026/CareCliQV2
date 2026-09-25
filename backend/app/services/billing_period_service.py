"""Billing period plan management lock service (CARECLIQV2-326)."""

from __future__ import annotations

import logging
from calendar import monthrange
from datetime import date, datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException, status

from ..core.timezone import app_today, participant_timezone
from ..models.billing_period import (
    VALID_PLAN_MANAGEMENT_TYPES,
    normalize_plan_management_type,
    plan_management_type_label,
)
from . import service_agreement_service
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

TABLE = "billing_periods"


class BillingPeriodError(Exception):
    """Billing period domain error."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def period_bounds_for_date(as_of: date) -> tuple[date, date]:
    """Calendar-month billing period containing as_of (org timezone date)."""
    period_start = as_of.replace(day=1)
    _, last_day = monthrange(as_of.year, as_of.month)
    period_end = as_of.replace(day=last_day)
    return period_start, period_end


def resolve_participant_plan_management_type(participant: dict[str, Any]) -> Optional[str]:
    """Read current plan management type — the active service agreement's
    declared type if the participant has one (that's the actual source of
    record now, see service_agreement_service.py's module docstring),
    falling back to patients.plan_management_type for participants with no
    service agreement on file yet (true for effectively everyone as of
    2026-09-25 — this table is brand new)."""
    participant_id = participant.get("id")
    organization_id = participant.get("organization_id")
    if participant_id and organization_id:
        agreement = service_agreement_service.get_active_service_agreement(
            str(participant_id), str(organization_id)
        )
        if agreement and agreement.get("plan_management_type"):
            return normalize_plan_management_type(str(agreement["plan_management_type"]))
    raw = participant.get("plan_management_type")
    return normalize_plan_management_type(str(raw) if raw is not None else None)


def _require_canonical_type(value: Optional[str], *, field_name: str = "plan_management_type") -> str:
    normalized = normalize_plan_management_type(value)
    if not normalized or normalized not in VALID_PLAN_MANAGEMENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Invalid {field_name}. "
                f"Allowed values: {', '.join(sorted(VALID_PLAN_MANAGEMENT_TYPES))}."
            ),
        )
    return normalized


def _fetch_period(participant_id: str, period_start: date) -> Optional[dict[str, Any]]:
    supabase = get_supabase_admin()
    result = (
        supabase.table(TABLE)
        .select("*")
        .eq("participant_id", participant_id)
        .eq("period_start", period_start.isoformat())
        .limit(1)
        .execute()
    )
    rows = result.data or []
    return rows[0] if rows else None


def close_stale_open_periods(
    participant_id: str,
    organization_id: str,
    *,
    as_of_date: Optional[date] = None,
) -> int:
    """
    Close open billing periods that ended before the target period month.
    Returns the number of periods closed.
    """
    as_of = as_of_date or app_today(participant_timezone(participant_id, organization_id=organization_id))
    target_start, _ = period_bounds_for_date(as_of)
    supabase = get_supabase_admin()
    result = (
        supabase.table(TABLE)
        .select("id, period_start, period_end, status")
        .eq("participant_id", participant_id)
        .eq("organization_id", organization_id)
        .eq("status", "open")
        .lt("period_start", target_start.isoformat())
        .execute()
    )
    rows = result.data or []
    if not rows:
        return 0

    closed = 0
    now = _now_iso()
    for row in rows:
        supabase.table(TABLE).update({
            "status": "closed",
            "updated_at": now,
        }).eq("id", row["id"]).execute()
        closed += 1
    return closed


def suggest_invoice_recipient(
    participant: dict[str, Any],
    locked_plan_management_type: str,
) -> tuple[str, Optional[str]]:
    """Derive default invoice recipient from locked plan management routing."""
    full_name = str(participant.get("full_name") or "Participant").strip()
    if locked_plan_management_type == "NDIA-managed":
        return "NDIA", None
    if locked_plan_management_type == "plan-managed":
        manager = str(participant.get("case_manager_name") or "").strip()
        email = participant.get("case_manager_email") or participant.get("case_manager_phone")
        return manager or "Plan Manager", str(email).strip() if email else None
    return full_name, str(participant.get("email") or "").strip() or None


def get_or_open_billing_period(
    participant_id: str,
    organization_id: str,
    *,
    as_of_date: Optional[date] = None,
    participant: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    Return the billing period for as_of_date, opening it with a locked type if needed.
    The locked type is immutable once the period row exists.
    """
    # A billing period turns over at midnight in the participant's branch.
    as_of = as_of_date or app_today(participant_timezone(participant_id, organization_id=organization_id))
    period_start, period_end = period_bounds_for_date(as_of)

    if participant is None:
        patient_result = (
            get_supabase_admin()
            .table("patients")
            .select(
                "id, organization_id, full_name, email, plan_management_type, "
                "case_manager_name, case_manager_email, case_manager_phone"
            )
            .eq("id", participant_id)
            .limit(1)
            .execute()
        )
        participant = (patient_result.data or [None])[0]
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found.")

    if str(participant.get("organization_id") or "") != str(organization_id):
        raise HTTPException(status_code=404, detail="Participant not found.")

    close_stale_open_periods(participant_id, organization_id, as_of_date=as_of)

    existing = _fetch_period(participant_id, period_start)
    if existing:
        return existing

    locked_type = resolve_participant_plan_management_type(participant)
    if not locked_type:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Participant plan management type is not set. "
                "Set plan management type before creating invoices for this period."
            ),
        )

    payload = {
        "organization_id": organization_id,
        "participant_id": participant_id,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "locked_plan_management_type": locked_type,
        "status": "open",
        "locked_at": _now_iso(),
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }

    supabase = get_supabase_admin()
    try:
        result = supabase.table(TABLE).insert(payload).execute()
        if result.data:
            return result.data[0]
    except Exception as exc:
        err = str(exc).lower()
        if "duplicate" in err or "unique" in err or "23505" in err:
            raced = _fetch_period(participant_id, period_start)
            if raced:
                return raced
        logger.warning("billing_period insert failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Could not open billing period.",
        ) from exc

    raced = _fetch_period(participant_id, period_start)
    if raced:
        return raced
    raise HTTPException(status_code=500, detail="Could not open billing period.")


def get_locked_plan_management_type(
    participant_id: str,
    organization_id: str,
    *,
    as_of_date: Optional[date] = None,
    participant: Optional[dict[str, Any]] = None,
) -> str:
    period = get_or_open_billing_period(
        participant_id,
        organization_id,
        as_of_date=as_of_date,
        participant=participant,
    )
    return str(period["locked_plan_management_type"])


def list_billing_periods(
    participant_id: str,
    organization_id: str,
    *,
    limit: int = 24,
) -> list[dict[str, Any]]:
    supabase = get_supabase_admin()
    result = (
        supabase.table(TABLE)
        .select("*")
        .eq("participant_id", participant_id)
        .eq("organization_id", organization_id)
        .order("period_start", desc=True)
        .limit(max(1, min(limit, 60)))
        .execute()
    )
    return result.data or []


def get_current_billing_period_view(
    participant_id: str,
    organization_id: str,
    *,
    participant: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Current open period plus whether profile type differs from locked value."""
    if participant is None:
        patient_result = (
            get_supabase_admin()
            .table("patients")
            .select("id, organization_id, plan_management_type")
            .eq("id", participant_id)
            .limit(1)
            .execute()
        )
        participant = (patient_result.data or [None])[0]
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found.")

    if str(participant.get("organization_id") or "") != str(organization_id):
        raise HTTPException(status_code=404, detail="Participant not found.")

    current_type = resolve_participant_plan_management_type(participant)
    today = app_today(participant_timezone(participant, organization_id=organization_id))
    close_stale_open_periods(participant_id, organization_id, as_of_date=today)
    period_start, _ = period_bounds_for_date(today)

    supabase = get_supabase_admin()
    open_result = (
        supabase.table(TABLE)
        .select("*")
        .eq("participant_id", participant_id)
        .eq("organization_id", organization_id)
        .eq("period_start", period_start.isoformat())
        .limit(1)
        .execute()
    )
    open_period = (open_result.data or [None])[0]

    differs = bool(
        open_period
        and current_type
        and open_period.get("locked_plan_management_type") != current_type
    )
    message = None
    if differs:
        message = (
            f"Current type ({plan_management_type_label(current_type)}) applies from the "
            f"next billing period. This period uses "
            f"{plan_management_type_label(open_period.get('locked_plan_management_type'))}."
        )

    return {
        "current_plan_management_type": current_type,
        "open_period": open_period,
        "type_differs_from_lock": differs,
        "message": message,
    }


def validate_plan_management_type_update(value: Optional[str]) -> Optional[str]:
    """Validate coordinator PATCH values; None means field omitted."""
    if value is None:
        return None
    return _require_canonical_type(value)
