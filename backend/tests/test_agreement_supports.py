"""Agreement-led shifts, stage 3a: support groups, hours per agreement line,
rostering warnings, and the agreement builder's price-limit check."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import agreement_support_service as svc

ORG, PARTICIPANT = "org-1", "p-1"
NOW = datetime(2026, 10, 3, 0, 0, tzinfo=timezone.utc)


def _item(code, name, reg="0107", purpose="Core Supports", unit="H"):
    return {"item_code": code, "name": name, "registration_group": reg, "support_purpose": purpose, "unit": unit}


SELF_CARE = "Assistance With Self-Care Activities"
CATALOGUE = [
    _item("01_011_0107_1_1", f"{SELF_CARE} - Standard - Weekday Daytime"),
    _item("01_015_0107_1_1", f"{SELF_CARE} - Standard - Weekday Evening"),
    _item("01_002_0107_1_1", f"{SELF_CARE} - Standard - Weekday Night"),
    _item("01_013_0107_1_1", f"{SELF_CARE} - Standard - Saturday"),
    _item("01_012_0107_1_1", f"{SELF_CARE} - Standard - Public Holiday"),
    _item("01_010_0107_1_1", f"{SELF_CARE} - Night-Time Sleepover"),
    _item("01_400_0104_1_1", f"{SELF_CARE} - High Intensity - Weekday Daytime", reg="0104"),
    _item("01_402_0104_1_1", f"{SELF_CARE} - High Intensity - Saturday", reg="0104"),
    _item("04_590_0125_6_1", "Activity Based Transport", reg="0125", unit="E"),
]


# ── Support groups ───────────────────────────────────────────────────────

def test_time_of_day_versions_are_one_support():
    groups = svc.support_groups(["01_011_0107_1_1"], CATALOGUE)
    assert [r["item_code"] for r in groups["01_011_0107_1_1"]] == [
        "01_002_0107_1_1", "01_011_0107_1_1", "01_012_0107_1_1", "01_013_0107_1_1", "01_015_0107_1_1",
    ]


def test_high_intensity_and_sleepover_never_join_standard():
    groups = svc.support_groups(["01_400_0104_1_1", "01_010_0107_1_1"], CATALOGUE)
    assert [r["item_code"] for r in groups["01_400_0104_1_1"]] == ["01_400_0104_1_1", "01_402_0104_1_1"]
    assert [r["item_code"] for r in groups["01_010_0107_1_1"]] == ["01_010_0107_1_1"]


def test_a_retired_code_has_no_group():
    assert svc.support_groups(["01_999_0107_1_1"], CATALOGUE)["01_999_0107_1_1"] == []


# ── Hours per line ───────────────────────────────────────────────────────

class _Query:
    def __init__(self, rows):
        self.rows = rows

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        return MagicMock(data=self.rows)


def _usage_db(shifts, verifications=()):
    db = MagicMock()
    db.table.side_effect = lambda name: _Query(list(shifts) if name == "shifts" else list(verifications))
    return db


def _shift(sid, status, start, hours, **kw):
    s = datetime.fromisoformat(start)
    return {"id": sid, "status": status, "service_agreement_support_id": "line-1",
            "scheduled_start": s.isoformat(), "scheduled_end": (s + timedelta(hours=hours)).isoformat(), **kw}


def test_hours_delivered_booked_soon_and_later():
    shifts = [
        _shift("verified", "completed", "2026-09-01T00:00:00+00:00", 3),     # billed 2h at verification
        _shift("unverified", "completed", "2026-09-02T00:00:00+00:00", 3,
               clocked_in_at="2026-09-02T00:00:00+00:00", clocked_out_at="2026-09-02T02:30:00+00:00"),
        _shift("soon", "scheduled", "2026-10-10T00:00:00+00:00", 4),
        _shift("later", "unassigned", "2026-12-01T00:00:00+00:00", 5),
        _shift("cancelled", "cancelled", "2026-10-11T00:00:00+00:00", 8),
    ]
    verifications = [{"shift_id": "verified", "checks_run": {"billing": {"billable_minutes": 120}}}]
    with patch.object(svc, "get_supabase_admin", return_value=_usage_db(shifts, verifications)):
        usage = svc.line_usage(["line-1"], ORG, now=NOW)["line-1"]
    assert usage == {"delivered": 120 + 150, "booked_soon": 240, "booked_later": 300}


# ── Rostering warnings ───────────────────────────────────────────────────

def _line(**kw):
    base = {"start_date": "2026-07-01", "end_date": "2027-06-30", "agreement_status": "active", "counted": True,
            "hours_allocated": 10.0, "delivered_hours": 4.0, "booked_soon_hours": 2.0, "booked_later_hours": 3.0}
    return {**base, **kw}


def test_warnings_for_dates_signing_and_hours():
    start = datetime(2027, 7, 5, 0, 0, tzinfo=timezone.utc)
    warnings = svc.creation_warnings(
        _line(agreement_status="pending_signature"), start=start, end=start + timedelta(hours=2), local_date=date(2027, 7, 5),
    )
    assert any("after this agreement ends" in w for w in warnings)
    assert any("hasn't been signed" in w for w in warnings)
    # 4 delivered + 2 soon + 3 later + 2 new = 11 of 10: later bookings count.
    assert any("1h over the 10h agreed" in w for w in warnings)


def test_no_warnings_when_everything_fits():
    start = datetime(2026, 10, 5, 0, 0, tzinfo=timezone.utc)
    assert svc.creation_warnings(_line(), start=start, end=start + timedelta(hours=1), local_date=date(2026, 10, 5)) == []


# ── The picker list ──────────────────────────────────────────────────────

def test_lines_with_hours_units_and_retired_codes():
    agreements = [{
        "id": "sa-1", "agreement_number": "SA-1", "status": "active", "start_date": "2026-07-01", "end_date": "2027-06-30",
        "service_agreement_supports": [
            {"id": "line-1", "support_item_code": "01_011_0107_1_1", "total_hours_allocated": 52},
            {"id": "line-2", "support_item_code": "04_590_0125_6_1", "total_hours_allocated": None},
            {"id": "line-3", "support_item_code": "01_999_0107_1_1", "total_hours_allocated": 10},
        ],
    }]
    usage = {"line-1": {"delivered": 18 * 60, "booked_soon": 6 * 60, "booked_later": 0},
             "line-2": {"delivered": 0, "booked_soon": 0, "booked_later": 0},
             "line-3": {"delivered": 0, "booked_soon": 0, "booked_later": 0}}
    with patch.object(svc, "_agreements_with_lines", return_value=agreements), \
         patch.object(svc, "_catalogue", return_value=CATALOGUE), \
         patch.object(svc, "line_usage", return_value=usage):
        lines = {l["id"]: l for l in svc.list_participant_supports(PARTICIPANT, ORG)}
    assert (lines["line-1"]["left_hours"], lines["line-1"]["delivered_hours"]) == (28.0, 18.0)
    assert "01_013_0107_1_1" in lines["line-1"]["group_codes"]
    # Transport is billed per unit: not counted in hours.
    assert (lines["line-2"]["counted"], lines["line-2"]["hours_allocated"], lines["line-2"]["left_hours"]) == (False, None, None)
    assert lines["line-3"]["in_current_catalogue"] is False


# ── Which lines a shift can use ──────────────────────────────────────────

def _line_db(agreement):
    db = MagicMock()
    db.table.return_value = _Query([{"id": "line-1", "support_item_code": "01_011_0107_1_1",
                                     "service_agreement_id": "sa-1", "service_agreements": agreement}])
    return db


@pytest.mark.parametrize("agreement", [
    {"organization_id": ORG, "participant_id": "someone-else", "status": "active"},
    {"organization_id": "org-2", "participant_id": PARTICIPANT, "status": "active"},
    {"organization_id": ORG, "participant_id": PARTICIPANT, "status": "draft"},
])
def test_only_this_participants_sent_or_active_lines(agreement):
    with pytest.raises(HTTPException) as err:
        svc.resolve_line_for_shift(_line_db(agreement), line_id="line-1", participant_id=PARTICIPANT, org_id=ORG)
    assert err.value.status_code == 422


def test_a_new_shift_stores_its_line_and_expected_item():
    from backend.app.api import coordinator

    agreement = {"organization_id": ORG, "participant_id": PARTICIPANT, "status": "active"}
    start = datetime(2026, 10, 5, 0, 0, tzinfo=timezone.utc)
    line_entry = {"id": "line-1", "warnings": ["This agreement hasn't been signed yet."]}
    with patch.object(coordinator.agreement_support_service, "list_participant_supports", return_value=[line_entry]), \
         patch.object(coordinator.shift_task_service, "local_shift_date", return_value=date(2026, 10, 5)):
        fields, warnings = coordinator._agreement_line_for_new_shift(
            _line_db(agreement), line_id="line-1", participant_id=PARTICIPANT, org_id=ORG,
            start=start, end=start + timedelta(hours=2), expected_code=None,
        )
        kept, _ = coordinator._agreement_line_for_new_shift(
            _line_db(agreement), line_id="line-1", participant_id=PARTICIPANT, org_id=ORG,
            start=start, end=start + timedelta(hours=2), expected_code="01_013_0107_1_1",
        )
    assert fields == {"service_agreement_support_id": "line-1", "expected_price_item_code": "01_011_0107_1_1"}
    assert warnings == ["This agreement hasn't been signed yet."]
    assert "expected_price_item_code" not in kept  # an explicit item isn't overwritten
    assert coordinator._agreement_line_for_new_shift(
        MagicMock(), line_id=None, participant_id=PARTICIPANT, org_id=ORG, start=start, end=start, expected_code=None,
    ) == ({}, [])


# ── Agreement builder ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_an_agreed_rate_never_changes_the_organisation_price():
    from backend.app.services import service_agreement_service as agreements

    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"id": "sa-1", "organization_id": ORG, "start_date": "2026-07-01"}]
    )
    db.table.return_value.insert.return_value.execute.return_value = MagicMock(data=[{"id": "line-9"}])
    limits = {"01_011_0107_1_1": [{"item_code": "01_011_0107_1_1", "price_national": 73.58, "price_remote": None,
                                   "price_very_remote": None, "valid_from": "2026-07-01T00:00:00+00:00", "valid_to": None}]}
    with patch.object(agreements, "get_supabase_admin", return_value=db), \
         patch.object(agreements.ndis_pricing_service, "load_price_limit_rows", return_value=limits), \
         patch.object(agreements.ndis_pricing_service, "edit_item_price", new=AsyncMock()) as org_price:
        await agreements.add_service_agreement_support(
            "sa-1", ORG, {"id": "md-1"}, {"support_item_code": "01_011_0107_1_1", "negotiated_rate": 72.00},
        )
        with pytest.raises(HTTPException) as err:
            await agreements.add_service_agreement_support(
                "sa-1", ORG, {"id": "md-1"}, {"support_item_code": "01_011_0107_1_1", "negotiated_rate": 80.00},
            )
    org_price.assert_not_called()
    assert err.value.status_code == 422 and "price limit of $73.58" in err.value.detail
