"""Leave cover: shifts rostered to someone on a day of their leave are found,
released only while they still clash, and approved time off becomes leave."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

import pytest

from backend.app.services import leave_cover_service as cover
from backend.app.services import schedule_request_service

ADL = ZoneInfo("Australia/Adelaide")


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], "select", None

    def select(self, *_a, **_k):
        return self

    def _add(self, fn):
        self.filters.append(fn)
        return self

    def eq(self, col, val):
        return self._add(lambda r: str(r.get(col)) == str(val))

    def in_(self, col, vals):
        vals = {str(v) for v in vals}
        return self._add(lambda r: str(r.get(col)) in vals)

    def gte(self, col, val):
        return self._add(lambda r: r.get(col) is not None and str(r[col]) >= str(val))

    def lte(self, col, val):
        return self._add(lambda r: r.get(col) is not None and str(r[col]) <= str(val))

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a):
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
            rows.append(dict(self.payload))
            return SimpleNamespace(data=[dict(self.payload)])
        hit = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in hit:
                r.update(self.payload)
        if self.op == "delete":
            self.db.tables[self.table] = [r for r in rows if r not in hit]
        return SimpleNamespace(data=[dict(r) for r in hit])


class _DB:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return _Query(self, name)


def _at(day: date, hour: int, minute: int = 0) -> str:
    return datetime.combine(day, datetime.min.time().replace(hour=hour, minute=minute), ADL).astimezone(timezone.utc).isoformat()


def _today() -> date:
    return datetime.now(ADL).date()


@pytest.fixture
def env(monkeypatch):
    start = _today() + timedelta(days=7)
    end = start + timedelta(days=4)
    shift = lambda sid, worker, day, hour=9, status="scheduled", **k: {
        "id": sid, "organization_id": "org-1", "worker_id": worker, "participant_id": "p-1",
        "participant_name": "Liam Carter", "scheduled_start": _at(day, hour), "scheduled_end": _at(day, hour + 3),
        "status": status, **k,
    }
    db = _DB({
        "worker_blackout_dates": [
            {"user_id": "w-sam", "start_date": start.isoformat(), "end_date": end.isoformat(), "reason": "Annual leave"},
            {"user_id": "w-old", "start_date": "2026-01-01", "end_date": "2026-01-05", "reason": "Gone"},
        ],
        "shifts": [
            shift("in-leave", "w-sam", start + timedelta(days=2), series_id="series-1"),
            # 6am on the first day in Adelaide is the evening before in UTC: still a leave day.
            shift("early", "w-sam", start, hour=6),
            shift("after", "w-sam", end + timedelta(days=1)),
            shift("other-worker", "w-mia", start + timedelta(days=1)),
            shift("done", "w-sam", start + timedelta(days=1), status="completed"),
            shift("offered", "w-sam", start + timedelta(days=3), status="offered"),
            {**shift("other-org", "w-sam", start + timedelta(days=1)), "organization_id": "org-2"},
        ],
        "users": [
            {"id": "w-sam", "organization_id": "org-1", "full_name": "Sam Nguyen"},
            {"id": "w-mia", "organization_id": "org-1", "full_name": "Mia Chen"},
        ],
        "worker_notifications": [],
    })
    monkeypatch.setattr(cover, "_staff_ids", lambda _org: ["w-sam", "w-mia", "w-old"])
    monkeypatch.setattr(cover, "participant_timezone", lambda *_a, **_k: ADL)
    audit = AsyncMock()
    monkeypatch.setattr(cover.audit_service, "log_action", audit)
    return SimpleNamespace(db=db, start=start, end=end, audit=audit)


def test_finds_coming_rostered_shifts_on_leave_days_only(env):
    clashes = cover.find_clashes(env.db, "org-1")
    assert [c["shift_id"] for c in clashes] == ["early", "in-leave"]
    first = clashes[1]
    assert first["worker_name"] == "Sam Nguyen" and first["participant_name"] == "Liam Carter"
    assert first["leave"] == {"start_date": env.start.isoformat(), "end_date": env.end.isoformat(), "reason": "Annual leave"}
    assert first["series_id"] == "series-1" and clashes[0]["series_id"] is None
    assert cover.count_for_worker(env.db, "org-1", "w-mia") == 0
    assert cover.count_for_worker(env.db, "org-1", "w-sam") == 2


def test_release_opens_only_shifts_that_still_clash_and_tells_the_worker_once(env):
    out = asyncio.run(cover.release(env.db, "org-1", ["in-leave", "early", "after", "other-worker"], "c-1"))
    assert out["released_count"] == 2
    assert {s["shift_id"] for s in out["skipped"]} == {"after", "other-worker"}
    rows = {s["id"]: s for s in env.db.tables["shifts"]}
    assert rows["in-leave"]["worker_id"] is None and rows["in-leave"]["status"] == "unassigned"
    assert rows["early"]["status"] == "unassigned"
    assert rows["after"]["worker_id"] == "w-sam" and rows["other-worker"]["worker_id"] == "w-mia"
    notes = env.db.tables["worker_notifications"]
    assert len(notes) == 1 and notes[0]["user_id"] == "w-sam" and notes[0]["body"].startswith("2 shifts during your leave")
    assert env.audit.await_count == 2
    # Nothing left to cover; releasing again changes nothing.
    assert cover.find_clashes(env.db, "org-1") == []
    assert asyncio.run(cover.release(env.db, "org-1", ["in-leave"], "c-1"))["released_count"] == 0


def test_approving_time_off_puts_it_on_the_workers_leave(env, monkeypatch):
    request = {"id": "r-1", "user_id": "w-mia", "request_type": "time_off", "status": "pending",
               "time_off": {"start_date": env.start.isoformat(), "end_date": env.end.isoformat(), "reason_code": "annual_leave"}}
    monkeypatch.setattr(schedule_request_service, "get_supabase_admin", lambda: env.db)
    monkeypatch.setattr(schedule_request_service, "get_request", lambda *_a, **_k: dict(request))
    out = schedule_request_service.resolve_request("r-1", "org-1", "c-1", status="approved")
    leave = [b for b in env.db.tables["worker_blackout_dates"] if b["user_id"] == "w-mia"]
    assert leave == [{"user_id": "w-mia", "organization_id": "org-1", "start_date": env.start.isoformat(),
                      "end_date": env.end.isoformat(), "reason": "Annual leave"}]
    # Mia has a shift on the second day of it.
    assert out["leave_clashes"] == 1
    # The same leave isn't added twice.
    schedule_request_service._add_approved_leave(env.db, request, "org-1")
    assert len([b for b in env.db.tables["worker_blackout_dates"] if b["user_id"] == "w-mia"]) == 1


def test_approved_days_count_only_their_own_clashes(env):
    # Sam already has two shifts in other leave; a day off with no shift is 0, not 2.
    quiet_day = (env.end + timedelta(days=3)).isoformat()
    request = {"id": "r-3", "user_id": "w-sam", "time_off": {"start_date": quiet_day, "end_date": quiet_day, "reason_code": "medical"}}
    assert schedule_request_service._add_approved_leave(env.db, request, "org-1") == 0
    assert cover.count_for_worker(env.db, "org-1", "w-sam") == 2
    assert cover.count_for_worker(env.db, "org-1", "w-sam", within=(env.start.isoformat(), env.start.isoformat())) == 1


def test_declining_adds_no_leave(env, monkeypatch):
    request = {"id": "r-2", "user_id": "w-mia", "request_type": "time_off", "status": "pending",
               "time_off": {"start_date": env.start.isoformat(), "end_date": env.end.isoformat(), "reason_code": "other"}}
    monkeypatch.setattr(schedule_request_service, "get_supabase_admin", lambda: env.db)
    monkeypatch.setattr(schedule_request_service, "get_request", lambda *_a, **_k: dict(request))
    out = schedule_request_service.resolve_request("r-2", "org-1", "c-1", status="declined", coordinator_notes="Busy week")
    assert "leave_clashes" not in out
    assert not [b for b in env.db.tables["worker_blackout_dates"] if b["user_id"] == "w-mia"]


def test_the_api_lists_and_releases_for_coordinators_only(env, monkeypatch):
    from fastapi.testclient import TestClient

    from backend.app.api import coordinator as coordinator_api
    from backend.app.api import leave_cover as api
    from backend.app.core.security import get_current_user
    from backend.app.main import app

    monkeypatch.setattr(api, "get_supabase_admin", lambda: env.db)
    monkeypatch.setattr(coordinator_api, "get_supabase_admin", lambda: env.db)
    monkeypatch.setattr(api, "_require_worker_in_org", lambda *_a: None)
    try:
        app.dependency_overrides[get_current_user] = lambda: {"sub": "w-1", "id": "w-1", "role": "support_worker", "organization_id": "org-1"}
        client = TestClient(app)
        assert client.get("/api/coordinator/leave-cover").status_code == 403
        assert client.post("/api/coordinator/leave-cover/release", json={"shift_ids": ["in-leave"]}).status_code == 403
        app.dependency_overrides[get_current_user] = lambda: {"sub": "c-1", "id": "c-1", "role": "support_coordinator", "organization_id": "org-1"}
        listed = client.get("/api/coordinator/leave-cover").json()["shifts"]
        assert [s["shift_id"] for s in listed] == ["early", "in-leave"]
        assert [s["shift_id"] for s in client.get("/api/coordinator/leave-cover?worker_id=w-sam").json()["shifts"]] == ["early", "in-leave"]
        res = client.post("/api/coordinator/leave-cover/release", json={"shift_ids": ["in-leave"]})
        assert res.status_code == 200 and res.json()["released_count"] == 1
    finally:
        app.dependency_overrides.pop(get_current_user, None)
