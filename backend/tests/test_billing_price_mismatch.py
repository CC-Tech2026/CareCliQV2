from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from backend.app.services import billing_service, ndis_pricing_service


ORG_ID = "org-1"
ITEM_CODE = "01_011_0107_1_1"


def _resolved_price(effective_price_dollars: float) -> dict:
    # _resolve_ndis_prices_for_invoice feeds this straight through
    # _money_to_cents (dollars -> cents) — matches how billing.tsx and
    # NdisPriceEditor.tsx treat price_national/effective_price as a dollar
    # figure (see NdisPriceEditor.tsx's "$X.XX per unit" display).
    return {
        "id": "price-1",
        "item_code": ITEM_CODE,
        "effective_price": effective_price_dollars,
        "day_type": "Weekday",
    }


@pytest.mark.asyncio
async def test_supplied_amount_matching_catalogue_price_is_not_flagged():
    line_items = [
        {
            "description": "Support",
            "quantity": 1,
            "item_code": ITEM_CODE,
            "service_date": "2026-01-05",
            "unit_amount_cents": 6000,
        }
    ]

    with patch.object(
        ndis_pricing_service,
        "resolve_price",
        new=AsyncMock(return_value=_resolved_price(60.00)),
    ):
        result = await billing_service._resolve_ndis_prices_for_invoice(line_items, ORG_ID)

    assert "catalogue_price_mismatch" not in result[0]
    assert result[0]["unit_amount_cents"] == 6000


@pytest.mark.asyncio
async def test_supplied_amount_diverging_from_catalogue_price_is_flagged_not_overridden():
    line_items = [
        {
            "description": "Support",
            "quantity": 1,
            "item_code": ITEM_CODE,
            "service_date": "2026-01-05",
            "unit_amount_cents": 9000,  # coordinator typed a different amount
        }
    ]

    with patch.object(
        ndis_pricing_service,
        "resolve_price",
        new=AsyncMock(return_value=_resolved_price(60.00)),
    ):
        result = await billing_service._resolve_ndis_prices_for_invoice(line_items, ORG_ID)

    item = result[0]
    # The originally supplied amount is still what's charged.
    assert item["unit_amount_cents"] == 9000
    assert item["catalogue_price_mismatch"] is True
    assert item["catalogue_unit_amount_cents"] == 6000


@pytest.mark.asyncio
async def test_no_supplied_amount_uses_catalogue_price_without_mismatch_flag():
    line_items = [
        {
            "description": "Support",
            "quantity": 1,
            "item_code": ITEM_CODE,
            "service_date": "2026-01-05",
        }
    ]

    with patch.object(
        ndis_pricing_service,
        "resolve_price",
        new=AsyncMock(return_value=_resolved_price(60.00)),
    ):
        result = await billing_service._resolve_ndis_prices_for_invoice(line_items, ORG_ID)

    item = result[0]
    assert item["unit_amount_cents"] == 6000
    assert "catalogue_price_mismatch" not in item
