import asyncio

import pytest

from backend.app.services import address_search_service as search


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    search._cache.clear()
    search._skip_until.clear()
    monkeypatch.setattr(search.settings, "google_maps_api_key", "test-key", raising=False)
    yield
    search._cache.clear()
    search._skip_until.clear()


def test_reads_unit_street_suburb_state_postcode_from_google_parts():
    parts = [
        {"long_name": "3", "short_name": "3", "types": ["subpremise"]},
        {"long_name": "24", "short_name": "24", "types": ["street_number"]},
        {"long_name": "King William Street", "short_name": "King William St", "types": ["route"]},
        {"long_name": "Adelaide", "short_name": "Adelaide", "types": ["locality", "political"]},
        {"long_name": "South Australia", "short_name": "SA", "types": ["administrative_area_level_1"]},
        {"long_name": "Australia", "short_name": "AU", "types": ["country"]},
        {"long_name": "5000", "short_name": "5000", "types": ["postal_code"]},
    ]
    a = search.address_from_components(parts, "3/24 King William St, Adelaide SA 5000, Australia", -34.9, 138.6)
    assert a["street"] == "3/24 King William Street"
    assert a["suburb"] == "Adelaide"
    assert a["state"] == "SA"
    assert a["postcode"] == "5000"
    assert a["formatted"] == "3/24 King William St, Adelaide SA 5000"
    assert (a["lat"], a["lng"]) == (-34.9, 138.6)


def test_reads_the_newer_places_shape_too():
    parts = [
        {"longText": "12", "shortText": "12", "types": ["street_number"]},
        {"longText": "Main Road", "shortText": "Main Rd", "types": ["route"]},
        {"longText": "Belair", "shortText": "Belair", "types": ["locality"]},
        {"longText": "South Australia", "shortText": "SA", "types": ["administrative_area_level_1"]},
        {"longText": "5052", "shortText": "5052", "types": ["postal_code"]},
    ]
    a = search.address_from_components(parts)
    assert a["street"] == "12 Main Road"
    assert a["formatted"] == "12 Main Road, Belair, SA 5052"


def test_short_queries_ask_nobody(monkeypatch):
    async def boom(*_a, **_k):
        raise AssertionError("should not search")

    monkeypatch.setattr(search, "_suggest_places_new", boom)
    assert asyncio.run(search.suggest("12")) == []


def test_falls_back_when_google_refuses_one_option(monkeypatch):
    async def refused(*_a, **_k):
        raise PermissionError("This API is not enabled")

    async def geocoded(_client, query):
        return [{"id": "gc:abc", "main": "12 Main Road", "secondary": "Belair SA 5052", "description": query}]

    monkeypatch.setattr(search, "_suggest_places_new", refused)
    monkeypatch.setattr(search, "_suggest_places_legacy", refused)
    monkeypatch.setattr(search, "_suggest_geocode", geocoded)
    found = asyncio.run(search.suggest("12 Main Rd Belair"))
    assert found[0]["id"] == "gc:abc"
    # The refused options are skipped next time rather than retried.
    assert set(search._usable_modes()) == {"geocode"}


def test_cached_answers_are_reused(monkeypatch):
    calls = []

    async def places(_client, query, _session):
        calls.append(query)
        return [{"id": "pn:1", "main": "1 Test St", "secondary": "Adelaide SA", "description": "1 Test St, Adelaide SA"}]

    monkeypatch.setattr(search, "_suggest_places_new", places)
    asyncio.run(search.suggest("1 Test St"))
    asyncio.run(search.suggest("1 test st"))
    assert calls == ["1 Test St"]


def test_no_key_means_unavailable_not_an_error(monkeypatch):
    monkeypatch.setattr(search.settings, "google_maps_api_key", "", raising=False)
    with pytest.raises(search.AddressSearchUnavailable):
        asyncio.run(search.suggest("24 King William"))


def test_unknown_suggestion_ids_are_rejected():
    with pytest.raises(ValueError):
        asyncio.run(search.details("nope"))
