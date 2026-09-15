"""Delegated access grants — Phase 1 verification.

Two kinds of tests here:
1. Standard mocked unit tests for the CRUD/audit-logging behaviour in
   access_grant_service.py (fast, deterministic).
2. A real-elapsed-time test for has_active_grant()'s expiry enforcement,
   using a fake table that actually implements .eq()/.is_()/.gt() filtering
   in Python (so it behaves like a real filtered query, not a canned mock
   response) and a genuine wall-clock sleep across the expiry boundary —
   per the spec's explicit instruction not to trust that the logic reads
   correctly, but to prove it's live rather than job-dependent.
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.core.access import has_active_grant
from backend.app.services import access_grant_service as svc


ORG_ID = str(uuid.uuid4())
MD = {"id": str(uuid.uuid4()), "organization_id": ORG_ID, "role": "managing_director"}
COORDINATOR_ID = str(uuid.uuid4())
COORDINATOR = {"id": COORDINATOR_ID, "organization_id": ORG_ID, "role": "support_coordinator"}


class _FakeAccessGrantsTable:
    """A minimal in-memory fake that actually applies .eq()/.is_()/.gt()
    filters against stored rows, rather than returning a canned response
    regardless of the query — so a test using it is exercising the real
    filter logic has_active_grant() constructs, not just that some data
    came back."""

    def __init__(self, rows: list[dict]):
        self.rows = rows
        self._filters: list[tuple[str, str, object]] = []
        self._select_cols = "*"

    def select(self, cols="*"):
        self._select_cols = cols
        return self

    def insert(self, payload):
        row = {"id": str(uuid.uuid4()), **payload}
        self.rows.append(row)
        self._last_insert = [row]
        return self

    def update(self, payload):
        self._update_payload = payload
        return self

    def eq(self, col, val):
        self._filters.append(("eq", col, val))
        return self

    def is_(self, col, val):
        self._filters.append(("is", col, val))
        return self

    def gt(self, col, val):
        self._filters.append(("gt", col, val))
        return self

    def order(self, *a, **k):
        return self

    def limit(self, n):
        self._limit = n
        return self

    def maybe_single(self):
        self._maybe_single = True
        return self

    def _matches(self, row: dict) -> bool:
        for kind, col, val in self._filters:
            if kind == "eq" and str(row.get(col)) != str(val):
                return False
            if kind == "is" and val == "null" and row.get(col) is not None:
                return False
            if kind == "gt":
                row_val = row.get(col)
                if row_val is None or str(row_val) <= str(val):
                    return False
        return True

    def execute(self):
        if hasattr(self, "_update_payload"):
            matched = [r for r in self.rows if self._matches(r)]
            for r in matched:
                r.update(self._update_payload)
            del self._update_payload
            self._filters = []
            return MagicMock(data=matched)
        matched = [r for r in self.rows if self._matches(r)]
        self._filters = []
        if getattr(self, "_maybe_single", False):
            self._maybe_single = False
            return MagicMock(data=matched[0] if matched else None)
        return MagicMock(data=matched)


def _fake_supabase(rows: list[dict]):
    table = _FakeAccessGrantsTable(rows)
    mock = MagicMock()
    mock.table.side_effect = lambda name: table if name == "access_grants" else MagicMock()
    return mock, table


# ── has_active_grant: real elapsed-time expiry (the spec's explicit ask) ──


def test_has_active_grant_true_while_active_false_once_actually_expired():
    """A grant expiring ~1.2s from now: active immediately, and genuinely
    denied once real wall-clock time has passed the expiry — not simulated,
    not mocked time, an actual time.sleep() across the boundary."""
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=1.2)).isoformat()
    rows = [{
        "id": str(uuid.uuid4()),
        "organization_id": ORG_ID,
        "granted_to_user_id": COORDINATOR_ID,
        "capability": "governance_vault",
        "expires_at": expires_at,
        "revoked_at": None,
    }]
    supabase, _table = _fake_supabase(rows)

    assert has_active_grant(COORDINATOR, "governance_vault", supabase) is True

    time.sleep(1.6)  # genuinely cross the expiry boundary in real time

    assert has_active_grant(COORDINATOR, "governance_vault", supabase) is False, (
        "Expiry must be enforced live against the current wall-clock time on "
        "every call, not a stale cached/job-computed status."
    )


def test_has_active_grant_false_once_revoked_even_if_not_yet_expired():
    """Revocation must deny access immediately, even with plenty of time
    left before expires_at — revocation is not 'let it expire faster'."""
    rows = [{
        "id": str(uuid.uuid4()),
        "organization_id": ORG_ID,
        "granted_to_user_id": COORDINATOR_ID,
        "capability": "governance_vault",
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
        "revoked_at": datetime.now(timezone.utc).isoformat(),
    }]
    supabase, _table = _fake_supabase(rows)
    assert has_active_grant(COORDINATOR, "governance_vault", supabase) is False


def test_has_active_grant_denies_other_capabilities_not_granted():
    """A coordinator with an active grant for one capability must not gain
    any other MD-exclusive capability they weren't specifically granted."""
    rows = [{
        "id": str(uuid.uuid4()),
        "organization_id": ORG_ID,
        "granted_to_user_id": COORDINATOR_ID,
        "capability": "governance_vault",
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "revoked_at": None,
    }]
    supabase, _table = _fake_supabase(rows)
    assert has_active_grant(COORDINATOR, "governance_vault", supabase) is True
    assert has_active_grant(COORDINATOR, "executive_dashboard", supabase) is False
    assert has_active_grant(COORDINATOR, "platform_billing", supabase) is False


