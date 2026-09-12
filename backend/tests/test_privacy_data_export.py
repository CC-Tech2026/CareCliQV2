"""A worker's data-export link is opened straight from an email with no
session — the download route must accept the token alone (no Authorization
header) and reject wrong/missing tokens, and the emailed link must be an
absolute URL pointing at the backend's own origin, not a bare API path.
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import privacy_service


def _mock_supabase_for_export_request(request_id: str) -> MagicMock:
    mock = MagicMock()
    mock.table.return_value.insert.return_value.execute.return_value = MagicMock(
        data=[{"id": request_id}]
    )
    mock.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data={"id": "u1", "email": "worker@example.com"}
    )
    mock.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[{}])
    return mock


def test_request_data_export_builds_absolute_download_url():
    request_id = str(uuid.uuid4())
    mock_supabase = _mock_supabase_for_export_request(request_id)

    with patch.object(privacy_service, "get_supabase_admin", return_value=mock_supabase), \
         patch.object(privacy_service, "queue_email_job", side_effect=lambda label, send: send()), \
         patch.object(privacy_service, "send_worker_notification_email") as mock_send_email, \
         patch("backend.app.services.object_storage.upload_evidence_bytes"):
        result = privacy_service.request_data_export("u1", "org1", "worker@example.com")

    assert result["download_path"].startswith("http://localhost:8000/api/worker/privacy/export/")
    assert "token=" in result["download_path"]

    mock_send_email.assert_called_once()
    email_kwargs = mock_send_email.call_args.kwargs
    assert email_kwargs["action_url"] == result["download_path"]
    assert email_kwargs["action_url"].startswith("http://")


def _mock_supabase_for_download(row: dict) -> MagicMock:
    mock = MagicMock()
    mock.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data=row
    )
    return mock


def test_download_export_succeeds_with_correct_token_and_no_caller_identity():
    """The route this backs no longer requires get_current_user — this proves
    the service function itself doesn't need a caller identity, only the
    request_id + token pair, matching the magic-link auth model."""
    request_id, user_id, token = str(uuid.uuid4()), str(uuid.uuid4()), "a" * 40
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    row = {
        "id": request_id,
        "user_id": user_id,
        "organization_id": "org1",
        "download_token_hash": token_hash,
        "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        "file_path": None,
    }
    mock_supabase = _mock_supabase_for_download(row)

    with patch.object(privacy_service, "get_supabase_admin", return_value=mock_supabase), \
         patch.object(privacy_service, "_build_export_payload", return_value={"user_id": user_id}):
        data, filename = privacy_service.download_export(request_id, token)

    assert user_id[:8] in filename
    assert data


def test_download_export_rejects_wrong_token():
    request_id, user_id = str(uuid.uuid4()), str(uuid.uuid4())
    row = {
        "id": request_id,
        "user_id": user_id,
        "download_token_hash": hashlib.sha256(b"correct-token").hexdigest(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        "file_path": None,
    }
    mock_supabase = _mock_supabase_for_download(row)

    with patch.object(privacy_service, "get_supabase_admin", return_value=mock_supabase):
        with pytest.raises(HTTPException) as exc_info:
            privacy_service.download_export(request_id, "wrong-token")

    assert exc_info.value.status_code == 403


def test_download_export_rejects_expired_link():
    request_id, user_id, token = str(uuid.uuid4()), str(uuid.uuid4()), "b" * 40
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    row = {
        "id": request_id,
        "user_id": user_id,
        "download_token_hash": token_hash,
        "expires_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
        "file_path": None,
    }
    mock_supabase = _mock_supabase_for_download(row)

    with patch.object(privacy_service, "get_supabase_admin", return_value=mock_supabase):
        with pytest.raises(HTTPException) as exc_info:
            privacy_service.download_export(request_id, token)

    assert exc_info.value.status_code == 410


def test_download_export_uses_storage_backend_interface_not_private_attrs():
    """Regression guard for the old `hasattr(backend, "_bucket")` hack, which
    only worked for the Supabase backend and silently regenerated the export
    from scratch (bypassing the stored file) on S3/Azure. Any backend that
    implements the shared `.download()` interface method must be used."""
    request_id, user_id, token = str(uuid.uuid4()), str(uuid.uuid4()), "c" * 40
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    row = {
        "id": request_id,
        "user_id": user_id,
        "organization_id": "org1",
        "download_token_hash": token_hash,
        "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        "file_path": "privacy-exports/u1/export.json",
    }
    mock_supabase = _mock_supabase_for_download(row)

    # spec=["download"] means this mock has no `_bucket` attribute at all —
    # simulates S3/Azure backends, which don't expose one, unlike the
    # Supabase backend the old `hasattr(backend, "_bucket")` code assumed.
    fake_backend = MagicMock(spec=["download"])
    fake_backend.download.return_value = b'{"stored": true}'

    with patch.object(privacy_service, "get_supabase_admin", return_value=mock_supabase), \
         patch("backend.app.services.object_storage.get_evidence_storage_backend", return_value=fake_backend):
        data, _filename = privacy_service.download_export(request_id, token)

    fake_backend.download.assert_called_once_with("privacy-exports/u1/export.json")
    assert data == b'{"stored": true}'
