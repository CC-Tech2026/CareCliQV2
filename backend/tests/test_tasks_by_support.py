"""Agreement-led shifts, stage 3b: tasks by support, what the worker sees,
and NDIS codes that drop out of the price guide."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import agreement_support_service as supports
from backend.app.services import ndis_pricing_service as pricing

CATALOGUE = [
    {"item_code": "01_011_0107_1_1", "name": "Assistance With Self-Care Activities - Standard - Weekday Daytime",
     "registration_group": "0107", "support_purpose": "Core Supports", "unit": "H"},
    {"item_code": "01_010_0107_1_1", "name": "Assistance With Self-Care Activities - Night-Time Sleepover",
     "registration_group": "0107", "support_purpose": "Core Supports", "unit": "E"},
]


class _Q:
    def __init__(self, rows):
        self.rows = rows

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        return MagicMock(data=self.rows)


def _db(rows):
    db = MagicMock()
    db.table.return_value = _Q(rows)
    return db


# ── What the worker sees ────────────────────────────────────────────────

def test_the_worker_sees_the_support_without_its_time_of_day():
    with patch.object(supports, "catalogue_cached", return_value=CATALOGUE):
        got = supports.support_for_worker(_db([{"support_item_code": "01_011_0107_1_1"}]),
                                          {"service_agreement_support_id": "line-1"})
        assert got == {"name": "Assistance With Self-Care Activities - Standard",
                       "item_code": "01_011_0107_1_1", "from_agreement": True}
        # No line: the expected item. A sleepover keeps its name.
        got = supports.support_for_worker(MagicMock(), {"expected_price_item_code": "01_010_0107_1_1"})
        assert got["name"] == "Assistance With Self-Care Activities - Night-Time Sleepover"
        assert got["from_agreement"] is False
        assert supports.support_for_worker(MagicMock(), {}) is None


def test_a_lines_support_is_every_time_of_day_code():
    rows = [{"item_code": c, "name": f"Assistance With Self-Care Activities - Standard - {d}", "registration_group": "0107",
             "support_purpose": "Core Supports", "unit": "H"}
            for c, d in (("01_011_0107_1_1", "Weekday Daytime"), ("01_013_0107_1_1", "Saturday"))]
    with patch.object(supports, "catalogue_cached", return_value=rows):
        assert supports.line_support_codes(_db([{"support_item_code": "01_011_0107_1_1"}]), "line-1") == {
            "01_011_0107_1_1", "01_013_0107_1_1",
        }
    assert supports.line_support_codes(MagicMock(), None) is None


# ── Templates ────────────────────────────────────────────────────────────

def test_new_template_codes_must_be_current_but_retired_ones_can_stay():
    from backend.app.api import coordinator

    with patch.object(coordinator.agreement_support_service, "current_codes", return_value={"01_011_0107_1_1"}):
        assert coordinator._template_support_codes([" 01_011_0107_1_1", "01_011_0107_1_1"]) == ["01_011_0107_1_1"]
        with pytest.raises(HTTPException) as err:
            coordinator._template_support_codes(["01_999_0107_1_1"])
        assert err.value.status_code == 422 and "01_999_0107_1_1" in err.value.detail
        # Already on the template: kept, so the template can still be edited.
        assert coordinator._template_support_codes(["01_999_0107_1_1"], ["01_999_0107_1_1"]) == ["01_999_0107_1_1"]


def test_templates_flag_codes_the_price_guide_no_longer_lists():
    from backend.app.api import coordinator

    templates = [{"id": "t1", "support_item_codes": ["01_011_0107_1_1", "01_999_0107_1_1"]}, {"id": "t2", "support_item_codes": []}]
    with patch.object(coordinator.agreement_support_service, "current_codes", return_value={"01_011_0107_1_1"}):
        flagged = coordinator._flag_retired(templates)
    assert flagged[0]["retired_codes"] == ["01_999_0107_1_1"]
    assert flagged[1]["retired_codes"] == []


# ── Loading a new price guide ────────────────────────────────────────────

class _Recorder:
    """Records platform catalogue updates; reads return today's codes."""

    def __init__(self, active):
        self.active = active
        self.updates = []

    def table(self, name):
        return _RecQuery(self, name)


