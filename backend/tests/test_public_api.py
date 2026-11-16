"""The CareCliQ API for other systems (CORA Workforce and the like): keys
are shown once and stored as fingerprints, a key only ever reads its own
organisation, and webhooks are signed, retried and kept off private networks."""
from __future__ import annotations

import hashlib
import hmac
import json
from datetime import date, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app.services import public_api_service as api
from backend.app.services import webhook_service as wh

ORG, OTHER = "org-1", "org-2"
DIRECTOR = {"id": "md-1", "organization_id": ORG, "role": "managing_director"}
COORDINATOR = {"id": "c-1", "organization_id": ORG, "role": "support_coordinator"}


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], "select", None

    def select(self, *_a, **_k):
        return self

    def eq(self, key, value):
        self.filters.append(lambda r: str(r.get(key)) == str(value))
        return self

    def in_(self, key, values):
        values = {str(v) for v in values}
        self.filters.append(lambda r: str(r.get(key)) in values)
        return self

    def lte(self, key, value):
        self.filters.append(lambda r: str(r.get(key)) <= str(value))
        return self

    def limit(self, *_a):
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def delete(self):
        self.op = "delete"
        return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.op == "insert":
            row = {"id": f"{self.table}-{len(rows) + 1}", **self.payload}
            rows.append(row)
            return MagicMock(data=[row])
        hit = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in hit:
                r.update(self.payload)
        if self.op == "delete":
            self.db.tables[self.table] = [r for r in rows if r not in hit]
        return MagicMock(data=hit)


class _DB:
    def __init__(self, **tables):
        self.tables = {k: [dict(r) for r in v] for k, v in tables.items()}

    def table(self, name):
        return _Query(self, name)


def _request(key: str | None = None, header: str = "authorization"):
    req = MagicMock()
    value = (f"Bearer {key}" if header == "authorization" else key) if key else ""
    req.headers = {header: value} if key else {}
    return req


MEMBERS = [
    {"user_id": "w-1", "organization_id": ORG, "role": "support_worker", "is_active": True, "employee_id": "SW001"},
    {"user_id": "w-2", "organization_id": ORG, "role": "support_worker", "is_active": False, "employee_id": "SW002"},
    {"user_id": "p-1", "organization_id": ORG, "role": "participant", "is_active": True},
    {"user_id": "x-1", "organization_id": OTHER, "role": "support_worker", "is_active": True},
]
USERS = [
    {"id": "w-1", "full_name": "Aisha Rahman", "email": "aisha@example.com", "is_active": True},
    {"id": "w-2", "full_name": "Tom Walsh", "email": "tom@example.com", "is_active": False, "deactivated_at": "2026-11-01"},
    {"id": "p-1", "full_name": "Liam Carter", "is_active": True},
    {"id": "x-1", "full_name": "Someone Else", "is_active": True},
]
CREDENTIALS = [
    {"id": "c-1", "user_id": "w-1", "organization_id": ORG, "credential_type": "first_aid", "status": "valid",
     "expiry_date": (date.today() - timedelta(days=1)).isoformat(), "file_path": "private/c-1.pdf",
     "verified_at": "2026-10-01T00:00:00Z", "updated_at": "2026-11-10T00:00:00Z"},
    {"id": "c-2", "user_id": "w-1", "organization_id": ORG, "credential_type": "ndis_screening", "status": "valid",
     "expiry_date": "2030-01-01", "updated_at": "2026-11-15T00:00:00Z"},
    {"id": "c-3", "user_id": "x-1", "organization_id": OTHER, "credential_type": "wwcc", "status": "valid"},
]


# ---------------------------------------------------------------------------
# Keys
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_key_is_shown_once_and_only_its_fingerprint_is_kept():
    db = _DB(api_keys=[])
    with patch.object(api, "get_supabase_admin", return_value=db), \
         patch.object(api.audit_service, "log_action", AsyncMock()):
        made = await api.create_key(DIRECTOR, "CORA Workforce")
    raw = made["key"]
    assert raw.startswith("cc_live_") and len(raw) > 40
    stored = db.tables["api_keys"][0]
    assert stored["key_hash"] == hashlib.sha256(raw.encode()).hexdigest()
    assert raw not in json.dumps(stored)
    assert stored["key_prefix"] == raw[:16] and made["prefix"] == raw[:16]
    with patch.object(api, "get_supabase_admin", return_value=db):
        assert all("key" not in k and "key_hash" not in k for k in api.list_keys(DIRECTOR))


