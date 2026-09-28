"""
Branch timezones (198_branches.sql, core/timezone.py, OrgContextMiddleware).

A provider's offices each carry their own zone; staff and participants
belong to an office. These tests pin the resolution chain — explicit tz →
request (caller's branch) → APP_TIMEZONE — the cached lookups, and that
the middleware binds the caller's zone for exactly the duration of the
request. All zones are fixed so the machine's timezone is irrelevant.
"""
from __future__ import annotations

import asyncio
import re
import uuid
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from backend.app.core import timezone as app_tz
from backend.app.core.security import create_access_token
from backend.app.middleware.org_context import OrgContextMiddleware

ADELAIDE = ZoneInfo("Australia/Adelaide")    # +9:30 in August
MELBOURNE = ZoneInfo("Australia/Melbourne")  # +10:00 in August
BRISBANE = ZoneInfo("Australia/Brisbane")    # +10:00, no DST

ORG = str(uuid.uuid4())
HEAD_OFFICE = str(uuid.uuid4())
MELB_BRANCH = str(uuid.uuid4())
USER_ADL = str(uuid.uuid4())
USER_MEL = str(uuid.uuid4())
PARTICIPANT_MEL = str(uuid.uuid4())


class _Query:
    def __init__(self, sb, name):
        self._sb, self._name, self._filters = sb, name, []

    def select(self, *_a, **_k):
        return self

    def eq(self, key, value):
        self._filters.append((key, value))
        return self

    def limit(self, _n):
        return self

    def execute(self):
        self._sb.calls += 1
        if self._sb.fail:
            raise RuntimeError("db down")
        rows = [
            r for r in self._sb.tables.get(self._name, [])
            if all(str(r.get(k)) == str(v) for k, v in self._filters)
        ]
        return SimpleNamespace(data=rows)


class FakeSupabase:
    """Just enough of the supabase-py query builder for the lookups."""

    def __init__(self, tables: dict, fail: bool = False):
        self.tables, self.fail, self.calls = tables, fail, 0

    def table(self, name):
        return _Query(self, name)


def _db(fail: bool = False) -> FakeSupabase:
    return FakeSupabase({
        "branches": [
            {"id": HEAD_OFFICE, "organization_id": ORG, "timezone": "Australia/Adelaide", "is_head_office": True},
            {"id": MELB_BRANCH, "organization_id": ORG, "timezone": "Australia/Melbourne", "is_head_office": False},
        ],
        "organization_members": [
            {"user_id": USER_ADL, "organization_id": ORG, "branch_id": HEAD_OFFICE},
            {"user_id": USER_MEL, "organization_id": ORG, "branch_id": MELB_BRANCH},
        ],
        "participants": [
            {"id": PARTICIPANT_MEL, "organization_id": ORG, "branch_id": MELB_BRANCH},
        ],
    }, fail=fail)


@pytest.fixture(autouse=True)
def _fixed_default_and_clean_caches():
    app_tz.clear_timezone_caches()
    with patch.object(app_tz, "APP_TIMEZONE", ADELAIDE):
        yield
    app_tz.clear_timezone_caches()


# ── Mapping / validation ───────────────────────────────────────────────


def test_state_maps_to_zone_case_insensitively():
    assert app_tz.timezone_for_state("vic") == MELBOURNE
    assert app_tz.timezone_for_state(" QLD ") == BRISBANE
    assert app_tz.timezone_for_state("ACT") == ZoneInfo("Australia/Sydney")
    assert app_tz.timezone_for_state("Victoria") is None
    assert app_tz.timezone_for_state(None) is None


def test_coerce_timezone_rejects_garbage():
    assert app_tz.coerce_timezone("Australia/Perth") == ZoneInfo("Australia/Perth")
    assert app_tz.coerce_timezone("Mars/Olympus") is None
    assert app_tz.coerce_timezone("") is None


def test_python_state_map_matches_the_sql_function():
    """The DB derives branch.timezone from state; keep both tables identical."""
    sql = Path(__file__).resolve().parents[1] / "supabase" / "migrations" / "198_branches.sql"
    body = sql.read_text()
    pairs = dict(re.findall(r"WHEN '([A-Z]+)'\s+THEN '([A-Za-z/_]+)'", body))
    assert pairs == app_tz.AUSTRALIAN_STATE_TIMEZONES


# ── Request-scoped zone and helper defaults ────────────────────────────


def test_request_timezone_defaults_to_app_timezone_outside_a_request():
    assert app_tz.request_timezone() == ADELAIDE


