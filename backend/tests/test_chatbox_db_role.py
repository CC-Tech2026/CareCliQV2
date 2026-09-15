"""
Chatbox ("Quill") — the read-only ``quill_agent`` database identity.

Quill's tools used to run on the service-role key, which bypasses RLS, so
the Python scope checks were the only boundary. db.py now mints a per-request
JWT for a dedicated Postgres role (migration 197) with SELECT-only grants
and org-scoped RLS policies. These tests pin down the token contract and
make sure tools.py can't quietly drift back to the service role.

What can't be unit-tested here: that Postgres actually denies a
non-granted table or filters rows by org. That needs a live database —
see the verification block at the bottom of 197_quill_agent_role.sql.
"""
from __future__ import annotations

import inspect
import time
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from jose import jwt

from backend.app.services.chatbox import db as chatbox_db
from backend.app.services.chatbox import tools as chatbox_tools

SECRET = "test-jwt-secret-" + "x" * 40


def _user(role: str = "support_coordinator", org_id: str | None = None, user_id: str | None = None) -> dict:
    return {
        "id": user_id or str(uuid.uuid4()),
        "role": role,
        "organization_id": org_id or str(uuid.uuid4()),
    }


# ── Token contract ──────────────────────────────────────────────────────


def test_token_carries_role_org_and_user_from_the_authenticated_user():
    user = _user()
    with patch.object(chatbox_db.settings, "supabase_jwt_secret", SECRET):
        token = chatbox_db.mint_quill_token(user, now=1_000_000)

    claims = jwt.decode(token, SECRET, algorithms=["HS256"], options={"verify_exp": False})
    assert claims["role"] == "quill_agent"
    assert claims["org_id"] == user["organization_id"]
    assert claims["user_id"] == user["id"]
    assert claims["app_role"] == "support_coordinator"


def test_token_is_short_lived():
    with patch.object(chatbox_db.settings, "supabase_jwt_secret", SECRET):
        token = chatbox_db.mint_quill_token(_user(), now=1_000_000)
    claims = jwt.decode(token, SECRET, algorithms=["HS256"], options={"verify_exp": False})
    assert claims["exp"] - claims["iat"] == chatbox_db.TOKEN_TTL_SECONDS
    assert chatbox_db.TOKEN_TTL_SECONDS <= 300, "Quill tokens must stay short-lived"


def test_token_is_rejected_when_signed_with_the_wrong_secret():
    with patch.object(chatbox_db.settings, "supabase_jwt_secret", SECRET):
        token = chatbox_db.mint_quill_token(_user())
    with pytest.raises(jwt.JWTError):
        jwt.decode(token, "some-other-secret", algorithms=["HS256"])


def test_refuses_to_mint_without_secret_instead_of_falling_back():
    with patch.object(chatbox_db.settings, "supabase_jwt_secret", ""):
        with pytest.raises(chatbox_db.QuillDbNotConfigured):
            chatbox_db.mint_quill_token(_user())


def test_refuses_to_mint_without_an_org():
    with patch.object(chatbox_db.settings, "supabase_jwt_secret", SECRET):
        with pytest.raises(ValueError):
            chatbox_db.mint_quill_token({"id": str(uuid.uuid4()), "role": "managing_director"})


# ── Client wiring ───────────────────────────────────────────────────────


def test_client_sends_the_quill_token_as_bearer_and_anon_key_as_apikey():
    user = _user()
    with patch.object(chatbox_db.settings, "supabase_jwt_secret", SECRET), \
         patch.object(chatbox_db.settings, "supabase_url", "https://example.supabase.co/"), \
         patch.object(chatbox_db.settings, "supabase_anon_key", "anon-key"):
        client = chatbox_db.quill_client(user)

    headers = client.session.headers
    assert headers["apikey"] == "anon-key"
    bearer = headers["Authorization"].removeprefix("Bearer ")
    claims = jwt.decode(bearer, SECRET, algorithms=["HS256"])
    assert claims["role"] == "quill_agent"
    assert claims["org_id"] == user["organization_id"]
    assert str(client.session.base_url).rstrip("/") == "https://example.supabase.co/rest/v1"


def test_each_call_builds_a_fresh_client_so_tokens_never_cross_users():
    a, b = _user(), _user()
    with patch.object(chatbox_db.settings, "supabase_jwt_secret", SECRET), \
         patch.object(chatbox_db.settings, "supabase_url", "https://example.supabase.co"), \
         patch.object(chatbox_db.settings, "supabase_anon_key", "anon-key"):
        client_a = chatbox_db.quill_client(a)
        client_b = chatbox_db.quill_client(b)

    assert client_a is not client_b
    org_a = jwt.decode(client_a.session.headers["Authorization"].removeprefix("Bearer "), SECRET, algorithms=["HS256"])["org_id"]
    org_b = jwt.decode(client_b.session.headers["Authorization"].removeprefix("Bearer "), SECRET, algorithms=["HS256"])["org_id"]
    assert org_a == a["organization_id"]
    assert org_b == b["organization_id"]


# ── tools.py must stay on the scoped client ─────────────────────────────


def test_tools_module_never_touches_the_service_role_client():
    source = inspect.getsource(chatbox_tools)
    assert "get_supabase_admin" not in source, (
        "tools.py must query through db.quill_client(current_user), never the service-role client"
    )


@pytest.mark.asyncio
async def test_tool_query_runs_as_the_calling_user():
    """The scoped client is built from the *authenticated* user captured in
    the closure — not from anything the LLM passes in."""
    md = _user("managing_director")
    mock_result = MagicMock(count=4, data=[{"is_active": True}] * 4)
    mock_supabase = MagicMock()
    mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = mock_result

    with patch.object(chatbox_tools, "audit_service") as mock_audit, \
         patch.object(chatbox_tools, "quill_client", return_value=mock_supabase) as mock_client:
        mock_audit.log_action = AsyncMock()
        tools = chatbox_tools.build_tools_for_user(md, "thread-1")
        tool = next(t for t in tools if t.name == "get_retention_rate")
        await tool.coroutine()

    mock_client.assert_called_once_with(md)


@pytest.mark.asyncio
async def test_missing_secret_surfaces_as_a_tool_error_not_service_role_data():
    md = _user("managing_director")
    with patch.object(chatbox_tools, "audit_service") as mock_audit, \
         patch.object(chatbox_db.settings, "supabase_jwt_secret", ""):
        mock_audit.log_action = AsyncMock()
        tools = chatbox_tools.build_tools_for_user(md, "thread-1")
        tool = next(t for t in tools if t.name == "get_retention_rate")
        with pytest.raises(chatbox_db.QuillDbNotConfigured):
            await tool.coroutine()
