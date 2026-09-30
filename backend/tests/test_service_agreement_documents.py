"""Generated NDIS service agreements: pricing, numbering, signing, rendering."""
from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import service_agreement_document_service as docs

ORG = "org-1"
PNG = "data:image/png;base64,iVBORw0KGgo="


def _item(code="01_011_0107_1_1", price=70.23, unit="H", name="Assistance with self-care activities"):
    return {"item_code": code, "name": name, "unit": unit, "effective_price": price}


@pytest.mark.asyncio
async def test_lines_are_priced_from_the_catalogue():
    with patch.object(docs.ndis_pricing_service, "resolve_price", new=AsyncMock(side_effect=[
        _item(), _item("04_590_0125_6_1", 9.90, "E", "Activity based transport"),
    ])):
        lines = await docs._priced_lines(ORG, "2026-10-01", [
            {"support_item_code": "01_011_0107_1_1", "quantity": 312, "location": "home", "frequency": "weekly"},
            {"support_item_code": "04_590_0125_6_1", "quantity": 156},
        ])
    assert lines[0]["rate"] == 70.23 and lines[0]["total_funding"] == 21911.76
    assert lines[0]["total_hours_allocated"] == 312
    assert lines[1]["total_funding"] == 1544.40 and lines[1]["total_hours_allocated"] is None
    assert [l["sort_order"] for l in lines] == [0, 1]


@pytest.mark.asyncio
async def test_rate_above_the_price_limit_is_refused():
    with patch.object(docs.ndis_pricing_service, "resolve_price", new=AsyncMock(return_value=_item())):
        with pytest.raises(HTTPException) as err:
            await docs._priced_lines(ORG, "2026-10-01", [{"support_item_code": "01_011_0107_1_1", "quantity": 1, "rate": 80}])
    assert err.value.status_code == 422 and "price limit" in err.value.detail
    # Below the limit is fine.
    with patch.object(docs.ndis_pricing_service, "resolve_price", new=AsyncMock(return_value=_item())):
        lines = await docs._priced_lines(ORG, "2026-10-01", [{"support_item_code": "01_011_0107_1_1", "quantity": 2, "rate": 65}])
    assert lines[0]["total_funding"] == 130


@pytest.mark.asyncio
async def test_unknown_item_and_quoted_items_without_a_rate():
    with patch.object(docs.ndis_pricing_service, "resolve_price", new=AsyncMock(return_value=None)):
        with pytest.raises(HTTPException) as err:
            await docs._priced_lines(ORG, "2026-10-01", [{"support_item_code": "nope", "quantity": 1}])
    assert "isn't in the NDIS price catalogue" in err.value.detail
    with patch.object(docs.ndis_pricing_service, "resolve_price", new=AsyncMock(return_value=_item(price=None))):
        with pytest.raises(HTTPException) as err:
            await docs._priced_lines(ORG, "2026-10-01", [{"support_item_code": "x", "quantity": 1}])
    assert "quoted rate" in err.value.detail


def test_agreement_numbers_increase_per_year():
    client = MagicMock()
    client.table.return_value.select.return_value.eq.return_value.like.return_value.execute.return_value = MagicMock(
        data=[{"agreement_number": "SA-2026-0147"}, {"agreement_number": "SA-2026-0009"}, {"agreement_number": "junk"}]
    )
    assert docs.next_agreement_number(ORG, 2026, client) == "SA-2026-0148"
    client.table.return_value.select.return_value.eq.return_value.like.return_value.execute.return_value = MagicMock(data=[])
    assert docs.next_agreement_number(ORG, 2027, client) == "SA-2027-0001"


def test_active_agreement_past_its_end_date_reads_expired():
    today = date(2026, 9, 30)
    assert docs.effective_status({"status": "active", "end_date": "2026-09-29"}, today) == "expired"
    assert docs.effective_status({"status": "active", "end_date": "2026-09-30"}, today) == "active"
    assert docs.effective_status({"status": "pending_signature", "end_date": "2020-01-01"}, today) == "pending_signature"


def test_document_matches_the_schedule_of_supports():
    agreement = {
        "id": "a1", "agreement_number": "SA-2026-0148", "status": "pending_signature",
        "plan_management_type": "plan-managed", "plan_manager_name": "Clearview Plan Management",
        "start_date": "2026-10-01", "end_date": "2027-09-30",
        "service_agreement_supports": [
            {"support_item_code": "01_011_0107_1_1", "item_name": "Assistance with self-care activities",
             "unit": "H", "quantity": 312, "rate": 70.23, "total_funding": 21911.76, "location": "home", "frequency": "weekly"},
            {"support_item_code": "04_590_0125_6_1", "item_name": "Activity based transport",
             "unit": "E", "quantity": 156, "rate": 9.90, "total_funding": 1544.40},
        ],
    }
    ctx = docs.document_context(
        {"provider_name": "Sunrise Support Services", "brand_accent_color": "#7C3AED"},
        agreement, {"full_name": "Liam Carter", "ndis_number": "430118562", "date_of_birth": "1998-03-14"},
    )
    assert ctx["period"] == "1 Oct 2026 to 30 Sep 2027"
    assert ctx["plan_management_label"] == "Plan-managed"
    assert ctx["participant"]["date_of_birth"] == "14 Mar 1998"
    assert [l["quantity_label"] for l in ctx["supports"]] == ["312 hrs", "156"]
    assert ctx["supports"][0]["detail"] == "Weekly · at home · 01_011_0107_1_1"
    assert ctx["total_label"] == "$23,456.16"
    assert ctx["draft"] is False

    with patch.object(docs, "get_letterhead", return_value={"provider_name": "Sunrise Support Services", "brand_accent_color": "#7C3AED", "abn": "51 824 753 556"}), \
         patch.object(docs, "_participant", return_value={"full_name": "Liam Carter & Co"}):
        html = docs.render_agreement_html(ORG, {**agreement, "participant_id": "p1"})
    assert "SA-2026-0148" in html and "ABN 51 824 753 556" in html
    assert "Liam Carter &amp; Co" in html  # escaped
    assert "DRAFT" not in html.split("<body>")[1]


