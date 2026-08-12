"""Baseline security response headers — flagged missing in SECURITY_AUDIT_SESSION_1.md and
never actually added. This is a JSON API (the frontend is a separate static-hosted service),
so the default CSP is maximally strict; /docs, /redoc, /openapi.json are exempted from CSP
only, since FastAPI's built-in Swagger/ReDoc UIs load their JS/CSS from a CDN.
"""

from __future__ import annotations

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

_DOCS_PREFIXES: tuple[str, ...] = ("/docs", "/redoc", "/openapi.json")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if not request.url.path.startswith(_DOCS_PREFIXES):
            response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        return response