@pytest.mark.asyncio
async def test_only_a_director_manages_keys():
    with pytest.raises(HTTPException) as exc:
        await api.create_key(COORDINATOR, "CORA")
    assert exc.value.status_code == 403


def test_a_key_is_checked_for_validity_revocation_and_permission():
    raw = "cc_live_" + "a" * 40
    good = {"id": "k-1", "organization_id": ORG, "key_hash": api.hash_key(raw), "scopes": ["workers:read"], "last_used_at": None}
    db = _DB(api_keys=[good])
    with patch.object(api, "get_supabase_admin", return_value=db):
        for request in (_request(None), _request("not-a-key"), _request("cc_live_" + "b" * 40)):
            with pytest.raises(HTTPException) as exc:
                api.authenticate(request, "workers:read")
            assert exc.value.status_code == 401
        with pytest.raises(HTTPException) as exc:
            api.authenticate(_request(raw), "credentials:read")
        assert exc.value.status_code == 403
        key = api.authenticate(_request(raw, header="x-api-key"), "workers:read")
        assert key["organization_id"] == ORG
        assert db.tables["api_keys"][0]["last_used_at"]  # noted
        db.tables["api_keys"][0]["revoked_at"] = "2026-11-16T00:00:00Z"
        with pytest.raises(HTTPException) as exc:
            api.authenticate(_request(raw), "workers:read")
        assert exc.value.status_code == 401


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

def test_workers_are_staff_of_this_organisation_only():
    db = _DB(organization_members=MEMBERS, users=USERS)
    with patch.object(api, "get_supabase_admin", return_value=db):
        active = api.list_workers(ORG)
        everyone = api.list_workers(ORG, status="all", limit=1)
    assert [w["full_name"] for w in active["data"]] == ["Aisha Rahman"]
    assert active["data"][0]["employee_id"] == "SW001" and active["data"][0]["active"] is True
    assert everyone["total"] == 2 and everyone["has_more"] is True and everyone["next_offset"] == 1
    with patch.object(api, "get_supabase_admin", return_value=db):
        names = {w["full_name"] for w in api.list_workers(ORG, status="all")["data"]}
    # Participants aren't workers, and other organisations' staff never appear.
    assert names == {"Aisha Rahman", "Tom Walsh"}


def test_credentials_stay_in_their_organisation_and_documents_stay_private():
    db = _DB(credentials=CREDENTIALS)
    with patch.object(api, "get_supabase_admin", return_value=db):
        page = api.list_credentials(ORG)
        recent = api.list_credentials(ORG, updated_since=datetime.fromisoformat("2026-11-12T00:00:00+00:00"))
    ids = [c["id"] for c in page["data"]]
    assert ids == ["c-1", "c-2"]
    first = page["data"][0]
    assert first["expired"] is True and first["verified"] is True and first["has_document"] is True
    assert "file_path" not in first and "file_url" not in first
    assert [c["id"] for c in recent["data"]] == ["c-2"]


def test_the_http_api_needs_a_key_and_returns_pages():
    from backend.app.main import app

    raw = "cc_live_" + "z" * 40
    db = _DB(
        api_keys=[{"id": "k-1", "organization_id": ORG, "key_hash": api.hash_key(raw), "scopes": api.DEFAULT_SCOPES, "last_used_at": "2999-01-01T00:00:00+00:00"}],
        organization_members=MEMBERS, users=USERS, credentials=CREDENTIALS,
    )
    client = TestClient(app)
    with patch.object(api, "get_supabase_admin", return_value=db):
        assert client.get("/api/v1/workers").status_code == 401
        resp = client.get("/api/v1/workers", headers={"Authorization": f"Bearer {raw}"})
        assert resp.status_code == 200
        assert [w["id"] for w in resp.json()["data"]] == ["w-1"]
        creds = client.get("/api/v1/workers/w-1/credentials", headers={"Authorization": f"Bearer {raw}"}).json()
        assert {c["id"] for c in creds["data"]} == {"c-1", "c-2"}


# ---------------------------------------------------------------------------
# Webhooks
# ---------------------------------------------------------------------------

