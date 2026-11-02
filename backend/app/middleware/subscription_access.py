"""Pause changes for an organisation whose CareCliQ subscription has lapsed
past its grace period (services/subscription_access.py).

Only writes are affected (POST/PUT/PATCH/DELETE). Everyone can still sign in,
view and export records. Some writes always stay open: paying, signing in,
security, privacy requests, notifications, error and feedback reports, and
anything that exports records. So do incident reports and complaints, which
an NDIS provider must be able to make whatever its billing state.

Registered inside CORSMiddleware (added before it in main.py) so the 402
reaches the browser with CORS headers and the page can show the message,
and after OrgContextMiddleware, which sets request.state.organisation_id.
"""

from __future__ import annotations

import asyncio

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from ..services import subscription_access

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

ALWAYS_OPEN_PREFIXES: tuple[str, ...] = (
    "/api/auth/",
    "/api/platform-billing/",
    "/api/security/",
    "/api/worker/privacy",
    "/api/worker/notifications",
    "/api/client-errors",
    "/api/bug-reports",
    "/api/improvement-feedback",
    # Safety and safeguarding: never paused.
    "/api/incidents",
    "/api/participant-complaints",
)

READ_ONLY_DETAIL = (
    "Your organisation's CareCliQ subscription has lapsed, so records are read-only for now. "
    "You can still view and export everything, and report incidents. "
    "Your managing director can choose a plan under Settings, Billing."
)


def is_always_open(path: str) -> bool:
    return path.startswith(ALWAYS_OPEN_PREFIXES) or "export" in path


class SubscriptionAccessMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method not in WRITE_METHODS or is_always_open(request.url.path):
            return await call_next(request)
        org_id = getattr(request.state, "organisation_id", None)
        if not org_id:
            return await call_next(request)
        access = await asyncio.to_thread(subscription_access.get_access, org_id)
        if access.state != "read_only":
            return await call_next(request)
        return JSONResponse(
            status_code=402,
            content={"detail": READ_ONLY_DETAIL, "code": "subscription_read_only"},
        )
