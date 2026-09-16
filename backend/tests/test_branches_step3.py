"""
Step 3 of the branch-timezone work: staff-scoped areas, the MD branch
filter, branch admin endpoints, and the cron/retention pass.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi import FastAPI

from backend.app.api import branches as branches_api
from backend.app.api import compliance as compliance_api
from backend.app.api import dashboards
from backend.app.core import timezone as app_tz
from backend.app.core.security import get_current_user
from backend.app.services import branch_service, retention_service

ADELAIDE = ZoneInfo("Australia/Adelaide")
MELBOURNE = ZoneInfo("Australia/Melbourne")
ORG = str(uuid.uuid4())
MELB = str(uuid.uuid4())


@pytest.fixture(autouse=True)
def _adelaide_default():
    app_tz.clear_timezone_caches()
    with patch.object(app_tz, "APP_TIMEZONE", ADELAIDE):
        yield


def _md() -> dict:
    return {"id": str(uuid.uuid4()), "organization_id": ORG, "role": "managing_director"}


# ── MD dashboard branch filter ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_md_dashboard_branch_filter_scopes_data_and_binds_the_branch_zone():
    p_mel, p_adl = {"id": "p1", "branch_id": MELB}, {"id": "p2", "branch_id": "other"}
    sessions = [{"id": "s1", "patient_id": "p1"}, {"id": "s2", "patient_id": "p2"}]
    u_mel = str(uuid.uuid4())
    seen: dict = {}

    async def fake_payload(current_user, org_id, participants, sess, team, branch):
        seen.update(zone=str(app_tz.request_timezone()), participants=participants, sessions=sess, branch=branch)
        return {}

    async def fake_team(org_id, scoped=None):
        seen["team_scope"] = scoped
        return []

    branch_row = {"id": MELB, "name": "Melbourne", "state": "VIC", "timezone": "Australia/Melbourne"}
    with patch.object(dashboards, "_branch_scope", return_value=(branch_row, {u_mel})), \
         patch.object(dashboards, "_team_members", side_effect=fake_team), \
         patch.object(dashboards, "_md_dashboard_payload", side_effect=fake_payload), \
         patch.object(dashboards.participant_service, "get_participants_list_light", AsyncMock(return_value=[p_mel, p_adl])), \
         patch.object(dashboards.session_service, "get_sessions_for_dashboard", AsyncMock(return_value=sessions)):
        await dashboards.md_dashboard(branch_id=MELB, current_user=_md())

    assert seen["zone"] == "Australia/Melbourne"
    assert seen["participants"] == [p_mel]
    assert [s["id"] for s in seen["sessions"]] == ["s1"]
    assert seen["team_scope"] == {u_mel}
    assert seen["branch"]["name"] == "Melbourne"
    assert app_tz.request_timezone() == ADELAIDE  # unbound afterwards


@pytest.mark.asyncio
async def test_md_dashboard_without_filter_is_org_wide_on_the_callers_zone():
    seen: dict = {}

    async def fake_payload(current_user, org_id, participants, sess, team, branch):
        seen.update(zone=str(app_tz.request_timezone()), n=len(participants), branch=branch)
        return {}

    with patch.object(dashboards, "_team_members", AsyncMock(return_value=[])), \
         patch.object(dashboards, "_md_dashboard_payload", side_effect=fake_payload), \
         patch.object(dashboards.participant_service, "get_participants_list_light", AsyncMock(return_value=[{"id": 1}, {"id": 2}])), \
         patch.object(dashboards.session_service, "get_sessions_for_dashboard", AsyncMock(return_value=[])):
        await dashboards.md_dashboard(branch_id=None, current_user=_md())

    assert seen == {"zone": "Australia/Adelaide", "n": 2, "branch": None}


# ── Compliance: incident day in the viewer's zone ─────────────────────


def test_compliance_local_day_uses_the_viewers_branch():
    token = app_tz.set_request_timezone(MELBOURNE)
    try:
        assert compliance_api._local_day("2026-08-31T14:15:00+00:00") == "2026-09-01"  # 00:15 Melbourne
    finally:
        app_tz.reset_request_timezone(token)
    assert compliance_api._local_day("2026-08-31T14:15:00+00:00") == "2026-08-31"      # 23:45 Adelaide
    assert compliance_api._local_day(None) == ""


# ── Branch admin API ───────────────────────────────────────────────────


def _client(user: dict):
    app = FastAPI()
    app.include_router(branches_api.router, prefix="/api")
    app.dependency_overrides[get_current_user] = lambda: user
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _run(coro):
    return asyncio.run(coro)


def test_only_the_md_can_create_a_branch():
    coordinator = {"id": "u", "organization_id": ORG, "role": "support_coordinator"}

    async def go():
        async with _client(coordinator) as c:
            return await c.post("/api/branches", json={"name": "Melbourne", "state": "VIC"})

    assert _run(go()).status_code == 403


def test_create_branch_normalises_state_and_derives_timezone():
    captured: dict = {}

    class _Ins:
        def __init__(self, payload):
            captured.update(payload)

        def execute(self):
            return SimpleNamespace(data=[{**captured, "id": MELB, "is_head_office": False}])

    class _Tbl:
        def insert(self, payload):
            return _Ins(payload)

    fake = SimpleNamespace(table=lambda name: _Tbl())

    async def go():
        async with _client(_md()) as c:
            return await c.post("/api/branches", json={"name": " Melbourne ", "state": "vic"})

    with patch.object(branch_service, "get_supabase_admin", return_value=fake):
        resp = _run(go())

    assert resp.status_code == 201
    assert captured["name"] == "Melbourne"
    assert captured["state"] == "VIC"
    assert captured["timezone"] == "Australia/Melbourne"


def test_create_branch_rejects_an_unknown_state():
    async def go():
        async with _client(_md()) as c:
            return await c.post("/api/branches", json={"name": "X", "state": "Victoria"})

    assert _run(go()).status_code == 422


def test_head_office_cannot_be_deleted():
    with patch.object(branch_service, "get_branch", return_value={"id": MELB, "is_head_office": True}):
        with pytest.raises(Exception) as exc:
            branch_service.delete_branch(ORG, MELB)
    assert getattr(exc.value, "status_code", None) == 409


def test_updating_a_branch_state_clears_the_timezone_caches():
    class _Q:
        def update(self, payload):
            self.payload = payload
            return self

        def eq(self, *_):
            return self

        def execute(self):
            return SimpleNamespace(data=[{"id": MELB, **self.payload}])

    fake = SimpleNamespace(table=lambda name: _Q())
    with patch.object(branch_service, "get_branch", return_value={"id": MELB}), \
         patch.object(branch_service, "get_supabase_admin", return_value=fake), \
         patch.object(branch_service, "clear_timezone_caches") as cleared:
        row = branch_service.update_branch(ORG, MELB, state="qld")

    assert row["timezone"] == "Australia/Brisbane"
    cleared.assert_called_once()


# ── Retention cron: due date judged on each participant's own day ──────


@pytest.mark.asyncio
async def test_retention_pass_only_purges_when_due_in_the_participants_own_zone():
    """At 14:15 UTC on 31 Aug it is already 1 Sep in Melbourne but still
    31 Aug in Adelaide. A record disposing on 1 Sep is due for the
    Melbourne participant, not the Adelaide one."""
    rows = [
        {"id": "mel", "disposal_date": "2026-09-01", "branch_id": MELB},
        {"id": "adl", "disposal_date": "2026-09-01", "branch_id": "adl"},
    ]

    class _Q:
        def select(self, *_):
            return self

        def lte(self, *_):
            return self

        def eq(self, *_):
            return self

        def update(self, *_):
            return self

        def insert(self, *_):
            return self

        def execute(self):
            return SimpleNamespace(data=rows)

    fake = SimpleNamespace(table=lambda name: _Q())
    fixed = {"Australia/Melbourne": date(2026, 9, 1), "Australia/Adelaide": date(2026, 8, 31)}

    def fake_today(tz=None):
        return fixed.get(str(tz or ADELAIDE), date(2026, 9, 1))

    purged_ids: list = []
    with patch.object(retention_service, "get_supabase_admin", return_value=fake), \
         patch.object(retention_service, "app_today", side_effect=fake_today), \
         patch.object(retention_service, "participant_timezone", lambda r, **k: MELBOURNE if r["branch_id"] == MELB else ADELAIDE), \
         patch.object(retention_service, "deidentify_participant", side_effect=lambda r: purged_ids.append(r["id"]) or {"external_pseudonym": "X"}):
        count = await retention_service.run_retention_pass()

    assert count == 1
    assert purged_ids == ["mel"]
