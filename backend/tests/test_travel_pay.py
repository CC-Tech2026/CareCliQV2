"""Approved travel claims are paid with wages: kilometres as a vehicle
allowance, fares as a reimbursement, through the export, Xero Payroll or
Employment Hero (travel_pay_service)."""
from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.app.services import employment_hero_service as eh
from backend.app.services import travel_pay_service as tps
from backend.app.services import xero_payroll_service as xp

ORG = "org-1"
WEEK = (date(2026, 11, 9), date(2026, 11, 15))
RATES = {"weekday": None, "saturday": "r-sat", "sunday": "r-sun", "public_holiday": "r-ph", "sleepover": "r-sleep",
         "travel_km": "r-km"}


def _shift(sid, day, km=0.0, fares=0, start="09:00", end="12:00", claims=None):
    return {"shift_id": sid, "worker_id": "w-1", "worker_name": "Aisha Rahman", "date": day,
            "start": f"{day}T{start}", "end": f"{day}T{end}", "break_minutes": 0, "periods": [],
            "participant": "J.S.", "travel_km": km, "travel_fares_cents": fares,
            "travel_claims": claims or {"km": [], "fares": []}}


# -- Splitting claims --------------------------------------------------------

def test_claims_split_into_kilometres_and_fares_and_count_what_is_unpaid():
    rows = [
        {"id": "a", "shift_id": "s-1", "status": "approved", "expense_type": "mileage", "claimed_km": 12, "amount_cents": 1056},
        {"id": "b", "shift_id": "s-1", "status": "paid", "expense_type": "transit", "amount_cents": 450},
        {"id": "c", "shift_id": "s-1", "status": "draft", "expense_type": "transit", "amount_cents": 900},
        {"id": "d", "shift_id": "s-2", "status": "rejected", "expense_type": "mileage", "claimed_km": 5, "amount_cents": 440},
    ]
    out = tps.by_shift(rows)
    assert set(out) == {"s-1"}
    assert out["s-1"] == {"km": 12.0, "km_cents": 1056, "fares_cents": 450, "km_ids": ["a"], "fares_ids": ["b"], "unpaid": 1}
    shifts = [{"travel_claims": {"km": ["a"], "fares": ["b"]}}]
    assert tps.claims_in(shifts) == ["a", "b"] and tps.claims_in(shifts, tps.FARES) == ["b"]


def test_marking_paid_needs_a_known_way_and_some_claims():
    assert tps.mark_paid(ORG, [], "payroll_export") == 0
    assert tps.mark_paid(ORG, ["a"], "cash") == 0


# -- Xero: kilometres on the timesheet ---------------------------------------

def test_kilometres_go_on_the_timesheet_on_the_day_of_the_shift():
    shifts = [_shift("s-1", "2026-11-11", km=12.5), _shift("s-2", "2026-11-11", km=3, start="13:00", end="14:00")]
    lines = {l["EarningsRateID"]: l["NumberOfUnits"] for l in xp.build_lines(shifts, WEEK, RATES, "r-ord", set(), False)}
    assert lines["r-km"] == [0, 0, 15.5, 0, 0, 0, 0]
    assert lines["r-ord"] == [0, 0, 4.0, 0, 0, 0, 0]


def test_without_a_per_km_pay_item_the_kilometres_are_left_off():
    lines = xp.build_lines([_shift("s-1", "2026-11-11", km=12.5)], WEEK, {**RATES, "travel_km": None}, "r-ord", set(), False)
    assert [l["EarningsRateID"] for l in lines] == ["r-ord"]


# -- Xero: fares onto the draft payslip --------------------------------------

def _xero(answers):
    calls = []

    async def papi(row, method, path, *, params=None, json=None, _retried=False):
        calls.append((method, path, json))
        return answers.get((method, path), {})
    return calls, papi


@pytest.mark.asyncio
async def test_fares_go_onto_the_payslip_replacing_only_our_own_lines():
    answers = {
        ("GET", "/PayRuns"): {"PayRuns": [{"PayRunID": "run-1", "PayrollCalendarID": "cal-1",
                                           "PayRunPeriodStartDate": "/Date(1794182400000+0000)/"}]},  # 2026-11-09
        ("GET", "/PayRuns/run-1"): {"PayRuns": [{"Payslips": [{"EmployeeID": "e-1", "PayslipID": "slip-1"}]}]},
        ("GET", "/Payslip/slip-1"): {"Payslip": {"ReimbursementLines": [
            {"ReimbursementTypeID": "r-x", "Description": "Uniform", "Amount": 20},
            {"ReimbursementTypeID": "r-fare", "Description": "CareCliQ travel 10/11", "Amount": 9.0},
        ]}},
    }
    calls, papi = _xero(answers)
    results: list[dict] = []
    row = {"scopes": "payroll.payruns payroll.payslip"}
    shift = _shift("s-1", "2026-11-11", fares=450, claims={"km": [], "fares": ["f-1"]})
    with patch.object(xp, "_papi", papi), patch.object(tps, "mark_paid") as paid, patch.object(tps, "note_error"):
        await xp._send_fares(ORG, row, {"fares_reimbursement_id": "r-fare"},
                             [("w-1", "Aisha Rahman", {"id": "e-1", "calendar_id": "cal-1"}, WEEK, "09/11 to 15/11", [shift])],
                             results)
    method, path, body = calls[-1]
    assert (method, path) == ("POST", "/Payslip/slip-1")
    lines = body[0]["ReimbursementLines"]
    assert lines == [
        {"ReimbursementTypeID": "r-x", "Description": "Uniform", "Amount": 20},
        {"ReimbursementTypeID": "r-fare", "Amount": 4.5, "Description": "CareCliQ travel 11/11 J.S."},
    ]
    paid.assert_called_once_with(ORG, ["f-1"], "xero_payroll", "Xero payslip slip-1")
    assert results[0]["status"] == "travel"


