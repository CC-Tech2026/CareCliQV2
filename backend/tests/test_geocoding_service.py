from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.app.services import geocoding_service


def _google_returns(payload: dict):
    response = MagicMock()
    response.json.return_value = payload
    client = MagicMock()
    client.get = AsyncMock(return_value=response)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return patch("backend.app.services.geocoding_service.httpx.AsyncClient", return_value=client), client


def _result(location_type: str) -> dict:
    return {
        "status": "OK",
        "results": [{"geometry": {"location": {"lat": -34.9229, "lng": 138.6107}, "location_type": location_type}}],
    }


@pytest.fixture(autouse=True)
def maps_key():
    with patch.object(geocoding_service.settings, "google_maps_api_key", "test-key"):
        yield


@pytest.mark.asyncio
async def test_a_street_address_resolves_to_its_point():
    patcher, client = _google_returns(_result("ROOFTOP"))
    with patcher:
        assert await geocoding_service.geocode_address("27 Rundle Mall, Adelaide SA 5000") == (-34.9229, 138.6107)
    params = client.get.await_args.kwargs["params"]
    assert params["components"] == "country:AU"


@pytest.mark.asyncio
async def test_a_suburb_level_match_is_not_good_enough_for_a_100m_check():
    patcher, _ = _google_returns(_result("APPROXIMATE"))
    with patcher:
        assert await geocoding_service.geocode_address("Adelaide SA") is None


@pytest.mark.asyncio
async def test_a_refused_request_gives_no_point():
    patcher, _ = _google_returns({"status": "REQUEST_DENIED", "error_message": "API not enabled", "results": []})
    with patcher:
        assert await geocoding_service.geocode_address("27 Rundle Mall") is None


@pytest.mark.asyncio
async def test_no_maps_key_skips_the_lookup():
    patcher, client = _google_returns(_result("ROOFTOP"))
    with patcher, patch.object(geocoding_service.settings, "google_maps_api_key", ""):
        assert await geocoding_service.geocode_address("27 Rundle Mall") is None
    client.get.assert_not_awaited()
