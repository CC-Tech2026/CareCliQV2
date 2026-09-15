from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from backend.app.services import billing_service, ndis_pricing_service


@pytest.mark.asyncio
async def test_catalogue_dollars_converted_once_and_service_context_preserved():
    line = {"description": "Support", "item_code": "TEST", "service_date": "2026-07-01", "location_type": "remote", "quantity": 2}
    resolver = AsyncMock(return_value={"id": "version-1", "effective_price": 73.45})
    with patch.object(ndis_pricing_service, "resolve_price", resolver):
        resolved = await billing_service._resolve_ndis_prices_for_invoice([line], "org-1")
    cleaned, subtotal, _, total = billing_service._calculate_totals(resolved)
    resolver.assert_awaited_once_with(item_code="TEST", org_id="org-1", as_of_date="2026-07-01", location_type="remote")
    assert cleaned[0]["unit_amount_cents"] == 7345
    assert total == subtotal == 14690
    assert cleaned[0]["ndis_price_item_id"] == "version-1"
    assert cleaned[0]["service_date"] == "2026-07-01"


@pytest.mark.asyncio
async def test_explicit_agreed_rate_is_preserved():
    line = {"description": "Support", "item_code": "TEST", "service_date": "2026-07-01", "unit_amount": 65, "quantity": 1}
    with patch.object(ndis_pricing_service, "resolve_price", AsyncMock(return_value={"id": "v1", "effective_price": 73.45})):
        result = await billing_service._resolve_ndis_prices_for_invoice([line], "org-1")
    assert billing_service._calculate_totals(result)[1] == 6500


@pytest.mark.asyncio
@pytest.mark.parametrize("result", [None, RuntimeError("unavailable")])
async def test_catalogue_failure_rejects_line_instead_of_silent_fallback(result):
    resolver = AsyncMock(side_effect=result) if isinstance(result, Exception) else AsyncMock(return_value=result)
    with patch.object(ndis_pricing_service, "resolve_price", resolver):
        with pytest.raises(HTTPException) as error:
            await billing_service._resolve_ndis_prices_for_invoice([{"item_code": "TEST", "service_date": "2026-07-01"}], "org-1")
    assert error.value.status_code == 422


@pytest.mark.asyncio
async def test_coded_line_requires_service_date():
    with pytest.raises(HTTPException) as error:
        await billing_service._resolve_ndis_prices_for_invoice([{"item_code": "TEST"}], "org-1")
    assert error.value.status_code == 422


def test_billing_roles_and_membership_remain_restricted():
    billing_service._require_billing_role({"role": "managing_director"})
    with pytest.raises(HTTPException):
        billing_service._require_billing_role({"role": "support_worker"})
    with pytest.raises(HTTPException):
        billing_service._require_org({"role": "managing_director"})
