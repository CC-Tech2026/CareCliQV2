"""Tests for the invoice-creation guard against an unlinked participant invoice: a manual
invoice with no participant_id must be refused, not silently created, if recipient_name
exactly matches one real participant on file — the org-level case (recipient_name matching no
participant, e.g. "NDIA") must keep working unchanged.
Run: python3 -m unittest backend.tests.test_invoice_participant_linking -v
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import billing_service

USER = {"id": "coord-1", "organization_id": "org-1", "role": "support_coordinator"}


def _table_with_patient_match(rows: list[dict]) -> MagicMock:
    mock_supabase = MagicMock()

    def _table(name):
        table = MagicMock()
        if name == "participants":
            table.select.return_value.eq.return_value.ilike.return_value.execute.return_value = MagicMock(data=rows)
        elif name == "invoices":
            table.insert.return_value.execute.return_value = MagicMock(
                data=[{"id": "inv-1", "invoice_number": "CS-1", "status": "draft", "total_cents": 0}],
            )
        return table

    mock_supabase.table.side_effect = _table
    return mock_supabase


@pytest.mark.asyncio
async def test_manual_invoice_with_unlinked_matching_participant_name_is_rejected():
    mock_supabase = _table_with_patient_match([{"id": "patient-1", "full_name": "Sarah Chen"}])
    with patch.object(billing_service, "_verify_invoice_scope", new=AsyncMock(return_value=None)), \
         patch.object(billing_service, "get_supabase_admin", return_value=mock_supabase):
        with pytest.raises(HTTPException) as exc_info:
            await billing_service.create_invoice(
                USER,
                {
                    "recipient_name": "Sarah Chen",
                    "status": "draft",
                    "line_items": [{"description": "Support", "quantity": 1, "unit_amount_cents": 1000}],
                },
            )
    assert exc_info.value.status_code == 422


@pytest.mark.asyncio
async def test_manual_invoice_with_no_matching_participant_is_allowed():
    # recipient_name "NDIA" matches no participant — a genuine organisation-level invoice.
    mock_supabase = _table_with_patient_match([])
    with patch.object(billing_service, "_verify_invoice_scope", new=AsyncMock(return_value=None)), \
         patch.object(billing_service, "get_supabase_admin", return_value=mock_supabase), \
         patch.object(billing_service.audit_service, "log_action", new=AsyncMock(return_value=None)):
        result = await billing_service.create_invoice(
            USER,
            {
                "recipient_name": "NDIA",
                "status": "draft",
                "line_items": [{"description": "Support", "quantity": 1, "unit_amount_cents": 1000}],
            },
        )
    assert result["id"] == "inv-1"


@pytest.mark.asyncio
async def test_invoice_with_explicit_participant_id_is_never_blocked_by_the_name_guard():
    participant_row = {
        "id": "patient-1", "organization_id": "org-1", "full_name": "Sarah Chen", "email": None,
        "plan_management_type": None, "plan_management": None,
        "case_manager_name": None, "case_manager_email": None, "case_manager_phone": None,
    }

    def _table(name):
        table = MagicMock()
        if name == "participants":
            table.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
                data=[participant_row],
            )
        elif name == "invoices":
            table.insert.return_value.execute.return_value = MagicMock(
                data=[{"id": "inv-1", "invoice_number": "CS-1", "status": "draft", "total_cents": 0}],
            )
        return table

    mock_supabase = MagicMock()
    mock_supabase.table.side_effect = _table

    with patch.object(billing_service, "_verify_invoice_scope", new=AsyncMock(return_value=None)), \
         patch.object(billing_service, "get_supabase_admin", return_value=mock_supabase), \
         patch.object(billing_service.billing_period_service, "get_or_open_billing_period", return_value={"id": "bp-1"}), \
         patch.object(billing_service.audit_service, "log_action", new=AsyncMock(return_value=None)):
        result = await billing_service.create_invoice(
            USER,
            {
                "participant_id": "patient-1",
                "recipient_name": "Sarah Chen",
                "status": "draft",
                "line_items": [{"description": "Support", "quantity": 1, "unit_amount_cents": 1000}],
            },
        )
    assert result["id"] == "inv-1"
