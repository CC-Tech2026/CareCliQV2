"""NDIA bulk claims: what's claimable, the bulk payment request file, and batches."""
from __future__ import annotations

import csv
import io
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import ndia_claim_service as claims

USER = {"id": "md-1", "organization_id": "org-1", "role": "managing_director"}
ORG = {"ndis_provider_number": "4050012345", "abn": "51 824 753 556"}
LIAM = {"id": "p1", "full_name": "Liam Carter", "ndis_number": "430 118 562", "plan_management_type": "NDIA-managed"}


def _invoice(**kw):
    base = {
        "id": "i1", "invoice_number": "CS-20260930-AB12", "participant_id": "p1", "billing_period_id": "bp1",
        "status": "finalized", "total_cents": 28092, "claim_batch_id": None,
        "line_items": [{"description": "Self-care", "item_code": "01_011_0107_1_1", "quantity": 4, "unit": "H",
                        "unit_amount_cents": 7023, "line_total_cents": 28092,
                        "service_date_from": "2026-09-01", "service_date_to": "2026-09-28"}],
    }
    return {**base, **kw}


PERIOD = {"id": "bp1", "period_start": "2026-09-01", "period_end": "2026-09-30", "locked_plan_management_type": "NDIA-managed"}


@pytest.fixture(autouse=True)
def _no_price_limits():
    """No catalogue in these tests — price limits have their own tests in
    test_ndis_price_limits.py."""
    with patch.object(claims, "_price_limits_for", return_value={}):
        yield


def test_plan_type_uses_the_locked_billing_period_first():
    assert claims.plan_type({}, PERIOD, {"plan_management_type": "plan-managed"}) == "NDIA-managed"
    assert claims.plan_type({}, None, {"plan_management_type": "self-managed"}) == "self-managed"


def test_problems_that_would_bounce_a_claim():
    invoice = _invoice(line_items=[{"description": "Manual line", "quantity": 1, "unit_amount_cents": 500}])
    lines = claims.claim_lines(invoice, None)
    problems = claims.claim_problems(invoice, {**LIAM, "ndis_number": "123"}, {}, lines)
    joined = " ".join(problems)
    assert "registration number" in joined
    assert "9-digit NDIS number" in joined
    assert "no NDIS support item" in joined
    assert "no delivery dates" in joined


def test_lines_without_dates_fall_back_to_the_billing_period():
    invoice = _invoice(line_items=[{"description": "Self-care", "item_code": "x", "quantity": 1}])
    line = claims.claim_lines(invoice, PERIOD)[0]
    assert (line["from"], line["to"]) == ("2026-09-01", "2026-09-01")


def test_bulk_file_layout():
    transport = _invoice(
        id="i2", invoice_number="CS-2",
        line_items=[
            {"description": "Transport", "item_code": "04_590_0125_6_1", "quantity": 4, "unit": "E",
             "unit_amount_cents": 990, "service_date_from": "2026-09-02", "service_date_to": "2026-09-20"},
            {"description": "Self-care", "item_code": "01_011_0107_1_1", "quantity": 1.5, "unit": "H",
             "unit_amount_cents": 7023, "service_date": "2026-09-05"},
        ],
    )
    content = claims.build_bulk_csv(ORG, [
        {"invoice": _invoice(), "participant": LIAM, "lines": claims.claim_lines(_invoice(), PERIOD)},
        {"invoice": transport, "participant": LIAM, "lines": claims.claim_lines(transport, PERIOD)},
    ])
    rows = list(csv.reader(io.StringIO(content)))
    assert rows[0] == claims.BULK_COLUMNS
    header = {name: i for i, name in enumerate(rows[0])}
    first, trip, care = rows[1], rows[2], rows[3]
    assert first[header["RegistrationNumber"]] == "4050012345"
    assert first[header["NDISNumber"]] == "430118562"
    assert (first[header["SupportsDeliveredFrom"]], first[header["SupportsDeliveredTo"]]) == ("2026-09-01", "2026-09-28")
    assert (first[header["Quantity"]], first[header["Hours"]]) == ("", "04:00")
    assert first[header["UnitPrice"]] == "70.23" and first[header["GSTCode"]] == "P2"
    assert first[header["ClaimReference"]] == "CS-20260930-AB12"
    assert first[header["ABN of Support Provider"]] == "51824753556"
    # Per-item supports use Quantity; multi-line invoices get unique references.
    assert (trip[header["Quantity"]], trip[header["Hours"]]) == ("4", "")
    assert trip[header["ClaimReference"]] == "CS-2-1" and care[header["ClaimReference"]] == "CS-2-2"
    assert care[header["Hours"]] == "01:30"
    assert content.endswith("\r\n")


