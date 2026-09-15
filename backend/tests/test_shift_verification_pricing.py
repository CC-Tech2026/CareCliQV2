from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.app.services import shift_verification_service
from backend.app.services.schads_engine import _day_type


ORG_ID = "org-1"
COORDINATOR_ID = "coord-1"
PARTICIPANT_ID = "patient-1"
PRICE_ITEM_CODE = "01_011_0107_1_1"


def _build_shift(scheduled_start: str) -> dict:
    return {
        "id": "shift-1",
        "organization_id": ORG_ID,
        "participant_id": PARTICIPANT_ID,
        "worker_id": "worker-1",
        "scheduled_start": scheduled_start,
        "scheduled_end": scheduled_start,
        "clocked_in_at": scheduled_start,
        "clocked_out_at": scheduled_start,
        "duration_minutes": 60,
        "status": "completed",
        "session_id": None,
        "tasks": [],
    }


def _make_supabase(shift: dict):
    mock_supabase = MagicMock()

    def table_side_effect(name: str):
        table = MagicMock()
        if name == "shifts":
            table.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[shift])
        elif name == "shift_verifications":
            table.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
            table.insert.return_value.execute.return_value = MagicMock(
                data=[{"id": "verification-1"}]
            )
        elif name == "public_holidays":
            table.select.return_value.execute.return_value = MagicMock(data=[])
        elif name == "plan_budgets":
            table.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
        elif name == "shift_tasks":
            table.select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
        else:
            table.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
            table.insert.return_value.execute.return_value = MagicMock(data=[])
        return table

    mock_supabase.table.side_effect = table_side_effect
    return mock_supabase


def _plan():
    return {
        "id": "plan-1",
        "plan_budgets": [{"id": "budget-1", "category": "core", "used_amount": 0}],
    }


def _price(day_type: str) -> dict:
    return {
        "id": "price-1",
        "item_code": PRICE_ITEM_CODE,
        "support_purpose": "Core Supports",
        "effective_price": 6000,
        "day_type": day_type,
    }


@pytest.mark.asyncio
async def test_verify_shift_resolves_price_using_shift_service_date_not_today():
    scheduled_start = "2026-01-05T09:00:00+00:00"  # a Monday
    shift = _build_shift(scheduled_start)
    mock_supabase = _make_supabase(shift)

    resolve_price_mock = AsyncMock(return_value=_price("Weekday"))

    with patch.object(shift_verification_service, "get_supabase_admin", return_value=mock_supabase), patch.object(
        shift_verification_service, "get_plan_for_participant", new=AsyncMock(return_value=_plan())
    ), patch.object(
        shift_verification_service.ndis_pricing_service, "resolve_price", new=resolve_price_mock
    ), patch.object(
        shift_verification_service, "record_verified_shift_budget_usage", return_value=None
    ):
        await shift_verification_service.verify_shift(
            "shift-1", COORDINATOR_ID, PRICE_ITEM_CODE, ORG_ID
        )

    resolve_price_mock.assert_awaited_once()
    _, kwargs = resolve_price_mock.call_args
    assert kwargs.get("as_of_date") == "2026-01-05"
    assert kwargs.get("as_of_date") != date.today().isoformat()


@pytest.mark.asyncio
async def test_verify_shift_warns_on_day_type_mismatch_but_does_not_block():
    scheduled_start = "2026-01-05T09:00:00+00:00"  # a Monday -> "weekday"
    shift = _build_shift(scheduled_start)
    mock_supabase = _make_supabase(shift)

    actual_day_type = _day_type(date(2026, 1, 5), set())
    assert actual_day_type == "weekday"
    mismatched_price_day_type = "Saturday"  # deliberately wrong for a Monday

    with patch.object(shift_verification_service, "get_supabase_admin", return_value=mock_supabase), patch.object(
        shift_verification_service, "get_plan_for_participant", new=AsyncMock(return_value=_plan())
    ), patch.object(
        shift_verification_service.ndis_pricing_service,
        "resolve_price",
        new=AsyncMock(return_value=_price(mismatched_price_day_type)),
    ), patch.object(
        shift_verification_service, "record_verified_shift_budget_usage", return_value=None
    ):
        result = await shift_verification_service.verify_shift(
            "shift-1", COORDINATOR_ID, PRICE_ITEM_CODE, ORG_ID
        )

    assert "day_type_warning" in result
    assert "Saturday" in result["day_type_warning"]
    assert "weekday" in result["day_type_warning"]
    # Non-blocking: verification still went through.
    assert result["billed_amount"] > 0


@pytest.mark.asyncio
async def test_verify_shift_no_warning_when_day_type_matches():
    scheduled_start = "2026-01-05T09:00:00+00:00"  # a Monday -> "weekday"
    shift = _build_shift(scheduled_start)
    mock_supabase = _make_supabase(shift)

    with patch.object(shift_verification_service, "get_supabase_admin", return_value=mock_supabase), patch.object(
        shift_verification_service, "get_plan_for_participant", new=AsyncMock(return_value=_plan())
    ), patch.object(
        shift_verification_service.ndis_pricing_service,
        "resolve_price",
        new=AsyncMock(return_value=_price("Weekday")),
    ), patch.object(
        shift_verification_service, "record_verified_shift_budget_usage", return_value=None
    ):
        result = await shift_verification_service.verify_shift(
            "shift-1", COORDINATOR_ID, PRICE_ITEM_CODE, ORG_ID
        )

    assert "day_type_warning" not in result
