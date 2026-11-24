"""Use the visitor's real address as request.client on Fly.io.

Behind Fly's proxy every connection reaches uvicorn from the proxy's
private address (production login records were all 172.16.x.x), so each
per-address limit in the API (login attempts, invite lookups, referrals)
was shared by every user at once: a busy morning could lock everyone
out, and one attacker looked like everyone else.

Fly puts the address it accepted the connection from in Fly-Client-IP,
replacing any value the client sent, so it is trusted only when the app
is running on Fly (FLY_APP_NAME is set). X-Forwarded-For is never used:
its first entry is whatever the client wrote.

Also starts the request's AI usage count under that address (see
services/ai_usage_guard.py); get_current_user switches it to the user.
"""
from __future__ import annotations

import ipaddress
import os

from ..services import ai_usage_guard

_FLY_HEADER = b"fly-client-ip"


def _valid_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return False
    return True


class ClientIPMiddleware:
    def __init__(self, app, trust_fly_header: bool | None = None):
        self.app = app
        self.trust_fly_header = bool(os.environ.get("FLY_APP_NAME")) if trust_fly_header is None else trust_fly_header

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        client = scope.get("client")
        if self.trust_fly_header:
            for name, value in scope.get("headers") or ():
                if name == _FLY_HEADER:
                    ip = value.decode("latin-1").strip()
                    if _valid_ip(ip):
                        scope = dict(scope)
                        client = (ip, client[1] if client else 0)
                        scope["client"] = client
                    break
        ai_usage_guard.set_request_ip(client[0] if client else None)
        await self.app(scope, receive, send)
