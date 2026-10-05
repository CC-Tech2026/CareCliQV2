"""Agreement-led shifts, stage 3d: invoice lines trace back to the agreement
they were delivered under, the invoice names the plan number and the
agreement separately, and an agreement shows what's been used."""
from __future__ import annotations

from decimal import Decimal
from unittest.mock import MagicMock, patch

from backend.app.services import billing_service, invoice_service

CARE = {"name": "Self-care", "unit": "H", "price_national": 70.23}
LINE_A = {"service_agreement_support_id": "line-a", "service_agreement_id": "sa-1", "agreement_number": "SA-2026-0001"}
LINE_B = {"service_agreement_support_id": "line-b", "service_agreement_id": "sa-2", "agreement_number": "SA-2026-0002"}


def _completion(cid, line=None, minutes=60):
    return {"id": cid, "price_item_code": "01_011", "duration_minutes": minutes, "billed_amount": 70.23 * minutes / 60,
            "completion_date": "2026-10-05", "ndis_price_items": CARE, "agreement_line": line}


def test_invoice_lines_keep_the_agreement_they_came_from():
    items = invoice_service.aggregate_line_items([
        _completion("c1", LINE_A), _completion("c2", LINE_A), _completion("c3", LINE_B), _completion("c4"),
    ])
    by_line = {i["service_agreement_support_id"]: i for i in items.values()}
    # The same item under two agreements stays two lines.
    assert by_line["line-a"]["quantity"] == Decimal("2") and by_line["line-a"]["agreement_number"] == "SA-2026-0001"
    assert by_line["line-b"]["completion_ids"] == ["c3"]
    # Not delivered under an agreement: one line by item code, as before.
    assert items["01_011"]["service_agreement_support_id"] is None and items["01_011"]["price_item_code"] == "01_011"


class _Q:
    def __init__(self, rows):
        self.rows = rows

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        return MagicMock(data=self.rows)


def test_completions_are_matched_to_lines_through_their_shifts():
    tables = {
        "shifts": [{"id": "s1", "service_agreement_support_id": "line-a"}, {"id": "s2", "service_agreement_support_id": None}],
        "service_agreement_supports": [{"id": "line-a", "support_item_code": "01_011", "service_agreement_id": "sa-1",
                                        "service_agreements": {"agreement_number": "SA-2026-0001"}}],
    }
    db = MagicMock()
    db.table.side_effect = lambda name: _Q(tables[name])
    lines = invoice_service._agreement_lines_for_shifts(db, [{"shift_id": "s1"}, {"shift_id": "s2"}, {}], "org-1")
    assert lines == {"s1": LINE_A}


def test_the_invoice_names_the_plan_and_the_agreement_separately():
    tables = {
        "participants": [{"id": "p-1", "full_name": "Liam Carter", "ndis_number": "430"}],
        "ndis_plans": [{"plan_number": "PLAN-778", "plan_start": "2026-07-01", "plan_end": "2027-06-30"}],
    }
    db = MagicMock()
    db.table.side_effect = lambda name: _Q(tables.get(name, []))
    invoice = {
        "organization_id": "org-1", "participant_id": "p-1", "invoice_number": "CS-1", "total_cents": 21069,
        "line_items": [
            {"item_code": "01_011", "description": "Self-care", "quantity": 2, "unit_amount_cents": 7023,
             "line_total_cents": 14046, "agreement_number": "SA-2026-0001"},
            {"item_code": "01_015", "description": "Self-care evening", "quantity": 1, "unit_amount_cents": 7023,
             "line_total_cents": 7023, "agreement_number": "SA-2026-0001"},
        ],
    }
    letterhead = {"provider_name": "Care Co", "address": "", "email": "", "phone": "", "abn": "",
                  "ndis_provider_number": "", "logo_url": None, "brand_accent_color": None}
    with patch.object(billing_service, "get_letterhead", return_value=letterhead):
        data = billing_service._build_template_data(invoice, db)
    # The field was labelled "Service Agreement" but held the plan number.
    assert data["plan_number"] == "PLAN-778"
    assert data["service_agreement_ref"] == "SA-2026-0001"
    assert data["line_items"][0]["agreement_number"] == "SA-2026-0001"


def test_an_agreement_shows_what_each_line_has_used():
    from backend.app.services import service_agreement_service as agreements

    rows = [{
        "id": "sa-1", "status": "active", "start_date": "2026-07-01", "end_date": "2027-06-30",
        "service_agreement_supports": [
            {"id": "line-a", "support_item_code": "01_011", "unit": "H", "total_hours_allocated": 52},
            {"id": "line-t", "support_item_code": "04_590", "unit": "E", "total_hours_allocated": None},
        ],
    }]
    usage = {"line-a": {"delivered": 18 * 60, "booked_soon": 4 * 60, "booked_later": 2 * 60, "billed": 1264.14},
             "line-t": {"delivered": 0, "booked_soon": 0, "booked_later": 0, "billed": 19.80}}
    with patch.object(agreements, "list_service_agreements", return_value=rows), \
         patch.object(agreements, "get_supabase_admin", return_value=MagicMock()), \
         patch("backend.app.services.agreement_support_service.line_usage", return_value=usage), \
         patch("backend.app.services.agreement_support_service.current_codes", return_value={"01_011", "04_590"}):
        out = agreements.list_service_agreements_for_profile("p-1", "org-1")
    care, transport = out[0]["service_agreement_supports"]
    assert care["usage"] == {"counted": True, "delivered_hours": 18.0, "booked_hours": 6.0, "left_hours": 28.0, "billed": 1264.14}
    assert transport["usage"] == {"counted": False, "delivered_hours": None, "booked_hours": None, "left_hours": None, "billed": 19.8}
