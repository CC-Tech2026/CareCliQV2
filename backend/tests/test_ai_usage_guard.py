"""AI usage limits: a loop on an AI endpoint must stop well short of
thousands of model calls, per user, per organisation and per address."""
from __future__ import annotations

import asyncio
import contextvars

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from backend.app.middleware.client_ip import ClientIPMiddleware
from backend.app.services import ai_usage_guard as guard


@pytest.fixture(autouse=True)
def _fresh_counts(monkeypatch):
    guard.reset_for_tests()
    for name in (
        "AI_USER_CALLS_PER_MINUTE", "AI_USER_CALLS_PER_DAY", "AI_ORG_CALLS_PER_DAY",
        "AI_IP_CALLS_PER_MINUTE", "AI_IP_CALLS_PER_DAY", "AI_GLOBAL_CALLS_PER_MINUTE",
    ):
        monkeypatch.delenv(name, raising=False)
    yield
    guard.reset_for_tests()


def _in_context(fn):
    """Run fn in a fresh context, as each request does."""
    return contextvars.copy_context().run(fn)


def test_signed_in_user_is_stopped_after_the_per_minute_limit(monkeypatch):
    monkeypatch.setenv("AI_USER_CALLS_PER_MINUTE", "5")

    def run():
        guard.set_request_user("user-1", "org-1")
        for _ in range(5):
            guard.consume_ai_call("openai")
        with pytest.raises(guard.AIRateLimitExceeded) as exc:
            guard.consume_ai_call("openai")
        return exc.value

    err = _in_context(run)
    assert err.status_code == 429
    assert 1 <= int(err.headers["Retry-After"]) <= 60


def test_one_users_limit_does_not_block_another(monkeypatch):
    monkeypatch.setenv("AI_USER_CALLS_PER_MINUTE", "2")

    def user(uid):
        def run():
            guard.set_request_user(uid, "org-1")
            guard.consume_ai_call()
            guard.consume_ai_call()
        return run

    _in_context(user("a"))
    _in_context(user("b"))  # would raise if the count were shared


def test_organisation_daily_cap_spans_its_users(monkeypatch):
    monkeypatch.setenv("AI_ORG_CALLS_PER_DAY", "3")

    def call(uid):
        def run():
            guard.set_request_user(uid, "org-9")
            guard.consume_ai_call()
        return run

    for uid in ("a", "b", "c"):
        _in_context(call(uid))
    with pytest.raises(guard.AIRateLimitExceeded):
        _in_context(call("d"))


def test_anonymous_address_has_a_tight_limit(monkeypatch):
    monkeypatch.setenv("AI_IP_CALLS_PER_MINUTE", "3")

    def run():
        guard.set_request_ip("203.0.113.7")
        for _ in range(3):
            guard.consume_ai_call()
        with pytest.raises(guard.AIRateLimitExceeded):
            guard.consume_ai_call()

    _in_context(run)


def test_background_work_only_counts_toward_global_cap(monkeypatch):
    monkeypatch.setenv("AI_GLOBAL_CALLS_PER_MINUTE", "4")
    monkeypatch.setenv("AI_USER_CALLS_PER_MINUTE", "1")

    def run():
        for _ in range(4):
            guard.consume_ai_call()  # no actor: scheduler work
        with pytest.raises(guard.AIRateLimitExceeded):
            guard.consume_ai_call()

    _in_context(run)


def test_blocked_calls_are_not_counted():
    counter = guard._Counter()
    checks = [("k", 2, 60.0)]
    assert counter.check(checks, now=0.0) is None
    assert counter.check(checks, now=1.0) is None
    assert counter.check(checks, now=2.0) == pytest.approx(58.0)
    assert counter.check(checks, now=3.0) == pytest.approx(57.0)
    # The window slides: the first hit expires at 60s.
    assert counter.check(checks, now=60.5) is None


def test_a_full_window_records_nothing_on_the_others():
    counter = guard._Counter()
    counter.check([("full", 1, 60.0)], now=0.0)
    assert counter.check([("open", 5, 60.0), ("full", 1, 60.0)], now=1.0) is not None
    assert len(counter._hits["open"]) == 0


