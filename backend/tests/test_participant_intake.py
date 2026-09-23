from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.api import participant_intake
from backend.app.services import participant_intake_service as svc

MD_USER = {"id": "u-md", "sub": "u-md", "organization_id": "org-1", "role": "managing_director"}
COORDINATOR_USER = {"id": "u-c", "sub": "u-c", "organization_id": "org-1", "role": "support_coordinator"}


# ── Router-level access gating ────────────────────────────────────────────

def test_require_md_rejects_non_md():
    with pytest.raises(HTTPException) as exc:
        participant_intake._require_md(COORDINATOR_USER)
    assert exc.value.status_code == 403


def test_require_md_allows_md():
    assert participant_intake._require_md(MD_USER) == "org-1"


@pytest.mark.asyncio
async def test_router_list_requires_md():
    with pytest.raises(HTTPException) as exc:
        await participant_intake.list_intakes(current_user=COORDINATOR_USER)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_router_list_scopes_to_callers_org():
    with patch("backend.app.api.participant_intake.svc.list_intakes", return_value=[{"id": "i-1"}]) as list_mock:
        result = await participant_intake.list_intakes(current_user=MD_USER)
    list_mock.assert_called_once_with("org-1")
    assert result == [{"id": "i-1"}]


# ── create_intake validation ──────────────────────────────────────────────

def test_create_intake_requires_date_of_birth():
    with pytest.raises(HTTPException) as exc:
        svc.create_intake(
            organization_id="org-1", created_by="u-md", full_name="Sam Rivera",
            ndis_number="430987621", email="sam@example.com", phone="0412000000",
            source="online_form", service_category="disability", service_hours_required=None,
            web_intake={},
        )
    assert exc.value.status_code == 422


def test_create_intake_rejects_aged_care_under_65():
    with pytest.raises(HTTPException) as exc:
        svc.create_intake(
            organization_id="org-1", created_by="u-md", full_name="Young Person",
            ndis_number="1", email="a@example.com", phone="0412000000",
            source="online_form", service_category="aged_care", service_hours_required=None,
            web_intake={"date_of_birth": "2005-01-01"},
        )
    assert exc.value.status_code == 422
    assert "65" in exc.value.detail


def test_create_intake_success_inserts_org_scoped_enquiry():
    table = MagicMock()
    supabase = MagicMock()
    supabase.table.return_value = table
    table.insert.return_value.execute.return_value = MagicMock(data=None)

    def fake_insert(payload):
        result = MagicMock()
        result.execute.return_value = MagicMock(data=[payload])
        return result

    table.insert.side_effect = fake_insert

    with patch("backend.app.services.participant_intake_service.get_supabase_admin", return_value=supabase):
        result = svc.create_intake(
            organization_id="org-1", created_by="u-md", full_name="Sam Rivera",
            ndis_number="430987621", email="sam@example.com", phone="0412000000",
            source="online_form", service_category="disability", service_hours_required=None,
            web_intake={"date_of_birth": "1990-01-01"},
        )

    assert result["organization_id"] == "org-1"
    assert result["status"] == "enquiry"
    assert result["full_name"] == "Sam Rivera"


# ── update_intake status-transition rules ─────────────────────────────────

@pytest.mark.asyncio
async def test_decline_requires_a_reason():
    existing = {"id": "i-1", "organization_id": "org-1", "status": "enquiry", "full_name": "Sam"}
    with patch("backend.app.services.participant_intake_service.get_intake", return_value=existing):
        with pytest.raises(HTTPException) as exc:
            await svc.update_intake("i-1", "org-1", {"status": "declined"}, MD_USER)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_declined_intake_cannot_be_moved_further():
    existing = {"id": "i-1", "organization_id": "org-1", "status": "declined", "full_name": "Sam"}
    with patch("backend.app.services.participant_intake_service.get_intake", return_value=existing):
        with pytest.raises(HTTPException) as exc:
            await svc.update_intake("i-1", "org-1", {"status": "screening"}, MD_USER)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_activate_requires_a_signed_or_suspended_intake():
    existing = {"id": "i-1", "organization_id": "org-1", "status": "meet_greet", "full_name": "Sam"}
    with patch("backend.app.services.participant_intake_service.get_intake", return_value=existing):
        with pytest.raises(HTTPException) as exc:
            await svc.update_intake("i-1", "org-1", {"status": "active"}, MD_USER)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_activate_requires_date_of_birth():
    existing = {
        "id": "i-1", "organization_id": "org-1", "status": "signed", "full_name": "Sam",
        "ndis_number": "123", "web_intake": {},
    }
    with patch("backend.app.services.participant_intake_service.get_intake", return_value=existing):
        with pytest.raises(HTTPException) as exc:
            await svc.update_intake("i-1", "org-1", {"status": "active"}, MD_USER)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_activate_creates_the_real_participant_record_and_links_it():
    existing = {
        "id": "i-1", "organization_id": "org-1", "status": "signed", "full_name": "Sam Rivera",
        "ndis_number": "430987621", "email": "sam@example.com", "phone": "0412000000",
        "web_intake": {"date_of_birth": "1990-01-01"}, "service_category": "disability",
    }
    updated_row = {**existing, "status": "active", "participant_id": "p-new"}
    table = MagicMock()
    table.update.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=[updated_row])
    supabase = MagicMock()
    supabase.table.return_value = table

    with patch("backend.app.services.participant_intake_service.get_intake", return_value=existing), \
         patch("backend.app.services.participant_intake_service.get_supabase_admin", return_value=supabase), \
         patch("backend.app.services.participant_service.create_participant", new=AsyncMock(return_value={"id": "p-new"})) as create_participant:
        result = await svc.update_intake("i-1", "org-1", {"status": "active"}, MD_USER)

    create_participant.assert_awaited_once()
    create_body = create_participant.await_args.args[0]
    assert create_body.full_name == "Sam Rivera"
    assert str(create_body.date_of_birth) == "1990-01-01"
    assert result["participant_id"] == "p-new"


@pytest.mark.asyncio
async def test_reactivating_a_suspended_participant_does_not_create_a_duplicate_record():
    existing = {
        "id": "i-1", "organization_id": "org-1", "status": "inactive", "full_name": "Sam Rivera",
        "ndis_number": "430987621", "web_intake": {"date_of_birth": "1990-01-01"},
        "participant_id": "p-existing",
    }
    updated_row = {**existing, "status": "active"}
    table = MagicMock()
    table.update.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=[updated_row])
    supabase = MagicMock()
    supabase.table.return_value = table

    with patch("backend.app.services.participant_intake_service.get_intake", return_value=existing), \
         patch("backend.app.services.participant_intake_service.get_supabase_admin", return_value=supabase), \
         patch("backend.app.services.participant_service.create_participant", new=AsyncMock()) as create_participant:
        result = await svc.update_intake("i-1", "org-1", {"status": "active"}, MD_USER)

    create_participant.assert_not_awaited()
    assert result["status"] == "active"
