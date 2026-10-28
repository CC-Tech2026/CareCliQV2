from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from backend.app.middleware.subscription_access import SubscriptionAccessMiddleware, is_always_open
from backend.app.services import subscription_access as svc
from backend.app.services.subscription_access import Access

NOW = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)
BILLED = {"stripe_customer_id": "cus_1", "stripe_subscription_id": "sub_1"}


def test_pilot_and_hand_set_up_orgs_are_never_restricted():
    assert svc.evaluate({"subscription_status": None}, NOW).state == "full"
    assert svc.evaluate({"subscription_status": "canceled", "trial_ends_at": "2026-01-01T00:00:00+00:00"}, NOW).state == "full"


def test_trialing_and_active_are_full():
    assert svc.evaluate({**BILLED, "subscription_status": "trialing"}, NOW).state == "full"
    assert svc.evaluate({**BILLED, "subscription_status": "active"}, NOW).state == "full"


def test_lapsed_within_grace_then_read_only():
    lapsed = (NOW - timedelta(days=3)).isoformat()
    grace = svc.evaluate({**BILLED, "subscription_status": "past_due", "subscription_lapsed_at": lapsed}, NOW)
    assert grace.state == "grace" and grace.grace_ends_at == NOW + timedelta(days=4)
    old = (NOW - timedelta(days=8)).isoformat()
    assert svc.evaluate({**BILLED, "subscription_status": "canceled", "subscription_lapsed_at": old}, NOW).state == "read_only"


def test_falls_back_to_trial_end_then_to_full():
    trial_end = (NOW - timedelta(days=10)).isoformat()
    assert svc.evaluate({**BILLED, "subscription_status": "past_due", "trial_ends_at": trial_end}, NOW).state == "read_only"
    assert svc.evaluate({**BILLED, "subscription_status": "past_due"}, NOW).state == "full"


def test_lapse_stamped_once_and_cleared_on_recovery():
    assert "subscription_lapsed_at" in svc.lapse_update({}, "past_due")
    assert svc.lapse_update({"subscription_lapsed_at": "2026-11-01T00:00:00+00:00"}, "unpaid") == {}
    assert svc.lapse_update({"subscription_lapsed_at": "2026-11-01T00:00:00+00:00"}, "active") == {"subscription_lapsed_at": None}
    assert svc.lapse_update({}, "active") == {}


def test_access_check_failure_allows_rather_than_locks_out():
    svc.forget()
    with patch.object(svc, "_load_org", side_effect=RuntimeError("db down")):
        assert svc.get_access("org-x", use_cache=False).state == "full"


def test_safety_billing_and_exports_always_open():
    for path in ("/api/incidents", "/api/incidents/abc/escalate", "/api/participant-complaints",
                 "/api/platform-billing/checkout", "/api/auth/login", "/api/participants/p1/records-export"):
        assert is_always_open(path), path
    for path in ("/api/sessions", "/api/coordinator/shifts", "/api/billing/invoices"):
        assert not is_always_open(path), path


def _client(state: str) -> TestClient:
    app = FastAPI()
    # Same order as main.py: the access check is added first, so the
    # org-context middleware (added after, like OrgContextMiddleware) runs
    # before it and has set organisation_id.
    app.add_middleware(SubscriptionAccessMiddleware)

    @app.middleware("http")
    async def set_org(request: Request, call_next):
        request.state.organisation_id = "org-1"
        return await call_next(request)

    @app.api_route("/api/sessions", methods=["GET", "POST"])
    async def sessions():
        return {"ok": True}

    @app.post("/api/incidents")
    async def incidents():
        return {"ok": True}

    patcher = patch.object(svc, "get_access", return_value=Access(state))
    patcher.start()
    client = TestClient(app)
    client._patcher = patcher  # stopped by the test
    return client


def test_read_only_blocks_writes_but_not_reads_or_incidents():
    client = _client("read_only")
    try:
        blocked = client.post("/api/sessions")
        assert blocked.status_code == 402 and blocked.json()["code"] == "subscription_read_only"
        assert client.get("/api/sessions").status_code == 200
        assert client.post("/api/incidents").status_code == 200
    finally:
        client._patcher.stop()


def test_grace_allows_writes():
    client = _client("grace")
    try:
        assert client.post("/api/sessions").status_code == 200
    finally:
        client._patcher.stop()
