"""Every way of setting a password applies the same rules as the screens
show (10+ characters, a capital letter, a number), and a refusal from the
auth service reads as a password problem, not "please try again"."""

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.api import invitations
from backend.app.services.password_policy import auth_password_error


def _invite_db():
    db = MagicMock()
    row = {
        "id": "inv-1", "email": "new.coordinator@example.com", "role": "support_coordinator",
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(),
        "accepted_at": None, "organization_id": "org-1", "invited_by": "md-1",
        "onboarding_id": None, "email_verified_at": None,
    }
    db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [row]
    return db


@pytest.mark.parametrize("password", ["short1A", "alllowercase12", "NoNumbersHere"])
def test_accepting_an_invite_refuses_a_weak_password_before_creating_anything(password):
    db = _invite_db()
    with patch.object(invitations, "get_supabase_admin", return_value=db):
        with pytest.raises(HTTPException) as err:
            asyncio.run(invitations.accept_invite("tok", invitations.InviteAcceptRequest(full_name="Sam Lee", password=password)))
    assert err.value.status_code == 422
    db.auth.admin.create_user.assert_not_called()


def test_accepting_an_invite_needs_a_name():
    db = _invite_db()
    with patch.object(invitations, "get_supabase_admin", return_value=db):
        with pytest.raises(HTTPException) as err:
            asyncio.run(invitations.accept_invite("tok", invitations.InviteAcceptRequest(full_name="  ", password="GoodPassword12")))
    assert err.value.status_code == 422
    db.auth.admin.create_user.assert_not_called()


def test_a_password_the_auth_service_refuses_gets_a_clear_reason():
    db = _invite_db()
    db.auth.admin.create_user.side_effect = Exception("Password should contain at least one character of each: abc, ABC, 123")
    with patch.object(invitations, "get_supabase_admin", return_value=db):
        with pytest.raises(HTTPException) as err:
            asyncio.run(invitations.accept_invite("tok", invitations.InviteAcceptRequest(full_name="Sam Lee", password="GoodPassword12")))
    assert err.value.status_code == 422
    assert "strong enough" in err.value.detail


def test_breached_and_unrelated_errors():
    assert "breach" in auth_password_error(Exception("Password is known to be weak and easy to guess (pwned)"))
    assert auth_password_error(Exception("connection reset by peer")) is None
