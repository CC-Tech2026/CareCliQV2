"""Worker availability for the roster: one request for the whole staff, and
only ever for the coordinator's own organisation."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.app.api import coordinator
from backend.app.core.security import get_current_user
from backend.app.main import app

COORDINATOR = {"sub": "c-1", "id": "c-1", "role": "support_coordinator", "organization_id": "org-1"}


class _Query:
    def __init__(self, db: "_DB", table: str):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], "select", None

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: str(r.get(col)) == str(val))
        return self

    def in_(self, col, vals):
        vals = {str(v) for v in vals}
        self.filters.append(lambda r: str(r.get(col)) in vals)
        return self

    def is_(self, *_a):
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a):
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def upsert(self, payload, **_k):
        self.op, self.payload = "upsert", payload
        return self

    def delete(self):
        self.op = "delete"
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def execute(self):
        if self.op != "select":
            self.db.writes.append((self.table, self.op, self.payload))
            return SimpleNamespace(data=[])
        rows = [dict(r) for r in self.db.tables.get(self.table, []) if all(f(r) for f in self.filters)]
        return SimpleNamespace(data=rows)


class _DB:
    def __init__(self, tables):
        self.tables, self.writes = tables, []

    def table(self, name):
        return _Query(self, name)


def _db():
    return _DB({
        "organization_members": [
            {"user_id": "w-1", "organization_id": "org-1", "role": "support_worker"},
            {"user_id": "w-2", "organization_id": "org-1", "role": "support_worker"},
            {"user_id": "p-1", "organization_id": "org-1", "role": "participant"},
            {"user_id": "w-other", "organization_id": "org-2", "role": "support_worker"},
        ],
        "users": [
            {"id": "w-1", "organization_id": "org-1", "role": "support_worker"},
            {"id": "w-2", "organization_id": "org-1", "role": "support_worker"},
            {"id": "w-3", "organization_id": "org-1", "role": "support_worker"},  # no membership row
            {"id": "w-other", "organization_id": "org-2", "role": "support_worker"},
        ],
        "worker_availability": [
            {"user_id": "w-1", "available_days": [1, 3], "max_hours_per_week": 20},
            {"user_id": "w-other", "available_days": [7]},
        ],
        "worker_blackout_dates": [
            {"id": "b-1", "user_id": "w-2", "start_date": "2026-12-24", "end_date": "2026-12-31", "reason": "Leave"},
            {"id": "b-2", "user_id": "w-other", "start_date": "2026-12-01", "end_date": "2026-12-02"},
        ],
    })


@pytest.fixture
def client():
    app.dependency_overrides[get_current_user] = lambda: COORDINATOR
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_team_availability_is_one_request_for_the_organisations_staff(client):
    db = _db()
    with patch.object(coordinator, "get_supabase_admin", return_value=db):
        body = client.get("/api/coordinator/workers/availability").json()
    workers = body["workers"]
    assert set(workers) == {"w-1", "w-2", "w-3"}  # not the participant, not another org's worker
    assert workers["w-1"]["availability"]["available_days"] == [1, 3]
    # Nothing saved: the same defaults as the single lookup.
    assert workers["w-3"]["availability"]["available_days"] == [1, 2, 3, 4, 5]
    assert workers["w-2"]["blackout_dates"] == [
        {"id": "b-1", "start_date": "2026-12-24", "end_date": "2026-12-31", "reason": "Leave"}
    ]


def test_another_organisations_worker_is_not_found(client):
    db = _db()
    with patch.object(coordinator, "get_supabase_admin", return_value=db):
        assert client.get("/api/coordinator/workers/w-other/availability").status_code == 404
        res = client.put(
            "/api/coordinator/workers/w-other/availability",
            json={"available_days": [1], "day_start_time": "08:00", "day_end_time": "16:00",
                  "max_hours_per_week": 10, "blackout_dates": []},
        )
        assert res.status_code == 404
        assert client.post("/api/coordinator/workers/w-other/availability/request-update").status_code == 404
    assert db.writes == []  # nothing about them was changed or wiped


def test_own_worker_still_works_including_one_without_a_membership_row(client):
    db = _db()
    with patch.object(coordinator, "get_supabase_admin", return_value=db):
        assert client.get("/api/coordinator/workers/w-1/availability").json()["availability"]["max_hours_per_week"] == 20
        assert client.get("/api/coordinator/workers/w-3/availability").status_code == 200