def test_metered_openai_client_checks_before_sending(monkeypatch):
    from openai import OpenAI

    sent = []
    monkeypatch.setattr(OpenAI, "request", lambda self, *a, **k: sent.append(a) or "ok")
    monkeypatch.setenv("AI_USER_CALLS_PER_MINUTE", "2")

    def run():
        guard.set_request_user("user-1", "org-1")
        client = guard.metered_openai(api_key="sk-test")
        assert client.request("cast", "options") == "ok"
        # Copies made with with_options() stay metered.
        assert client.with_options(timeout=5).request("cast", "options") == "ok"
        with pytest.raises(guard.AIRateLimitExceeded):
            client.request("cast", "options")

    _in_context(run)
    assert len(sent) == 2


def test_metered_anthropic_client_checks_before_sending(monkeypatch):
    import anthropic

    monkeypatch.setattr(anthropic.Anthropic, "request", lambda self, *a, **k: "ok")
    monkeypatch.setenv("AI_USER_CALLS_PER_MINUTE", "1")

    def run():
        guard.set_request_user("user-1", "org-1")
        client = guard.metered_anthropic(api_key="sk-ant-test")
        assert client.request("cast", "options") == "ok"
        with pytest.raises(guard.AIRateLimitExceeded):
            client.request("cast", "options")

    _in_context(run)


def test_ai_service_builds_metered_clients():
    from backend.app.services import ai_service

    assert type(ai_service.client).__name__ == "MeteredOpenAI"
    assert type(ai_service._build_openai_client()).__name__ == "MeteredOpenAI"


def _app_with_route(per_minute=3, per_day=100):
    from backend.app.core.security import create_access_token, get_current_user

    app = FastAPI()
    app.add_middleware(ClientIPMiddleware, trust_fly_header=False)

    @app.post(
        "/ai/thing",
        dependencies=[Depends(get_current_user), Depends(guard.limit_ai_requests("test-ai", per_minute, per_day))],
    )
    async def thing():
        return {"ok": True}

    def token(uid):
        return create_access_token({"sub": uid, "role": "support_coordinator", "organization_id": "org-1"})

    return app, token


def test_route_limit_answers_429_with_retry_after_per_user():
    app, token = _app_with_route(per_minute=3)
    client = TestClient(app)
    alice = {"Authorization": f"Bearer {token('alice')}"}
    bob = {"Authorization": f"Bearer {token('bob')}"}

    codes = [client.post("/ai/thing", headers=alice).status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]
    last = client.post("/ai/thing", headers=alice)
    assert "Retry-After" in last.headers
    assert "limit" in last.json()["detail"]
    # Bob has his own allowance.
    assert client.post("/ai/thing", headers=bob).status_code == 200


def test_route_limit_can_be_raised_from_the_environment(monkeypatch):
    monkeypatch.setenv("AI_ROUTE_TEST_AI_PER_MINUTE", "6")
    app, token = _app_with_route(per_minute=3)
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {token('carol')}"}
    codes = [client.post("/ai/thing", headers=headers).status_code for _ in range(7)]
    assert codes.count(200) == 6


def test_get_current_user_switches_the_count_to_the_user():
    from backend.app.core.security import create_access_token, get_current_user
    from fastapi.security import HTTPAuthorizationCredentials
    from starlette.requests import Request

    tok = create_access_token({"sub": "dave", "role": "support_worker", "organization_id": "org-3"})
    request = Request({"type": "http", "method": "GET", "path": "/api/x", "headers": [], "query_string": b""})

    async def run():
        guard.set_request_ip("198.51.100.1")
        await get_current_user(request, HTTPAuthorizationCredentials(scheme="Bearer", credentials=tok))
        return guard.current_actor()

    actor = contextvars.copy_context().run(asyncio.run, run())
    assert actor == guard.Actor("user", "dave", "org-3")


def test_gemini_translation_is_metered(monkeypatch):
    from unittest.mock import patch

    from backend.app.services import onshore_translation

    monkeypatch.setenv("AI_USER_CALLS_PER_MINUTE", "1")
    sent = []

    def run():
        guard.set_request_user("user-1", "org-1")
        with patch.object(onshore_translation, "configuration_problem", return_value=None), \
             patch.object(onshore_translation, "_access_token", side_effect=lambda: sent.append(1) or "tok"), \
             patch.object(onshore_translation.urllib.request, "urlopen", side_effect=RuntimeError("stop")):
            with pytest.raises(Exception) as first:
                onshore_translation.translate_sync("hola")
            assert not isinstance(first.value, guard.AIRateLimitExceeded)
            with pytest.raises(guard.AIRateLimitExceeded):
                onshore_translation.translate_sync("hola")

    _in_context(run)
    assert len(sent) == 1  # the second call never reached Google
