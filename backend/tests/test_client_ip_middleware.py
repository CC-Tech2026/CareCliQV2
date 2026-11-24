"""Per-address limits need the visitor's real address, not Fly's proxy."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from backend.app.middleware.client_ip import ClientIPMiddleware
from backend.app.services import ai_usage_guard


def _client(trust: bool) -> TestClient:
    app = FastAPI()
    app.add_middleware(ClientIPMiddleware, trust_fly_header=trust)

    @app.get("/ip")
    async def ip(request: Request):
        actor = ai_usage_guard.current_actor()
        return {"client": request.client.host, "actor": actor.key if actor else None}

    return TestClient(app)


def test_uses_fly_client_ip_on_fly():
    body = _client(True).get("/ip", headers={"Fly-Client-IP": "203.0.113.9"}).json()
    assert body == {"client": "203.0.113.9", "actor": "203.0.113.9"}


def test_ignores_fly_header_off_fly():
    body = _client(False).get("/ip", headers={"Fly-Client-IP": "203.0.113.9"}).json()
    assert body["client"] != "203.0.113.9"


def test_never_trusts_x_forwarded_for():
    body = _client(True).get("/ip", headers={"X-Forwarded-For": "203.0.113.50"}).json()
    assert body["client"] != "203.0.113.50"


def test_ignores_a_malformed_header():
    body = _client(True).get("/ip", headers={"Fly-Client-IP": "not-an-ip"}).json()
    assert body["client"] != "not-an-ip"


def test_main_app_installs_the_middleware():
    from backend.app.main import app

    assert any(m.cls is ClientIPMiddleware for m in app.user_middleware)
    # Outermost, so every other middleware and route sees the real address.
    assert app.user_middleware[0].cls is ClientIPMiddleware
