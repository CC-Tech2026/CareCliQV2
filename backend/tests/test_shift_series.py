"""Regular schedules: the right days, kept topped up, changed and ended
without touching what someone changed by hand, and never double-booked."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from backend.app.services import shift_series_service as series

ADL = ZoneInfo("Australia/Adelaide")


class _Query:
    def __init__(self, db: "_DB", table: str):
        self.db, self.table, self.filters, self.op, self.payload, self._limit = db, table, [], "select", None, None
        self.not_ = SimpleNamespace(is_=self._not_is)

    def select(self, *_a, **_k):
        return self

    def _add(self, fn):
        self.filters.append(fn)
        return self

    def eq(self, col, val):
        return self._add(lambda r: str(r.get(col)) == str(val))

    def neq(self, col, val):
        return self._add(lambda r: str(r.get(col)) != str(val))

    def gte(self, col, val):
        return self._add(lambda r: r.get(col) is not None and str(r.get(col)) >= str(val))

    def in_(self, col, vals):
        vals = {str(v) for v in vals}
        return self._add(lambda r: str(r.get(col)) in vals)

    def _not_is(self, col, _null):
        return self._add(lambda r: r.get(col) is not None)

    def or_(self, expr):
        # Only "generated_through.is.null,generated_through.lt.<date>" is used.
        cutoff = expr.rsplit(".", 1)[-1]
        return self._add(lambda r: r.get("generated_through") is None or str(r["generated_through"]) < cutoff)

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self._limit = n
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def delete(self):
        self.op = "delete"
        return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.op == "insert":
            row = dict(self.payload)
            rows.append(row)
            return SimpleNamespace(data=[row])
        hit = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in hit:
                r.update(self.payload)
            return SimpleNamespace(data=hit)
        if self.op == "delete":
            self.db.tables[self.table] = [r for r in rows if r not in hit]
            self.db.deleted += [r["id"] for r in hit]
            return SimpleNamespace(data=hit)
        return SimpleNamespace(data=[dict(r) for r in hit])


class _DB:
    def __init__(self):
        self.tables = {"participants": [{"id": "p-1", "organization_id": "org-1", "full_name": "Liam Carter", "address": "1 Rd"}]}
        self.deleted: list[str] = []

    def table(self, name):
        return _Query(self, name)

    def shifts(self):
        return sorted(self.tables.get("shifts", []), key=lambda r: r["scheduled_start"])


@pytest.fixture
def env(monkeypatch):
    db = _DB()
    busy: dict[str, set[str]] = {}  # worker -> local dates they can't do
    notes: list[tuple[str, str]] = []

    def insert(_sb, payload):
        for r in db.tables.get("shifts", []):
            if r.get("series_id") == payload["series_id"] and r.get("series_date") == payload["series_date"]:
                raise Exception('duplicate key value violates unique constraint (23505)')
        return db.table("shifts").insert(payload).execute()

    def conflicts(_sb, worker_id, _org, start, _end, exclude_shift_id=None, tz=None):
        day = start.astimezone(ADL).date().isoformat()
        return [{"severity": "error", "message": "On leave"}] if day in busy.get(worker_id, set()) else []

    async def notify(_sb, user_id, _org, _type, _shift, title, _body):
        notes.append((user_id, title))

    fake = SimpleNamespace(
        _insert_shift_with_legacy_fallback=insert,
        _detect_worker_conflicts=conflicts,
        _resolve_care_coordinator_id=lambda *_a, **_k: None,
        _send_worker_notification=notify,
    )
    monkeypatch.setattr(series, "_coordinator", lambda: fake)
    monkeypatch.setattr(series, "participant_timezone", lambda *_a, **_k: ADL)
    monkeypatch.setattr(series.agreement_support_service, "rostering_gate", lambda *_a, **_k: None)
    monkeypatch.setattr(series.shift_task_service, "attach_tasks_to_new_shift", lambda *_a, **_k: None)

    async def eligible(*_a, **_k):
        return None

    monkeypatch.setattr(series, "_worker_blocked", eligible)
    monkeypatch.setattr(series, "get_supabase_admin", lambda: db)
    return SimpleNamespace(db=db, busy=busy, notes=notes)


def run(coro):
    return asyncio.run(coro)


def _today() -> date:
    return datetime.now(ADL).date()


def _next(weekday: int, after: date | None = None) -> date:
    d = (after or _today()) + timedelta(days=1)
    while d.weekday() != weekday:
        d += timedelta(days=1)
    return d


def _local(shift: dict) -> tuple[str, str]:
    s = datetime.fromisoformat(shift["scheduled_start"]).astimezone(ADL)
    e = datetime.fromisoformat(shift["scheduled_end"]).astimezone(ADL)
    return s.strftime("%a %H:%M"), e.strftime("%H:%M")


def test_every_second_week_counts_from_the_start_week():
    s = {"start_date": "2026-11-16", "end_date": None, "days_of_week": [0, 2], "interval_weeks": 2}
    days = series.occurrence_dates(s, date(2026, 11, 16), date(2026, 12, 13))
    assert [d.isoformat() for d in days] == ["2026-11-16", "2026-11-18", "2026-11-30", "2026-12-02"]


def test_overnight_and_daylight_saving_keep_the_wall_clock():
    s = {"start_time": "22:00", "end_time": "07:00"}
    # Adelaide moves its clocks forward on 4 Oct 2026.
    start, end = series.window(s, date(2026, 10, 3), ADL)
    assert start.astimezone(ADL).strftime("%d %H:%M") == "03 22:00"
    assert end.astimezone(ADL).strftime("%d %H:%M") == "04 07:00"
    assert (end - start) == timedelta(hours=8)  # an hour lost to daylight saving


def test_a_new_schedule_makes_the_coming_weeks_and_opens_days_the_worker_cant_do(env):
    monday = _next(0)
    env.busy["w-sam"] = {(monday + timedelta(days=7)).isoformat()}
    out = run(series.create_series(env.db, "org-1", "c-1", {
        "participant_id": "p-1", "days_of_week": [0, 2], "start_time": "09:00", "end_time": "12:00",
        "start_date": monday.isoformat(), "worker_id": "w-sam",
    }))
    shifts = env.db.shifts()
    # Mondays and Wednesdays for the next eight weeks, all at 9 to 12.
    assert out["created_count"] == len(shifts) >= 15
    assert {_local(s)[0][:3] for s in shifts} == {"Mon", "Wed"}
    assert all(_local(s)[0].endswith("09:00") and _local(s)[1] == "12:00" for s in shifts)
    # The Monday Sam is on leave is an open shift, said so, not skipped.
    leave = next(s for s in shifts if s["series_date"] == (monday + timedelta(days=7)).isoformat())
    assert leave["status"] == "unassigned" and "worker_id" not in leave
    assert out["opened"] == [{"date": leave["series_date"], "shift_id": leave["id"], "reason": "On leave"}]
    assert env.notes == [("w-sam", "Regular shifts assigned")]


def test_topping_up_twice_never_double_books(env):
    out = run(series.create_series(env.db, "org-1", None, {
        "participant_id": "p-1", "days_of_week": [1], "start_time": "10:00", "end_time": "11:00",
        "start_date": _today().isoformat(),
    }))
    before = len(env.db.shifts())
    row = env.db.tables["shift_series"][0]
    row["generated_through"] = None  # as if a second server hadn't seen the first's work
    run(series.generate(env.db, row))
    assert len(env.db.shifts()) == before == out["created_count"]
    # Open shifts: no worker on any of them.
    assert all(s["status"] == "unassigned" for s in env.db.shifts())


def test_the_hourly_pass_tops_up_and_skips_ended_schedules(env):
    env.db.tables["shift_series"] = [
        {"id": "s-live", "organization_id": "org-1", "participant_id": "p-1", "worker_id": None,
         "days_of_week": [0, 1, 2, 3, 4, 5, 6], "start_time": "09:00", "end_time": "10:00", "interval_weeks": 1,
         "start_date": _today().isoformat(), "end_date": None, "generated_through": _today().isoformat()},
        {"id": "s-ended", "organization_id": "org-1", "participant_id": "p-1", "worker_id": None,
         "days_of_week": [0, 1, 2, 3, 4, 5, 6], "start_time": "09:00", "end_time": "10:00", "interval_weeks": 1,
         "start_date": "2026-01-01", "end_date": "2026-02-01", "generated_through": "2026-02-01"},
    ]
    made = run(series.run_series_pass())
    assert made == series.HORIZON_DAYS
    assert {s["series_id"] for s in env.db.shifts()} == {"s-live"}


def _start(env, **extra):
    monday = _next(0)
    run(series.create_series(env.db, "org-1", "c-1", {
        "participant_id": "p-1", "days_of_week": [0, 2, 4], "start_time": "09:00", "end_time": "12:00",
        "start_date": monday.isoformat(), "worker_id": "w-sam", **extra,
    }))
    return env.db.tables["shift_series"][0]["id"], monday


def test_changing_from_a_date_moves_the_future_and_leaves_hand_changes(env):
    series_id, monday = _start(env)
    from_date = monday + timedelta(days=7)
    # Someone moved one later Wednesday to the afternoon by hand.
    wed = next(s for s in env.db.shifts() if s["series_date"] == (from_date + timedelta(days=2)).isoformat())
    wed["scheduled_start"] = datetime.combine(from_date + timedelta(days=2), datetime.min.time().replace(hour=13), ADL).astimezone(timezone.utc).isoformat()
    first_week = [s for s in env.db.shifts() if s["series_date"] < from_date.isoformat()]
    wednesdays = sum(1 for s in env.db.shifts() if s["series_date"] >= from_date.isoformat() and _local(s)[0].startswith("Wed"))
    mon_fri = sum(1 for s in env.db.shifts() if s["series_date"] >= from_date.isoformat() and _local(s)[0][:3] in ("Mon", "Fri"))

    out = run(series.change_series(env.db, "org-1", series_id, from_date, {
        "days_of_week": [0, 4], "start_time": "10:00", "end_time": "13:00", "worker_id": "w-mia",
    }))

    later = [s for s in env.db.shifts() if s["series_date"] >= from_date.isoformat()]
    untouched_by_hand = [s for s in later if s["id"] != wed["id"]]
    # No more Wednesdays (except the one changed by hand), Mon/Fri now 10 to 1 with Mia.
    assert {_local(s)[0][:3] for s in untouched_by_hand} == {"Mon", "Fri"}
    assert all(_local(s)[0].endswith("10:00") and s["worker_id"] == "w-mia" for s in untouched_by_hand)
    assert any(s["id"] == wed["id"] for s in later) and out["left_alone_count"] == 1
    assert out["removed_count"] == wednesdays - 1 and out["updated_count"] == mon_fri
    # The week before the change is as it was.
    assert all(s["worker_id"] == "w-sam" and _local(s)[0].endswith("09:00") for s in first_week)
    assert ("w-sam", "Regular shifts changed") in env.notes and ("w-mia", "Regular shifts assigned") in env.notes


def test_adding_a_day_makes_its_shifts(env):
    series_id, monday = _start(env)
    out = run(series.change_series(env.db, "org-1", series_id, monday, {"days_of_week": [0, 2, 4, 5]}))
    assert out["created_count"] >= 7
    assert "Sat" in {_local(s)[0][:3] for s in env.db.shifts()}


def test_a_change_with_nothing_in_it_touches_nothing_and_tells_no_one(env):
    series_id, monday = _start(env)
    before = [dict(s) for s in env.db.shifts()]
    env.notes.clear()
    out = run(series.change_series(env.db, "org-1", series_id, monday, {}))
    assert out["updated_count"] == out["removed_count"] == 0
    assert env.db.shifts() == before and env.notes == []


def test_a_new_worker_who_is_busy_leaves_that_day_open(env):
    series_id, monday = _start(env)
    env.busy["w-mia"] = {(monday + timedelta(days=2)).isoformat()}
    out = run(series.change_series(env.db, "org-1", series_id, monday, {"worker_id": "w-mia"}))
    busy = next(s for s in env.db.shifts() if s["series_date"] == (monday + timedelta(days=2)).isoformat())
    assert busy["worker_id"] is None and busy["status"] == "unassigned"
    assert [o["date"] for o in out["opened"]] == [busy["series_date"]]


def test_ending_removes_what_it_made_and_keeps_hand_changes_and_started_shifts(env):
    series_id, monday = _start(env)
    shifts = env.db.shifts()
    shifts[0]["status"] = "in_progress"  # started: never removed
    shifts[1]["worker_id"] = "w-other"   # changed by hand: left for the coordinator
    out = run(series.end_series(env.db, "org-1", series_id, monday))
    assert {s["id"] for s in env.db.shifts()} == {shifts[0]["id"], shifts[1]["id"]}
    assert out["left_alone_count"] == 1 and out["removed_count"] == len(shifts) - 2
    assert env.db.tables["shift_series"][0]["end_date"] == (monday - timedelta(days=1)).isoformat()
    # Nothing more is made for it.
    assert run(series.run_series_pass()) == 0


def test_the_api_is_for_coordinators_and_explains_problems(env, monkeypatch):
    from fastapi.testclient import TestClient

    from backend.app.api import shift_series as api
    from backend.app.core.security import get_current_user
    from backend.app.main import app

    monkeypatch.setattr(api, "get_supabase_admin", lambda: env.db)
    body = {"participant_id": "p-1", "days_of_week": [0], "start_time": "09:00", "end_time": "09:00",
            "start_date": _next(0).isoformat()}
    try:
        app.dependency_overrides[get_current_user] = lambda: {"sub": "w-1", "id": "w-1", "role": "support_worker", "organization_id": "org-1"}
        client = TestClient(app)
        assert client.post("/api/coordinator/shift-series", json=body).status_code == 403
        app.dependency_overrides[get_current_user] = lambda: {"sub": "c-1", "id": "c-1", "role": "support_coordinator", "organization_id": "org-1"}
        res = client.post("/api/coordinator/shift-series", json=body)
        assert res.status_code == 422 and res.json()["detail"] == "The shift starts and ends at the same time."
        res = client.post("/api/coordinator/shift-series", json={**body, "end_time": "11:00"})
        assert res.status_code == 201 and res.json()["created_count"] >= 8
        series_id = res.json()["series"]["id"]
        # Sending worker_id as null means open shifts; leaving it out keeps the worker.
        res = client.patch(f"/api/coordinator/shift-series/{series_id}", json={"from_date": _today().isoformat(), "end_time": "12:00"})
        assert res.status_code == 200 and res.json()["series"]["end_time"] == "12:00"
        assert client.post("/api/coordinator/shift-series/nope/end", json={"from_date": _today().isoformat()}).status_code == 404
        assert len(client.get("/api/coordinator/shift-series").json()) == 1
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_list_shows_whats_coming_and_hides_ended(env):
    series_id, _ = _start(env)
    env.db.tables.setdefault("users", []).append({"id": "w-sam", "organization_id": "org-1", "full_name": "Sam Nguyen"})
    listed = series.list_series(env.db, "org-1")
    assert len(listed) == 1
    item = listed[0]
    assert item["summary"] == "Mon, Wed, Fri 09:00 to 12:00"
    assert item["worker_name"] == "Sam Nguyen" and item["participant_name"] == "Liam Carter"
    assert item["upcoming_count"] == len(env.db.shifts()) and item["upcoming_open"] == 0
    run(series.end_series(env.db, "org-1", series_id, _today()))
    assert series.list_series(env.db, "org-1") == []
