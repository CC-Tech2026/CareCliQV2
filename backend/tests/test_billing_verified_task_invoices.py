from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.app.services import billing_service


USER = {"id": "coord-1", "organization_id": "org-1", "role": "support_coordinator"}


@pytest.mark.asyncio
async def test_create_invoice_can_generate_from_verified_task_completions():
    mock_supabase = MagicMock()
    invoice_row = {"id": "inv-1", "invoice_number": "CS-123", "status": "draft", "total_cents": 13512}
    participant_row = {
        "id": "patient-1",
        "organization_id": "org-1",
        "full_name": "Pat One",
        "email": "pat@example.com",
        "plan_management_type": "plan-managed",
        "plan_management": "plan-managed",
        "case_manager_name": None,
        "case_manager_email": None,
        "case_manager_phone": None,
    }

    def table_side_effect(name: str):
        table = MagicMock()
        if name == "participants":
            table.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
                data=[participant_row]
            )
        elif name == "invoices":
            table.insert.return_value.execute.return_value = MagicMock(data=[invoice_row])
        elif name == "task_completions":
            table.update.return_value.in_.return_value.execute.return_value = MagicMock(data=[])
        return table

    mock_supabase.table.side_effect = table_side_effect

    completions = [
        {"id": "tc-1"},
        {"id": "tc-2"},
    ]
    aggregated = {
        "01_011_0107_1_1": {
            "price_item_code": "01_011_0107_1_1",
            "description": "Community participation support",
            "support_category": "Core Supports",
            "day_type": None,
            "time_type": None,
            "support_intensity": None,
            "unit_price": 6756,
            "quantity": 2,
            "total_price": "135.12",
            "task_ids": ["task-1", "task-2"],
        }
    }

    with patch.object(billing_service, "_verify_invoice_scope", new=AsyncMock(return_value=None)), patch.object(
        billing_service, "get_supabase_admin", return_value=mock_supabase
    ), patch.object(
        billing_service.invoice_service,
        "get_completed_tasks_for_period",
        return_value=completions,
    ), patch.object(
        billing_service.invoice_service,
        "aggregate_line_items",
        return_value=aggregated,
    ), patch.object(
        billing_service, "_resolve_ndis_prices_for_invoice", new=AsyncMock(side_effect=lambda items, org_id: items)
    ), patch.object(
        billing_service.billing_period_service,
        "get_or_open_billing_period",
        return_value={"id": "bp-1", "locked_plan_management_type": "plan-managed"},
    ), patch.object(
        billing_service.billing_period_service,
        "suggest_invoice_recipient",
        return_value=("Plan Manager", "plan@example.com"),
    ), patch.object(
        billing_service.audit_service,
        "log_action",
        new=AsyncMock(return_value=None),
    ):
        result = await billing_service.create_invoice(
            USER,
            {
                "participant_id": "patient-1",
                "recipient_name": "Plan Manager",
                "recipient_email": "plan@example.com",
                "status": "draft",
                "generate_from_verified_tasks": True,
                "period_start": "2026-06-01",
                "period_end": "2026-06-30",
                "line_items": [],
            },
        )

    assert result["id"] == "inv-1"
    assert result["total_cents"] == 13512
