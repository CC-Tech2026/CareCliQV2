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


# The NDIS price limit (platform catalogue) the builder checks agreed rates
# against: $73.58 for weekday self-care; transport has no limit here.
LIMITS = {"01_011_0107_1_1": [{"item_code": "01_011_0107_1_1", "price_national": 73.58, "price_remote": None,
                                 "price_very_remote": None, "valid_from": "2026-07-01T00:00:00+00:00", "valid_to": None}]}


@pytest.fixture(autouse=True)
def _ndis_limits():
    with patch.object(docs.ndis_pricing_service, "load_price_limit_rows", return_value=LIMITS):
        yield



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
    assert err.value.status_code == 422 and "price limit of $73.58" in err.value.detail
    # Below the limit is fine.
    with patch.object(docs.ndis_pricing_service, "resolve_price", new=AsyncMock(return_value=_item())):
        lines = await docs._priced_lines(ORG, "2026-10-01", [{"support_item_code": "01_011_0107_1_1", "quantity": 2, "rate": 65}])
    assert lines[0]["total_funding"] == 130


@pytest.mark.asyncio
async def test_agreed_rate_can_exceed_the_org_price_up_to_the_ndis_limit():
    # The organisation's price is $70.23; the NDIS limit is $73.58.
    with patch.object(docs.ndis_pricing_service, "resolve_price", new=AsyncMock(return_value=_item())):
        lines = await docs._priced_lines(ORG, "2026-10-01", [{"support_item_code": "01_011_0107_1_1", "quantity": 1, "rate": 72}])
    assert lines[0]["rate"] == 72



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
    assert [l["quantity_label"] for l in ctx["supports"]] == ["312 hrs", "156 trips"]
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


class _Q:
    """A chainable Supabase query stub returning fixed rows."""

    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def __getattr__(self, name):
        def call(*args, **kwargs):
            self.calls.append((name, args))
            return self
        return call

    def execute(self):
        return MagicMock(data=self.rows)


@pytest.mark.asyncio
async def test_an_onboarding_agreement_is_built_for_the_intake():
    data = {"plan_management_type": "plan-managed", "start_date": "2026-10-01", "end_date": "2027-09-30", "supports": []}
    with patch.object(docs, "_priced_lines", new=AsyncMock(return_value=[])),          patch.object(docs, "_insert_with_number", return_value={"id": "a1"}) as insert,          patch.object(docs, "_replace_lines"),          patch.object(docs.audit_service, "log_action", new=AsyncMock()),          patch.object(docs, "get_agreement", return_value={"id": "a1"}):
        await docs.create_draft(None, ORG, "u1", data, intake_id="i1")
    payload = insert.call_args.args[0]
    assert (payload["participant_id"], payload["intake_id"]) == (None, "i1")
    with pytest.raises(ValueError):
        await docs.create_draft(None, ORG, "u1", data)


@pytest.mark.asyncio
async def test_signing_an_onboarding_agreement_moves_the_intake_on():
    existing = {"id": "a1", "agreement_number": "SA-2026-0001", "participant_id": None, "intake_id": "i1",
                "start_date": "2026-10-01", "end_date": "2027-09-30"}
    client = MagicMock()
    with patch.object(docs, "render_agreement_pdf", return_value=b"%PDF"),          patch.object(docs, "get_supabase_admin", return_value=client),          patch.object(docs, "mark_plan_agreement_signed") as mark,          patch.object(docs, "_intake_signed") as intake_signed,          patch.object(docs.audit_service, "log_action", new=AsyncMock()):
        await docs.finalise_signature(
            ORG, existing, "u1", method="in_person",
            provider={"name": "Maria", "png": PNG, "at": "2026-10-01T00:00:00Z"},
            participant={"name": "Liam Carter", "png": PNG, "at": "2026-10-01T00:00:00Z"},
        )
    # No participant yet, so no NDIS plan to mark; the intake moves to signed.
    mark.assert_not_called()
    assert intake_signed.call_args.args[:2] == (ORG, "i1")


def test_only_a_signed_agreement_with_supports_lets_onboarding_finish():
    rows = [{"id": "a1", "status": "active", "service_agreement_supports": []},
            {"id": "a2", "status": "active", "service_agreement_supports": [{"id": "l1"}]}]
    client = MagicMock()
    client.table.return_value = _Q(rows)
    with patch.object(docs, "get_supabase_admin", return_value=client):
        assert docs.signed_intake_agreement(ORG, "i1")["id"] == "a2"
    client.table.return_value = _Q(rows[:1])
    with patch.object(docs, "get_supabase_admin", return_value=client):
        assert docs.signed_intake_agreement(ORG, "i1") is None


def test_activation_moves_the_agreement_onto_the_participant():
    rows = [{"id": "a1", "status": "active", "start_date": "2026-10-01", "end_date": "2027-09-30",
             "participant_signed_at": "2026-10-01T00:00:00Z"},
            {"id": "a2", "status": "draft", "start_date": "2026-10-01", "end_date": None}]
    client = MagicMock()
    query = _Q(rows)
    client.table.return_value = query
    with patch.object(docs, "get_supabase_admin", return_value=client),          patch.object(docs, "mark_plan_agreement_signed") as mark:
        assert docs.attach_intake_agreements(ORG, "i1", "p1") == rows
    assert query.calls[0][0] == "update" and query.calls[0][1][0]["participant_id"] == "p1"
    # Only the signed one marks the NDIS plan signed.
    mark.assert_called_once_with(ORG, "p1", "2026-10-01", "2027-09-30", "2026-10-01T00:00:00Z")


def test_the_document_names_the_person_on_the_intake_before_activation():
    client = MagicMock()
    client.table.return_value = _Q([{"full_name": "Liam Carter", "ndis_number": "430", "web_intake": {"date_of_birth": "2001-02-03"}}])
    with patch.object(docs, "get_supabase_admin", return_value=client):
        assert docs.party(ORG, {"participant_id": None, "intake_id": "i1"}) == {
            "full_name": "Liam Carter", "ndis_number": "430", "date_of_birth": "2001-02-03",
        }
