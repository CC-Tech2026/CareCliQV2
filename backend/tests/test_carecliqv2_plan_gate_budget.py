"""Tests for CARECLIQV2-327/328/329 plan gate, budget usage, and goal support_category."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.api import coordinator as coordinator_api
from backend.app.services import funding_service, shift_verification_service


COORDINATOR = {"id": "coord-1", "organization_id": "org-1", "role": "support_coordinator"}
ACTIVE_PLAN = {"id": "plan-1", "plan_budgets": [{"id": "pb-1", "category": "core", "used_amount": 0}]}


@pytest.mark.asyncio
async def test_require_active_plan_raises_when_missing():
    with patch.object(
        funding_service,
        "get_plan_for_participant",
        new=AsyncMock(return_value=None),
    ):
        with pytest.raises(ValueError, match="no active NDIS plan"):
            await funding_service.require_active_plan_for_participant("patient-1")


@pytest.mark.asyncio
async def test_require_active_plan_returns_plan():
    with patch.object(
        funding_service,
        "get_plan_for_participant",
        new=AsyncMock(return_value=ACTIVE_PLAN),
    ):
        plan = await funding_service.require_active_plan_for_participant("patient-1")
        assert plan["id"] == "plan-1"


def test_normalize_goal_support_category_rejects_invalid():
    assert funding_service.normalize_goal_support_category("") is None
    assert funding_service.normalize_goal_support_category("not_a_real_category") is None
    assert funding_service.normalize_goal_support_category("core_daily_activities") == "core_daily_activities"


@pytest.mark.asyncio
async def test_create_ndis_goal_requires_support_category():
    body = coordinator_api.NdisGoalBody(
        participant_id="patient-1",
        name="Test goal",
        goal_area="daily_living",
        support_category=None,
    )
    with pytest.raises(HTTPException) as exc:
        await coordinator_api.create_ndis_goal(body, COORDINATOR)
    assert exc.value.status_code == 422
    assert "support_category" in str(exc.value.detail).lower()


@pytest.mark.asyncio
async def test_create_ndis_goal_requires_active_plan():
    body = coordinator_api.NdisGoalBody(
        participant_id="patient-1",
        name="Test goal",
        goal_area="daily_living",
        support_category="core_daily_activities",
    )
    mock_supabase = MagicMock()
    with patch.object(coordinator_api, "get_supabase_admin", return_value=mock_supabase), patch.object(
        coordinator_api,
        "_ensure_participant_active_plan",
        new=AsyncMock(side_effect=HTTPException(status_code=422, detail="no active NDIS plan")),
    ):
        with pytest.raises(HTTPException) as exc:
            await coordinator_api.create_ndis_goal(body, COORDINATOR)
        assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_create_participant_task_blocked_without_plan():
    body = coordinator_api.ParticipantTaskPayload(
        name="Morning meds",
        goal_id=None,
    )
    with patch.object(
        coordinator_api,
        "_ensure_participant_active_plan",
        new=AsyncMock(side_effect=HTTPException(status_code=422, detail="no active NDIS plan")),
    ):
        with pytest.raises(HTTPException) as exc:
            await coordinator_api.create_participant_task("patient-1", body, COORDINATOR)
        assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_verify_shift_records_budget_usage():
    shift = {
        "id": "shift-1",
        "organization_id": "org-1",
        "participant_id": "patient-1",
        "status": "completed",
        "scheduled_start": "2026-06-01T09:00:00+00:00",
        "scheduled_end": "2026-06-01T11:00:00+00:00",
        "clocked_in_at": "2026-06-01T09:00:00+00:00",
        "clocked_out_at": "2026-06-01T11:00:00+00:00",
        "duration_minutes": 120,
        "session_id": "session-1",
    }
    price = {
        "item_code": "01_011_0107_1_1",
        "effective_price": 67.56,  # ndis_price_items stores plain dollars, not cents
        "support_purpose": "Core Supports",
    }
    verification_row = {"id": "ver-1"}

    mock_supabase = MagicMock()

    def table_side_effect(name: str):
        table = MagicMock()
        if name == "shifts":
            table.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[shift])
        elif name == "shift_verifications":
            select_chain = table.select.return_value.eq.return_value
            select_chain.execute.return_value = MagicMock(data=[])
            table.insert.return_value.execute.return_value = MagicMock(data=[verification_row])
        elif name == "shift_tasks":
            table.select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
                data=[{"task_id": "task-1"}, {"task_id": "task-2"}]
            )
        elif name == "participant_tasks":
            table.select.return_value.in_.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
                data=[
                    {"id": "task-1", "participant_id": "patient-1"},
                    {"id": "task-2", "participant_id": "patient-1"},
                ]
            )
        elif name == "task_completions":
            table.select.return_value.eq.return_value.in_.return_value.execute.return_value = MagicMock(data=[])
            table.insert.return_value.execute.return_value = MagicMock(data=[{"id": "tc-1"}])
        elif name == "plan_budgets":
            table.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
        return table

    mock_supabase.table.side_effect = table_side_effect

    with patch.object(shift_verification_service, "get_supabase_admin", return_value=mock_supabase), patch.object(
        shift_verification_service,
        "get_plan_for_participant",
        new=AsyncMock(return_value={**ACTIVE_PLAN, "id": "plan-1"}),
    ), patch.object(
        shift_verification_service.ndis_pricing_service,
        "resolve_price",
        new=AsyncMock(return_value=price),
    ), patch.object(
        shift_verification_service,
        "_get_session_for_shift",
        return_value={"id": "session-1"},
    ), patch.object(
        shift_verification_service,
        "compute_verification_checks",
        return_value={},
    ), patch.object(
        shift_verification_service,
        "record_verified_shift_budget_usage",
        return_value={"id": "bu-1"},
    ) as record_usage:
        result = await shift_verification_service.verify_shift(
            shift_id="shift-1",
            coordinator_id="coord-1",
            price_item_code="01_011_0107_1_1",
            org_id="org-1",
        )

    assert result["billed_amount"] > 0
    assert len(result["task_completions"]) == 2
    record_usage.assert_called_once()
    call_kwargs = record_usage.call_args.kwargs
    assert call_kwargs["shift_verification_id"] == "ver-1"
    assert call_kwargs["plan_id"] == "plan-1"
    assert call_kwargs["hourly_rate"] == pytest.approx(67.56)
