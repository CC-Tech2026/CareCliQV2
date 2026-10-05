"""Agreement-led shifts, stage 3c: verification re-matches the shift to its
agreement line from the actual times, picks the time-of-day code, bills the
agreed rate for the line's own code, refuses a rate above the NDIS limit,
and needs a reason for anything outside the agreement."""
from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch
from zoneinfo import ZoneInfo

import pytest

from backend.app.services import agreement_support_service as agreements
from backend.app.services import shift_verification_service as svc

ADL = ZoneInfo("Australia/Adelaide")
NAME = "Assistance With Self-Care Activities - Standard"


def _item(code, day_type, time_type, price, suffix):
    return {"item_code": code, "name": f"{NAME} - {suffix}", "registration_group": "0107", "support_purpose": "Core Supports",
            "unit": "H", "day_type": day_type, "time_type": time_type, "price_national": price}


CATALOGUE = [
    _item("01_011_0107_1_1", "Weekday", "Daytime", 73.58, "Weekday Daytime"),
    _item("01_015_0107_1_1", "Weekday", "Evening", 81.07, "Weekday Evening"),
    _item("01_002_0107_1_1", "Weekday", "Night", 82.57, "Weekday Night"),
    _item("01_013_0107_1_1", "Saturday", None, 103.54, "Saturday"),
    _item("01_014_0107_1_1", "Sunday", None, 133.50, "Sunday"),
    _item("01_012_0107_1_1", "Public Holiday", None, 163.46, "Public Holiday"),
]
AGREEMENT = {"id": "sa-1", "agreement_number": "SA-0001", "status": "active", "start_date": "2026-07-01", "end_date": "2027-06-30"}
WEEKDAY_LINE = {"id": "line-wd", "support_item_code": "01_011_0107_1_1", "total_hours_allocated": 52, "negotiated_rate": 70.00}
SATURDAY_LINE = {"id": "line-sat", "support_item_code": "01_013_0107_1_1", "total_hours_allocated": 20, "negotiated_rate": None}
NO_USE = {"delivered": 0.0, "booked_soon": 0.0, "booked_later": 0.0}


def _shift(**kw):
    return {"id": "shift-1", "organization_id": "org-1", "participant_id": "p-1",
            "service_agreement_support_id": "line-wd", "expected_price_item_code": "01_011_0107_1_1", **kw}


def _assess(shift, start, end, billed=None, lines=None, usage=None, minutes=None):
    lines = [(AGREEMENT, WEEKDAY_LINE), (AGREEMENT, SATURDAY_LINE)] if lines is None else lines
    with patch.object(agreements, "_verification_lines", return_value=lines), \
         patch.object(agreements, "_catalogue", return_value=CATALOGUE), \
         patch.object(agreements, "line_usage", side_effect=lambda ids, *a, **k: {i: dict(usage or NO_USE) for i in ids}):
        return agreements.assess_for_verification(
            shift, billed_code=billed, local_start=start, local_end=end, holidays=set(),
            billable_minutes=minutes if minutes is not None else (end - start).total_seconds() / 60,
        )


def _at(day, hour, minute=0):
    return datetime(2026, 10, day, hour, minute, tzinfo=ADL)


def test_a_weekday_shift_on_its_line_bills_the_agreed_rate():
    result = _assess(_shift(), _at(5, 9), _at(5, 12))
    assert result["suggested_code"] == "01_011_0107_1_1"
    assert result["matched_line"]["id"] == "line-wd" and not result["line_changed"]
    assert result["agreed_rate"] == 70.00
    assert result["issues"] == []


def test_running_into_the_evening_suggests_the_evening_code_at_the_organisation_price():
    result = _assess(_shift(), _at(5, 17), _at(5, 21))
    assert result["bands"] == ["weekday_daytime", "weekday_evening"] and result["crosses_bands"]
    assert result["suggested_code"] == "01_015_0107_1_1"
    # Two lines (weekday and Saturday) both cover self-care, and the
    # evening code is exact on neither: never guessed, so it needs a reason.
    assert result["matched_line"] is None and result["agreed_rate"] is None
    assert [i["code"] for i in result["issues"]] == ["no_line"]
    assert "matches more than one support" in result["issues"][0]["message"]


def test_a_saturday_shift_moves_to_the_saturday_line():
    result = _assess(_shift(), _at(10, 9), _at(10, 13))
    assert result["suggested_code"] == "01_013_0107_1_1"
    assert result["matched_line"]["id"] == "line-sat" and result["line_changed"]
    assert result["issues"] == []


def test_one_line_covers_its_whole_support():
    result = _assess(_shift(), _at(5, 17), _at(5, 21), lines=[(AGREEMENT, WEEKDAY_LINE)])
    assert result["matched_line"]["id"] == "line-wd" and result["issues"] == []


def test_billing_a_code_that_doesnt_fit_the_times_warns():
    result = _assess(_shift(), _at(10, 9), _at(10, 13), billed="01_011_0107_1_1")
    assert "priced for weekday daytime, but the shift ran Saturday" in result["band_warning"]
    assert result["matched_line"]["id"] == "line-wd"  # still an agreed line, at its agreed rate


