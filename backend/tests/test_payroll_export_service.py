"""Timesheets for payroll: a pay period's approved shifts with the time worked
(not the billed time), split around sleepovers, and a CSV any payroll system
can take."""
from __future__ import annotations

import csv
import io
from datetime import date
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

import pytest

from backend.app.services import pay_time_service
from backend.app.services import payroll_export_service as svc

ORG = "org-1"
ADELAIDE = ZoneInfo("Australia/Adelaide")


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.window = db, table, [], None

    def select(self, *_a, **_k):
        return self

    def eq(self, key, value):
        self.filters.append(lambda r: str(r.get(key)) == str(value))
        return self

    def in_(self, key, values):
        values = {str(v) for v in values}
        self.filters.append(lambda r: str(r.get(key)) in values)
        return self

    def gte(self, key, value):
        self.filters.append(lambda r: str(r.get(key) or "") >= str(value))
        return self

    def lt(self, key, value):
        self.filters.append(lambda r: str(r.get(key) or "") < str(value))
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a):
        return self

    def range(self, start, end):
        self.window = (start, end)
        return self

    def execute(self):
        if self.table in self.db.missing:
            raise RuntimeError(f'relation "{self.table}" does not exist')
        rows = [r for r in self.db.tables.get(self.table, []) if all(f(r) for f in self.filters)]
        if self.window:
            rows = rows[self.window[0]:self.window[1] + 1]
        return MagicMock(data=rows)


class _DB:
    def __init__(self, missing=(), **tables):
        self.tables, self.missing = tables, set(missing)

    def table(self, name):
        return _Query(self, name)


def _shift(sid, worker="w-1", start="2026-11-12T09:00:00+10:30", end="2026-11-12T12:00:00+10:30",
           clock_out="2026-11-12T12:40:00+10:30", **extra):
    return {
        "id": sid, "organization_id": ORG, "participant_id": "p-1", "participant_name": "Liam Carter",
        "worker_id": worker, "scheduled_start": start, "scheduled_end": end,
        "clocked_in_at": start, "clocked_out_at": clock_out, "status": "completed", "is_sleepover": False, **extra,
    }


def _approval(sid, by="c-1"):
    return {"shift_id": sid, "organization_id": ORG, "verified_by": by, "verified_at": "2026-11-13T01:00:00+00:00",
            "reversed_at": None, "checks_run": {"billing": {"billable_minutes": 180}}}


def _db(**more):
    sleep = _shift("s-sleep", start="2026-11-13T20:00:00+10:30", end="2026-11-14T08:00:00+10:30",
                   clock_out="2026-11-14T08:00:00+10:30", is_sleepover=True)
    tables = {
        "shifts": [
            _shift("s-late"),
            sleep,
            _shift("s-todo", worker="w-2"),  # finished, not approved
            _shift("s-out", start="2026-11-20T09:00:00+10:30", end="2026-11-20T12:00:00+10:30"),  # next period
            _shift("s-future", worker="w-2", clock_out=None, status="scheduled"),  # not worked yet
        ],
        "shift_verifications": [_approval("s-late"), _approval("s-sleep"),
                                {**_approval("s-reversed"), "reversed_at": "2026-11-13T02:00:00+00:00"}],
        "shift_segments": [{"shift_id": "s-sleep", "segment_type": "sleepover_block",
                            "segment_start": "2026-11-13T22:00:00+10:30", "segment_end": "2026-11-14T06:00:00+10:30"}],
        "shift_breaks": [{"shift_id": "s-late", "break_start_at": "2026-11-12T10:30:00+10:30",
                          "break_end_at": "2026-11-12T11:00:00+10:30"}],
        "shift_travel_expenses": [
            {"shift_id": "s-late", "organization_id": ORG, "status": "approved", "claimed_km": 12.5, "calculated_km": 11, "amount_cents": 1100},
            {"shift_id": "s-late", "organization_id": ORG, "status": "draft", "claimed_km": 40, "amount_cents": 3520},
        ],
        "users": [
            {"id": "w-1", "full_name": "Aisha Rahman", "email": "aisha@example.com"},
            {"id": "w-2", "full_name": "Tom Walsh", "email": "tom@example.com"},
            {"id": "c-1", "full_name": "Olivia Bennett", "email": "olivia@example.com"},
        ],
        **more,
    }
    return _DB(**tables)


