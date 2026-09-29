"""Public participant referral form — referrals reach the provider's board.

Previously the form saved to the referrer's own browser storage, so nothing
ever reached the provider despite a "referral received" confirmation.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.app.api import participant_intake
from backend.app.main import app

ORG = "11111111-2222-3333-4444-555555555555"
REFERRAL = {
    "full_name": "Sam Taylor",
    "service_category": "disability",
    "date_of_birth": "1990-05-01",
    "ndis_number": "430123456",
    "primary_disability": "Autism",
    "support_needs": "Community access twice a week",
    "service_hours_required": 6,
    "referrer_name": "Alex Taylor",
    "referrer_relationship": "family",
    "referrer_phone": "0400 000 000",
}


@pytest.fixture(autouse=True)
def reset_rate_limit():
    participant_intake._public_referrals.clear()
    yield
    participant_intake._public_referrals.clear()


@pytest.fixture
def branding():
    with patch.object(participant_intake, "get_branding", return_value={"display_name": "Sunshine Care", "logo_url": None}) as mock:
        yield mock


@pytest.fixture
def inserted():
    table = MagicMock()
    table.insert.return_value.execute.return_value = MagicMock(data=[{"id": "intake-1"}])
    client = MagicMock()
    client.table.return_value = table
    with patch("backend.app.services.participant_intake_service.get_supabase_admin", return_value=client):
        yield table


def test_provider_lookup_signed_out(branding):
    response = TestClient(app).get(f"/api/participant-intakes/public/{ORG}")
    assert response.status_code == 200
    assert response.json() == {"display_name": "Sunshine Care", "logo_url": None}


def test_invalid_link_is_404_without_touching_the_database():
    with patch.object(participant_intake, "get_branding") as lookup:
        response = TestClient(app).get("/api/participant-intakes/public/not-a-uuid")
    assert response.status_code == 404
    lookup.assert_not_called()


def test_referral_creates_an_enquiry_on_the_providers_board(branding, inserted):
    response = TestClient(app).post(f"/api/participant-intakes/public/{ORG}", json=REFERRAL)
    assert response.status_code == 201
    assert response.json() == {"received": True}  # no record echoed to an anonymous caller
    row = inserted.insert.call_args.args[0]
    assert row["organization_id"] == ORG
    assert row["status"] == "enquiry"
    assert row["source"] == "online_form"
    assert row["created_by"] is None
    assert row["service_hours_required"] == 6
    assert row["web_intake"]["date_of_birth"] == "1990-05-01"
    assert row["web_intake"]["submitted_by"] == "Alex Taylor"
    assert "Referrer contact: 0400 000 000" in row["web_intake"]["notes"]


def test_honeypot_is_accepted_but_not_stored(branding, inserted):
    response = TestClient(app).post(f"/api/participant-intakes/public/{ORG}", json={**REFERRAL, "website": "spam.example"})
    assert response.status_code == 201
    inserted.insert.assert_not_called()


def test_aged_care_age_rule_still_applies(branding, inserted):
    response = TestClient(app).post(
        f"/api/participant-intakes/public/{ORG}",
        json={**REFERRAL, "service_category": "aged_care", "date_of_birth": "1990-05-01"},
    )
    assert response.status_code == 422
    inserted.insert.assert_not_called()


def test_rate_limited_per_connection(branding, inserted):
    client = TestClient(app)
    codes = [client.post(f"/api/participant-intakes/public/{ORG}", json=REFERRAL).status_code
             for _ in range(participant_intake._PUBLIC_MAX_REFERRALS + 1)]
    assert codes[-1] == 429
    assert codes[:-1] == [201] * participant_intake._PUBLIC_MAX_REFERRALS