def test_things_outside_the_agreement_need_a_reason():
    unsigned = {**AGREEMENT, "status": "pending_signature", "end_date": "2026-09-30"}
    result = _assess(
        _shift(), _at(5, 9), _at(5, 12), lines=[(unsigned, WEEKDAY_LINE)],
        usage={"delivered": 50 * 60, "booked_soon": 0, "booked_later": 0},
    )
    assert [i["code"] for i in result["issues"]] == ["outside_dates", "unsigned", "over_hours"]
    assert "1h over the 52h agreed" in result["issues"][2]["message"]


def test_no_agreement_at_all_needs_a_reason():
    result = _assess(_shift(service_agreement_support_id=None), _at(5, 9), _at(5, 12), lines=[])
    assert [i["code"] for i in result["issues"]] == ["no_agreement"]
    assert result["suggested_code"] == "01_011_0107_1_1"  # from the expected item


# ── verify_shift ─────────────────────────────────────────────────────────

PRICE = {"item_code": "01_011_0107_1_1", "effective_price": 65.0, "price_source": "platform",
         "support_purpose": "Core Supports", "unit": "H"}
PLAN = {"id": "plan-1", "plan_budgets": [{"id": "budget-1", "category": "core", "used_amount": 0}]}
SHIFT = {
    "id": "shift-1", "organization_id": "org-1", "participant_id": "p-1", "worker_id": "w-1", "status": "completed",
    "session_id": "session-1", "tasks": [], "scheduled_start": "2026-10-05T09:00:00+10:30",
    "scheduled_end": "2026-10-05T12:00:00+10:30", "clocked_in_at": "2026-10-05T09:00:00+10:30",
    "clocked_out_at": "2026-10-05T12:00:00+10:30", "service_agreement_support_id": "line-old",
}


def _db():
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[dict(SHIFT)])
    db.table.return_value.insert.return_value.execute.return_value = MagicMock(data=[{"id": "ver-1"}])
    return db


def _assessment(**kw):
    base = {"issues": [], "agreed_rate": None, "billed_band": "weekday_daytime", "band_warning": None,
            "line_changed": False, "matched_line": {"id": "line-wd"}}
    return {**base, **kw}


async def _verify(assessment, limit=73.58, **kw):
    db = _db()
    with patch.object(svc, "get_supabase_admin", return_value=db), \
         patch.object(svc, "_active_verification", return_value=None), \
         patch.object(svc, "_get_session_for_shift", return_value={"id": "session-1", "compliance_input_text": "Helped with lunch."}), \
         patch.object(svc, "get_plan_for_participant", new=AsyncMock(return_value=PLAN)), \
         patch.object(svc.ndis_pricing_service, "resolve_price", new=AsyncMock(return_value=PRICE)), \
         patch.object(svc, "_agreement_assessment", return_value=assessment), \
         patch.object(svc, "_price_limit", return_value=limit), \
         patch.object(svc, "_upsert_task_completions_for_verified_shift", return_value=[]), \
         patch.object(svc, "_apply_budget_change", return_value=0.0) as charge:
        result = await svc.verify_shift("shift-1", "coord-1", "01_011_0107_1_1", "org-1", **kw)
    return result, charge, db


@pytest.mark.asyncio
async def test_the_agreed_rate_is_billed_and_recorded():
    result, charge, _ = await _verify(_assessment(agreed_rate=70.0))
    assert result["hourly_rate_applied"] == 70.0 and result["billed_amount"] == 210.0
    assert result["rate_source"] == "agreement"
    assert charge.call_args.kwargs["amount"] == 210.0


@pytest.mark.asyncio
async def test_without_an_agreed_rate_the_organisation_or_catalogue_price_is_billed():
    result, _, _ = await _verify(_assessment())
    assert result["hourly_rate_applied"] == 65.0 and result["rate_source"] == "platform"


@pytest.mark.asyncio
async def test_a_rate_above_the_ndis_limit_is_refused_before_charging():
    with pytest.raises(ValueError, match="above the NDIS price limit of \\$73.58"):
        await _verify(_assessment(agreed_rate=80.0))


@pytest.mark.asyncio
async def test_outside_the_agreement_needs_a_reason_which_is_saved():
    issues = [{"code": "unsigned", "message": "The agreement hasn't been signed yet."}]
    with pytest.raises(ValueError, match="hasn't been signed yet.*Give a reason"):
        await _verify(_assessment(issues=issues))
    result, _, _ = await _verify(_assessment(issues=issues), agreement_reason="Signed copy is on its way by post.")
    assert result["agreement"]["reason"] == "Signed copy is on its way by post."
    assert result["checks"]["agreement"]["issues"] == issues


@pytest.mark.asyncio
async def test_the_shift_moves_to_the_line_its_times_matched():
    _, _, db = await _verify(_assessment(line_changed=True, matched_line={"id": "line-sat"}))
    db.table.return_value.update.assert_any_call({"service_agreement_support_id": "line-sat"})


@pytest.mark.asyncio
async def test_a_band_mismatch_replaces_the_old_day_type_warning():
    result, _, _ = await _verify(_assessment(band_warning="01_011_0107_1_1 is priced for weekday daytime, but the shift ran Saturday."))
    assert result["day_type_warning"].endswith("the shift ran Saturday.")
