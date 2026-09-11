"""A worker renewing an already-verified credential (new expiry date and/or a
re-uploaded document) must be able to actually submit that renewal, and it
must come back out as pending_review rather than silently keeping the old
verified_at — otherwise either the renewal is blocked entirely, or a new
unreviewed claim/file would still show as coordinator-approved.
"""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.app.api import credentials as credentials_api


def _worker_user(user_id: str, org_id: str) -> dict:
    return {"sub": user_id, "organization_id": org_id, "role": "support_worker"}


def _coordinator_user(user_id: str, org_id: str) -> dict:
    return {"sub": user_id, "organization_id": org_id, "role": "support_coordinator"}


def _mock_supabase_for_update(existing: dict, updated: dict) -> MagicMock:
    mock = MagicMock()
    # _get_credential_for_user path: .table(...).select(...).eq(...).maybe_single().execute()
    mock.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data=existing
    )
    # the actual .update(...).eq(...).eq(...).execute() call
    mock.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[updated]
    )
    return mock


@pytest.mark.asyncio
async def test_worker_renewing_verified_credential_resets_to_pending_review():
    worker_id, org_id, credential_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    existing = {
        "id": credential_id,
        "user_id": worker_id,
        "organization_id": org_id,
        "status": "expired",
        "verified_at": "2026-01-01T00:00:00+00:00",
        "verified_by": str(uuid.uuid4()),
        "expiry_date": "2025-12-01",
    }
    updated = {**existing, "expiry_date": "2027-12-01", "status": "pending_review", "verified_at": None, "verified_by": None}
    mock_supabase = _mock_supabase_for_update(existing, updated)

    body = credentials_api.CredentialBody(
        credential_type="first_aid", title="First Aid", expiry_date="2027-12-01",
    )

    with patch.object(credentials_api, "get_supabase_admin", return_value=mock_supabase), \
         patch.object(credentials_api.audit_service, "log_action", new=AsyncMock(return_value=None)):
        result = await credentials_api.update_my_credential(
            credential_id, body, current_user=_worker_user(worker_id, org_id)
        )

    # Must not raise/block — this is the actual bug being fixed.
    update_call = mock_supabase.table.return_value.update
    update_call.assert_called_once()
    sent_payload = update_call.call_args[0][0]
    assert sent_payload["status"] == "pending_review"
    assert sent_payload["verified_at"] is None
    assert sent_payload["verified_by"] is None
    assert result["status"] == "pending_review"


@pytest.mark.asyncio
async def test_coordinator_editing_verified_credential_keeps_verification():
    coordinator_id, org_id, credential_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    verified_at = "2026-01-01T00:00:00+00:00"
    existing = {
        "id": credential_id,
        "user_id": str(uuid.uuid4()),
        "organization_id": org_id,
        "status": "valid",
        "verified_at": verified_at,
        "verified_by": coordinator_id,
        "expiry_date": "2027-01-01",
    }
    updated = {**existing, "title": "Updated title"}
    mock_supabase = _mock_supabase_for_update(existing, updated)

    body = credentials_api.CredentialBody(credential_type="first_aid", title="Updated title")

    with patch.object(credentials_api, "get_supabase_admin", return_value=mock_supabase), \
         patch.object(credentials_api.audit_service, "log_action", new=AsyncMock(return_value=None)):
        await credentials_api.update_my_credential(
            credential_id, body, current_user=_coordinator_user(coordinator_id, org_id)
        )

    sent_payload = mock_supabase.table.return_value.update.call_args[0][0]
    # Org-wide edits to a verified record are unaffected by the worker-renewal reset.
    assert "status" not in sent_payload
    assert "verified_at" not in sent_payload
    assert "verified_by" not in sent_payload


@pytest.mark.asyncio
async def test_worker_reuploading_file_on_verified_credential_resets_to_pending_review():
    worker_id, org_id, credential_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    existing = {
        "id": credential_id,
        "user_id": worker_id,
        "organization_id": org_id,
        "status": "valid",
        "verified_at": "2026-01-01T00:00:00+00:00",
        "verified_by": str(uuid.uuid4()),
    }
    mock_supabase = MagicMock()
    mock_supabase.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data=existing
    )
    mock_supabase.storage.from_.return_value.upload.return_value = None
    mock_supabase.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{**existing, "status": "pending_review", "verified_at": None, "verified_by": None}]
    )

    upload_file = MagicMock()
    upload_file.content_type = "application/pdf"
    upload_file.filename = "renewed.pdf"
    upload_file.read = AsyncMock(return_value=b"%PDF-fake")

    with patch.object(credentials_api, "get_supabase_admin", return_value=mock_supabase):
        result = await credentials_api.upload_my_credential_file(
            credential_id, file=upload_file, current_user=_worker_user(worker_id, org_id)
        )

    sent_payload = mock_supabase.table.return_value.update.call_args[0][0]
    assert sent_payload["status"] == "pending_review"
    assert sent_payload["verified_at"] is None
    assert sent_payload["verified_by"] is None
    assert result["status"] == "pending_review"