def _run(db):
    return patch.multiple(svc, get_supabase_admin=MagicMock(return_value=db),
                          participant_timezone=MagicMock(return_value=ADELAIDE))


WEEK = (date(2026, 11, 9), date(2026, 11, 15))


def test_the_period_has_the_approved_shifts_with_the_time_worked():
    with _run(_db(missing={"employment_hero_connections"})):
        data = svc.period(ORG, *WEEK)
    by_id = {s["shift_id"]: s for s in data["shifts"]}
    assert set(by_id) == {"s-late", "s-sleep"}
    late = by_id["s-late"]
    # Billing stopped at 3 hours; the worker is paid the 3h 40m worked.
    assert late["worked_minutes"] == 220 and late["over_roster_minutes"] == 40
    assert (late["start"], late["end"]) == ("2026-11-12T09:00", "2026-11-12T12:40")
    assert late["break_minutes"] == 30 and late["periods"][0]["break_minutes"] == 30
    assert late["participant"] == "Liam C." and late["approved_by"] == "Olivia Bennett"
    # Only the approved travel claim counts.
    assert late["travel_km"] == 12.5 and late["travel_cents"] == 1100
    assert [(p["kind"], p["minutes"]) for p in by_id["s-sleep"]["periods"]] == [
        ("active", 120), ("sleepover", 480), ("active", 120)]
    # Not connected to payroll: no payroll status at all.
    assert late["payroll"] is None and data["connected"] == {"employment_hero": False}
    # Finished but not approved: waiting. Not worked yet, next period, reversed: not listed.
    assert [w["shift_id"] for w in data["waiting"]] == ["s-todo"]
    assert data["totals"] == {"shifts": 2, "hours": round((220 + 720) / 60, 2), "workers": 1,
                              "waiting": 1, "sent": 0, "attention": 0}


def test_the_approved_snapshot_is_used_over_live_times():
    db = _db(missing={"employment_hero_connections"})
    snap = pay_time_service.to_record(pay_time_service.paid_time(
        {**_shift("s-late"), "clocked_out_at": "2026-11-12T12:10:00+10:30"}))
    db.tables["shift_verifications"][0]["checks_run"]["pay"] = snap
    with _run(db):
        late = next(s for s in svc.period(ORG, *WEEK)["shifts"] if s["shift_id"] == "s-late")
    assert late["end"] == "2026-11-12T12:10" and late["worked_minutes"] == 190


def test_with_employment_hero_connected_each_shift_says_where_it_got_to():
    db = _db(
        employment_hero_connections=[{"organization_id": ORG}],
        employment_hero_timesheets=[
            {"organization_id": ORG, "shift_id": "s-late", "status": "sent", "error": None},
            {"organization_id": ORG, "shift_id": "s-sleep", "status": "failed", "error": "Choose the work type for sleepovers."},
        ],
        employment_hero_employees=[{"organization_id": ORG, "worker_id": "w-1", "employee_id": 501}],
    )
    with _run(db):
        data = svc.period(ORG, *WEEK)
    by_id = {s["shift_id"]: s for s in data["shifts"]}
    assert by_id["s-late"]["payroll"] == {"status": "sent", "error": None}
    assert by_id["s-sleep"]["payroll"]["status"] == "failed"
    assert by_id["s-late"]["payroll_employee_id"] == 501
    assert data["totals"]["sent"] == 1 and data["totals"]["attention"] == 1