class _RecQuery:
    def __init__(self, db, name):
        self.db, self.name, self.op, self.payload, self.codes = db, name, "select", None, None

    def select(self, *a, **k):
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def in_(self, col, values):
        self.codes = list(values)
        return self

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        if self.op == "update":
            self.db.updates.append((self.payload, self.codes))
            return MagicMock(data=[])
        if self.op == "insert":
            rows = self.payload if isinstance(self.payload, list) else [self.payload]
            return MagicMock(data=[{"id": "sched-1", **r} for r in rows])
        return MagicMock(data=[{"item_code": c} for c in self.db.active])


def _guide(codes, priced=True):
    return {
        "metadata": {"financial_year": "2027-28", "effective_date": "2027-07-01", "source": "PAPL 2027-28"},
        "support_categories": [{
            "category_number": "01", "support_purpose": "Core Supports", "registration_group": "0107",
            "items": [{"item_code": c, "name": c, "unit": "H", "price_national": 80.0 if priced else None} for c in codes],
        }],
    }


@pytest.mark.asyncio
async def test_codes_missing_from_a_full_guide_are_retired_from_its_start_date():
    db = _Recorder(active=["01_011_0107_1_1", "01_013_0107_1_1", "01_999_0107_1_1"])
    with patch.object(pricing, "get_supabase_admin", return_value=db), \
         patch.object(pricing.audit_service, "log_action", new=AsyncMock()), \
         patch.object(pricing, "retired_codes_in_use", return_value={"task_templates": 2, "agreement_lines": 1}):
        result = await pricing.load_platform_price_schedule({"role": "super_admin"}, _guide(["01_011_0107_1_1", "01_013_0107_1_1"]))
    assert result["codes_retired"] == ["01_999_0107_1_1"]
    assert result["retired_in_use"] == {"task_templates": 2, "agreement_lines": 1}
    assert ({"valid_to": "2027-07-01T00:00:00Z"}, ["01_999_0107_1_1"]) in db.updates


@pytest.mark.asyncio
async def test_quote_only_items_and_partial_files_retire_nothing():
    # A quote-only item has no price, so it isn't loaded, but it's still listed.
    db = _Recorder(active=["01_011_0107_1_1", "01_799_0107_1_1"])
    with patch.object(pricing, "get_supabase_admin", return_value=db), \
         patch.object(pricing.audit_service, "log_action", new=AsyncMock()):
        guide = _guide(["01_011_0107_1_1"])
        guide["support_categories"][0]["items"].append({"item_code": "01_799_0107_1_1", "name": "Quote", "unit": "E", "price_national": None})
        result = await pricing.load_platform_price_schedule({"role": "super_admin"}, guide)
    assert result["codes_retired"] == []

    db = _Recorder(active=[f"01_{n:03d}_0107_1_1" for n in range(10)])
    with patch.object(pricing, "get_supabase_admin", return_value=db), \
         patch.object(pricing.audit_service, "log_action", new=AsyncMock()):
        result = await pricing.load_platform_price_schedule({"role": "super_admin"}, _guide(["01_000_0107_1_1"]))
    assert result["codes_retired"] == [] and "looks partial" in result["retire_note"]


# ── Clock-in fallback ────────────────────────────────────────────────────

def test_the_clock_in_fallback_follows_the_same_support_rule():
    from backend.app.services import shift_service

    templates = [
        {"id": "t-care", "participant_id": "p-1", "name": "Shower", "support_item_codes": ["01_013_0107_1_1"]},
        {"id": "t-pool", "participant_id": "p-1", "name": "Swimming", "support_item_codes": ["04_104_0125_6_1"]},
        {"id": "t-any", "participant_id": "p-1", "name": "Check in with family", "support_item_codes": []},
    ]
    db = MagicMock()
    # System defaults first (none), then the participant's own templates.
    db.table.side_effect = [_Q([]), _Q(templates)]
    with patch.object(shift_service, "get_supabase_admin", return_value=db), \
         patch.object(supports, "line_support_codes", return_value={"01_011_0107_1_1", "01_013_0107_1_1"}) as lookup:
        tasks = shift_service._load_tasks_from_templates("p-1", "org-1", "", None, support_line_id="line-1")
    assert lookup.call_args.args[1] == "line-1"
    assert [t["label"] for t in tasks] == ["Shower", "Check in with family"]
