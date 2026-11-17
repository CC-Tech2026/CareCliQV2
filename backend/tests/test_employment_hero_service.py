"""Employment Hero Payroll: approved timesheets go to payroll with nothing
typed in. Workers are matched by email or name, each shift is sent once,
shifts from before "send from" stay out, and reversing an approval takes the
timesheet back out unless it's been paid."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException

from backend.app.services import employment_hero_service as eh

ORG = "org-1"
DIRECTOR = {"id": "md-1", "organization_id": ORG, "role": "managing_director"}
COORDINATOR = {"id": "c-1", "organization_id": ORG, "role": "support_coordinator"}
ADELAIDE = ZoneInfo("Australia/Adelaide")
KEYS = {
    "employment_hero_connections": ("organization_id",),
    "employment_hero_employees": ("organization_id", "worker_id"),
    "employment_hero_timesheets": ("organization_id", "shift_id"),
}


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], "select", None

    def select(self, *_a, **_k):
        return self

    def eq(self, key, value):
        self.filters.append(lambda r: str(r.get(key)) == str(value))
        return self

    def in_(self, key, values):
        values = {str(v) for v in values}
        self.filters.append(lambda r: str(r.get(key)) in values)
        return self

    def is_(self, key, _null):
        self.filters.append(lambda r: r.get(key) is None)
        return self

    def gte(self, key, value):
        self.filters.append(lambda r: r.get(key) is None or str(r.get(key)) >= str(value))
        return self

    def lt(self, *_a):
        return self

    def limit(self, *_a):
        return self

    def order(self, *_a, **_k):
        return self

    def range(self, start, end):
        self.window = (start, end)
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def upsert(self, payload, **_k):
        self.op, self.payload = "upsert", payload
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
            return MagicMock(data=[self.payload])
        if self.op == "upsert":
            keys = KEYS.get(self.table, ("id",))
            same = [r for r in rows if all(str(r.get(k)) == str(self.payload.get(k)) for k in keys)]
            if same:
                same[0].update(self.payload)
                return MagicMock(data=[same[0]])
            rows.append(dict(self.payload))
            return MagicMock(data=[self.payload])
        hit = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in hit:
                r.update(self.payload)
        if self.op == "delete":
            self.db.tables[self.table] = [r for r in rows if r not in hit]
        if self.op == "select" and hasattr(self, "window"):
            start, end = self.window
            hit = hit[start:end + 1]
        return MagicMock(data=hit)


class _DB:
    def __init__(self, **tables):
        self.tables = {k: [dict(r) for r in v] for k, v in tables.items()}

    def table(self, name):
        return _Query(self, name)


EMPLOYEES = [
    {"id": 501, "firstName": "Aisha", "surname": "Rahman", "emailAddress": "aisha@example.com", "status": "Active"},
    {"id": 502, "firstName": "Tom", "surname": "Walsh", "emailAddress": "tom.w@payroll.example", "status": "Active"},
    {"id": 503, "firstName": "Sam", "surname": "Lee", "emailAddress": "", "status": "Active"},
    {"id": 504, "firstName": "Sam", "surname": "Lee", "emailAddress": "", "status": "Active"},
    {"id": 505, "firstName": "Old", "surname": "Staff", "emailAddress": "old@example.com", "status": "Terminated"},
]


def _connection(**settings):
    return {
        "organization_id": ORG, "business_id": 9001, "business_name": "Sunrise Supports Pty Ltd",
        "access_token": "at", "refresh_token": "rt",
        "access_token_expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        "settings": {**eh.DEFAULT_SETTINGS, "send_from": "2026-11-01", **settings},
    }


def _shift(shift_id="s-1", worker="w-1", start="2026-11-14T09:00:00+10:30", **extra):
    return {
        "id": shift_id, "organization_id": ORG, "participant_id": "p-1", "participant_name": "Liam Carter",
        "worker_id": worker, "scheduled_start": start, "scheduled_end": "2026-11-14T12:00:00+10:30",
        "clocked_in_at": start, "clocked_out_at": "2026-11-14T12:20:00+10:30", "status": "completed",
        "is_sleepover": False, **extra,
    }


def _verification(shift_id="s-1", minutes=180):
    return {"id": f"v-{shift_id}", "shift_id": shift_id, "organization_id": ORG, "reversed_at": None,
            "verified_at": datetime.now(timezone.utc).isoformat(),
            "checks_run": {"billing": {"billable_minutes": minutes, "capped_at_scheduled": True}}}


def _db(shifts=None, verifications=None, **more):
    shifts = shifts if shifts is not None else [_shift()]
    return _DB(
        employment_hero_connections=[_connection()],
        shifts=shifts,
        shift_verifications=verifications if verifications is not None else [_verification(s["id"]) for s in shifts],
        users=[
            {"id": "w-1", "full_name": "Aisha Rahman", "email": "Aisha@Example.com"},
            {"id": "w-2", "full_name": "Tom Walsh", "email": "tom@carecliq.example"},
            {"id": "w-3", "full_name": "Sam Lee", "email": "sam@carecliq.example"},
        ],
        organization_members=[{"organization_id": ORG, "user_id": w} for w in ("w-1", "w-2", "w-3")],
        employment_hero_employees=[], employment_hero_timesheets=[],
        **more,
    )


class _FakeApi:
    """Employment Hero, answering by method and path."""

    def __init__(self, responses=None):
        self.calls: list[tuple] = []
        self.responses = responses or {}
        self.next_id = 7000

    async def __call__(self, row, method, path, *, params=None, json=None, business_scoped=True, **_k):
        self.calls.append((method, path, params, json))
        answer = self.responses.get((method, path))
        if isinstance(answer, Exception):
            raise answer
        if callable(answer):
            return answer(params, json)
        if answer is not None:
            return answer
        if (method, path) == ("GET", "/employee/unstructured"):
            return EMPLOYEES if not (params or {}).get("$skip") else []
        if (method, path) == ("POST", "/timesheet"):
            self.next_id += 1
            return {"id": self.next_id, **(json or {})}
        return {}

    def posted(self):
        return [c for c in self.calls if c[:2] == ("POST", "/timesheet")]


def _run(db, api):
    return patch.multiple(
        eh,
        get_supabase_admin=MagicMock(return_value=db),
        _api=api,
        participant_timezone=MagicMock(return_value=ADELAIDE),
    )


# ---------------------------------------------------------------------------
# Matching and the timesheet itself
# ---------------------------------------------------------------------------

def test_workers_are_matched_by_email_then_name_and_never_guessed():
    employees = [eh._employee_view(e) for e in EMPLOYEES]
    # Email (any case) wins.
    assert eh.match_employee({"full_name": "A Rahman", "email": "AISHA@example.com"}, employees)[0]["id"] == 501
    # No email match: the one active employee with that name.
    assert eh.match_employee({"full_name": "Tom  Walsh", "email": "tom@carecliq.example"}, employees) == (
        next(e for e in employees if e["id"] == 502), "name")
    # Two people called Sam Lee: not guessed.
    assert eh.match_employee({"full_name": "Sam Lee", "email": "sam@carecliq.example"}, employees) is None
    # Terminated employees aren't matched while there are active ones.
    assert eh.match_employee({"full_name": "Old Staff", "email": "old@example.com"}, employees) is None


def test_the_timesheet_is_the_approved_time_in_local_time_once_per_shift():
    shift = _shift(is_sleepover=True)
    start, end = eh.paid_window(shift, _verification(minutes=180))
    # Clocked out 20 minutes late without approval: paid the 3 scheduled hours.
    assert (end - start) == timedelta(hours=3)
    line = eh.build_timesheet(shift, 501, start, end, {**eh.DEFAULT_SETTINGS, "sleepover_work_type_id": 44}, ADELAIDE)
    assert line == {
        "employeeId": 501,
        "startTime": "2026-11-14T09:00:00",
        "endTime": "2026-11-14T12:00:00",
        "comments": "CareCliQ shift with Liam C.",
        "externalId": "carecliq-shift-s-1",
        "status": "Approved",
        "workTypeId": 44,
    }
    submitted = eh.build_timesheet(_shift(), 501, start, end, {**eh.DEFAULT_SETTINGS, "send_approved": False}, ADELAIDE)
    assert submitted["status"] == "Submitted" and "workTypeId" not in submitted


# ---------------------------------------------------------------------------
# Sending
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_an_approved_shift_goes_once_with_the_worker_found_by_email():
    db, api = _db(), _FakeApi()
    with _run(db, api):
        first = await eh.push_shift(ORG, "s-1")
        again = await eh.push_shift(ORG, "s-1")
    assert first["status"] == "sent" and again["status"] == "sent"
    posted = api.posted()
    assert len(posted) == 1
    _method, _path, params, body = posted[0]
    assert params == {"enforceUniqueExternalId": "true"}
    assert body["employeeId"] == 501 and body["externalId"] == "carecliq-shift-s-1"
    sheet = db.tables["employment_hero_timesheets"][0]
    assert sheet["status"] == "sent" and sheet["timesheet_id"] == 7001 and sheet["error"] is None
    link = db.tables["employment_hero_employees"][0]
    assert link["employee_id"] == 501 and link["matched_by"] == "email"


@pytest.mark.asyncio
async def test_shifts_before_send_from_stay_out_unless_sent_by_hand():
    db, api = _db(shifts=[_shift(start="2026-10-20T09:00:00+10:30")]), _FakeApi()
    with _run(db, api):
        skipped = await eh.push_shift(ORG, "s-1")
        forced = await eh.push_shift(ORG, "s-1", force=True)
    assert skipped == {"status": "skipped", "reason": "before_send_from"}
    assert forced["status"] == "sent" and len(api.posted()) == 1


@pytest.mark.asyncio
async def test_an_unapproved_shift_is_never_sent():
    db, api = _db(verifications=[]), _FakeApi()
    with _run(db, api):
        result = await eh.push_shift(ORG, "s-1")
    assert result["status"] == "skipped" and api.posted() == []


@pytest.mark.asyncio
async def test_a_worker_who_cant_be_told_apart_waits_for_the_director_to_choose():
    db, api = _db(shifts=[_shift(worker="w-3")]), _FakeApi()
    with _run(db, api), patch.object(eh, "audit_service", MagicMock(log_action=AsyncMock())):
        result = await eh.push_shift(ORG, "s-1")
        assert result["status"] == "failed" and "Choose who they are" in result["error"]
        status = eh.get_status(DIRECTOR)
        assert status["counts"]["failed"] == 1
        attention = status["attention"][0]
        assert attention["needs_employee"] is True and attention["worker_name"] == "Sam Lee"

        await eh.choose_employee(DIRECTOR, "w-3", 504, "Sam Lee")
    assert api.posted()[-1][3]["employeeId"] == 504
    assert db.tables["employment_hero_timesheets"][0]["status"] == "sent"


@pytest.mark.asyncio
async def test_a_lost_answer_is_picked_up_instead_of_sending_twice():
    responses = {
        ("POST", "/timesheet"): eh.EmploymentHeroError("A timesheet with this external id already exists."),
        ("GET", "/timesheet"): [{"id": 8123, "externalId": "carecliq-shift-s-1"}],
    }
    db, api = _db(), _FakeApi(responses)
    with _run(db, api):
        result = await eh.push_shift(ORG, "s-1")
    assert result == {"status": "sent", "timesheet_id": 8123}
    assert db.tables["employment_hero_timesheets"][0]["timesheet_id"] == 8123


@pytest.mark.asyncio
async def test_reversing_removes_the_timesheet_unless_its_been_paid():
    db, api = _db(), _FakeApi({("GET", "/timesheet/7001"): {"id": 7001, "status": "Approved"}})
    with _run(db, api):
        await eh.push_shift(ORG, "s-1")
        removed = await eh.remove_shift(ORG, "s-1")
    assert removed["status"] == "removed"
    assert ("DELETE", "/timesheet/7001", None, None) in api.calls
    assert db.tables["employment_hero_timesheets"][0]["status"] == "removed"

    db, api = _db(), _FakeApi({("GET", "/timesheet/7001"): {"id": 7001, "status": "Processed"}})
    with _run(db, api):
        await eh.push_shift(ORG, "s-1")
        paid = await eh.remove_shift(ORG, "s-1")
    assert paid["status"] == "paid" and "Adjust it in Employment Hero" in paid["error"]
    assert not [c for c in api.calls if c[0] == "DELETE"]


@pytest.mark.asyncio
async def test_the_background_pass_sends_what_is_waiting():
    shifts = [_shift("s-1", "w-1"), _shift("s-2", "w-2"), _shift("s-3", "w-3")]
    db, api = _db(shifts=shifts), _FakeApi()
    with _run(db, api):
        result = await eh.sync_organization(ORG)
        again = await eh.sync_organization(ORG)
    # Sam Lee can't be told apart: waits. The others go, once.
    assert result == {"sent": 2, "failed": 1}
    assert again == {"sent": 0, "failed": 1}
    assert sorted(c[3]["employeeId"] for c in api.posted()) == [501, 502]


# ---------------------------------------------------------------------------
# Connecting
# ---------------------------------------------------------------------------

def _oauth_state():
    return {"state": "st", "organization_id": ORG, "user_id": "md-1", "created_at": datetime.now(timezone.utc).isoformat()}


@pytest.mark.asyncio
async def test_connecting_picks_the_only_business_and_its_sleepover_work_type(monkeypatch):
    monkeypatch.setattr(eh.settings, "employment_hero_client_id", "cid")
    monkeypatch.setattr(eh.settings, "employment_hero_client_secret", "secret")
    db = _DB(employment_hero_oauth_states=[_oauth_state()], employment_hero_connections=[],
             employment_hero_timesheets=[], employment_hero_employees=[], users=[])
    api = _FakeApi({
        ("GET", "/business"): [{"id": 9001, "name": "Sunrise Supports Pty Ltd"}],
        ("GET", "/worktype"): [{"id": 40, "name": "Ordinary hours"}, {"id": 44, "name": "Sleepover (SCHADS)"}],
    })
    tokens = {"access_token": "at", "refresh_token": "rt", "expires_in": 3600}
    with _run(db, api), patch.object(eh, "_token_request", AsyncMock(return_value=tokens)), \
            patch.object(eh, "_local_today", MagicMock(return_value=datetime(2026, 11, 17).date())), \
            patch.object(eh, "audit_service", MagicMock(log_action=AsyncMock())):
        status = await eh.complete_connection(DIRECTOR, "code", "st")
    assert status["connected"] is True and status["business_name"] == "Sunrise Supports Pty Ltd"
    assert status["needs_business"] is False
    assert status["settings"]["send_from"] == "2026-11-17"
    assert status["settings"]["sleepover_work_type_id"] == 44


@pytest.mark.asyncio
async def test_a_login_with_several_businesses_chooses_by_name(monkeypatch):
    monkeypatch.setattr(eh.settings, "employment_hero_client_id", "cid")
    monkeypatch.setattr(eh.settings, "employment_hero_client_secret", "secret")
    db = _DB(employment_hero_oauth_states=[_oauth_state()], employment_hero_connections=[],
             employment_hero_timesheets=[], employment_hero_employees=[], users=[])
    api = _FakeApi({
        ("GET", "/business"): [{"id": 2, "name": "Sunrise West"}, {"id": 1, "name": "Sunrise East"}],
        ("GET", "/worktype"): [],
    })
    tokens = {"access_token": "at", "refresh_token": "rt", "expires_in": 3600}
    with _run(db, api), patch.object(eh, "_token_request", AsyncMock(return_value=tokens)), \
            patch.object(eh, "_local_today", MagicMock(return_value=datetime(2026, 11, 17).date())), \
            patch.object(eh, "audit_service", MagicMock(log_action=AsyncMock())):
        status = await eh.complete_connection(DIRECTOR, "code", "st")
        assert status["needs_business"] is True
        assert [b["name"] for b in status["businesses"]] == ["Sunrise East", "Sunrise West"]
        with pytest.raises(HTTPException):
            await eh.choose_business(DIRECTOR, 99)
        chosen = await eh.choose_business(DIRECTOR, 2)
    assert chosen["business_name"] == "Sunrise West" and chosen["needs_business"] is False


@pytest.mark.asyncio
async def test_only_a_director_manages_the_connection():
    db = _db()
    with _run(db, _FakeApi()):
        for call in (lambda: eh.get_status(COORDINATOR), lambda: eh.create_connect_url(COORDINATOR),
                     lambda: eh.update_settings(COORDINATOR, {"auto_send": False})):
            with pytest.raises(HTTPException) as err:
                call()
            assert err.value.status_code == 403
        with pytest.raises(HTTPException):
            await eh.choose_employee(COORDINATOR, "w-1", 501)


def test_settings_take_a_send_from_date_and_switches():
    db = _db()
    with _run(db, _FakeApi()):
        status = eh.update_settings(DIRECTOR, {"send_from": "2026-11-10", "send_approved": False})
        assert status["settings"]["send_from"] == "2026-11-10" and status["settings"]["send_approved"] is False
        with pytest.raises(HTTPException):
            eh.update_settings(DIRECTOR, {"send_from": "not a date"})
