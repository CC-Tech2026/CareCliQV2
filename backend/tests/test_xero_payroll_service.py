"""Xero Payroll: approved hours go to Xero as draft timesheets, one per
employee per Xero pay period, sorted by day type into the pay items the
director chose. Xero applies no award, so nothing beyond the day type is
decided here, and an approved timesheet in Xero is never overwritten."""
from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import xero_payroll_service as xp
from backend.app.services import xero_service as xs

ORG = "org-1"
DIRECTOR = {"id": "md-1", "organization_id": ORG, "role": "managing_director"}
COORDINATOR = {"id": "c-1", "organization_id": ORG, "role": "support_coordinator"}
RATES = {"weekday": None, "saturday": "r-sat", "sunday": "r-sun", "public_holiday": "r-ph", "sleepover": "r-sleep"}
SCOPES = "offline_access accounting.invoices payroll.employees.read payroll.timesheets payroll.settings.read"


def _shift(sid, start, end, worker="w-1", name="Aisha Rahman", email="aisha@example.com", periods=None, breaks=0):
    return {"shift_id": sid, "worker_id": worker, "worker_name": name, "worker_email": email,
            "start": start, "end": end, "break_minutes": breaks, "periods": periods or []}


# ---------------------------------------------------------------------------
# Pay periods, day types and lines
# ---------------------------------------------------------------------------

def test_pay_periods_follow_the_xero_calendar():
    fortnight = {"name": "Fortnightly", "type": "FORTNIGHTLY", "start": date(2026, 11, 2)}
    assert xp.calendar_periods(fortnight, date(2026, 11, 10), date(2026, 11, 16)) == [
        (date(2026, 11, 2), date(2026, 11, 15)), (date(2026, 11, 16), date(2026, 11, 29)),
    ]
    # The calendar's start can be ahead of the days asked for.
    weekly = {"name": "Weekly", "type": "WEEKLY", "start": date(2026, 11, 23)}
    assert xp.calendar_periods(weekly, date(2026, 11, 10), date(2026, 11, 15)) == [(date(2026, 11, 9), date(2026, 11, 15))]
    with pytest.raises(xp.NotReady) as err:
        xp.calendar_periods({"name": "Monthly", "type": "MONTHLY", "start": date(2026, 11, 1)}, date(2026, 11, 1), date(2026, 11, 7))
    assert "monthly" in str(err.value)


def test_day_types_include_public_holidays():
    holidays = {"2026-12-25"}
    assert xp.day_type(date(2026, 12, 25), holidays) == "public_holiday"  # a Friday
    assert xp.day_type(date(2026, 11, 14), holidays) == "saturday"
    assert xp.day_type(date(2026, 11, 15), holidays) == "sunday"
    assert xp.day_type(date(2026, 11, 13), holidays) == "weekday"


def test_a_friday_night_shift_puts_hours_after_midnight_on_saturday():
    shifts = [_shift("s-1", "2026-11-13T20:00", "2026-11-14T02:30")]
    lines = xp.build_lines(shifts, (date(2026, 11, 9), date(2026, 11, 15)), RATES, "r-ord", set(), False)
    by_rate = {l["EarningsRateID"]: l["NumberOfUnits"] for l in lines}
    # Mon..Sun: Friday 4 hours ordinary, Saturday 2.5 hours at the Saturday pay item.
    assert by_rate["r-ord"] == [0, 0, 0, 0, 4.0, 0, 0]
    assert by_rate["r-sat"] == [0, 0, 0, 0, 0, 2.5, 0]


def test_a_sleepover_is_one_unit_and_its_hours_arent_ordinary_hours():
    periods = [
        {"kind": "active", "start": "2026-11-10T20:00", "end": "2026-11-10T22:00", "break_minutes": 0},
        {"kind": "sleepover", "start": "2026-11-10T22:00", "end": "2026-11-11T06:00", "break_minutes": 0},
        {"kind": "active", "start": "2026-11-11T06:00", "end": "2026-11-11T08:00", "break_minutes": 0},
    ]
    shifts = [_shift("s-2", "2026-11-10T20:00", "2026-11-11T08:00", periods=periods)]
    lines = xp.build_lines(shifts, (date(2026, 11, 9), date(2026, 11, 15)), RATES, "r-ord", set(), False)
    by_rate = {l["EarningsRateID"]: l["NumberOfUnits"] for l in lines}
    assert by_rate["r-ord"] == [0, 2.0, 2.0, 0, 0, 0, 0]
    assert by_rate["r-sleep"] == [0, 1, 0, 0, 0, 0, 0]


def test_unpaid_breaks_come_off_only_when_the_director_says_so():
    shifts = [_shift("s-3", "2026-11-10T09:00", "2026-11-10T17:00", breaks=30)]
    period = (date(2026, 11, 9), date(2026, 11, 15))
    paid = xp.build_lines(shifts, period, RATES, "r-ord", set(), False)
    unpaid = xp.build_lines(shifts, period, RATES, "r-ord", set(), True)
    assert paid[0]["NumberOfUnits"][1] == 8.0 and unpaid[0]["NumberOfUnits"][1] == 7.5


