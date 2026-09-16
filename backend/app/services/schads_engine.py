"""SCHADS Award (MA000100) pay-calculation engine — Phase 1.

Prices a completed shift: ordinary hours by day-type (weekday / Saturday /
Sunday / public holiday), casual loading, a minimum-engagement top-up when
the shift ran short, and that worker's whole-calendar-day overtime split.
Every write lands in pay_transactions (migration 158), an append-only ledger
mirroring budget_transactions — corrections are new 'reversal' rows, never
edits.

Known, disclosed gaps in this phase (see the SCHADS Phase 1 plan):
  - Evening/night shift loading is not priced. The user's own reference
    document flags the exact percentage as unconfirmed against the Fair
    Work Pay and Conditions Tool, so this engine prices weekday/Saturday/
    Sunday/public-holiday only rather than guess a number.
  - AllowanceCalculator (on-call, travel, first aid, uniform, laundry) is a
    documented no-op: nothing in the data model yet flags a shift as
    on-call, records travel distance, or marks a worker as uniform/first-aid
    entitled. Building it now would mean fabricating that data rather than
    reading it. award_allowances already holds the rate data for when those
    flags exist.
  - Overtime and weekend/public-holiday penalties are not stacked. The
    overtime top-up (§5 below) is calculated against the worker's plain
    weekday base_rate, not the day's penalty-inflated rate — a conservative,
    clearly-documented simplification, since neither source document
    resolves how the two should compound.
  - Sleepover and broken-shift pricing are Phase 2, gated on independently
    verifying the cited 1 June 2026 Fair Work ruling.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, date as date_cls
from datetime import timezone as dt_timezone

from ..core.timezone import APP_TIMEZONE, parse_shift_datetime, participant_timezone
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

# Mirrors coordinator.py's UNASSIGNED_SHIFT_PLACEHOLDER_ID - duplicated (not
# imported) to avoid a circular import, same reasoning as notification_service.py.
UNASSIGNED_SHIFT_PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000"

MINIMUM_ENGAGEMENT_HOURS = {
    "disability_services": 2.0,
    "general_sacs": 3.0,
}
OVERTIME_FIRST_BAND_HOURS = 3.0
OVERTIME_THRESHOLD_DEFAULT_HOURS = 10.0
OVERTIME_THRESHOLD_AGREED_HOURS = 12.0

_DAY_MULTIPLIER = {
    "weekday": 1.0,
    "saturday": 1.5,
    "sunday": 2.0,
    "public_holiday": 2.5,
}
_DAY_COMPONENT = {
    "saturday": "penalty_saturday",
    "sunday": "penalty_sunday",
    "public_holiday": "penalty_public_holiday",
}


def _cents(amount: float) -> int:
    return round(amount * 100)


def _component_row(
    *, organization_id: str, worker_id: str, shift_id: str, component_type: str,
    amount: float, rate_used: float | None, hours_applied: float | None,
    classification_id: str | None, run_id: str, metadata: dict | None = None,
) -> dict | None:
    cents = _cents(amount)
    if cents == 0:
        return None
    return {
        "organization_id": organization_id,
        "worker_id": worker_id,
        "shift_id": shift_id,
        "component_type": component_type,
        "amount_cents": cents,
        "rate_used": rate_used,
        "hours_applied": hours_applied,
        "award_classification_id": classification_id,
        "calculation_run_id": run_id,
        "metadata": metadata or {},
    }


def _get_public_holidays(supabase) -> set[str]:
    resp = supabase.table("public_holidays").select("holiday_date").execute()
    return {row["holiday_date"] for row in (resp.data or []) if row.get("holiday_date")}


def _day_type(local_date: date_cls, public_holidays: set[str]) -> str:
    if local_date.isoformat() in public_holidays:
        return "public_holiday"
    weekday = local_date.weekday()  # Monday=0 .. Sunday=6
    if weekday == 5:
        return "saturday"
    if weekday == 6:
        return "sunday"
    return "weekday"


def _segment_shift_by_local_day(start: datetime, end: datetime, tz=APP_TIMEZONE) -> list[tuple[datetime, datetime]]:
    """Split [start, end) at each local-midnight boundary so a shift crossing
    into a new day-type (e.g. Saturday evening into Sunday) prices each part
    at its own rate instead of one rate for the whole span. ``tz`` is the
    branch the shift is worked in — midnight in Melbourne is not midnight
    in Adelaide."""
    segments: list[tuple[datetime, datetime]] = []
    cursor = start
    while cursor < end:
        local_cursor = cursor.astimezone(tz)
        next_local_midnight = (local_cursor.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1))
        boundary = min(end, next_local_midnight.astimezone(dt_timezone.utc))
        segments.append((cursor, boundary))
        cursor = boundary
    return segments


def _resolve_classification(supabase, classification_id: str) -> dict | None:
    resp = (
        supabase.table("award_classifications")
        .select("id, stream_id, level, pay_point, base_rate, casual_rate")
        .eq("id", classification_id)
        .maybe_single()
        .execute()
    )
    return resp.data if resp else None


def _shift_span(shift: dict) -> tuple[datetime, datetime] | None:
    start_raw = shift.get("clocked_in_at") or shift.get("scheduled_start")
    end_raw = shift.get("clocked_out_at") or shift.get("scheduled_end")
    if not start_raw or not end_raw:
        return None
    start = parse_shift_datetime(start_raw)
    end = parse_shift_datetime(end_raw)
    if end <= start:
        return None
    return start, end


def calculate_shift_pay(shift: dict, *, dry_run: bool = False) -> dict:
    """Price a completed shift. Returns {"components": [...], "total_cents": N}.

    Writes to pay_transactions unless dry_run=True (used by the pay-preview
    endpoint). Non-fatal by design at the call site — shift_service.end_shift
    wraps this in try/except so a pricing bug can never block a worker from
    ending their shift.
    """
    shift_id = shift.get("id")
    worker_id = shift.get("worker_id")
    org_id = shift.get("organization_id")
    empty = {"components": [], "total_cents": 0, "reason": None}
    if not shift_id or not worker_id or not org_id:
        return {**empty, "reason": "missing_shift_worker_or_org"}
    # Penalty-rate boundaries and the overtime day are in the zone where
    # the work happened — the participant's branch.
    tz = participant_timezone(shift, organization_id=org_id)

    supabase = get_supabase_admin()

    worker_resp = (
        supabase.table("users")
        .select("id, classification_id, employment_type, written_agreement_12hr")
        .eq("id", worker_id)
        .maybe_single()
        .execute()
    )
    worker = worker_resp.data if worker_resp else None
    if not worker or not worker.get("classification_id"):
        return {**empty, "reason": "worker_has_no_classification"}

    span = _shift_span(shift)
    if not span:
        return {**empty, "reason": "shift_missing_start_or_end"}
    start, end = span

    classification = _resolve_classification(supabase, worker["classification_id"])
    if not classification:
        logger.warning(
            "schads_engine: worker %s has classification_id %s with no matching award_classifications row",
            worker_id, worker["classification_id"],
        )
        return {**empty, "reason": "classification_not_found"}

    is_casual = worker.get("employment_type") == "casual"

    if shift.get("is_sleepover"):
        return _price_sleepover_shift(
            shift=shift, classification=classification, is_casual=is_casual,
            org_id=org_id, worker_id=worker_id, shift_id=shift_id, dry_run=dry_run, tz=tz,
        )

    base_rate = float(classification["base_rate"])
    casual_rate = float(classification["casual_rate"])
    public_holidays = _get_public_holidays(supabase)
    run_id = str(uuid.uuid4())
    duty_type = shift.get("duty_type") or "disability_services"

    rows: list[dict] = []
    total_hours = 0.0

    for seg_start, seg_end in _segment_shift_by_local_day(start, end, tz):
        hours = (seg_end - seg_start).total_seconds() / 3600
        if hours <= 0:
            continue
        total_hours += hours
        local_date = seg_start.astimezone(tz).date()
        day_type = _day_type(local_date, public_holidays)
        multiplier = _DAY_MULTIPLIER[day_type]
        day_rate = base_rate * multiplier
        component_type = _DAY_COMPONENT.get(day_type, "base_pay")
        rows.append(_component_row(
            organization_id=org_id, worker_id=worker_id, shift_id=shift_id,
            component_type=component_type, amount=day_rate * hours,
            rate_used=day_rate, hours_applied=hours,
            classification_id=classification["id"], run_id=run_id,
        ))
        if is_casual:
            casual_extra_rate = (casual_rate - base_rate) * multiplier
            rows.append(_component_row(
                organization_id=org_id, worker_id=worker_id, shift_id=shift_id,
                component_type="casual_loading", amount=casual_extra_rate * hours,
                rate_used=casual_extra_rate, hours_applied=hours,
                classification_id=classification["id"], run_id=run_id,
            ))

    min_hours = MINIMUM_ENGAGEMENT_HOURS.get(duty_type, MINIMUM_ENGAGEMENT_HOURS["disability_services"])
    if total_hours < min_hours:
        shortfall = min_hours - total_hours
        # Topped up at the plain weekday base rate - the simplest, most
        # defensible baseline for a shortfall on a shift too short to have a
        # clear single day-type rate of its own.
        rows.append(_component_row(
            organization_id=org_id, worker_id=worker_id, shift_id=shift_id,
            component_type="minimum_engagement_topup", amount=base_rate * shortfall,
            rate_used=base_rate, hours_applied=shortfall,
            classification_id=classification["id"], run_id=run_id,
        ))

    rows = [r for r in rows if r is not None]
    total_cents = sum(r["amount_cents"] for r in rows)

    if not dry_run and rows:
        try:
            supabase.table("pay_transactions").insert(rows).execute()
        except Exception:
            logger.exception("schads_engine: failed to write pay_transactions for shift %s", shift_id)
            raise

    if not dry_run:
        try:
            local_date = start.astimezone(tz).date()
            recompute_daily_overtime(worker_id=worker_id, organization_id=org_id, local_date=local_date, tz=tz)
        except Exception:
            logger.exception("schads_engine: overtime recompute failed for worker %s on %s", worker_id, start)

    return {"components": rows, "total_cents": total_cents, "reason": None}


def _price_sleepover_shift(
    *, shift: dict, classification: dict, is_casual: bool,
    org_id: str, worker_id: str, shift_id: str, dry_run: bool, tz=APP_TIMEZONE,
) -> dict:
    """Prices a sleepover shift from its shift_segments rows instead of the
    plain-shift day-segmenter path. Verified against Fair Work Full Bench
    decision [2025] FWCFB 292 (effective 1 June 2026): active-work segments
    price at their ordinary day-rate same as a normal shift, the sleepover
    block prices as one flat allowance, call-outs price at overtime rate,
    and hours beyond an 8h-per-period / 12h-combined ordinary-hours cap
    around the sleepover become an overtime top-up."""
    empty = {"components": [], "total_cents": 0, "reason": None}
    supabase = get_supabase_admin()

    segments_resp = (
        supabase.table("shift_segments")
        .select("id, segment_type, segment_start, segment_end")
        .eq("shift_id", shift_id)
        .order("segment_start")
        .execute()
    )
    segments = segments_resp.data or []
    if not segments:
        return {**empty, "reason": "sleepover_shift_has_no_segments"}

    base_rate = float(classification["base_rate"])
    casual_rate = float(classification["casual_rate"])
    public_holidays = _get_public_holidays(supabase)
    run_id = str(uuid.uuid4())
    rows: list[dict] = []

    sleepover_block = next((s for s in segments if s["segment_type"] == "sleepover_block"), None)
    sleepover_start = parse_shift_datetime(sleepover_block["segment_start"]) if sleepover_block else None
    sleepover_end = parse_shift_datetime(sleepover_block["segment_end"]) if sleepover_block else None

    pre_hours = 0.0
    post_hours = 0.0

    for seg in segments:
        seg_type = seg["segment_type"]
        seg_start = parse_shift_datetime(seg["segment_start"])
        seg_end = parse_shift_datetime(seg["segment_end"])
        if seg_end <= seg_start:
            continue

        if seg_type == "active_work":
            for sub_start, sub_end in _segment_shift_by_local_day(seg_start, seg_end, tz):
                hours = (sub_end - sub_start).total_seconds() / 3600
                if hours <= 0:
                    continue
                local_date = sub_start.astimezone(tz).date()
                day_type = _day_type(local_date, public_holidays)
                multiplier = _DAY_MULTIPLIER[day_type]
                day_rate = base_rate * multiplier
                component_type = _DAY_COMPONENT.get(day_type, "base_pay")
                rows.append(_component_row(
                    organization_id=org_id, worker_id=worker_id, shift_id=shift_id,
                    component_type=component_type, amount=day_rate * hours,
                    rate_used=day_rate, hours_applied=hours,
                    classification_id=classification["id"], run_id=run_id,
                    metadata={"segment_id": seg["id"]},
                ))
                if is_casual:
                    casual_extra_rate = (casual_rate - base_rate) * multiplier
                    rows.append(_component_row(
                        organization_id=org_id, worker_id=worker_id, shift_id=shift_id,
                        component_type="casual_loading", amount=casual_extra_rate * hours,
                        rate_used=casual_extra_rate, hours_applied=hours,
                        classification_id=classification["id"], run_id=run_id,
                        metadata={"segment_id": seg["id"]},
                    ))
            hours_total = (seg_end - seg_start).total_seconds() / 3600
            if sleepover_start and seg_end <= sleepover_start:
                pre_hours += hours_total
            elif sleepover_end and seg_start >= sleepover_end:
                post_hours += hours_total
            else:
                # Doesn't fall cleanly before/after the sleepover block (e.g.
                # no sleepover_block segment present) - count toward "pre"
                # for the ordinary-hours cap below rather than silently
                # dropping it from the cap check.
                pre_hours += hours_total

        elif seg_type == "sleepover_block":
            allowance_resp = (
                supabase.table("award_allowances")
                .select("rate")
                .eq("allowance_type", "sleepover")
                .is_("valid_to", "null")
                .maybe_single()
                .execute()
            )
            allowance = allowance_resp.data if allowance_resp else None
            if allowance:
                rows.append(_component_row(
                    organization_id=org_id, worker_id=worker_id, shift_id=shift_id,
                    component_type="sleepover_allowance", amount=float(allowance["rate"]),
                    rate_used=float(allowance["rate"]), hours_applied=None,
                    classification_id=classification["id"], run_id=run_id,
                    metadata={"segment_id": seg["id"]},
                ))

        elif seg_type == "call_out":
            hours = max(1.0, (seg_end - seg_start).total_seconds() / 3600)  # 1h minimum per call-out
            rate = base_rate * 1.5
            rows.append(_component_row(
                organization_id=org_id, worker_id=worker_id, shift_id=shift_id,
                component_type="overtime_1_5x", amount=rate * hours,
                rate_used=rate, hours_applied=hours,
                classification_id=classification["id"], run_id=run_id,
                metadata={"segment_id": seg["id"], "call_out": True},
            ))

    # Ordinary-hours caps around the sleepover: 8h ordinary per period, 12h
    # ordinary combined. Anything beyond either cap is an overtime top-up on
    # top of the per-segment pricing above (which already paid 1x for every
    # hour) - same top-up convention as recompute_daily_overtime.
    ordinary_capped = min(min(pre_hours, 8.0) + min(post_hours, 8.0), 12.0)
    total_active_hours = pre_hours + post_hours
    overtime_hours = max(0.0, total_active_hours - ordinary_capped)
    if overtime_hours > 0:
        hours_1_5x = min(overtime_hours, OVERTIME_FIRST_BAND_HOURS)
        hours_2x = max(0.0, overtime_hours - OVERTIME_FIRST_BAND_HOURS)
        if hours_1_5x > 0:
            rate = base_rate * 0.5
            rows.append(_component_row(
                organization_id=org_id, worker_id=worker_id, shift_id=shift_id,
                component_type="overtime_1_5x", amount=rate * hours_1_5x, rate_used=rate,
                hours_applied=hours_1_5x, classification_id=classification["id"], run_id=run_id,
                metadata={"sleepover_ordinary_cap_topup": True},
            ))
        if hours_2x > 0:
            rate = base_rate * 1.0
            rows.append(_component_row(
                organization_id=org_id, worker_id=worker_id, shift_id=shift_id,
                component_type="overtime_2x", amount=rate * hours_2x, rate_used=rate,
                hours_applied=hours_2x, classification_id=classification["id"], run_id=run_id,
                metadata={"sleepover_ordinary_cap_topup": True},
            ))

    rows = [r for r in rows if r is not None]
    total_cents = sum(r["amount_cents"] for r in rows)
    if not dry_run and rows:
        supabase.table("pay_transactions").insert(rows).execute()
    return {"components": rows, "total_cents": total_cents, "reason": None}


def calculate_cancellation_pay(shift: dict, cancelled_at: datetime, *, dry_run: bool = False) -> dict:
    """SCHADS clause 25.5(f): a provider cancelling an assigned shift with
    less than 12 hours' notice before the scheduled start must pay a
    full-time or part-time worker (not casuals) for it in full. Prices the
    *scheduled* span (no clock times exist for a cancelled shift) through
    the same day-segmenter used for a worked shift."""
    empty = {"components": [], "total_cents": 0, "reason": None}
    shift_id = shift.get("id")
    worker_id = shift.get("worker_id")
    org_id = shift.get("organization_id")
    if not shift_id or not org_id:
        return {**empty, "reason": "missing_shift_or_org"}
    if not worker_id or worker_id == UNASSIGNED_SHIFT_PLACEHOLDER_ID:
        return {**empty, "reason": "no_assigned_worker"}
    if shift.get("status") in ("in_progress", "completed"):
        return {**empty, "reason": "shift_already_started"}

    supabase = get_supabase_admin()
    worker_resp = (
        supabase.table("users")
        .select("id, classification_id, employment_type")
        .eq("id", worker_id).maybe_single().execute()
    )
    worker = worker_resp.data if worker_resp else None
    if not worker or not worker.get("classification_id"):
        return {**empty, "reason": "worker_has_no_classification"}
    if worker.get("employment_type") not in ("full_time", "part_time"):
        # Casuals are explicitly excluded from clause 25.5(f).
        return {**empty, "reason": "not_eligible_employment_type"}

    scheduled_start_raw = shift.get("scheduled_start")
    scheduled_end_raw = shift.get("scheduled_end")
    if not scheduled_start_raw or not scheduled_end_raw:
        return {**empty, "reason": "shift_missing_schedule"}
    scheduled_start = parse_shift_datetime(scheduled_start_raw)
    scheduled_end = parse_shift_datetime(scheduled_end_raw)
    notice_hours = (scheduled_start - cancelled_at).total_seconds() / 3600
    if notice_hours < 0:
        return {**empty, "reason": "shift_start_already_passed"}
    if notice_hours >= 12:
        return {**empty, "reason": "sufficient_notice_given"}

    classification = _resolve_classification(supabase, worker["classification_id"])
    if not classification:
        return {**empty, "reason": "classification_not_found"}

    base_rate = float(classification["base_rate"])
    public_holidays = _get_public_holidays(supabase)
    run_id = str(uuid.uuid4())
    rows: list[dict] = []

    tz = participant_timezone(shift, organization_id=org_id)
    for seg_start, seg_end in _segment_shift_by_local_day(scheduled_start, scheduled_end, tz):
        hours = (seg_end - seg_start).total_seconds() / 3600
        if hours <= 0:
            continue
        local_date = seg_start.astimezone(tz).date()
        day_type = _day_type(local_date, public_holidays)
        multiplier = _DAY_MULTIPLIER[day_type]
        day_rate = base_rate * multiplier
        rows.append(_component_row(
            organization_id=org_id, worker_id=worker_id, shift_id=shift_id,
            component_type="shift_cancellation_payment", amount=day_rate * hours,
            rate_used=day_rate, hours_applied=hours,
            classification_id=classification["id"], run_id=run_id,
            metadata={"notice_hours": round(notice_hours, 2)},
        ))

    rows = [r for r in rows if r is not None]
    total_cents = sum(r["amount_cents"] for r in rows)
    if not dry_run and rows:
        supabase.table("pay_transactions").insert(rows).execute()
    return {"components": rows, "total_cents": total_cents, "reason": None}


def recompute_daily_overtime(*, worker_id: str, organization_id: str, local_date: date_cls, tz=APP_TIMEZONE) -> None:
    """Re-derive a worker's whole calendar day across every completed shift
    that day and reconcile the overtime_1_5x/overtime_2x ledger rows to
    match. Triggered synchronously by calculate_shift_pay rather than a
    nightly job (see Phase 1 plan) - no new scheduler infrastructure needed,
    and coordinators see an accurate total the moment the relevant shift
    ends instead of waiting for a batch run."""
    supabase = get_supabase_admin()

    day_start_local = datetime.combine(local_date, datetime.min.time()).replace(tzinfo=tz)
    day_end_local = day_start_local + timedelta(days=1)
    day_start_utc = day_start_local.astimezone(dt_timezone.utc).isoformat()
    day_end_utc = day_end_local.astimezone(dt_timezone.utc).isoformat()

    shifts_resp = (
        supabase.table("shifts")
        .select("id, clocked_in_at, clocked_out_at, scheduled_start, scheduled_end")
        .eq("worker_id", worker_id)
        .eq("status", "completed")
        .gte("scheduled_start", day_start_utc)
        .lt("scheduled_start", day_end_utc)
        .execute()
    )
    shifts = shifts_resp.data or []

    total_hours_today = 0.0
    for s in shifts:
        span = _shift_span(s)
        if span:
            total_hours_today += (span[1] - span[0]).total_seconds() / 3600

    worker_resp = (
        supabase.table("users")
        .select("classification_id, written_agreement_12hr")
        .eq("id", worker_id)
        .maybe_single()
        .execute()
    )
    worker = worker_resp.data if worker_resp else None

    # Cancel out any previously-written overtime rows for this worker/day
    # before writing the fresh total - always, even if there's no worker/
    # classification/shifts left, so a day that no longer qualifies (e.g. a
    # shift was reassigned elsewhere) doesn't leave stale overtime pay on
    # the ledger.
    shift_ids = [s["id"] for s in shifts if s.get("id")]
    reversal_rows = _build_overtime_reversal_rows(supabase, worker_id, organization_id, shift_ids)

    if not worker or not worker.get("classification_id") or not shifts:
        if reversal_rows:
            supabase.table("pay_transactions").insert(reversal_rows).execute()
        return

    classification = _resolve_classification(supabase, worker["classification_id"])
    if not classification:
        if reversal_rows:
            supabase.table("pay_transactions").insert(reversal_rows).execute()
        return

    base_rate = float(classification["base_rate"])
    threshold = OVERTIME_THRESHOLD_AGREED_HOURS if worker.get("written_agreement_12hr") else OVERTIME_THRESHOLD_DEFAULT_HOURS
    overtime_hours = max(0.0, total_hours_today - threshold)

    run_id = str(uuid.uuid4())
    new_rows: list[dict] = []
    representative_shift_id = shift_ids[-1] if shift_ids else None
    if overtime_hours > 0 and representative_shift_id:
        hours_1_5x = min(overtime_hours, OVERTIME_FIRST_BAND_HOURS)
        hours_2x = max(0.0, overtime_hours - OVERTIME_FIRST_BAND_HOURS)
        if hours_1_5x > 0:
            rate = base_rate * 0.5  # top-up only: the base component already paid 1x for these hours
            new_rows.append(_component_row(
                organization_id=organization_id, worker_id=worker_id, shift_id=representative_shift_id,
                component_type="overtime_1_5x", amount=rate * hours_1_5x, rate_used=rate,
                hours_applied=hours_1_5x, classification_id=classification["id"], run_id=run_id,
            ))
        if hours_2x > 0:
            rate = base_rate * 1.0
            new_rows.append(_component_row(
                organization_id=organization_id, worker_id=worker_id, shift_id=representative_shift_id,
                component_type="overtime_2x", amount=rate * hours_2x, rate_used=rate,
                hours_applied=hours_2x, classification_id=classification["id"], run_id=run_id,
            ))

    all_rows = reversal_rows + [r for r in new_rows if r is not None]
    if all_rows:
        supabase.table("pay_transactions").insert(all_rows).execute()


def _build_overtime_reversal_rows(supabase, worker_id: str, organization_id: str, shift_ids: list[str]) -> list[dict]:
    if not shift_ids:
        return []
    existing_resp = (
        supabase.table("pay_transactions")
        .select("id, shift_id, component_type, amount_cents, award_classification_id, calculation_run_id")
        .eq("worker_id", worker_id)
        .in_("shift_id", shift_ids)
        .in_("component_type", ["overtime_1_5x", "overtime_2x"])
        .execute()
    )
    originals = existing_resp.data or []
    if not originals:
        return []

    reversed_resp = (
        supabase.table("pay_transactions")
        .select("metadata")
        .eq("worker_id", worker_id)
        .eq("component_type", "reversal")
        .in_("shift_id", shift_ids)
        .execute()
    )
    already_reversed = {
        row["metadata"]["reverses_id"]
        for row in (reversed_resp.data or [])
        if isinstance(row.get("metadata"), dict) and row["metadata"].get("reverses_id")
    }

    reversal_run_id = str(uuid.uuid4())
    reversals = []
    for original in originals:
        if original["id"] in already_reversed:
            continue
        reversals.append({
            "organization_id": organization_id,
            "worker_id": worker_id,
            "shift_id": original["shift_id"],
            "component_type": "reversal",
            "amount_cents": -int(original["amount_cents"]),
            "rate_used": None,
            "hours_applied": None,
            "award_classification_id": original.get("award_classification_id"),
            "calculation_run_id": reversal_run_id,
            "metadata": {"reverses_id": original["id"], "reverses_component_type": original["component_type"]},
        })
    return reversals
