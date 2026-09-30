"""Invoicing can't double-bill, miscount 'each' items, or rewrite settled invoices."""
from __future__ import annotations

from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import billing_service, invoice_service

USER = {"id": "coord-1", "organization_id": "org-1", "role": "support_coordinator"}


def test_each_items_are_counted_per_completion_not_in_hours():
    transport = {"name": "Activity based transport", "unit": "E", "price_national": 9.90}
    completions = [
        {"id": "c1", "price_item_code": "04_590", "duration_minutes": 30, "billed_amount": 9.90,
         "completion_date": "2026-09-03", "ndis_price_items": transport},
        {"id": "c2", "price_item_code": "04_590", "duration_minutes": 45, "billed_amount": 9.90,
         "completion_date": "2026-09-01", "ndis_price_items": transport},
    ]
    item = invoice_service.aggregate_line_items(completions)["04_590"]
    assert item["quantity"] == Decimal("2")
    assert item["total_price"] == Decimal("19.80")
    assert (item["service_date_from"], item["service_date_to"]) == ("2026-09-01", "2026-09-03")
    assert item["completion_ids"] == ["c1", "c2"]


def test_hourly_items_still_count_hours():
    care = {"name": "Self-care", "unit": "H", "price_national": 70.23}
    item = invoice_service.aggregate_line_items([
        {"id": "c1", "price_item_code": "01_011", "duration_minutes": 90, "billed_amount": 105.35,
         "completion_date": "2026-09-01", "ndis_price_items": care},
    ])["01_011"]
    assert item["quantity"] == Decimal("1.5")


def test_invoice_generation_only_reads_unbilled_completions():
    query = MagicMock()
    for method in ("select", "eq", "gte", "lte", "is_", "order"):
        getattr(query, method).return_value = query
    query.execute.return_value = MagicMock(data=[])
    supabase = MagicMock()
    supabase.table.return_value = query
    from datetime import date
    invoice_service.get_completed_tasks_for_period(
        supabase, "p1", "org-1", date(2026, 9, 1), date(2026, 9, 30), unbilled_only=True,
    )
    query.is_.assert_called_once_with("invoice_id", "null")


@pytest.mark.parametrize("current,target", [("paid", "draft"), ("paid", "cancelled"), ("cancelled", "sent"), ("sent", "draft")])
def test_settled_invoices_cant_be_rewound(current, target):
    with pytest.raises(HTTPException) as err:
        billing_service.check_transition(current, target)
    assert err.value.status_code == 409


@pytest.mark.parametrize("current,target", [("draft", "finalized"), ("finalized", "sent"), ("sent", "paid"), ("overdue", "paid")])
def test_normal_progression_is_allowed(current, target):
    billing_service.check_transition(current, target)


@pytest.mark.asyncio
async def test_lines_can_only_change_on_a_draft():
    with patch.object(billing_service, "get_invoice", new=AsyncMock(return_value={"id": "i1", "status": "sent", "organization_id": "org-1"})):
        with pytest.raises(HTTPException) as err:
            await billing_service.update_invoice("i1", USER, {"line_items": [{"description": "x", "quantity": 1, "unit_amount": 5}]})
    assert err.value.status_code == 409


@pytest.mark.asyncio
async def test_recipient_is_locked_once_sent():
    existing = {"id": "i1", "status": "sent", "organization_id": "org-1", "recipient_name": "NDIA"}
    with patch.object(billing_service, "get_invoice", new=AsyncMock(return_value=existing)):
        with pytest.raises(HTTPException):
            await billing_service.update_invoice("i1", USER, {"recipient_name": "Someone else"})


@pytest.mark.asyncio
async def test_cancelling_releases_the_invoiced_completions():
    supabase = MagicMock()
    with patch.object(billing_service, "get_invoice", new=AsyncMock(return_value={"id": "i1", "status": "sent", "organization_id": "org-1"})), \
         patch.object(billing_service, "get_supabase_admin", return_value=supabase), \
         patch.object(billing_service.audit_service, "log_action", new=AsyncMock()):
        await billing_service.cancel_invoice("i1", USER)
    tables = [c.args[0] for c in supabase.table.call_args_list]
    assert "task_completions" in tables
    release = supabase.table.return_value.update.call_args_list[-1].args[0]
    assert release["invoice_id"] is None


@pytest.mark.asyncio
async def test_paid_invoice_cannot_be_cancelled():
    with patch.object(billing_service, "get_invoice", new=AsyncMock(return_value={"id": "i1", "status": "paid", "organization_id": "org-1"})):
        with pytest.raises(HTTPException) as err:
            await billing_service.cancel_invoice("i1", USER)
    assert err.value.status_code == 409


@pytest.mark.asyncio
async def test_new_invoices_cant_be_created_as_paid():
    with patch.object(billing_service, "_verify_invoice_scope", new=AsyncMock()), \
         patch.object(billing_service, "_resolve_ndis_prices_for_invoice", new=AsyncMock(side_effect=lambda items, org: items)), \
         patch.object(billing_service, "_single_matching_participant", return_value=None):
        with pytest.raises(HTTPException) as err:
            await billing_service.create_invoice(USER, {
                "recipient_name": "Org", "status": "paid",
                "line_items": [{"description": "x", "quantity": 1, "unit_amount": 5}],
            })
    assert err.value.status_code == 422


class _Builder:
    """Like the real client: .range() appends offset/limit to the builder,
    and PostgREST honours the first of each."""

    def __init__(self, rows):
        self.rows, self.params = rows, []

    def range(self, start, end):
        self.params += [("offset", start), ("limit", end - start + 1)]
        return self

    def execute(self):
        offset = next(v for k, v in self.params if k == "offset")
        limit = next(v for k, v in self.params if k == "limit")
        return MagicMock(data=self.rows[offset:offset + limit])


def test_invoice_list_is_not_capped():
    rows = [{"id": i} for i in range(2500)]
    fetched = billing_service._fetch_all(lambda: _Builder(rows))
    assert [r["id"] for r in fetched] == list(range(2500))


def test_reusing_one_builder_is_what_went_wrong():
    # The old call shape re-read page one: 20 x 1,000 copies of the first
    # rows, so every total past 1,000 invoices or shifts was inflated.
    rows = [{"id": i} for i in range(1500)]
    shared = _Builder(rows)
    fetched = billing_service._fetch_all(lambda: shared)
    assert len(fetched) != 1500