def test_claim_reference_is_capped_at_50():
    assert len(claims.claim_reference("X" * 80, 0, 1)) == 50


def _supabase_for_submit(invoices):
    client = MagicMock()

    def table(name):
        t = MagicMock()
        if name == "invoices":
            t.select.return_value.eq.return_value.in_.return_value.execute.return_value = MagicMock(data=invoices)
        return t

    client.table.side_effect = table
    return client


@pytest.mark.asyncio
async def test_submit_refuses_claimed_or_unfinalised_invoices():
    invoices = [_invoice(), _invoice(id="i2", invoice_number="CS-2", status="draft")]
    with patch.object(claims, "get_supabase_admin", return_value=_supabase_for_submit(invoices)), \
         patch.object(claims, "_participants", return_value={"p1": LIAM}), \
         patch.object(claims, "_periods", return_value={"bp1": PERIOD}), \
         patch.object(claims, "_org", return_value=ORG):
        with pytest.raises(HTTPException) as err:
            await claims.submit_batch(USER, ["i1", "i2"])
    assert err.value.status_code == 409 and "CS-2 isn't finalised" in err.value.detail


@pytest.mark.asyncio
async def test_submit_refuses_plan_managed_invoices():
    period = {**PERIOD, "locked_plan_management_type": "plan-managed"}
    with patch.object(claims, "get_supabase_admin", return_value=_supabase_for_submit([_invoice()])), \
         patch.object(claims, "_participants", return_value={"p1": LIAM}), \
         patch.object(claims, "_periods", return_value={"bp1": period}), \
         patch.object(claims, "_org", return_value=ORG):
        with pytest.raises(HTTPException) as err:
            await claims.submit_batch(USER, ["i1"])
    assert "isn't for an NDIA-managed participant" in err.value.detail


@pytest.mark.asyncio
async def test_submit_creates_batch_and_marks_invoices_sent():
    client = _supabase_for_submit([_invoice()])
    with patch.object(claims, "get_supabase_admin", return_value=client), \
         patch.object(claims, "_participants", return_value={"p1": LIAM}), \
         patch.object(claims, "_periods", return_value={"bp1": PERIOD}), \
         patch.object(claims, "_org", return_value=ORG), \
         patch.object(claims, "_next_batch_number", return_value="CLM-20260930-01"), \
         patch.object(claims.audit_service, "log_action", new=AsyncMock()):
        result = await claims.submit_batch(USER, ["i1"])
    assert result["file_name"] == "ndia-bulk-claim-CLM-20260930-01.csv"
    assert "01_011_0107_1_1" in result["csv"]
    client.storage.from_.assert_called_with("ndia-claims")


@pytest.mark.asyncio
async def test_payment_date_cant_be_in_the_future():
    with pytest.raises(HTTPException) as err:
        await claims.mark_paid(USER, ["i1"], "2999-01-01", "REM-1")
    assert err.value.status_code == 422


@pytest.mark.asyncio
async def test_rejected_claim_needs_a_reason():
    with pytest.raises(HTTPException):
        await claims.return_to_ready(USER, "i1", "no")


def test_list_splits_ready_submitted_and_paid():
    rows = [
        _invoice(),
        _invoice(id="i2", invoice_number="CS-2", status="draft"),
        _invoice(id="i3", invoice_number="CS-3", status="sent", claim_batch_id="b1"),
        _invoice(id="i4", invoice_number="CS-4", status="paid", claim_batch_id="b1"),
        _invoice(id="i5", invoice_number="CS-5", participant_id="p2", billing_period_id=None),
    ]
    with patch.object(claims, "get_supabase_admin"), \
         patch("backend.app.services.billing_service._fetch_all", return_value=rows), \
         patch.object(claims, "_participants", return_value={"p1": LIAM, "p2": {**LIAM, "id": "p2", "plan_management_type": "plan-managed"}}), \
         patch.object(claims, "_periods", return_value={"bp1": PERIOD}), \
         patch.object(claims, "_batches", return_value={"b1": {"id": "b1", "batch_number": "CLM-1"}}), \
         patch.object(claims, "_org", return_value=ORG):
        result = claims.list_claims(USER)
    assert [r["invoice_number"] for r in result["ready"]] == ["CS-20260930-AB12"]
    assert [r["invoice_number"] for r in result["submitted"]] == ["CS-3"]
    assert [r["invoice_number"] for r in result["paid"]] == ["CS-4"]
    assert result["drafts_awaiting_review"] == 1
    assert result["ready"][0]["quantity_label"] == "4 hrs" and result["ready"][0]["problems"] == []