def _existing(status="pending_signature", supports=True):
    return {"id": "a1", "participant_id": "p1", "status": status, "agreement_number": "SA-2026-0001",
            "start_date": "2026-10-01", "end_date": "2027-09-30",
            "service_agreement_supports": [{"support_item_code": "x"}] if supports else []}


@pytest.mark.asyncio
async def test_signing_needs_both_signatures_and_an_unsigned_agreement():
    kwargs = dict(provider_name="Maria", provider_signature_png=PNG, participant_name="Liam", participant_signature_png=PNG)
    with patch.object(docs, "get_agreement", return_value=_existing("active")):
        with pytest.raises(HTTPException) as err:
            await docs.sign(ORG, "a1", "u1", **kwargs)
    assert err.value.status_code == 409
    with patch.object(docs, "get_agreement", return_value=_existing()):
        with pytest.raises(HTTPException) as err:
            await docs.sign(ORG, "a1", "u1", **{**kwargs, "participant_signature_png": ""})
    assert "Participant signature" in err.value.detail


@pytest.mark.asyncio
async def test_signing_stores_the_pdf_and_marks_the_plan_signed():
    client = MagicMock()
    with patch.object(docs, "get_agreement", return_value=_existing()), \
         patch.object(docs, "render_agreement_pdf", return_value=b"%PDF") as render, \
         patch.object(docs, "get_supabase_admin", return_value=client), \
         patch.object(docs, "mark_plan_agreement_signed") as mark, \
         patch.object(docs.audit_service, "log_action", new=AsyncMock()):
        await docs.sign(ORG, "a1", "u1", provider_name="Maria", provider_signature_png=PNG,
                        participant_name="Liam Carter", participant_signature_png=PNG)
    assert render.call_args.args[1]["status"] == "active"
    client.storage.from_.assert_called_with("service-agreements")
    update = client.table.return_value.update.call_args.args[0]
    assert update["status"] == "active" and update["signed_by"] == "Liam Carter"
    assert update["document_path"].endswith("SA-2026-0001-signed.pdf")
    assert mark.call_args.args[:4] == (ORG, "p1", "2026-10-01", "2027-09-30")


@pytest.mark.asyncio
async def test_only_drafts_can_be_edited_or_deleted():
    with patch.object(docs, "get_agreement", return_value=_existing("active")):
        with pytest.raises(HTTPException) as err:
            await docs.update_draft(ORG, "a1", "u1", {})
        assert err.value.status_code == 409
        with pytest.raises(HTTPException):
            await docs.delete_draft(ORG, "a1", "u1")


def test_onboarding_agreement_is_recorded_once():
    intake = {
        "id": "i1", "organization_id": ORG, "provider_signed_at": "2026-09-30T01:00:00Z",
        "family_signed_at": "2026-09-30T01:05:00Z", "family_signed_name": "Liam Carter",
        "provider_signed_name": "Maria", "plan_start_date": "2026-10-01", "plan_end_date": "2027-09-30",
        "service_agreement_document_path": "org-1/i1/x.pdf", "web_intake": {"funding_type": "plan_managed", "plan_manager_org": "Clearview"},
    }
    client = MagicMock()
    client.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
    with patch.object(docs, "get_supabase_admin", return_value=client), \
         patch.object(docs, "_insert_with_number", return_value={"id": "a9"}) as insert, \
         patch.object(docs, "mark_plan_agreement_signed") as mark:
        assert docs.from_intake(intake, "p1") == {"id": "a9"}
    payload = insert.call_args.args[0]
    assert payload["status"] == "active" and payload["intake_id"] == "i1"
    assert payload["plan_management_type"] == "plan-managed" and payload["plan_manager_name"] == "Clearview"
    assert (payload["document_bucket"], payload["document_path"]) == ("participant-intake-files", "org-1/i1/x.pdf")
    mark.assert_called_once()

    client.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[{"id": "a9"}])
    with patch.object(docs, "get_supabase_admin", return_value=client), \
         patch.object(docs, "_insert_with_number") as insert:
        docs.from_intake(intake, "p1")
    insert.assert_not_called()
    # Unsigned intake: nothing to record.
    assert docs.from_intake({"id": "i2", "organization_id": ORG}, "p1") is None


def test_onboarding_agreement_never_guesses_plan_management():
    intake = {"id": "i3", "organization_id": ORG, "family_signed_at": "2026-09-30T01:05:00Z", "web_intake": {}}
    client = MagicMock()
    client.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
    with patch.object(docs, "get_supabase_admin", return_value=client), \
         patch.object(docs, "_insert_with_number") as insert:
        assert docs.from_intake(intake, "p1") is None
    insert.assert_not_called()