def test_webhook_addresses_must_be_https_and_public(monkeypatch):
    monkeypatch.setenv("WEBHOOKS_ALLOW_PRIVATE", "false")
    with pytest.raises(HTTPException):
        wh.check_url("http://example.com/hook")
    for address in ("127.0.0.1", "10.0.0.5", "169.254.169.254", "192.168.1.2"):
        monkeypatch.setattr(wh.socket, "getaddrinfo", lambda *_a, _ip=address, **_k: [(None, None, None, None, (_ip, 443))])
        with pytest.raises(HTTPException) as exc:
            wh.check_url("https://hooks.example.com/carecliq")
        assert "private network" in str(exc.value.detail)
    monkeypatch.setattr(wh.socket, "getaddrinfo", lambda *_a, **_k: [(None, None, None, None, ("13.54.0.10", 443))])
    assert wh.check_url("https://hooks.example.com/carecliq") == "https://hooks.example.com/carecliq"


def test_the_signature_can_be_checked_by_the_receiver():
    body = b'{"type":"credential.updated"}'
    header = wh.sign("whsec_test", 1763251200, body)
    t, v1 = (part.split("=", 1)[1] for part in header.split(","))
    expected = hmac.new(b"whsec_test", f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    assert t == "1763251200" and hmac.compare_digest(v1, expected)


@pytest.mark.asyncio
async def test_events_go_only_to_subscribed_endpoints_and_failures_are_retried():
    endpoints = [
        {"id": "e-1", "organization_id": ORG, "url": "https://a.example.com", "secret": "whsec_a",
         "events": ["credential.updated"], "is_active": True, "failure_count": 0},
        {"id": "e-2", "organization_id": ORG, "url": "https://b.example.com", "secret": "whsec_b",
         "events": ["training.completed"], "is_active": True, "failure_count": 0},
        {"id": "e-3", "organization_id": OTHER, "url": "https://c.example.com", "secret": "whsec_c",
         "events": ["credential.updated"], "is_active": True, "failure_count": 0},
    ]
    db = _DB(webhook_endpoints=endpoints, webhook_deliveries=[])
    post = AsyncMock(return_value={"ok": False, "status": 500, "body": "", "message": "The address answered 500."})
    with patch.object(wh, "get_supabase_admin", return_value=db), patch.object(wh, "_post", post):
        await wh._queue_and_send(ORG, "credential.updated", {"id": "c-2"})
    assert [call.args[0]["id"] for call in post.await_args_list] == ["e-1"]
    delivery = db.tables["webhook_deliveries"][0]
    assert delivery["status"] == "pending" and delivery["attempts"] == 1 and delivery["next_attempt_at"]
    assert delivery["payload"]["type"] == "credential.updated" and delivery["payload"]["data"] == {"id": "c-2"}
    assert db.tables["webhook_endpoints"][0]["failure_count"] == 1

    # The last allowed attempt fails: marked failed, not retried again.
    delivery["attempts"] = wh.MAX_ATTEMPTS - 1
    with patch.object(wh, "get_supabase_admin", return_value=db), patch.object(wh, "_post", post):
        await wh.deliver(delivery, endpoints[0])
    assert db.tables["webhook_deliveries"][0]["status"] == "failed"

    # A success clears the failure count.
    ok = AsyncMock(return_value={"ok": True, "status": 200, "body": "ok", "message": None})
    db.tables["webhook_deliveries"][0].update({"status": "pending", "attempts": 0})
    with patch.object(wh, "get_supabase_admin", return_value=db), patch.object(wh, "_post", ok):
        assert await wh.deliver(db.tables["webhook_deliveries"][0], endpoints[0]) is True
    assert db.tables["webhook_deliveries"][0]["status"] == "delivered"
    assert db.tables["webhook_endpoints"][0]["failure_count"] == 0


def test_a_malformed_encryption_key_never_breaks_saving_a_secret(monkeypatch):
    import base64
    import os

    from backend.app.services import pii_service
    from backend.app.services import xero_service as xero

    monkeypatch.setenv("PII_ENCRYPTION_KEY", "not-a-32-byte-key")
    assert wh._seal("whsec_abc") == "whsec_abc"
    assert xero._seal("refresh-token") == "refresh-token"
    assert pii_service.decrypt_field("whsec_abc") == "whsec_abc"

    monkeypatch.setenv("PII_ENCRYPTION_KEY", base64.b64encode(os.urandom(32)).decode())
    sealed = wh._seal("whsec_abc")
    assert sealed.startswith("ENC:") and pii_service.decrypt_field(sealed) == "whsec_abc"
    assert xero._seal("refresh-token").startswith("ENC:")
