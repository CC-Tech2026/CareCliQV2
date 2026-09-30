"""Organisation business details (ABN, NDIS registration) — what documents and claims print."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from backend.app.api import settings as api
from backend.app.core.security import get_current_user
from backend.app.main import app

MD = {"id": "md-1", "role": "managing_director", "organization_id": "org-1"}
COORD = {"id": "c-1", "role": "support_coordinator", "organization_id": "org-1"}
ROW = {"organization_name": "Sunrise Support Services Pty Ltd", "display_name": "Sunrise", "abn": None,
       "plan_tier": "pro", "ndis_provider_number": None, "org_address": None, "contact_number": None, "email": None}


def _client(user):
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _supabase():
    client = MagicMock()
    table = client.table.return_value
    table.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(data=ROW)
    return client, table


def teardown_function():
    app.dependency_overrides.clear()


def test_abn_checksum():
    assert api.abn_is_valid("51824753556")
    assert not api.abn_is_valid("51824753557")
    assert not api.abn_is_valid("5182475355")


def test_coordinators_cant_change_details():
    res = _client(COORD).put("/api/settings/organisation", json={"abn": "51824753556"})
    assert res.status_code == 403


def test_invalid_values_are_refused():
    client, _ = _supabase()
    with patch.object(api, "get_supabase_admin", return_value=client):
        http = _client(MD)
        assert http.put("/api/settings/organisation", json={"abn": "51 824 753 557"}).status_code == 422
        assert http.put("/api/settings/organisation", json={"ndis_registration_number": "12345"}).status_code == 422
        assert http.put("/api/settings/organisation", json={"legal_name": "  "}).status_code == 422
        assert http.put("/api/settings/organisation", json={"email": "not-an-email"}).status_code == 422


def test_saves_to_the_organisation_columns_documents_read():
    client, table = _supabase()
    with patch.object(api, "get_supabase_admin", return_value=client), \
         patch.object(api, "log_action", new=AsyncMock()) as audit:
        res = _client(MD).put("/api/settings/organisation", json={
            "abn": "51 824 753 556", "ndis_registration_number": "405 001 2345", "email": "accounts@sunrise.com.au",
        })
    assert res.status_code == 200
    update = table.update.call_args.args[0]
    assert update == {"abn": "51824753556", "ndis_provider_number": "4050012345", "email": "accounts@sunrise.com.au"}
    audit.assert_awaited_once()


def test_get_returns_the_details():
    client, _ = _supabase()
    with patch.object(api, "get_supabase_admin", return_value=client):
        body = _client(COORD).get("/api/settings/organisation").json()
    assert body["name"] == "Sunrise" and body["legal_name"] == "Sunrise Support Services Pty Ltd"
    assert body["ndis_registration_number"] is None
