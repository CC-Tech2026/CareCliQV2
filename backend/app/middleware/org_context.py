"""CCQ-104 — Organisation context middleware.

Decodes the Bearer JWT on every request and attaches
request.state.organisation_id for use in route handlers and services.

Also binds the caller's branch timezone for the request (core.timezone.
request_timezone) so "today", day boundaries and displayed times follow
the office the user works from — see 198_branches.sql.

For requests that reach a *protected* path without a valid org claim this
middleware returns HTTP 403 immediately, so no handler code runs.

Public paths (auth, health, invite validation) are exempt.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Callable, Optional, Set
from zoneinfo import ZoneInfo

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.types import ASGIApp

from ..core.security import decode_access_token
from ..core.timezone import reset_request_timezone, set_request_timezone, user_timezone

logger = logging.getLogger(__name__)

# Paths that do NOT require an org context.
# Prefix-matched: any path starting with one of these strings is exempt.
#
# "/api/admin" is here for a different reason than the rest — it's not
# public, it's CareCliQ's own vendor-side Super Admin surface (see
# backend/app/api/admin.py), used only by the super_admin role, which is
# deliberately not scoped to any organization at all. Every endpoint under
# that prefix enforces its own is_super_admin() check independently (see
# admin.py's _require_super_admin), so exempting it here doesn't weaken
# tenant isolation for any provider-facing route — it just lets a
# legitimately org-less role reach the one surface built for it, instead
# of being rejected before its own auth check ever runs.
_PUBLIC_PREFIXES: tuple[str, ...] = (
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/logout",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/api/auth/me",
    "/api/auth/refresh",
    "/api/auth/verify-email",
    "/api/invitations/validate/",
    "/api/invitations/lookup/",
    "/api/invitations/request-invite",
    "/api/invitations/organizations",
    "/api/invitations/accept/",
    "/api/health",
    "/api/admin",
    # Jira calls this one directly (Automation "Send web request"), with no
    # JWT at all — it authenticates with its own shared-secret header
    # instead (see jira_webhook.py), checked independently of org context.
    "/api/webhooks/jira",
    "/docs",
    "/openapi.json",
    "/redoc",
)


def _is_public(path: str) -> bool:
    # Root "/" is exact-match only — prefix-matching "/" would bypass everything.
    return path == "/" or any(path.startswith(prefix) for prefix in _PUBLIC_PREFIXES)


class OrgContextMiddleware(BaseHTTPMiddleware):
    """Attach ``request.state.organisation_id`` from the JWT on every request.

    For authenticated requests that lack an ``organization_id`` claim the
    middleware returns 403 before any route handler runs.  Public routes are
    always exempt.
    """

    def __init__(
        self,
        app: ASGIApp,
        _decode_fn=None,
        _timezone_fn: Optional[Callable[[str, str], ZoneInfo]] = None,
    ) -> None:
        super().__init__(app)
        # _decode_fn / _timezone_fn: injectable for tests; production always
        # uses the real decoder and the cached branch lookup.
        self._decode_fn = _decode_fn if _decode_fn is not None else decode_access_token
        self._timezone_fn = _timezone_fn if _timezone_fn is not None else user_timezone

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path

        if _is_public(path):
            request.state.organisation_id = None
            return await call_next(request)

        auth_header = request.headers.get("authorization", "")
        token = auth_header.removeprefix("Bearer ").strip() if auth_header.startswith("Bearer ") else None

        if not token:
            # No token — the route-level dependency (get_current_user) will
            # raise 401.  We don't duplicate that here.
            request.state.organisation_id = None
            return await call_next(request)

        payload = self._decode_fn(token)
        if payload is None:
            # Invalid / expired token — get_current_user will handle 401.
            request.state.organisation_id = None
            return await call_next(request)

        org_id: str | None = (
            payload.get("organization_id")
            or payload.get("organisation_id")
            or (payload.get("app_metadata") or {}).get("organisation_id")
        )

        if org_id:
            request.state.organisation_id = str(org_id)
            return await self._call_with_timezone(request, call_next, str(org_id), payload.get("sub"))

        # Authenticated user with no org — reject with 403.
        logger.warning(
            "CCQ-104: request to %s rejected — JWT has no organisation_id claim (sub=%s)",
            path,
            payload.get("sub", "unknown"),
        )
        return JSONResponse(
            status_code=403,
            content={"detail": "No organisation context — complete onboarding or contact your administrator."},
        )

    async def _call_with_timezone(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
        org_id: str,
        user_id: Optional[str],
    ) -> Response:
        """Run the request with the caller's branch zone bound in context.

        The lookup is cached per user (core.timezone), so the thread hop is
        only paid on a cache miss. Any failure falls back to APP_TIMEZONE
        inside user_timezone — a timezone hiccup must never fail a request.
        """
        tz = await asyncio.to_thread(self._timezone_fn, str(user_id or ""), org_id)
        request.state.timezone = tz
        token = set_request_timezone(tz)
        try:
            return await call_next(request)
        finally:
            reset_request_timezone(token)
