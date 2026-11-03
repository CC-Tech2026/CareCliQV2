from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.app.services import participant_intake_service as svc
from backend.app.services import participant_service

MD_USER = {"id": "u-md", "sub": "u-md", "organization_id": "org-1", "role": "managing_director"}
DOCS = "backend.app.services.service_agreement_document_service"
SIGNED = {"id": "sa-1", "status": "active", "service_agreement_supports": [{"id": "line-1"}]}


def test_intake_address_joins_the_form_parts():
    web_intake = {"street_address": " 12 Example St ", "suburb": "Adelaide", "state": "SA", "postcode": "5000"}
    assert svc._intake_address(web_intake) == "12 Example St, Adelaide, SA 5000"


def test_intake_address_skips_missing_parts():
    assert svc._intake_address({"suburb": "Glenelg", "postcode": "5045"}) == "Glenelg, 5045"
    assert svc._intake_address({}) is None
    assert svc._intake_address({"street_address": "  "}) is None


def test_intake_address_prefers_an_imported_single_line():
    web_intake = {"address": "4/20 King William St, Adelaide SA 5000", "suburb": "Ignored"}
    assert svc._intake_address(web_intake) == "4/20 King William St, Adelaide SA 5000"


@pytest.mark.asyncio
async def test_activating_carries_the_intake_address_to_the_participant():
    existing = {
        "id": "i-1", "organization_id": "org-1", "status": "signed", "full_name": "Sam Rivera",
        "ndis_number": "430987621", "service_category": "disability",
        "web_intake": {
            "date_of_birth": "1990-01-01",
            "street_address": "12 Example St", "suburb": "Adelaide", "state": "SA", "postcode": "5000",
        },
    }
    table = MagicMock()
    table.update.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{**existing, "status": "active", "participant_id": "p-new"}]
    )
    supabase = MagicMock()
    supabase.table.return_value = table

    with patch("backend.app.services.participant_intake_service.get_intake", return_value=existing), \
         patch("backend.app.services.participant_intake_service.get_supabase_admin", return_value=supabase), \
         patch("backend.app.services.participant_service.create_participant", new=AsyncMock(return_value={"id": "p-new"})) as create, \
         patch(f"{DOCS}.signed_intake_agreement", return_value=SIGNED), \
         patch(f"{DOCS}.attach_intake_agreements", return_value=[SIGNED]):
        await svc.update_intake("i-1", "org-1", {"status": "active"}, MD_USER)

    assert create.await_args.args[0].address == "12 Example St, Adelaide, SA 5000"


def test_a_blank_address_clears_the_field_instead_of_storing_spaces():
    payload = {"address": "   "}
    participant_service._normalize_address(payload)
    assert payload == {"address": None}

    payload = {"address": " 12 Example St "}
    participant_service._normalize_address(payload)
    assert payload == {"address": "12 Example St"}

    payload = {"phone": "0412"}
    participant_service._normalize_address(payload)
    assert payload == {"phone": "0412"}


def test_upcoming_shifts_take_the_new_address():
    supabase = MagicMock()
    with patch("backend.app.services.participant_service.get_supabase_admin", return_value=supabase):
        participant_service._sync_upcoming_shift_addresses("p-1", "27 Rundle Mall, Adelaide SA 5000")

    supabase.table.assert_called_once_with("shifts")
    update = supabase.table.return_value.update
    update.assert_called_once_with({"participant_address": "27 Rundle Mall, Adelaide SA 5000"})
    update.return_value.eq.assert_called_once_with("participant_id", "p-1")
    update.return_value.eq.return_value.in_.assert_called_once_with("status", ["unassigned", "scheduled"])


def test_a_failed_shift_refresh_does_not_fail_the_participant_save():
    supabase = MagicMock()
    supabase.table.side_effect = RuntimeError("network down")
    with patch("backend.app.services.participant_service.get_supabase_admin", return_value=supabase):
        participant_service._sync_upcoming_shift_addresses("p-1", None)


@pytest.mark.asyncio
async def test_saving_an_address_refreshes_upcoming_shifts_and_other_saves_do_not():
    from backend.app.schemas.participant import ParticipantUpdate

    supabase = MagicMock()
    supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{"id": "p-1", "address": "27 Rundle Mall"}]
    )
    svc_path = "backend.app.services.participant_service"
    with patch(f"{svc_path}.get_supabase_admin", return_value=supabase), \
         patch(f"{svc_path}._sync_upcoming_shift_addresses") as sync, \
         patch("backend.app.services.geocoding_service.geocode_address", new=AsyncMock(return_value=(-34.92, 138.6))), \
         patch("backend.app.services.goals_service.enrich_participant", new=AsyncMock(side_effect=lambda p, **_: p)), \
         patch("backend.app.services.funding_service.enrich_participant_plan_fields", new=AsyncMock(side_effect=lambda p: p)):
        await participant_service.update_participant("p-1", ParticipantUpdate(address=" 27 Rundle Mall "))
        coords = {"latitude": -34.92, "longitude": 138.6}
        supabase.table.return_value.update.assert_called_with({"address": "27 Rundle Mall", **coords})
        sync.assert_called_once_with("p-1", "27 Rundle Mall", coords)

        sync.reset_mock()
        await participant_service.update_participant("p-1", ParticipantUpdate(phone="0412 000 000"))
        sync.assert_not_called()


def test_upcoming_shifts_take_the_new_coordinates_too():
    supabase = MagicMock()
    with patch("backend.app.services.participant_service.get_supabase_admin", return_value=supabase):
        participant_service._sync_upcoming_shift_addresses(
            "p-1", "27 Rundle Mall", {"latitude": -34.92, "longitude": 138.6}
        )
    supabase.table.return_value.update.assert_called_once_with(
        {"participant_address": "27 Rundle Mall", "participant_latitude": -34.92, "participant_longitude": 138.6}
    )


GEOCODE = "backend.app.services.geocoding_service.geocode_address"


@pytest.mark.asyncio
async def test_a_new_address_gets_its_own_coordinates():
    with patch(GEOCODE, new=AsyncMock(return_value=(-34.92, 138.6))):
        assert await participant_service._address_coordinates("27 Rundle Mall", "22 Fenwick Ave") == {
            "latitude": -34.92, "longitude": 138.6,
        }


@pytest.mark.asyncio
async def test_a_move_that_cannot_be_looked_up_clears_the_old_point():
    """Otherwise the 100 m clock-in check keeps measuring from the old home."""
    with patch(GEOCODE, new=AsyncMock(return_value=None)):
        assert await participant_service._address_coordinates("27 Rundle Mall", "22 Fenwick Ave") == {
            "latitude": None, "longitude": None,
        }


@pytest.mark.asyncio
async def test_a_failed_lookup_on_an_unchanged_address_keeps_the_stored_point():
    with patch(GEOCODE, new=AsyncMock(return_value=None)):
        assert await participant_service._address_coordinates("27 Rundle Mall", " 27 Rundle Mall ") is None


@pytest.mark.asyncio
async def test_clearing_the_address_clears_the_point():
    with patch(GEOCODE, new=AsyncMock()) as geocode:
        assert await participant_service._address_coordinates(None, "27 Rundle Mall") == {
            "latitude": None, "longitude": None,
        }
    geocode.assert_not_awaited()