def test_the_csv_has_a_row_per_period_and_shift_figures_once():
    with _run(_db(missing={"employment_hero_connections"})):
        text = svc.to_csv(svc.period(ORG, *WEEK))
    rows = list(csv.DictReader(io.StringIO(text)))
    late = [r for r in rows if r["CareCliQ shift ID"] == "s-late"]
    assert len(late) == 1
    assert late[0]["Hours"] == "3.67" and late[0]["Hours over roster"] == "0.67"
    assert late[0]["Breaks (minutes)"] == "30" and late[0]["Kilometres"] == "12.5"
    assert late[0]["Travel reimbursement ($)"] == "11.00" and late[0]["Times from"] == "Clock times"
    sleep = [r for r in rows if r["CareCliQ shift ID"] == "s-sleep"]
    # Australian dates, and an overnight period shows the day it ends.
    assert [(r["Start date"], r["Start time"], r["End date"], r["End time"], r["Type"]) for r in sleep] == [
        ("13/11/2026", "20:00", "13/11/2026", "22:00", "Active work"),
        ("13/11/2026", "22:00", "14/11/2026", "06:00", "Sleepover"),
        ("14/11/2026", "06:00", "14/11/2026", "08:00", "Active work"),
    ]
    # Approved at 01:00 UTC is 11:30 in Adelaide (daylight saving), day first.
    assert late[0]["Approved at"] == "13/11/2026 11:30"
    # Roster hours on the first row only, so a column total isn't doubled.
    assert sleep[0]["Rostered hours"] == "12.00" and sleep[1]["Rostered hours"] == ""


def test_a_name_that_looks_like_a_formula_is_defused():
    db = _db(missing={"employment_hero_connections"})
    db.tables["users"][0]["full_name"] = "=HYPERLINK(\"http://x\")"
    with _run(db):
        text = svc.to_csv(svc.period(ORG, *WEEK))
    assert "'=HYPERLINK" in text


def test_a_period_must_be_the_right_way_round_and_not_too_long():
    with pytest.raises(svc.PeriodError):
        svc.check_period(date(2026, 11, 15), date(2026, 11, 9))
    with pytest.raises(svc.PeriodError):
        svc.check_period(date(2026, 1, 1), date(2026, 6, 30))
    svc.check_period(date(2026, 11, 1), date(2026, 11, 28))


def test_the_routes_are_for_coordinators_and_directors_and_the_csv_downloads():
    from fastapi.testclient import TestClient

    from backend.app.core.security import get_current_user
    from backend.app.main import app

    sample = {"start": "2026-11-09", "end": "2026-11-15", "connected": {"employment_hero": False},
              "totals": {"shifts": 0, "hours": 0, "workers": 0, "waiting": 0, "sent": 0, "attention": 0},
              "shifts": [], "waiting": []}
    client = TestClient(app)
    try:
        app.dependency_overrides[get_current_user] = lambda: {"id": "w-1", "organization_id": ORG, "role": "support_worker"}
        assert client.get("/api/payroll/timesheets", params={"start": "2026-11-09", "end": "2026-11-15"}).status_code == 403
        app.dependency_overrides[get_current_user] = lambda: {"id": "c-1", "organization_id": ORG, "role": "support_coordinator"}
        with patch.object(svc, "period", return_value=sample), \
                patch("backend.app.api.payroll_export.audit_service.log_action", MagicMock(side_effect=Exception("down"))):
            res = client.get("/api/payroll/timesheets.csv", params={"start": "2026-11-09", "end": "2026-11-15"})
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("text/csv")
        assert 'filename="carecliq-timesheets-2026-11-09-to-2026-11-15.csv"' in res.headers["content-disposition"]
        assert res.text.lstrip("\ufeff").startswith("Worker,Worker email,")
        bad = client.get("/api/payroll/timesheets", params={"start": "2026-11-15", "end": "2026-11-09"})
        assert bad.status_code == 422
    finally:
        app.dependency_overrides.clear()
