"""
Sharing one pending invitation's sign-up link (POST /invitations/{id}/link).

The link is a credential (whoever opens it can set up the invited account),
so it's only handed out to someone who could have sent the invitation, after
a password check, while the invite is still usable, and every hand-out is
audited. It's never part of /list.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.api import invitations

MD = {"sub": "md-1", "role": "managing_director", "organization_id": "org-1"}
COORDINATOR = {"sub": "c-1", "role": "support_coordinator", "organization_id": "org-1"}


def _future(days=3):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def _db(rows):
    db = MagicMock()
    query = db.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value
    query.execute.return_value.data = rows
    return db


def _invite(**overrides):
    return {
        "id": "inv-1", "email": "sam@example.com", "role": "support_worker", "token": "a" * 64,
        "short_code": "AB12CD", "expires_at": _future(), "accepted_at": None, **overrides,
    }


@pytest.fixture
def reauthed():
    with patch.object(invitations, "require_recent_reauth") as guard:
        yield guard


@pytest.fixture
def audit():
    with patch.object(invitations.audit_service, "log_action", AsyncMock()) as log:
        yield log


@pytest.mark.asyncio
async def test_a_coordinator_without_invite_access_cannot_get_a_link(reauthed, audit):
    with patch.object(invitations, "get_supabase_admin", return_value=_db([_invite()])), \
         patch.object(invitations, "has_active_grant", return_value=False):
        with pytest.raises(HTTPException) as exc:
            await invitations.get_invite_link("inv-1", MagicMock(), COORDINATOR)
    assert exc.value.status_code == 403
    audit.assert_not_awaited()


@pytest.mark.asyncio
async def test_the_password_check_is_required(audit):
    request = MagicMock()
    request.headers = {}
    with patch.object(invitations, "get_supabase_admin", return_value=_db([_invite()])):
        with pytest.raises(HTTPException) as exc:
            await invitations.get_invite_link("inv-1", request, MD)
    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "reauth_required"


@pytest.mark.asyncio
async def test_the_director_gets_the_link_and_it_is_audited(reauthed, audit):
    db = _db([_invite()])
    with patch.object(invitations, "get_supabase_admin", return_value=db), \
         patch.object(invitations.settings, "frontend_base_url", "https://app.example.com/"):
        result = await invitations.get_invite_link("inv-1", MagicMock(), MD)

    assert result["invite_url"] == "https://app.example.com/accept-invite?token=" + "a" * 64
    assert result["short_code"] == "AB12CD"
    # Scoped to the director's own organisation.
    eq_calls = db.table.return_value.select.return_value.eq.call_args_list + \
        db.table.return_value.select.return_value.eq.return_value.eq.call_args_list
    assert ("organization_id", "org-1") in [c.args for c in eq_calls]
    audit.assert_awaited_once()
    assert audit.await_args.kwargs["action_type"] == "invitation.link_shared"
    assert audit.await_args.kwargs["entity_id"] == "inv-1"


@pytest.mark.asyncio
async def test_someone_with_temporary_invite_access_can_get_a_link(reauthed, audit):
    with patch.object(invitations, "get_supabase_admin", return_value=_db([_invite()])), \
         patch.object(invitations, "has_active_grant", return_value=True):
        result = await invitations.get_invite_link("inv-1", MagicMock(), COORDINATOR)
    assert result["email"] == "sam@example.com"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "rows, status",
    [
        ([], 404),  # not found, or another organisation's invite
        ([_invite(accepted_at="2026-11-01T00:00:00+00:00")], 410),
        ([_invite(expires_at=(datetime.now(timezone.utc) - timedelta(days=1)).isoformat())], 410),
    ],
)
async def test_unusable_invites_never_give_out_a_link(reauthed, audit, rows, status):
    with patch.object(invitations, "get_supabase_admin", return_value=_db(rows)):
        with pytest.raises(HTTPException) as exc:
            await invitations.get_invite_link("inv-1", MagicMock(), MD)
    assert exc.value.status_code == status
    audit.assert_not_awaited()


@pytest.mark.asyncio
async def test_the_pending_list_never_includes_tokens():
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.order.return_value.execute.return_value.data = []
    with patch.object(invitations, "get_supabase_admin", return_value=db):
        await invitations.list_invites(MD)
    columns = db.table.return_value.select.call_args.args[0]
    assert "token" not in columns