def test_a_missing_pay_item_says_which_one():
    shifts = [_shift("s-4", "2026-11-15T09:00", "2026-11-15T12:00")]  # a Sunday
    with pytest.raises(xp.NotReady) as err:
        xp.build_lines(shifts, (date(2026, 11, 9), date(2026, 11, 15)), {**RATES, "sunday": None}, "r-ord", set(), False)
    assert "Sundays" in str(err.value)


# ---------------------------------------------------------------------------
# Permissions and settings
# ---------------------------------------------------------------------------

def test_payroll_access_is_asked_for_only_when_wanted_and_never_dropped():
    with patch.object(xs, "_load_connection", return_value={"scopes": "offline_access accounting.invoices"}), \
            patch.object(xs.settings, "xero_scopes", "offline_access accounting.invoices"):
        assert "payroll" not in xs._scopes_for(ORG, payroll=False)
        assert all(s in xs._scopes_for(ORG, payroll=True).split() for s in xp.PAYROLL_SCOPES)
    with patch.object(xs, "_load_connection", return_value={"scopes": SCOPES}), \
            patch.object(xs.settings, "xero_scopes", "offline_access accounting.invoices"):
        # Reconnecting for invoices keeps payroll.
        assert "payroll.timesheets" in xs._scopes_for(ORG, payroll=False).split()


def test_payroll_wont_turn_on_without_access_or_alongside_employment_hero():
    saved = {}
    row = {"organization_id": ORG, "scopes": "offline_access", "settings": {}}
    with patch.object(xs, "_load_connection", return_value=row), \
            patch.object(xs, "_save_connection", side_effect=lambda org, data: saved.update(data)), \
            patch.object(xp, "_eh_connected", return_value=False):
        with pytest.raises(HTTPException) as err:
            xp.update_settings(DIRECTOR, {"enabled": True})
        assert err.value.status_code == 409
        row["scopes"] = SCOPES
        status = xp.update_settings(DIRECTOR, {"enabled": True, "rates": {"saturday": "r-sat"}, "rate_names": {"saturday": "Saturday"}})
        assert status["enabled"] is True and status["rates"]["saturday"] == "r-sat"
        assert saved["settings"]["payroll"]["rate_names"]["saturday"] == "Saturday"
        # Invoice settings are untouched.
        assert saved["settings"]["sales_account_code"] == "200"
    with patch.object(xs, "_load_connection", return_value={**row, "scopes": SCOPES}), \
            patch.object(xp, "_eh_connected", return_value=True):
        with pytest.raises(HTTPException) as err:
            xp.update_settings(DIRECTOR, {"enabled": True})
        assert "Employment Hero" in err.value.detail


def test_only_coordinators_and_directors_send():
    with pytest.raises(HTTPException) as err:
        xp._require_sender({"id": "w-1", "organization_id": ORG, "role": "support_worker"})
    assert err.value.status_code == 403


# ---------------------------------------------------------------------------
# Sending a pay period
# ---------------------------------------------------------------------------

EMPLOYEES = [
    {"EmployeeID": "e-aisha", "FirstName": "Aisha", "LastName": "Rahman", "Email": "aisha@example.com", "Status": "ACTIVE",
     "PayrollCalendarID": "cal-week", "OrdinaryEarningsRateID": "r-ord"},
    {"EmployeeID": "e-tom", "FirstName": "Tom", "LastName": "Walsh", "Email": "tom@payroll.example", "Status": "ACTIVE",
     "PayrollCalendarID": "cal-week", "OrdinaryEarningsRateID": "r-ord"},
    {"EmployeeID": "e-sam1", "FirstName": "Sam", "LastName": "Lee", "Status": "ACTIVE", "PayrollCalendarID": "cal-week", "OrdinaryEarningsRateID": "r-ord"},
    {"EmployeeID": "e-sam2", "FirstName": "Sam", "LastName": "Lee", "Status": "ACTIVE", "PayrollCalendarID": "cal-week", "OrdinaryEarningsRateID": "r-ord"},
]


class _FakeXero:
    def __init__(self, timesheets=None):
        self.calls = []
        self.timesheets = timesheets or []

    async def __call__(self, row, method, path, *, params=None, json=None, **_k):
        self.calls.append((method, path, json))
        if (method, path) == ("GET", "/Employees"):
            return {"Employees": EMPLOYEES if params.get("page") == 1 else []}
        if (method, path) == ("GET", "/PayrollCalendars"):
            return {"PayrollCalendars": [{"PayrollCalendarID": "cal-week", "Name": "Weekly", "CalendarType": "WEEKLY",
                                          "StartDate": "/Date(1763337600000+0000)/"}]}  # 2025-11-17, a Monday
        if (method, path) == ("GET", "/Timesheets"):
            return {"Timesheets": self.timesheets if params.get("page") == 1 else []}
        return {"Timesheets": [{"TimesheetID": "t-new"}]}

    def posts(self):
        return [c for c in self.calls if c[0] == "POST"]


def _period_data(shifts):
    return {"shifts": shifts, "waiting": [], "totals": {}}