def test_has_active_grant_denies_grant_belonging_to_different_org():
    rows = [{
        "id": str(uuid.uuid4()),
        "organization_id": str(uuid.uuid4()),  # different org
        "granted_to_user_id": COORDINATOR_ID,
        "capability": "governance_vault",
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "revoked_at": None,
    }]
    supabase, _table = _fake_supabase(rows)
    assert has_active_grant(COORDINATOR, "governance_vault", supabase) is False


def test_has_active_grant_denies_grant_belonging_to_different_user():
    rows = [{
        "id": str(uuid.uuid4()),
        "organization_id": ORG_ID,
        "granted_to_user_id": str(uuid.uuid4()),  # a different coordinator
        "capability": "governance_vault",
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "revoked_at": None,
    }]
    supabase, _table = _fake_supabase(rows)
    assert has_active_grant(COORDINATOR, "governance_vault", supabase) is False


# ── access_grant_service: create / list / revoke + audit logging ──────────


@pytest.mark.asyncio
async def test_create_grant_requires_md_role():
    with pytest.raises(HTTPException) as exc:
        await svc.create_grant(
            COORDINATOR,
            granted_to_user_id=COORDINATOR_ID,
            capability="governance_vault",
            expires_at=(datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_create_grant_rejects_unknown_capability():
    mock_supabase = MagicMock()
    with patch.object(svc, "get_supabase_admin", return_value=mock_supabase):
        with pytest.raises(HTTPException) as exc:
            await svc.create_grant(
                MD,
                granted_to_user_id=COORDINATOR_ID,
                capability="not_a_real_capability",
                expires_at=(datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
            )
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_create_grant_rejects_past_expiry():
    mock_supabase = MagicMock()
    with patch.object(svc, "get_supabase_admin", return_value=mock_supabase):
        with pytest.raises(HTTPException) as exc:
            await svc.create_grant(
                MD,
                granted_to_user_id=COORDINATOR_ID,
                capability="governance_vault",
                expires_at=(datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
            )
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_create_grant_rejects_non_coordinator_target():
    mock_supabase = MagicMock()
    mock_supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data={"id": COORDINATOR_ID, "role": "support_worker", "organization_id": ORG_ID, "full_name": "Not A Coordinator"}
    )
    with patch.object(svc, "get_supabase_admin", return_value=mock_supabase):
        with pytest.raises(HTTPException) as exc:
            await svc.create_grant(
                MD,
                granted_to_user_id=COORDINATOR_ID,
                capability="governance_vault",
                expires_at=(datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
            )
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_create_grant_succeeds_and_logs_audit_action():
    mock_supabase = MagicMock()

    def table_side_effect(name):
        table = MagicMock()
        if name == "users":
            table.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
                data={"id": COORDINATOR_ID, "role": "support_coordinator", "organization_id": ORG_ID, "full_name": "Casey Coordinator"}
            )
        elif name == "access_grants":
            inserted = {
                "id": str(uuid.uuid4()),
                "organization_id": ORG_ID,
                "granted_to_user_id": COORDINATOR_ID,
                "granted_by_user_id": MD["id"],
                "capability": "governance_vault",
                "revoked_at": None,
                "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
            }
            table.insert.return_value.execute.return_value = MagicMock(data=[inserted])
        return table

    mock_supabase.table.side_effect = table_side_effect

    with patch.object(svc, "get_supabase_admin", return_value=mock_supabase), patch.object(
        svc.audit_service, "log_action", new=AsyncMock(return_value=True)
    ) as log_mock:
        result = await svc.create_grant(
            MD,
            granted_to_user_id=COORDINATOR_ID,
            capability="governance_vault",
            expires_at=(datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
            reason="Covering staff onboarding while I'm on leave",
        )

    assert result["status"] == "active"
    log_mock.assert_awaited_once()
    call_kwargs = log_mock.call_args.kwargs
    assert call_kwargs["action_type"] == "access_grant.created"
    assert call_kwargs["organization_id"] == ORG_ID
    assert call_kwargs["user_id"] == MD["id"]
    assert call_kwargs["after_state"]["granted_to_user_id"] == COORDINATOR_ID
    assert call_kwargs["after_state"]["capability"] == "governance_vault"


@pytest.mark.asyncio
async def test_revoke_grant_sets_revoked_fields_and_logs_audit_action():
    mock_supabase = MagicMock()
    existing_grant = {
        "id": "grant-1",
        "organization_id": ORG_ID,
        "granted_to_user_id": COORDINATOR_ID,
        "capability": "governance_vault",
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "revoked_at": None,
    }

    def table_side_effect(name):
        table = MagicMock()
        select_chain = table.select.return_value.eq.return_value.eq.return_value
        select_chain.maybe_single.return_value.execute.return_value = MagicMock(data=existing_grant)
        table.update.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[{**existing_grant, "revoked_at": "now", "revoked_by_user_id": MD["id"]}]
        )
        return table

    mock_supabase.table.side_effect = table_side_effect

    with patch.object(svc, "get_supabase_admin", return_value=mock_supabase), patch.object(
        svc.audit_service, "log_action", new=AsyncMock(return_value=True)
    ) as log_mock:
        result = await svc.revoke_grant(MD, "grant-1")

    assert result["status"] == "revoked"
    assert result["revoked_by_user_id"] == MD["id"]
    log_mock.assert_awaited_once()
    assert log_mock.call_args.kwargs["action_type"] == "access_grant.revoked"


@pytest.mark.asyncio
async def test_revoke_grant_rejects_double_revoke():
    mock_supabase = MagicMock()
    already_revoked = {
        "id": "grant-1",
        "organization_id": ORG_ID,
        "granted_to_user_id": COORDINATOR_ID,
        "capability": "governance_vault",
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "revoked_at": datetime.now(timezone.utc).isoformat(),
    }
    mock_supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data=already_revoked
    )
    with patch.object(svc, "get_supabase_admin", return_value=mock_supabase):
        with pytest.raises(HTTPException) as exc:
            await svc.revoke_grant(MD, "grant-1")
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_list_org_grants_requires_md_role():
    with pytest.raises(HTTPException) as exc:
        await svc.list_org_grants(COORDINATOR)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_list_my_grants_only_returns_active_grants_for_that_coordinator():
    other_coordinator_id = str(uuid.uuid4())
    rows = [
        {  # this coordinator, active
            "id": "g1", "organization_id": ORG_ID, "granted_to_user_id": COORDINATOR_ID,
            "capability": "governance_vault", "revoked_at": None,
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        },
        {  # this coordinator, but expired — must not appear
            "id": "g2", "organization_id": ORG_ID, "granted_to_user_id": COORDINATOR_ID,
            "capability": "executive_dashboard", "revoked_at": None,
            "expires_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
        },
        {  # a different coordinator, active — must not appear
            "id": "g3", "organization_id": ORG_ID, "granted_to_user_id": other_coordinator_id,
            "capability": "governance_vault", "revoked_at": None,
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        },
    ]
    supabase, _table = _fake_supabase(rows)
    with patch.object(svc, "get_supabase_admin", return_value=supabase):
        result = await svc.list_my_grants(COORDINATOR)
    assert [r["id"] for r in result] == ["g1"]