def test_helpers_follow_the_bound_request_zone_and_explicit_tz_wins():
    token = app_tz.set_request_timezone(MELBOURNE)
    try:
        # Melbourne midnight on 25 Aug is 14:00 UTC on the 24th (+10:00)
        assert app_tz.app_day_bounds_utc(date(2026, 8, 25))[0] == "2026-08-24T14:00:00+00:00"
        # 14:15 UTC on the 24th: already the 25th in Melbourne, still the 24th in Adelaide
        assert app_tz.shift_local_date("2026-08-24T14:15:00+00:00") == date(2026, 8, 25)
        assert app_tz.shift_local_date("2026-08-24T14:15:00+00:00", tz=ADELAIDE) == date(2026, 8, 24)
        # Naive strings are read in the bound zone
        assert app_tz.parse_shift_datetime("2026-08-25T00:00:00").isoformat() == "2026-08-24T14:00:00+00:00"
    finally:
        app_tz.reset_request_timezone(token)
    # Reset restores the default
    assert app_tz.app_day_bounds_utc(date(2026, 8, 25))[0] == "2026-08-24T14:30:00+00:00"


# ── Lookups ─────────────────────────────────────────────────────────────


def test_user_timezone_comes_from_their_branch():
    db = _db()
    assert app_tz.user_timezone(USER_MEL, ORG, supabase=db) == MELBOURNE
    assert app_tz.user_timezone(USER_ADL, ORG, supabase=db) == ADELAIDE


def test_user_without_a_member_row_falls_back_to_head_office():
    assert app_tz.user_timezone(str(uuid.uuid4()), ORG, supabase=_db()) == ADELAIDE


def test_db_failure_falls_back_to_app_timezone_and_never_raises():
    assert app_tz.user_timezone(USER_MEL, ORG, supabase=_db(fail=True)) == ADELAIDE
    assert app_tz.participant_timezone(PARTICIPANT_MEL, supabase=_db(fail=True)) == ADELAIDE


def test_lookups_are_cached():
    db = _db()
    app_tz.user_timezone(USER_MEL, ORG, supabase=db)
    first = db.calls
    assert first > 0
    app_tz.user_timezone(USER_MEL, ORG, supabase=db)
    assert db.calls == first


def test_participant_timezone_by_id_row_or_shift_row():
    db = _db()
    assert app_tz.participant_timezone(PARTICIPANT_MEL, supabase=db) == MELBOURNE
    assert app_tz.participant_timezone({"branch_id": MELB_BRANCH}, supabase=db) == MELBOURNE
    assert app_tz.participant_timezone({"participant_id": PARTICIPANT_MEL}, supabase=db) == MELBOURNE
    assert app_tz.participant_timezone({"patient_id": PARTICIPANT_MEL}, supabase=db) == MELBOURNE


def test_unknown_participant_falls_back_to_the_request_zone():
    db = _db()
    token = app_tz.set_request_timezone(BRISBANE)
    try:
        assert app_tz.participant_timezone(str(uuid.uuid4()), supabase=db) == BRISBANE
        assert app_tz.participant_timezone(None, supabase=db) == BRISBANE
    finally:
        app_tz.reset_request_timezone(token)


# ── Middleware ──────────────────────────────────────────────────────────


def _app_with_middleware(timezone_fn):
    app = FastAPI()
    app.add_middleware(OrgContextMiddleware, _timezone_fn=timezone_fn)

    @app.get("/api/today")
    async def today(request: Request):
        return JSONResponse({
            "zone": str(app_tz.request_timezone()),
            "state_zone": str(getattr(request.state, "timezone", None)),
            "day_start": app_tz.app_day_bounds_utc(date(2026, 8, 25))[0],
        })

    return app


def _get(app, token):
    async def _run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            return await c.get("/api/today", headers={"Authorization": f"Bearer {token}"})

    return asyncio.run(_run())


def test_middleware_binds_the_callers_branch_zone_for_the_request():
    seen = {}

    def fake_tz(user_id, org_id):
        seen["args"] = (user_id, org_id)
        return MELBOURNE

    token = create_access_token(data={"sub": USER_MEL, "role": "support_coordinator", "organization_id": ORG})
    resp = _get(_app_with_middleware(fake_tz), token)

    assert resp.status_code == 200
    assert seen["args"] == (USER_MEL, ORG)
    assert resp.json()["zone"] == "Australia/Melbourne"
    assert resp.json()["state_zone"] == "Australia/Melbourne"
    assert resp.json()["day_start"] == "2026-08-24T14:00:00+00:00"
    # Nothing leaks past the request
    assert app_tz.request_timezone() == ADELAIDE


def test_middleware_uses_the_real_lookup_and_survives_a_db_outage():
    """Production wiring: user_timezone hits the DB; when that fails the
    request still succeeds on APP_TIMEZONE."""
    token = create_access_token(data={"sub": USER_ADL, "role": "managing_director", "organization_id": ORG})
    with patch.object(app_tz, "_admin_client", return_value=_db(fail=True)):
        resp = _get(_app_with_middleware(None), token)

    assert resp.status_code == 200
    assert resp.json()["zone"] == "Australia/Adelaide"