def _run(row, fake, shifts):
    return [
        patch.object(xs, "_load_connection", return_value=row),
        patch.object(xs, "_save_connection", MagicMock()),
        patch.object(xs, "is_configured", return_value=True),
        patch.object(xp, "_papi", fake),
        patch.object(xp, "get_supabase_admin", MagicMock()),
        patch.object(xp.payroll_export_service, "period", return_value=_period_data(shifts)),
        patch("backend.app.services.schads_engine._get_public_holidays", return_value=set()),
        patch.object(xp.audit_service, "log_action", AsyncMock()),
    ]


async def _send(row, fake, shifts, user=COORDINATOR):
    patches = _run(row, fake, shifts)
    for p in patches:
        p.start()
    try:
        return await xp.send_period(user, date(2026, 11, 9), date(2026, 11, 15))
    finally:
        for p in reversed(patches):
            p.stop()


def _row(**payroll):
    return {"organization_id": ORG, "tenant_id": "t-1", "scopes": SCOPES,
            "settings": {"payroll": {"enabled": True, "rates": RATES, **payroll}}}


@pytest.mark.asyncio
async def test_each_worker_gets_one_draft_timesheet_for_the_xero_pay_period():
    shifts = [
        _shift("s-1", "2026-11-10T09:00", "2026-11-10T12:00"),
        _shift("s-2", "2026-11-14T09:00", "2026-11-14T13:00"),  # Saturday
        _shift("s-3", "2026-11-11T09:00", "2026-11-11T11:00", worker="w-2", name="Tom Walsh", email="tom@carecliq.example"),
    ]
    fake = _FakeXero()
    result = await _send(_row(), fake, shifts)
    assert result["sent"] == 2 and result["failed"] == 0
    sheets = {p[2][0]["EmployeeID"]: p[2][0] for p in fake.posts()}
    aisha = sheets["e-aisha"]
    assert aisha["Status"] == "DRAFT"
    assert (aisha["StartDate"], aisha["EndDate"]) == ("2026-11-09T00:00:00", "2026-11-15T00:00:00")
    assert {l["EarningsRateID"]: l["NumberOfUnits"] for l in aisha["TimesheetLines"]} == {
        "r-ord": [0, 3.0, 0, 0, 0, 0, 0], "r-sat": [0, 0, 0, 0, 0, 4.0, 0],
    }
    # Tom matched by his unique name though his emails differ.
    assert sheets["e-tom"]["TimesheetLines"][0]["NumberOfUnits"] == [0, 0, 2.0, 0, 0, 0, 0]


@pytest.mark.asyncio
async def test_sending_again_updates_the_draft_and_leaves_an_approved_one_alone():
    shifts = [_shift("s-1", "2026-11-10T09:00", "2026-11-10T12:00"),
              _shift("s-3", "2026-11-11T09:00", "2026-11-11T11:00", worker="w-2", name="Tom Walsh", email="tom@payroll.example")]
    fake = _FakeXero(timesheets=[
        {"TimesheetID": "t-aisha", "EmployeeID": "e-aisha", "StartDate": "2026-11-09T00:00:00", "Status": "DRAFT"},
        {"TimesheetID": "t-tom", "EmployeeID": "e-tom", "StartDate": "2026-11-09T00:00:00", "Status": "APPROVED"},
    ])
    result = await _send(_row(), fake, shifts)
    posts = fake.posts()
    assert [p[1] for p in posts] == ["/Timesheets/t-aisha"]
    assert posts[0][2][0]["TimesheetID"] == "t-aisha"
    statuses = {r["worker_name"]: r["status"] for r in result["results"]}
    assert statuses == {"Aisha Rahman": "updated", "Tom Walsh": "skipped"}
    assert "approved in Xero" in next(r for r in result["results"] if r["status"] == "skipped")["message"]


@pytest.mark.asyncio
async def test_someone_who_cant_be_told_apart_isnt_guessed():
    shifts = [_shift("s-5", "2026-11-10T09:00", "2026-11-10T12:00", worker="w-3", name="Sam Lee", email="sam@carecliq.example")]
    fake = _FakeXero()
    result = await _send(_row(), fake, shifts)
    assert result["failed"] == 1 and fake.posts() == []
    assert "Choose who they are" in result["results"][0]["message"]
    # Once the director links them, they go.
    fake2 = _FakeXero()
    result2 = await _send(_row(links={"w-3": "e-sam2"}), fake2, shifts)
    assert result2["sent"] == 1 and fake2.posts()[0][2][0]["EmployeeID"] == "e-sam2"


@pytest.mark.asyncio
async def test_a_missing_pay_item_fails_that_person_only():
    shifts = [_shift("s-1", "2026-11-10T09:00", "2026-11-10T12:00"),
              _shift("s-6", "2026-11-15T09:00", "2026-11-15T12:00", worker="w-2", name="Tom Walsh", email="tom@payroll.example")]
    result = await _send(_row(rates={**RATES, "sunday": None}), _FakeXero(), shifts)
    statuses = {r["worker_name"]: r["status"] for r in result["results"]}
    assert statuses == {"Aisha Rahman": "sent", "Tom Walsh": "failed"}
