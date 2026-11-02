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