@pytest.mark.asyncio
async def test_with_no_draft_pay_run_the_fares_wait_and_the_office_is_told():
    calls, papi = _xero({("GET", "/PayRuns"): {"PayRuns": []}})
    results: list[dict] = []
    shift = _shift("s-1", "2026-11-11", fares=450, claims={"km": [], "fares": ["f-1"]})
    with patch.object(xp, "_papi", papi), patch.object(tps, "mark_paid") as paid, patch.object(tps, "note_error") as noted:
        await xp._send_fares(ORG, {"scopes": "payroll.payruns payroll.payslip"}, {"fares_reimbursement_id": "r-fare"},
                             [("w-1", "Aisha Rahman", {"id": "e-1", "calendar_id": "cal-1"}, WEEK, "09/11 to 15/11", [shift])],
                             results)
    paid.assert_not_called()
    assert "start the pay run" in results[0]["message"] and "$4.50" in results[0]["message"]
    noted.assert_called_once()


@pytest.mark.asyncio
async def test_without_pay_run_access_fares_are_not_sent():
    calls, papi = _xero({})
    results: list[dict] = []
    shift = _shift("s-1", "2026-11-11", fares=450, claims={"km": [], "fares": ["f-1"]})
    with patch.object(xp, "_papi", papi), patch.object(tps, "note_error"):
        await xp._send_fares(ORG, {"scopes": "payroll.timesheets"}, {"fares_reimbursement_id": "r-fare"},
                             [("w-1", "Aisha Rahman", {"id": "e-1", "calendar_id": "cal-1"}, WEEK, "09/11 to 15/11", [shift])],
                             results)
    assert calls == [] and "allow pay run access" in results[0]["message"]


# -- Employment Hero: expense requests ---------------------------------------

@pytest.mark.asyncio
async def test_employment_hero_gets_an_approved_expense_request_per_claim():
    claim = {"id": "c1234567-aaaa", "worker_id": "w-1", "shift_id": "s-1", "status": "approved", "expense_type": "mileage",
             "claimed_km": 12.5, "amount_cents": 1100, "rate_cents_snapshot": 88, "approved_at": "2026-11-12T01:00:00+00:00"}
    row = {"business_id": 7, "settings": {"travel_km_category_id": 31, "send_approved": True}}
    api = AsyncMock(side_effect=[{"id": 555}, {}])
    with patch.object(eh, "_travel_due", return_value=[claim]), \
         patch.object(eh, "_employee_for", AsyncMock(return_value=99)), \
         patch.object(eh, "_shift", return_value={"id": "s-1", "participant_name": "Jordan Smith",
                                                  "scheduled_start": "2026-11-11T22:30:00+00:00"}), \
         patch.object(eh, "participant_timezone", return_value=None), \
         patch.object(eh, "_api", api), patch.object(tps, "mark_paid") as paid:
        result = await eh.push_travel(ORG, row=row)
    assert result == {"sent": 1, "failed": 0}
    (_r, method, path), kwargs = api.call_args_list[0]
    assert (method, path) == ("POST", "/employee/99/expenserequest")
    line = kwargs["json"]["lineItems"][0]
    assert line["expenseCategoryId"] == 31 and line["amount"] == 11.0
    assert line["notes"].startswith("12.5 km at $0.88/km")
    assert api.call_args_list[1].args[1:] == ("POST", "/employee/99/expenserequest/555/approve")
    paid.assert_called_once_with(ORG, ["c1234567-aaaa"], "employment_hero", "Employment Hero expense request 555")


@pytest.mark.asyncio
async def test_a_claim_waits_until_its_expense_category_is_chosen():
    claim = {"id": "c-2", "worker_id": "w-1", "status": "approved", "expense_type": "transit", "amount_cents": 450}
    api = AsyncMock()
    with patch.object(eh, "_travel_due", return_value=[claim]), patch.object(eh, "_api", api), \
         patch.object(tps, "note_error") as noted, patch.object(tps, "mark_paid") as paid:
        result = await eh.push_travel(ORG, row={"business_id": 7, "settings": {}})
    assert result == {"sent": 0, "failed": 0}
    api.assert_not_called() and paid.assert_not_called()
    assert "fares" in noted.call_args.args[2]


def test_travel_categories_are_suggested_by_name():
    cats = [{"id": 1, "name": "Uniforms"}, {"id": 2, "name": "Vehicle allowance (per km)"}, {"id": 3, "name": "Public transport fares"}]
    assert eh._suggest_travel_categories(cats) == {"travel_km_category": 2, "travel_fares_category": 3}
