"""NDIS price limits: an org's own rate, an invoice line or a claim can be
lower than the platform catalogue's limit for the delivery date, never higher."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import billing_service, ndia_claim_service as claims
from backend.app.services import ndis_pricing_service as pricing

SELF_CARE = "01_011_0107_1_1"
# FY25-26 limit until 30 June, then a higher FY26-27 limit.
CATALOGUE = {
    SELF_CARE: [
        {"item_code": SELF_CARE, "price_national": 70.23, "price_remote": None, "price_very_remote": None,
         "valid_from": "2025-07-01T00:00:00+00:00", "valid_to": "2026-07-01T00:00:00+00:00"},
        {"item_code": SELF_CARE, "price_national": 73.58, "price_remote": 103.01, "price_very_remote": None,
         "valid_from": "2026-07-01T00:00:00+00:00", "valid_to": None},
    ],
}


def _line(cents, *, on="2026-09-10", location="national", code=SELF_CARE, **extra):
    return {"description": "Self-care", "item_code": code, "quantity": 2, "unit_amount_cents": cents,
            "service_date": on, "location_type": location, **extra}


def test_limit_follows_the_delivery_date():
    assert pricing.price_limit_cents(CATALOGUE, SELF_CARE, "2026-06-30") == 7023
    assert pricing.price_limit_cents(CATALOGUE, SELF_CARE, "2026-07-01") == 7358
    assert pricing.price_limit_cents(CATALOGUE, SELF_CARE, "2025-06-30") is None  # before the catalogue


def test_limit_by_location():
    assert pricing.price_limit_cents(CATALOGUE, SELF_CARE, "2026-09-10", "remote") == 10301   # explicit
    assert pricing.price_limit_cents(CATALOGUE, SELF_CARE, "2026-09-10", "very_remote") == 10301  # 73.58 x 1.40


def test_items_with_no_limit_are_not_capped():
    # Quote-required items are never loaded into the catalogue.
    assert pricing.price_limit_breaches([_line(99999, code="15_037_0117_1_3")], CATALOGUE) == []


def test_breaches_name_the_line_price_and_limit():
    ok = _line(7358)
    rounded = _line(7359)  # 1 cent of rounding slack
    over = _line(8000)
    old_rate = _line(7358, on="2026-06-15")  # above last year's limit
    problems = pricing.price_limit_breaches([ok, rounded, over, old_rate], CATALOGUE)
    assert len(problems) == 2
    assert "$80.00 is above the NDIS price limit of $73.58" in problems[0]
    assert "$70.23" in problems[1] and "2026-06-15" in problems[1]


def test_generated_lines_use_their_first_delivery_date():
    line = _line(8000, on=None, service_date_from="2026-09-01")
    assert pricing.price_limit_breaches([line], CATALOGUE)


def test_invoice_lines_above_the_limit_are_refused():
    with patch.object(pricing, "load_price_limit_rows", return_value=CATALOGUE):
        billing_service._enforce_price_limits([_line(7000)])
        with pytest.raises(HTTPException) as err:
            billing_service._enforce_price_limits([_line(9000)])
    assert err.value.status_code == 422 and "above the NDIS price limit" in err.value.detail


@pytest.mark.asyncio
async def test_finalising_an_old_draft_checks_its_prices():
    draft = {"id": "inv-1", "organization_id": "org-1", "status": "draft", "line_items": [_line(9000)]}
    user = {"id": "md-1", "organization_id": "org-1", "role": "managing_director"}
    with patch.object(billing_service, "get_invoice", new=AsyncMock(return_value=draft)), \
         patch.object(pricing, "load_price_limit_rows", return_value=CATALOGUE), \
         patch.object(billing_service, "get_supabase_admin") as db:
        with pytest.raises(HTTPException) as err:
            await billing_service.update_invoice("inv-1", user, {"status": "finalized"})
    assert err.value.status_code == 422
    db.return_value.table.assert_not_called()  # nothing was saved


def test_claims_list_lines_above_the_limit():
    invoice = {"id": "i1", "line_items": [_line(9000, service_date_from="2026-09-01", service_date_to="2026-09-02")]}
    lines = claims.claim_lines(invoice, None)
    org = {"ndis_provider_number": "4050012345"}
    participant = {"full_name": "Liam Carter", "ndis_number": "430118562"}
    assert claims.claim_problems(invoice, participant, org, lines) == []  # not checked without limits
    problems = claims.claim_problems(invoice, participant, org, lines, CATALOGUE)
    assert problems and "above the NDIS price limit of $73.58" in problems[0]


def _org_price_db():
    db = MagicMock()
    current = MagicMock(data=[{"id": "row-1", "item_code": SELF_CARE, "price_national": 70.00}])
    db.table.return_value.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value = current
    return db


@pytest.mark.asyncio
@pytest.mark.parametrize("prices, message", [
    ({"price_national": 80.00}, "$80.00 is above the NDIS price limit of $73.58"),
    ({"price_national": 70.00, "price_remote": 110.00}, "(remote)"),
])
async def test_org_rate_above_the_limit_is_refused(prices, message):
    md = {"id": "md-1", "organization_id": "org-1", "role": "managing_director"}
    with patch.object(pricing, "get_supabase_admin", return_value=_org_price_db()), \
         patch.object(pricing, "load_price_limit_rows", return_value=CATALOGUE):
        with pytest.raises(HTTPException) as err:
            await pricing.edit_item_price(md, SELF_CARE, effective_date="2026-09-01", **prices)
    assert err.value.status_code == 422 and message in err.value.detail
