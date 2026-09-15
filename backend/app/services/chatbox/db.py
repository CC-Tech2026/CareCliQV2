"""Per-request, read-only database client for Quill's tools.

Every other part of the backend talks to Supabase with the service-role key,
which bypasses RLS. Quill is the one place where an LLM decides which query
runs, so its tools instead use a dedicated Postgres role (``quill_agent`` —
see supabase/migrations/197_quill_agent_role.sql) that can only SELECT from
an explicit allow-list of tables/columns, filtered by RLS to the organisation
carried in the token.

The backend proves its identity to PostgREST by minting a short-lived JWT
signed with the project's JWT secret (``SUPABASE_JWT_SECRET``) — the same
mechanism behind the anon/service keys, just with our own role and claims.
PostgREST reads the ``role`` claim to ``SET ROLE quill_agent`` and exposes
the rest via ``request.jwt.claims`` for the RLS policies.

Fails closed: if the secret is missing, tools error rather than silently
falling back to the service role.
"""

import time

from jose import jwt
from postgrest import SyncPostgrestClient

from ...core.access import get_user_id, get_user_organization_id
from ...core.config import settings

QUILL_DB_ROLE = "quill_agent"
TOKEN_TTL_SECONDS = 60


class QuillDbNotConfigured(RuntimeError):
    """SUPABASE_JWT_SECRET is unset — refuse to run Quill on the service role."""


def mint_quill_token(current_user: dict, *, now: float | None = None) -> str:
    """Sign a 60-second JWT that PostgREST will run as ``quill_agent``.

    Claims are taken from the authenticated user, never from tool arguments,
    so the LLM has no way to point a query at a different organisation.
    """
    if not settings.supabase_jwt_secret:
        raise QuillDbNotConfigured(
            "SUPABASE_JWT_SECRET is not set — Quill will not fall back to the service role"
        )
    org_id = get_user_organization_id(current_user)
    user_id = get_user_id(current_user)
    if not org_id or not user_id:
        raise ValueError("Cannot mint a Quill token without an organisation and user id")

    issued_at = int(now if now is not None else time.time())
    return jwt.encode(
        {
            "role": QUILL_DB_ROLE,
            "org_id": str(org_id),
            "user_id": str(user_id),
            "app_role": current_user.get("role"),
            "iss": "carecliq-backend",
            "iat": issued_at,
            "exp": issued_at + TOKEN_TTL_SECONDS,
        },
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )


def quill_client(current_user: dict) -> SyncPostgrestClient:
    """A fresh PostgREST client scoped to *current_user* as ``quill_agent``.

    Built per call rather than cached: the bearer token is per-user, and
    postgrest's ``auth()`` mutates client headers, so sharing one instance
    across concurrent requests would leak one user's token to another.
    Exposes the same ``.table()`` / ``.rpc()`` surface the existing helpers
    (get_coordinator_team_ids, _execute_shift_query_with_legacy_fallback)
    already accept.
    """
    token = mint_quill_token(current_user)
    return SyncPostgrestClient(
        f"{settings.supabase_url.rstrip('/')}/rest/v1",
        schema="public",
        headers={
            "apikey": settings.supabase_anon_key,   # gateway key; role comes from the bearer
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
