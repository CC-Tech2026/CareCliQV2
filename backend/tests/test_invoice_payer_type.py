from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from backend.app.services import billing_service


def _supabase(participants: list[dict], periods: list[dict]) -> MagicMock:
    tables = {
        "participants": MagicMock(),
        "billing_periods": MagicMock(),
    }
    tables["participants"].select.return_value.in_.return_value.execute.return_value = MagicMock(data=participants)
    tables["billing_periods"].select.return_value.in_.return_value.execute.return_value = MagicMock(data=periods)
    supabase = MagicMock()
    supabase.table.side_effect = lambda name: tables[name]
    return supabase


@pytest.mark.asyncio
async def test_each_invoice_says_who_pays_it():
    """The invoice workflow sends plan- and self-managed invoices and claims
    NDIA-managed ones, so the list tells it which is which."""
    supabase = _supabase(
        participants=[
            {"id": "p-agency", "service_category": "disability", "plan_management_type": "NDIA-managed"},
            {"id": "p-plan", "service_category": "disability", "plan_management_type": "plan-managed"},
            {"id": "p-moved", "service_category": "disability", "plan_management_type": "self-managed"},
        ],
        periods=[{"id": "bp-1", "locked_plan_management_type": "NDIA-managed"}],
    )
    invoices = [
        {"id": "i-1", "participant_id": "p-agency"},
        {"id": "i-2", "participant_id": "p-plan"},
        # Raised while the participant was NDIA-managed: the period's lock wins.
        {"id": "i-3", "participant_id": "p-moved", "billing_period_id": "bp-1"},
        {"id": "i-4", "participant_id": None},
    ]

    out = await billing_service._enrich_with_service_category(supabase, invoices)

    assert [inv.get("plan_management_type") for inv in out[:3]] == ["NDIA-managed", "plan-managed", "NDIA-managed"]
    assert out[0]["service_category"] == "disability"
    assert out[3].get("plan_management_type") is None
