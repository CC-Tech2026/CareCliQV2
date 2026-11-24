"""Request-level protections from the 2026-11-24 security review: oversized
uploads, per-sign-in Supabase clients, and signed-out tokens."""
from __future__ import annotations

import inspect
from unittest.mock import patch

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.testclient import TestClient

from backend.app.middleware.body_limit import BodySizeLimitMiddleware


def _upload_app(limit: int) -> TestClient:
    app = FastAPI()
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=limit)

    @app.post("/upload")
    async def upload(file: UploadFile = File(...)):
        return {"size": len(await file.read())}

    @app.post("/raw")
    async def raw(request: Request):
        return {"size": len(await request.body())}

    return TestClient(app)


def test_declared_oversized_upload_is_refused_before_reading():
    client = _upload_app(limit=1000)
    res = client.post("/upload", files={"file": ("a.bin", b"x" * 5000)})
    assert res.status_code == 413
    assert "too large" in res.json()["detail"]


def test_upload_under_the_limit_goes_through():
    client = _upload_app(limit=10_000)
    res = client.post("/upload", files={"file": ("a.bin", b"x" * 500)})
    assert res.status_code == 200
    assert res.json() == {"size": 500}


def test_body_without_length_is_cut_off_at_the_limit():
    client = _upload_app(limit=1000)

    def chunks():
        for _ in range(10):
            yield b"y" * 500

    res = client.post("/raw", content=chunks())
    assert res.status_code in (400, 413)


def test_main_app_limits_body_size():
    from backend.app.main import app

    assert any(m.cls is BodySizeLimitMiddleware for m in app.user_middleware)


def test_each_sign_in_gets_its_own_supabase_client():
    from backend.app.services import supabase_client

    with patch.object(supabase_client, "_ensure_supabase_region"):
        a = supabase_client.new_auth_client()
        b = supabase_client.new_auth_client()
    assert a is not b


def test_login_reads_mfa_level_from_its_own_client():
    # The MFA level and factors must come from the client the password was
    # checked on, never the shared one (another user's session could be on it).
    from backend.app.api import auth

    src = inspect.getsource(auth.login)
    assert "supabase = new_auth_client()" in src
    assert "supabase.auth.mfa.get_authenticator_assurance_level" in src
    assert "supabase.auth.mfa.list_factors" in src
    assert "get_supabase()" not in src


def test_no_sign_in_on_the_shared_client():
    import pathlib

    api = pathlib.Path(__file__).resolve().parents[1] / "app" / "api"
    offenders = [
        p.name for p in api.glob("*.py")
        if "get_supabase().auth" in p.read_text(encoding="utf-8")
    ]
    assert not offenders, offenders


def test_optional_user_treats_signed_out_token_as_anonymous():
    import asyncio

    from fastapi.security import HTTPAuthorizationCredentials
    from starlette.requests import Request as StarletteRequest

    from backend.app.core.security import create_access_token, get_optional_user
    from backend.app.services import device_security_service as dss

    tok = create_access_token({"sub": "u1", "role": "support_worker", "jti": "j1"})
    req = StarletteRequest({"type": "http", "method": "GET", "path": "/api/x", "headers": [], "query_string": b""})
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=tok)
    with patch.object(dss, "is_session_active", return_value=False):
        assert asyncio.run(get_optional_user(req, creds)) is None
    with patch.object(dss, "is_session_active", return_value=True):
        assert asyncio.run(get_optional_user(req, creds))["sub"] == "u1"


def test_session_check_does_not_hold_up_other_requests():
    # A slow session lookup must run off the event loop, so other requests
    # (here a 10 ms timer) keep moving while it waits.
    import asyncio
    import time

    from fastapi.security import HTTPAuthorizationCredentials
    from starlette.requests import Request as StarletteRequest

    from backend.app.core.security import create_access_token, get_current_user
    from backend.app.services import device_security_service as dss

    tok = create_access_token({"sub": "u1", "role": "support_worker", "jti": "j1"})
    req = StarletteRequest({"type": "http", "method": "GET", "path": "/api/x", "headers": [], "query_string": b""})
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=tok)

    def slow_lookup(_jti):
        time.sleep(0.3)
        return True

    async def run():
        ticks = 0

        async def other_request():
            nonlocal ticks
            for _ in range(10):
                await asyncio.sleep(0.01)
                ticks += 1

        await asyncio.gather(get_current_user(req, creds), other_request())
        return ticks

    with patch.object(dss, "is_session_active", side_effect=slow_lookup):
        start = time.monotonic()
        ticks = asyncio.run(run())
    assert ticks == 10
    assert time.monotonic() - start < 0.6  # ran side by side, not one after the other
