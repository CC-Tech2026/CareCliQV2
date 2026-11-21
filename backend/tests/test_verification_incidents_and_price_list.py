"""Shift verification: the shift's incidents are shown, and the price item
list offers the national catalogue (with the agreement's items first)."""

from __future__ import annotations

import asyncio
from unittest.mock import patch

from backend.app.services import shift_verification_service as svc

ORG = "org-1"


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, rows):
        self.rows = list(rows)

    def select(self, *_a, **_k):
        return self

    def eq(self, col, value):
        self.rows = [r for r in self.rows if str(r.get(col)) == str(value)]
        return self

    def in_(self, col, values):
        values = {str(v) for v in values}
        self.rows = [r for r in self.rows if str(r.get(col)) in values]
        return self

    def gte(self, col, value):
        self.rows = [r for r in self.rows if str(r.get(col) or "") >= str(value)[:19]]
        return self

    def is_(self, col, _value):
        self.rows = [r for r in self.rows if r.get(col) is None]
        return self

    def execute(self):
        return _Result(self.rows)


class _Supabase:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return _Query(self.tables.get(name, []))


SHIFT = {
    "id": "shift-1",
    "participant_id": "p-1",
    "session_id": "sess-1",
    "clocked_in_at": "2026-11-18T09:00:00+00:00",
    "clocked_out_at": "2026-11-18T12:00:00+00:00",
}


def _incident(**over):
    row = {
        "id": "inc",
        "organization_id": ORG,
        "participant_id": "p-1",
        "title": "Fall in the bathroom",
        "severity": "high",
        "status": "reported",
        "incident_type": "fall",
        "incident_date": None,
        "created_at": "2026-11-18T11:00:00",
        "shift_id": None,
        "session_id": None,
    }
    row.update(over)
    return row


def _incidents_for(rows):
    with patch.object(svc, "get_supabase_admin", return_value=_Supabase({"incidents": rows})):
        return svc.incidents_for_shifts(ORG, [SHIFT])


def test_an_incident_reported_from_the_shift_is_attached():
    found = _incidents_for([_incident(id="a", shift_id="shift-1")])
    assert [i["id"] for i in found["shift-1"]] == ["a"]
    assert found["shift-1"][0]["link"] == "reported_on_shift"


def test_an_incident_linked_by_session_is_attached():
    found = _incidents_for([_incident(id="b", session_id="sess-1")])
    assert found["shift-1"][0]["id"] == "b"


def test_an_office_report_dated_during_the_shift_is_attached():
    found = _incidents_for([_incident(id="c", incident_date="2026-11-18T10:30:00+00:00")])
    assert found["shift-1"][0]["link"] == "during_shift"


def test_unrelated_incidents_are_not_attached():
    rows = [
        _incident(id="other-shift", shift_id="shift-9", incident_date="2026-11-18T10:00:00+00:00"),
        _incident(id="other-person", participant_id="p-2", shift_id="shift-1"),
        _incident(id="next-day", incident_date="2026-11-19T10:00:00+00:00"),
    ]
    assert _incidents_for(rows) == {}


def test_price_list_offers_the_catalogue_with_agreement_items_first():
    org_items = [{"item_code": "04_104_0125_6_1", "name": "Community access", "unit": "H", "price_national": 70.23, "organization_id": ORG, "valid_to": None}]
    catalogue = [
        {"item_code": "01_011_0107_1_1", "name": "Assistance With Self-Care Activities - Standard - Weekday Daytime", "unit": "H", "price_national": 70.23},
        {"item_code": "01_013_0107_1_1", "name": "Assistance With Self-Care Activities - Standard - Saturday", "unit": "H", "price_national": 98.83},
        {"item_code": "15_037_0117_1_3", "name": "Therapy", "unit": "H", "price_national": 193.99},
    ]
    supabase = _Supabase({"ndis_price_items": org_items})

    async def no_plan(_pid):
        return None

    with patch.object(svc, "get_supabase_admin", return_value=supabase), \
         patch.object(svc, "get_plan_for_participant", side_effect=no_plan), \
         patch.object(svc.agreement_support_service, "catalogue_cached", return_value=catalogue), \
         patch.object(
             svc.agreement_support_service, "_verification_lines",
             return_value=[({"id": "sa-1"}, {"support_item_code": "01_011_0107_1_1"})],
         ), \
         patch.object(
             svc.agreement_support_service, "support_groups",
             return_value={"01_011_0107_1_1": catalogue[:2]},
         ):
        out = asyncio.run(svc.list_price_item_options_for_participant("p-1", ORG))

    codes = [o["item_code"] for o in out]
    # Every catalogue item and the organisation's own one are offered.
    assert set(codes) == {"01_011_0107_1_1", "01_013_0107_1_1", "15_037_0117_1_3", "04_104_0125_6_1"}
    # The agreement's support (both time bands) first, then the org's list.
    assert codes[:2] == ["01_011_0107_1_1", "01_013_0107_1_1"]
    assert codes[2] == "04_104_0125_6_1"
    assert out[0]["in_agreement"] and not out[3]["in_agreement"]
    assert out[2]["source"] == "organisation" and out[3]["source"] == "catalogue"
    assert out[0]["category_label"]  # "Assistance with Daily Life", from the code


def test_price_list_still_works_without_the_catalogue():
    org_items = [{"item_code": "04_104_0125_6_1", "name": "Community access", "organization_id": ORG, "valid_to": None}]

    async def no_plan(_pid):
        return None

    with patch.object(svc, "get_supabase_admin", return_value=_Supabase({"ndis_price_items": org_items})), \
         patch.object(svc, "get_plan_for_participant", side_effect=no_plan), \
         patch.object(svc.agreement_support_service, "catalogue_cached", side_effect=RuntimeError("down")), \
         patch.object(svc.agreement_support_service, "_verification_lines", return_value=[]):
        out = asyncio.run(svc.list_price_item_options_for_participant("p-1", ORG))
    assert [o["item_code"] for o in out] == ["04_104_0125_6_1"]


CATALOGUE = [
    {"item_code": "01_011_0107_1_1", "name": "Self-care weekday", "unit": "H", "price_national": 70.23},
    {"item_code": "15_037_0117_1_3", "name": "Therapy", "unit": "H", "price_national": 193.99},
]


def _options_for_plan(budgets):
    async def plan(_pid):
        return {"plan_budgets": budgets}

    with patch.object(svc, "get_supabase_admin", return_value=_Supabase({"ndis_price_items": []})), \
         patch.object(svc, "get_plan_for_participant", side_effect=plan), \
         patch.object(svc.agreement_support_service, "catalogue_cached", return_value=CATALOGUE), \
         patch.object(svc.agreement_support_service, "_verification_lines", return_value=[]):
        return asyncio.run(svc.list_price_item_options_for_participant("p-1", ORG))


def test_plan_budgets_written_differently_still_match_the_price_guide():
    out = _options_for_plan([{"category": "Core Supports"}])
    assert [o["item_code"] for o in out] == ["01_011_0107_1_1"]
    assert not any(o.get("outside_plan") for o in out)
    assert svc._budget_key("Capacity-Building") == "capacity_building" and svc._budget_key("CAPITAL") == "capital"


def test_a_plan_that_matches_nothing_offers_every_item_instead_of_an_empty_list():
    out = _options_for_plan([{"category": "assistance_animals"}])
    assert {o["item_code"] for o in out} == {"01_011_0107_1_1", "15_037_0117_1_3"}
    assert all(o["outside_plan"] for o in out)
