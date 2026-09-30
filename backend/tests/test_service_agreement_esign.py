"""Remote e-signing of service agreements: link, emailed code, signature."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app.services import service_agreement_esign_service as esign
from backend.app.services import service_agreement_service
from backend.app.services.email_service import EmailDelivery

ORG = "org-1"
PNG = "data:image/png;base64,iVBORw0KGgo="
TOKEN = "tok-abc"


def _iso(delta: timedelta) -> str:
    return (datetime.now(timezone.utc) + delta).isoformat()


def _row(**over):
    row = {
        "id": "a1", "organization_id": ORG, "participant_id": "p1", "agreement_number": "SA-2026-0001",
        "status": "pending_signature", "start_date": "2026-10-01", "end_date": "2027-09-30",
        "signer_name": "Priya Carter", "signer_email": "priya@example.com", "signer_relationship": "nominee",
        "sign_token_expires_at": _iso(timedelta(days=10)),
        "signing_code_hash": None, "signing_code_expires_at": None, "signing_code_sent_at": None,
        "signing_code_attempts": 0, "signing_email_verified_at": None,
        "provider_signed_name": "Maria", "provider_signed_at": _iso(timedelta(hours=-1)),
        "service_agreement_supports": [{"support_item_code": "x", "sort_order": 0}],
    }
    row.update(over)
    return row


def _client_returning(rows):
    client = MagicMock()
    client.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=rows)
    return client


def _updates(client):
    return [c.args[0] for c in client.table.return_value.update.call_args_list]


# ── Link lookup ─────────────────────────────────────────────────────────


def test_unknown_link_is_404_and_expired_pending_link_is_410():
    with patch.object(esign, "get_supabase_admin", return_value=_client_returning([])):
        with pytest.raises(HTTPException) as err:
            esign._by_token(TOKEN)
    assert err.value.status_code == 404

    expired = _row(sign_token_expires_at=_iso(timedelta(days=-1)))
    with patch.object(esign, "get_supabase_admin", return_value=_client_returning([expired])):
        with pytest.raises(HTTPException) as err:
            esign._by_token(TOKEN)
    assert err.value.status_code == 410

    # A signed agreement stays viewable as a receipt after the date passes.
    signed = _row(status="active", sign_token_expires_at=_iso(timedelta(days=-1)))
    with patch.object(esign, "get_supabase_admin", return_value=_client_returning([signed])):
        assert esign._by_token(TOKEN)["status"] == "active"


def test_the_link_is_looked_up_by_hash_only():
    client = _client_returning([_row()])
    with patch.object(esign, "get_supabase_admin", return_value=client):
        esign._by_token(TOKEN)
    eq = client.table.return_value.select.return_value.eq
    assert eq.call_args.args == ("sign_token_hash", esign.token_hash(TOKEN))
    assert TOKEN not in str(eq.call_args)


def test_nothing_from_the_agreement_is_shown_before_the_code():
    with patch.object(esign, "_by_token", return_value=_row()), \
         patch.object(esign, "_branding", return_value={"display_name": "Sunrise"}), \
         patch.object(esign.documents, "_participant", return_value={"full_name": "Liam Carter"}), \
         patch.object(esign, "_summary", return_value={"total": "$1.00"}) as summary:
        view = esign.public_view(TOKEN)
    assert view["agreement"] is None and not summary.called
    assert view["email_hint"] == "pr•••@example.com"
    assert view["participant_first_name"] == "Liam"

    with patch.object(esign, "_by_token", return_value=_row(signing_email_verified_at=_iso(timedelta(0)))), \
         patch.object(esign, "_branding", return_value={}), \
         patch.object(esign.documents, "get_letterhead", return_value={"provider_name": "Sunrise"}), \
         patch.object(esign.documents, "_participant", return_value={"full_name": "Liam Carter"}), \
         patch.object(esign, "_summary", return_value={"total": "$1.00"}):
        view = esign.public_view(TOKEN)
    assert view["agreement"] == {"total": "$1.00"} and view["organization_name"] == "Sunrise"


def test_pdf_needs_the_code_first():
    with patch.object(esign, "_by_token", return_value=_row()):
        with pytest.raises(HTTPException) as err:
            esign.document(TOKEN)
    assert err.value.status_code == 403


# ── Code ────────────────────────────────────────────────────────────────


def test_code_is_sent_hashed_and_rate_limited():
    client = MagicMock()
    with patch.object(esign, "_by_token", return_value=_row()), \
         patch.object(esign, "get_supabase_admin", return_value=client), \
         patch.object(esign, "_branding", return_value={}), \
         patch.object(esign, "queue_email_job", return_value={"status": "queued"}) as queue:
        result = esign.send_code(TOKEN)
    assert result["ok"] and "pr•••@example.com" in result["message"]
    update = _updates(client)[0]
    assert len(update["signing_code_hash"]) == 64 and update["signing_code_attempts"] == 0
    assert queue.called

    # Asked again straight away: no second email.
    with patch.object(esign, "_by_token", return_value=_row(signing_code_sent_at=_iso(timedelta(seconds=-5)))), \
         patch.object(esign, "queue_email_job") as queue:
        esign.send_code(TOKEN)
    assert not queue.called


def test_code_email_that_cannot_be_queued_is_an_error():
    with patch.object(esign, "_by_token", return_value=_row()), \
         patch.object(esign, "get_supabase_admin", return_value=MagicMock()), \
         patch.object(esign, "_branding", return_value={}), \
         patch.object(esign, "queue_email_job", return_value={"status": "queue_full"}):
        with pytest.raises(HTTPException) as err:
            esign.send_code(TOKEN)
    assert err.value.status_code == 503


def test_wrong_codes_count_down_then_lock():
    code_hash = esign._code_hash("123456", "a1")
    base = dict(signing_code_hash=code_hash, signing_code_expires_at=_iso(timedelta(minutes=5)))
    client = MagicMock()
    with patch.object(esign, "_by_token", return_value=_row(**base, signing_code_attempts=3)), \
         patch.object(esign, "get_supabase_admin", return_value=client):
        with pytest.raises(HTTPException) as err:
            esign.verify_code(TOKEN, "000000")
    assert err.value.status_code == 400 and "1 try left" in err.value.detail
    assert _updates(client)[0] == {"signing_code_attempts": 4}

    with patch.object(esign, "_by_token", return_value=_row(**base, signing_code_attempts=5)):
        with pytest.raises(HTTPException) as err:
            esign.verify_code(TOKEN, "123456")  # right code, but locked
    assert err.value.status_code == 429

    with patch.object(esign, "_by_token", return_value=_row(signing_code_hash=code_hash,
                                                             signing_code_expires_at=_iso(timedelta(minutes=-1)))):
        with pytest.raises(HTTPException) as err:
            esign.verify_code(TOKEN, "123456")
    assert "expired" in err.value.detail


def test_right_code_unlocks_the_agreement():
    client = MagicMock()
    row = _row(signing_code_hash=esign._code_hash("123456", "a1"), signing_code_expires_at=_iso(timedelta(minutes=5)))
    with patch.object(esign, "_by_token", return_value=row), \
         patch.object(esign, "get_supabase_admin", return_value=client):
        assert esign.verify_code(TOKEN, "123456") == {"ok": True}
    update = _updates(client)[0]
    assert update["signing_email_verified_at"] and update["signing_code_hash"] is None


def test_a_code_from_another_agreement_does_not_work():
    client = MagicMock()
    row = _row(signing_code_hash=esign._code_hash("123456", "other"), signing_code_expires_at=_iso(timedelta(minutes=5)))
    with patch.object(esign, "_by_token", return_value=row), \
         patch.object(esign, "get_supabase_admin", return_value=client):
        with pytest.raises(HTTPException):
            esign.verify_code(TOKEN, "123456")


# ── Signing ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_signing_needs_the_code_consent_name_and_signature():
    kwargs = dict(full_name="Priya Carter", signature_png=PNG, understood=True, ip_address="1.2.3.4", user_agent="UA")
    with patch.object(esign, "_by_token", return_value=_row()):
        with pytest.raises(HTTPException) as err:
            await esign.sign(TOKEN, **kwargs)
    assert err.value.status_code == 403

    verified = _row(signing_email_verified_at=_iso(timedelta(0)))
    for bad, message in (({"understood": False}, "understood"), ({"full_name": " "}, "full name"), ({"signature_png": ""}, "signature")):
        with patch.object(esign, "_by_token", return_value=verified):
            with pytest.raises(HTTPException) as err:
                await esign.sign(TOKEN, **{**kwargs, **bad})
        assert message in err.value.detail

    with patch.object(esign, "_by_token", return_value=_row(status="active", signing_email_verified_at=_iso(timedelta(0)))):
        with pytest.raises(HTTPException) as err:
            await esign.sign(TOKEN, **kwargs)
    assert err.value.status_code == 409


@pytest.mark.asyncio
async def test_signing_by_email_records_the_evidence_and_keeps_the_receipt_link():
    verified = _row(signing_email_verified_at=_iso(timedelta(0)))
    full = {**verified, "provider_signature_png": PNG}
    with patch.object(esign, "_by_token", return_value=verified), \
         patch.object(esign.documents, "get_agreement", return_value=full), \
         patch.object(esign.documents, "finalise_signature", new=AsyncMock(return_value="f" * 64)) as finalise, \
         patch.object(esign, "_notify_organisation") as notify:
        result = await esign.sign(TOKEN, full_name=" Priya Carter ", signature_png=PNG, understood=True,
                                  ip_address="203.0.113.9", user_agent="Mozilla/5.0")
    assert result == {"ok": True, "document_sha256": "f" * 64}
    kwargs = finalise.call_args.kwargs
    assert kwargs["method"] == "email"
    assert kwargs["participant"]["name"] == "Priya Carter"
    assert kwargs["provider"] == {"name": "Maria", "png": PNG, "at": full["provider_signed_at"]}
    assert kwargs["extra"]["participant_signed_ip"] == "203.0.113.9"
    assert kwargs["extra"]["sign_token_hash"] == esign.token_hash(TOKEN)
    assert notify.called


# ── Sending ─────────────────────────────────────────────────────────────


def _send_kwargs(**over):
    kwargs = dict(provider_name="Maria", provider_signature_png=PNG, signer_name="Priya Carter",
                  signer_email="Priya@Example.com ", relationship="nominee")
    kwargs.update(over)
    return kwargs


@pytest.mark.asyncio
async def test_sending_stores_only_the_hash_of_the_link():
    client = MagicMock()
    queued = EmailDelivery(status="queued", message="")
    with patch.object(esign.documents, "get_agreement", return_value=_row(status="draft")), \
         patch.object(esign, "delivery_state", return_value=queued), \
         patch.object(esign, "get_supabase_admin", return_value=client), \
         patch.object(esign, "_branding", return_value={}), \
         patch.object(esign.documents, "_participant", return_value={"full_name": "Liam Carter"}), \
         patch.object(esign, "queue_email_job", return_value={"status": "queued"}), \
         patch.object(esign, "_sign_url", side_effect=lambda t: f"https://app/agreement-sign?token={t}"), \
         patch.object(esign.audit_service, "log_action", new=AsyncMock()):
        result = await esign.send_for_esign(ORG, "a1", "u1", **_send_kwargs())
    update = _updates(client)[0]
    assert update["status"] == "pending_signature"
    assert update["signer_email"] == "priya@example.com"
    assert len(update["sign_token_hash"]) == 64
    assert update["signing_email_verified_at"] is None and update["signing_code_attempts"] == 0
    assert result["sent_to"] == "pr•••@example.com" and "sign_url" not in result


@pytest.mark.asyncio
async def test_sending_hands_back_the_link_when_the_email_cannot_be_queued():
    queued = EmailDelivery(status="queued", message="")
    with patch.object(esign.documents, "get_agreement", return_value=_row(status="draft")), \
         patch.object(esign, "delivery_state", return_value=queued), \
         patch.object(esign, "get_supabase_admin", return_value=MagicMock()), \
         patch.object(esign, "_branding", return_value={}), \
         patch.object(esign.documents, "_participant", return_value={"full_name": "Liam Carter"}), \
         patch.object(esign, "queue_email_job", return_value={"status": "queue_full"}), \
         patch.object(esign, "_sign_url", side_effect=lambda t: f"https://app/agreement-sign?token={t}"), \
         patch.object(esign.audit_service, "log_action", new=AsyncMock()):
        result = await esign.send_for_esign(ORG, "a1", "u1", **_send_kwargs())
    assert result["sign_url"].startswith("https://app/agreement-sign?token=")


@pytest.mark.asyncio
async def test_sending_is_refused_without_email_or_with_bad_details():
    disabled = EmailDelivery(status="disabled", message="")
    client = MagicMock()
    with patch.object(esign.documents, "get_agreement", return_value=_row(status="draft")), \
         patch.object(esign, "delivery_state", return_value=disabled), \
         patch.object(esign, "get_supabase_admin", return_value=client):
        with pytest.raises(HTTPException) as err:
            await esign.send_for_esign(ORG, "a1", "u1", **_send_kwargs())
    assert err.value.status_code == 503 and not client.table.called

    for bad in ({"signer_email": "nope"}, {"relationship": "friend"}, {"provider_signature_png": ""}, {"signer_name": " "}):
        with patch.object(esign.documents, "get_agreement", return_value=_row(status="draft")):
            with pytest.raises(HTTPException) as err:
                await esign.send_for_esign(ORG, "a1", "u1", **_send_kwargs(**bad))
        assert err.value.status_code == 422

    with patch.object(esign.documents, "get_agreement", return_value=_row(status="active")):
        with pytest.raises(HTTPException) as err:
            await esign.send_for_esign(ORG, "a1", "u1", **_send_kwargs())
    assert err.value.status_code == 409


# ── Profile listing ─────────────────────────────────────────────────────


def test_profile_never_sees_the_hashes():
    agreement = _row(sign_token_hash="h" * 64, signing_code_hash="c" * 64)
    service_agreement_service._esign_summary(agreement)
    for key in ("sign_token_hash", "signing_code_hash", "signer_email", "signing_code_attempts"):
        assert key not in agreement
    assert agreement["esign"]["signer_email"] == "pr•••@example.com"
    assert agreement["esign"]["expired"] is False

    signed = _row(status="active", sign_token_hash="h" * 64)
    service_agreement_service._esign_summary(signed)
    assert signed["esign"] is None and "sign_token_hash" not in signed


# ── Public API ──────────────────────────────────────────────────────────


def test_public_routes_need_no_login_and_validate_the_code():
    from backend.app.main import app

    client = TestClient(app)
    with patch.object(esign, "public_view", return_value={"status": "awaiting_signature"}) as view:
        res = client.get(f"/api/agreement-sign/{TOKEN}")
    assert res.status_code == 200 and view.call_args.args == (TOKEN,)

    res = client.post(f"/api/agreement-sign/{TOKEN}/verify-code", json={"code": "12ab56"})
    assert res.status_code == 422

    with patch.object(esign, "sign", new=AsyncMock(return_value={"ok": True})) as sign:
        res = client.post(f"/api/agreement-sign/{TOKEN}", json={"full_name": "Priya", "signature_png": PNG, "understood": True},
                          headers={"user-agent": "pytest-agent"})
    assert res.status_code == 200
    assert sign.call_args.kwargs["user_agent"] == "pytest-agent"
