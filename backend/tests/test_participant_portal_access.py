"""Participants Portal access: MD-only management, the invite flow
(identity check -> set password, single use, expiry, lockout), and the
per-request access-row gate that stops one login seeing another
participant's data."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.api import participant_portal, participant_portal_access
from backend.app.services import participant_portal_access_service as svc

ORG = "org-1"
OTHER_ORG = "org-2"
MD = {"sub": "u-md", "organization_id": ORG, "role": "managing_director"}
COORDINATOR = {"sub": "u-c", "organization_id": ORG, "role": "support_coordinator"}
WORKER = {"sub": "u-w", "organization_id": ORG, "role": "support_worker"}
EMMA = {"sub": "u-emma", "organization_id": ORG, "role": "participant"}

MAX, LILY, NOAH, OUTSIDER = "p-max", "p-lily", "p-noah", "p-outsider"


# ── Minimal in-memory supabase fake ───────────────────────────────────────


class _Query:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.filters, self.op, self.payload, self._limit, self._single = [], "select", None, None, False

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: str(r.get(col)) == str(val))
        return self

    def neq(self, col, val):
        self.filters.append(lambda r: str(r.get(col)) != str(val))
        return self

    def ilike(self, col, val):
        self.filters.append(lambda r: str(r.get(col) or "").lower() == str(val).lower())
        return self

    def gte(self, col, val):
        self.filters.append(lambda r: r.get(col) is not None and str(r.get(col)) >= str(val))
        return self

    def in_(self, col, vals):
        vals = {str(v) for v in vals}
        self.filters.append(lambda r: str(r.get(col)) in vals)
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self._limit = n
        return self

    def maybe_single(self):
        self._single = True
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def _rows(self):
        return [r for r in self.db.tables.setdefault(self.name, []) if all(f(r) for f in self.filters)]

    def execute(self):
        if self.op == "insert":
            row = {"id": str(uuid.uuid4()), **self.payload}
            self.db.tables.setdefault(self.name, []).append(row)
            return SimpleNamespace(data=[dict(row)])
        if self.op == "update":
            rows = self._rows()
            for r in rows:
                r.update(self.payload)
            return SimpleNamespace(data=[dict(r) for r in rows])
        rows = [dict(r) for r in self._rows()]
        if self._limit is not None:
            rows = rows[: self._limit]
        if self._single:
            return SimpleNamespace(data=rows[0] if rows else None)
        return SimpleNamespace(data=rows)


class FakeSupabase:
    def __init__(self, tables):
        self.tables = tables
        self.auth = SimpleNamespace(admin=MagicMock())
        self.auth.admin.create_user.return_value = SimpleNamespace(user=SimpleNamespace(id="u-new"))

    def table(self, name):
        return _Query(self, name)


def _access(participant_id, user_id="u-emma", email="emma@example.com", status="active", **extra):
    return {
        "id": f"a-{participant_id}-{user_id}",
        "organization_id": ORG,
        "participant_id": participant_id,
        "user_id": user_id,
        "email": email,
        "full_name": "Emma Parker",
        "relationship": "parent",
        "status": status,
        "granted_at": "2026-09-01T00:00:00+00:00",
        **extra,
    }


def _db():
    return FakeSupabase({
        "participants": [
            {"id": MAX, "organization_id": ORG, "full_name": "Max Well", "date_of_birth": "1980-01-02", "ndis_number": "430 000 001", "email": "max@example.com"},
            {"id": LILY, "organization_id": ORG, "full_name": "Lily Parker", "date_of_birth": "2018-04-12", "ndis_number": "431000101"},
            {"id": NOAH, "organization_id": ORG, "full_name": "Noah Parker", "date_of_birth": "2015-09-03", "ndis_number": "431000102"},
            {"id": OUTSIDER, "organization_id": OTHER_ORG, "full_name": "Other Org", "date_of_birth": "1990-01-01", "ndis_number": "1"},
        ],
        "participant_portal_access": [_access(LILY), _access(NOAH)],
        "users": [
            {"id": "u-emma", "email": "emma@example.com", "role": "participant", "organization_id": ORG},
            {"id": "u-c", "email": "coord@example.com", "role": "support_coordinator", "organization_id": ORG},
        ],
        "invoices": [],
    })


@pytest.fixture
def db():
    fake = _db()
    with patch.object(svc, "get_supabase_admin", return_value=fake), \
         patch("backend.app.api.participant_portal.get_supabase_admin", return_value=fake), \
         patch.object(svc.audit_service, "log_action", new=AsyncMock(return_value=True)), \
         patch.object(svc.email_service, "queue_worker_notification_email", return_value={"status": "queued"}), \
         patch.object(svc, "_organization_name", return_value="Sunshine Care"), \
         patch("backend.app.api.auth._upsert_user_record", new=AsyncMock()):
        yield fake


def _row(db, participant_id, email):
    return next(
        r for r in db.tables["participant_portal_access"]
        if r["participant_id"] == participant_id and r["email"] == email and r["status"] != "revoked"
    )


# ── The key rule: a login only sees participants it has an active row for ─


def test_parent_can_view_each_child(db):
    assert svc.assert_active_access("u-emma", LILY, ORG)["participant_id"] == LILY
    assert svc.assert_active_access("u-emma", NOAH, ORG)["participant_id"] == NOAH


def test_parent_cannot_view_unrelated_participant(db):
    with pytest.raises(HTTPException) as exc:
        svc.assert_active_access("u-emma", MAX, ORG)
    assert exc.value.status_code == 404


def test_revoked_or_pending_access_is_blocked(db):
    db.tables["participant_portal_access"][0]["status"] = "revoked"
    db.tables["participant_portal_access"][1]["status"] = "pending"
    for pid in (LILY, NOAH):
        with pytest.raises(HTTPException) as exc:
            svc.assert_active_access("u-emma", pid, ORG)
        assert exc.value.status_code == 404


def test_picker_lists_only_granted_participants(db):
    listed = svc.list_accessible_participants("u-emma", ORG)
    assert {p["participant_id"] for p in listed} == {LILY, NOAH}


@pytest.mark.asyncio
async def test_portal_endpoint_rejects_someone_elses_participant_id(db):
    with pytest.raises(HTTPException) as exc:
        await participant_portal.list_my_invoices(participant_id=MAX, current_user=EMMA)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_portal_endpoint_rejects_staff_roles(db):
    with pytest.raises(HTTPException) as exc:
        await participant_portal.list_my_invoices(participant_id=LILY, current_user=MD)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_portal_endpoint_allows_granted_participant_and_logs_view(db):
    assert await participant_portal.list_my_invoices(participant_id=LILY, current_user=EMMA) == []
    actions = [c.kwargs["action_type"] for c in svc.audit_service.log_action.call_args_list]
    assert "participant_portal.invoices_viewed" in actions


# ── MD-only management ───────────────────────────────────────────────────


@pytest.mark.parametrize("user", [COORDINATOR, WORKER, EMMA])
def test_only_md_can_manage_access(user):
    with pytest.raises(HTTPException) as exc:
        participant_portal_access._require_md(user)
    assert exc.value.status_code == 403


def test_coordinator_can_view_but_worker_cannot():
    assert participant_portal_access._require_viewer(COORDINATOR) == ORG
    with pytest.raises(HTTPException):
        participant_portal_access._require_viewer(WORKER)


@pytest.mark.asyncio
async def test_representative_requires_recorded_authority(db):
    with pytest.raises(HTTPException) as exc:
        await svc.grant_access(
            participant_id=MAX, org_id=ORG, actor_id="u-md", email="sis@example.com",
            full_name="Sis Well", relationship="consented_family", identity_method="participant_dob",
        )
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_grant_from_another_org_is_not_found(db):
    with pytest.raises(HTTPException) as exc:
        await svc.grant_access(
            participant_id=OUTSIDER, org_id=ORG, actor_id="u-md", email="x@example.com",
            full_name="X", relationship="self", identity_method="participant_dob",
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_staff_email_cannot_be_given_portal_access(db):
    with pytest.raises(HTTPException) as exc:
        await svc.grant_access(
            participant_id=MAX, org_id=ORG, actor_id="u-md", email="coord@example.com",
            full_name="Coord", relationship="self", identity_method="participant_dob",
        )
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_existing_portal_login_gets_access_added_without_invite(db):
    result = await svc.grant_access(
        participant_id=MAX, org_id=ORG, actor_id="u-md", email="Emma@Example.com",
        full_name="Emma Parker", relationship="consented_family", identity_method="participant_dob",
        authority_notes="Max's written consent on file", consent_method="written",
    )
    assert result["invite_url"] is None
    assert result["access"]["status"] == "active"
    assert svc.assert_active_access("u-emma", MAX, ORG)


@pytest.mark.asyncio
async def test_grant_stores_only_a_hash_of_the_token(db):
    result = await svc.grant_access(
        participant_id=MAX, org_id=ORG, actor_id="u-md", email="max@example.com",
        full_name="Max Well", relationship="self", identity_method="participant_dob",
    )
    token = result["invite_url"].split("token=")[1]
    row = _row(db, MAX, "max@example.com")
    assert row["status"] == "pending"
    assert row["invite_token_hash"] == svc._hash(token)
    assert token not in str(row)


@pytest.mark.asyncio
async def test_not_using_blocked_while_access_is_live(db):
    with pytest.raises(HTTPException) as exc:
        await svc.set_not_using(
            participant_id=LILY, org_id=ORG, actor_id="u-md", reason="declined", note=None,
            review_date=date(2027, 3, 1),
        )
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_revoke_requires_reason_and_blocks_access(db):
    access_id = db.tables["participant_portal_access"][0]["id"]
    with pytest.raises(HTTPException):
        await svc.revoke_access(access_id=access_id, org_id=ORG, actor_id="u-md", reason="  ")
    await svc.revoke_access(access_id=access_id, org_id=ORG, actor_id="u-md", reason="Participant request")
    with pytest.raises(HTTPException):
        svc.assert_active_access("u-emma", LILY, ORG)


# ── Invite flow ──────────────────────────────────────────────────────────


async def _invite_max(db, method="participant_dob"):
    result = await svc.grant_access(
        participant_id=MAX, org_id=ORG, actor_id="u-md", email="max@example.com",
        full_name="Max Well", relationship="self", identity_method=method,
    )
    return result["invite_url"].split("token=")[1], result


@pytest.mark.asyncio
async def test_cannot_set_password_before_identity_check(db):
    token, _ = await _invite_max(db)
    with pytest.raises(HTTPException) as exc:
        await svc.accept_invite(token=token, password="GoodPassword1", ip_address=None)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_identity_locks_after_five_wrong_answers(db):
    token, _ = await _invite_max(db)
    for _ in range(4):
        with pytest.raises(HTTPException) as exc:
            await svc.verify_identity(token=token, answer="1999-12-31", ip_address=None)
        assert exc.value.status_code == 400
    with pytest.raises(HTTPException) as exc:
        await svc.verify_identity(token=token, answer="1999-12-31", ip_address=None)
    assert exc.value.status_code == 423
    # Even the right answer is refused once locked.
    with pytest.raises(HTTPException) as exc:
        await svc.verify_identity(token=token, answer="1980-01-02", ip_address=None)
    assert exc.value.status_code == 423


@pytest.mark.asyncio
async def test_ndis_number_check_ignores_spacing(db):
    token, _ = await _invite_max(db, method="ndis_number")
    assert (await svc.verify_identity(token=token, answer="430000001", ip_address=None))["verified"]


@pytest.mark.asyncio
async def test_code_check_uses_the_code_shown_to_the_md(db):
    token, result = await _invite_max(db, method="code")
    assert result["identity_code"] and len(result["identity_code"]) == 6
    assert (await svc.verify_identity(token=token, answer=result["identity_code"], ip_address=None))["verified"]


@pytest.mark.asyncio
async def test_full_invite_flow_is_single_use(db):
    token, _ = await _invite_max(db)
    await svc.verify_identity(token=token, answer="1980-01-02", ip_address=None)
    result = await svc.accept_invite(token=token, password="GoodPassword1", ip_address="1.2.3.4")
    assert result["email"] == "max@example.com"
    db.auth.admin.create_user.assert_called_once()
    row = _row(db, MAX, "max@example.com")
    assert row["status"] == "active" and row["user_id"] == "u-new"
    assert row["invite_token_hash"] is None
    with pytest.raises(HTTPException) as exc:
        svc.invite_summary(token)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_weak_password_is_rejected(db):
    token, _ = await _invite_max(db)
    await svc.verify_identity(token=token, answer="1980-01-02", ip_address=None)
    with pytest.raises(HTTPException) as exc:
        await svc.accept_invite(token=token, password="short", ip_address=None)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_expired_invite_is_refused(db):
    token, _ = await _invite_max(db)
    _row(db, MAX, "max@example.com")["invite_expires_at"] = (
        datetime.now(timezone.utc) - timedelta(minutes=1)
    ).isoformat()
    with pytest.raises(HTTPException) as exc:
        svc.invite_summary(token)
    assert exc.value.status_code == 410


@pytest.mark.asyncio
async def test_resend_replaces_link_and_unlocks(db):
    old_token, result = await _invite_max(db)
    row = _row(db, MAX, "max@example.com")
    row["identity_locked_at"] = datetime.now(timezone.utc).isoformat()
    resent = await svc.resend_invite(access_id=row["id"], org_id=ORG, actor_id="u-md")
    new_token = resent["invite_url"].split("token=")[1]
    with pytest.raises(HTTPException):
        svc.invite_summary(old_token)
    assert svc.invite_summary(new_token)["identity_verified"] is False


# ── Front-door rule: participant logins only reach portal endpoints ─────


def _gate_client():
    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient

    from backend.app.core.security import get_current_user, get_optional_user

    app = FastAPI()

    @app.get("/api/participant-portal/access")
    async def portal(user: dict = Depends(get_current_user)):
        return {"ok": True}

    @app.get("/api/auth/me")
    async def me(user: dict = Depends(get_current_user)):
        return {"ok": True}

    @app.get("/api/budget/remaining")
    async def staff(user: dict = Depends(get_current_user)):
        return {"ok": True}

    @app.get("/api/participant-portal-access/participants/p-1")
    async def md_only(user: dict = Depends(get_current_user)):
        return {"ok": True}

    @app.get("/api/public-thing")
    async def optional(user=Depends(get_optional_user)):
        return {"user": bool(user)}

    return TestClient(app)


def _token(role):
    from backend.app.core.security import create_access_token

    return {"Authorization": f"Bearer {create_access_token({'sub': 'u-x', 'role': role, 'organization_id': ORG})}"}


@pytest.mark.parametrize("path", ["/api/participant-portal/access", "/api/auth/me"])
def test_participant_login_reaches_portal_and_auth(path):
    assert _gate_client().get(path, headers=_token("participant")).status_code == 200


@pytest.mark.parametrize("path", ["/api/budget/remaining", "/api/participant-portal-access/participants/p-1"])
def test_participant_login_is_refused_on_staff_endpoints(path):
    assert _gate_client().get(path, headers=_token("participant")).status_code == 403


def test_participant_login_is_anonymous_on_optional_auth_routes():
    client = _gate_client()
    assert client.get("/api/public-thing", headers=_token("participant")).json() == {"user": False}
    assert client.get("/api/public-thing", headers=_token("support_coordinator")).json() == {"user": True}


def test_staff_logins_are_unaffected():
    assert _gate_client().get("/api/budget/remaining", headers=_token("support_coordinator")).status_code == 200


# ── Separate sign-in doors ───────────────────────────────────────────────


def test_portal_door_refuses_staff_accounts():
    from backend.app.api.auth import _check_login_door

    for role in ("managing_director", "support_coordinator", "support_worker"):
        with pytest.raises(HTTPException) as exc:
            _check_login_door("participant", role)
        assert exc.value.status_code == 403


def test_staff_door_refuses_participant_accounts():
    from backend.app.api.auth import _check_login_door

    with pytest.raises(HTTPException) as exc:
        _check_login_door("staff", "participant")
    assert exc.value.status_code == 403


def test_each_door_accepts_its_own_accounts_and_mobile_is_unchecked():
    from backend.app.api.auth import _check_login_door

    _check_login_door("participant", "participant")
    _check_login_door("staff", "support_coordinator")
    # The mobile app sends no portal field; it enforces worker-only itself.
    _check_login_door(None, "participant")
    _check_login_door(None, "support_worker")


@pytest.mark.asyncio
@pytest.mark.parametrize("portal, suffix", [(True, "/reset-password?portal=1"), (False, "/reset-password")])
async def test_password_reset_link_returns_to_the_right_door(portal, suffix):
    from urllib.parse import unquote

    from backend.app.api import auth

    with patch.object(auth, "_supabase_auth_request") as req:
        await auth.request_password_reset(auth.PasswordResetRequest(email="max@example.com", portal=portal))
    path = req.call_args.args[0]
    assert unquote(path.split("redirect_to=")[1]).endswith(suffix)


# ── Overview & NDIS plan ─────────────────────────────────────────────────

MAX_USER = {"sub": "u-max", "organization_id": ORG, "role": "participant"}


def _seed_max_profile(db):
    future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    db.tables["participant_portal_access"].append(_access(MAX, user_id="u-max", email="max@example.com", relationship="self"))
    p = next(r for r in db.tables["participants"] if r["id"] == MAX)
    p.update({
        "assigned_worker_id": "u-sarah",
        # Internal / clinical columns that must never reach the portal.
        "primary_disability": "SECRET-DISABILITY",
        "risk_notes": "SECRET-RISK",
        "behaviour_support_plan": "SECRET-BSP",
    })
    db.tables["users"].append({
        "id": "u-sarah", "full_name": "Sarah Kim", "role": "support_worker",
        "email": "sarah.private@example.com", "phone": "0400-SECRET", "profile_photo_url": None,
    })
    db.tables["participant_intakes"] = [{
        "participant_id": MAX, "organization_id": ORG, "updated_at": "2026-09-01",
        "service_category": "disability", "service_hours_required": 12,
        "service_agreement_document_path": "org-1/sa.pdf", "service_agreement_document_name": "Service Agreement.pdf",
        "screening_checks": {"red_flag_notes": "SECRET-REDFLAG"},
        "meet_greet_notes": "SECRET-MEETGREET",
        "web_intake": {
            "pronouns": "he/him", "preferred_language": "English", "suburb": "Glenelg",
            "plan_manager_name": "Pat Planner", "presenting_needs": ["Daily living"],
            "next_of_kin": [{"name": "Ann Well"}],
            "notes": "SECRET-INTAKE-NOTE", "referral_source": "SECRET-REFERRAL", "submitted_by": "SECRET-SUBMITTER",
        },
    }]
    db.tables["medications"] = [{"participant_id": MAX, "name": "SECRET-MEDICATION"}]
    db.tables["shifts"] = [
        {"id": f"s-up-{i}", "participant_id": MAX, "scheduled_start": future, "scheduled_end": future, "status": "scheduled", "worker_id": "u-sarah"}
        for i in range(5)
    ] + [
        {"id": "s-past", "participant_id": MAX, "scheduled_start": past, "scheduled_end": past, "status": "completed", "worker_id": "u-sarah"},
    ]
    db.tables["ndis_plans"] = [{
        "id": "plan-1", "patient_id": MAX, "organization_id": ORG, "plan_start": "2026-07-01", "plan_end": "2027-06-30",
        "status": "active", "total_funding": 50000,
        "plan_budgets": [{"category": "Core", "allocated_amount": 30000, "used_amount": 12000.5}],
    }]
    db.tables["ndis_goals"] = [{"participant_id": MAX, "organization_id": ORG, "name": "Cook a meal", "status": "active"}]


@pytest.mark.asyncio
async def test_overview_shows_profile_team_and_pinned_documents(db):
    _seed_max_profile(db)
    data = await participant_portal.get_overview(participant_id=MAX, current_user=MAX_USER)
    assert data["profile"]["full_name"] == "Max Well"
    assert data["profile"]["intake"]["plan_manager_name"] == "Pat Planner"
    assert data["profile"]["intake"]["presenting_needs"] == ["Daily living"]
    assert data["support_team"][0]["full_name"] == "Sarah Kim"
    assert data["support_team"][0]["is_assigned"] is True
    assert len(data["upcoming_shifts"]) == 3
    assert all(s["id"].startswith("s-up") for s in data["upcoming_shifts"])
    assert [s["id"] for s in data["recent_shifts"]] == ["s-past"]
    assert data["pinned"]["service_agreement"]["available"] is True
    assert data["pinned"]["ndis_plan"]["available"] is True


@pytest.mark.asyncio
async def test_overview_never_returns_internal_clinical_or_staff_contact_details(db):
    _seed_max_profile(db)
    dumped = str(await participant_portal.get_overview(participant_id=MAX, current_user=MAX_USER))
    assert "SECRET" not in dumped
    assert "sarah.private@example.com" not in dumped


@pytest.mark.asyncio
async def test_plan_shows_budgets_and_goals(db):
    _seed_max_profile(db)
    data = await participant_portal.get_my_plan(participant_id=MAX, current_user=MAX_USER)
    assert data["plan"]["total_funding"] == 50000
    assert data["plan"]["budgets"] == [{"category": "Core", "allocated": 30000.0, "used": 12000.5, "remaining": 17999.5}]
    assert data["goals"][0]["name"] == "Cook a meal"


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["get_overview", "get_my_plan"])
async def test_overview_and_plan_refuse_someone_elses_participant(db, endpoint):
    _seed_max_profile(db)
    with pytest.raises(HTTPException) as exc:
        await getattr(participant_portal, endpoint)(participant_id=MAX, current_user=EMMA)
    assert exc.value.status_code == 404


def test_front_door_allows_the_new_portal_endpoints():
    from backend.app.core.security import participant_may_call

    assert participant_may_call("/api/participant-portal/overview")
    assert participant_may_call("/api/participant-portal/plan")
    assert not participant_may_call("/api/participants")


@pytest.mark.asyncio
async def test_portal_invoices_hide_drafts_void_and_cancelled(db):
    db.tables["invoices"] = [
        {"id": f"inv-{status}", "organization_id": ORG, "participant_id": LILY, "status": status, "pdf_path": None}
        for status in ("draft", "void", "cancelled", "finalized", "issued", "sent", "overdue", "paid")
    ]
    with patch("backend.app.api.participant_portal.signed_storage_url", return_value=None):
        rows = await participant_portal.list_my_invoices(participant_id=LILY, current_user=EMMA)
    assert sorted(r["status"] for r in rows) == ["issued", "overdue", "paid", "sent"]


def test_front_door_allows_only_the_self_settings_endpoints():
    from backend.app.core.security import participant_may_call

    for path in ("/api/users/me/accessibility", "/api/users/me/language", "/api/users/me/change-password"):
        assert participant_may_call(path)
    for path in (
        "/api/users/me",
        "/api/users/me/notification-preferences",
        "/api/users/me/accessibility-export",
        "/api/users/u-other/accessibility",
        "/api/users",
    ):
        assert not participant_may_call(path)


# ── Invoice downloads ────────────────────────────────────────────────────

import io as _io
import zipfile as _zipfile


def _seed_invoices(db, *, stored_ok=True):
    files = {"org-1/inv-a/INV-1.pdf": b"%PDF-stored"}

    def download(path):
        if path not in files:
            raise RuntimeError("missing object")
        return files[path]

    db.storage = SimpleNamespace(from_=lambda _bucket: SimpleNamespace(download=download))
    db.tables["invoices"] = [
        # Stored PDF.
        {"id": "inv-a", "organization_id": ORG, "participant_id": LILY, "status": "paid",
         "invoice_number": "INV-1", "pdf_path": "org-1/inv-a/INV-1.pdf", "created_at": "2026-09-01"},
        # No stored PDF — rendered on request.
        {"id": "inv-b", "organization_id": ORG, "participant_id": LILY, "status": "sent",
         "invoice_number": "INV-2", "pdf_path": None, "created_at": "2026-09-02"},
        # Draft — never visible.
        {"id": "inv-draft", "organization_id": ORG, "participant_id": LILY, "status": "draft",
         "invoice_number": "INV-3", "pdf_path": None, "created_at": "2026-09-03"},
        # Someone else's.
        {"id": "inv-max", "organization_id": ORG, "participant_id": MAX, "status": "paid",
         "invoice_number": "INV-9", "pdf_path": None, "created_at": "2026-09-04"},
    ]


def _render_ok():
    return patch.multiple(
        "backend.app.services.invoice_service", render_invoice_pdf=MagicMock(return_value=b"%PDF-rendered")
    )


def _template_ok():
    return patch("backend.app.services.billing_service._build_template_data", return_value={})


@pytest.mark.asyncio
async def test_invoice_pdf_uses_stored_copy_then_renders_missing_ones(db):
    _seed_invoices(db)
    with _render_ok(), _template_ok():
        stored = await participant_portal.download_invoice_pdf("inv-a", participant_id=LILY, current_user=EMMA)
        rendered = await participant_portal.download_invoice_pdf("inv-b", participant_id=LILY, current_user=EMMA)
    assert stored.body == b"%PDF-stored"
    assert rendered.body == b"%PDF-rendered"
    assert stored.headers["content-disposition"] == 'attachment; filename="INV-1.pdf"'


@pytest.mark.asyncio
@pytest.mark.parametrize("invoice_id", ["inv-draft", "inv-max"])
async def test_invoice_pdf_refuses_drafts_and_other_participants_invoices(db, invoice_id):
    _seed_invoices(db)
    with _render_ok(), _template_ok(), pytest.raises(HTTPException) as exc:
        await participant_portal.download_invoice_pdf(invoice_id, participant_id=LILY, current_user=EMMA)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_invoice_pdf_render_failure_is_an_error_never_a_placeholder(db):
    _seed_invoices(db)
    with patch("backend.app.services.billing_service._build_template_data", side_effect=RuntimeError("boom")), \
         pytest.raises(HTTPException) as exc:
        await participant_portal.download_invoice_pdf("inv-b", participant_id=LILY, current_user=EMMA)
    assert exc.value.status_code == 502


@pytest.mark.asyncio
async def test_download_all_zips_visible_invoices_and_notes_missing_ones(db):
    _seed_invoices(db)
    with patch("backend.app.services.billing_service._build_template_data", side_effect=RuntimeError("boom")):
        response = await participant_portal.download_all_invoices(participant_id=LILY, current_user=EMMA)
    archive = _zipfile.ZipFile(_io.BytesIO(response.body))
    assert sorted(archive.namelist()) == ["INV-1.pdf", "NOT-INCLUDED.txt"]
    assert archive.read("INV-1.pdf") == b"%PDF-stored"
    assert "INV-2" in archive.read("NOT-INCLUDED.txt").decode()
    assert "INV-3" not in archive.read("NOT-INCLUDED.txt").decode()


@pytest.mark.asyncio
async def test_download_all_refuses_someone_elses_participant(db):
    _seed_invoices(db)
    with pytest.raises(HTTPException) as exc:
        await participant_portal.download_all_invoices(participant_id=MAX, current_user=EMMA)
    assert exc.value.status_code == 404
