"""Tests for CARECLIQV2-230 evidence media upload."""

from __future__ import annotations

import base64
from unittest.mock import MagicMock, patch

import pytest

from backend.app.services import evidence_upload_service
from backend.app.services.object_storage import StoredObject


def _tiny_jpeg_b64() -> str:
    # 1x1 red JPEG
    return base64.b64encode(
        bytes.fromhex(
            "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707"
            "070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c"
            "1c2837292c30313434341f27393d38323c2e333432ffdb0043010909090c0b0c180d"
            "0d1832211c2132323232323232323232323232323232323232323232323232323232"
            "323232323232ffc00011080001000103011100021100031100ffc4001500010100000000"
            "00000000000000000000000008ffc40014100100000000000000000000000000000000"
            "00ffda000c03010002110311003f00aa3f0000ffd9"
        )
    ).decode()


def _session_row():
    return {
        "id": "sess-1",
        "organization_id": "org-1",
        "worker_id": "worker-1",
        "support_worker_id": None,
        "owner_user_id": None,
        "created_by": None,
        "task_evidence": [],
    }


@patch("backend.app.services.evidence_upload_service.upload_evidence_bytes")
@patch("backend.app.services.evidence_upload_service.get_supabase_admin")
def test_upload_photo_stores_file_and_metadata(mock_admin, mock_upload):
    mock_upload.return_value = StoredObject(
        storage_path="org-1/sess-1/evidence/evid-abc.jpg",
        file_url="https://example.com/evid.jpg",
        provider="supabase",
    )

    supabase = MagicMock()
    mock_admin.return_value = supabase

    table = MagicMock()
    supabase.table.return_value = table
    select_chain = MagicMock()
    table.select.return_value = select_chain
    select_chain.eq.return_value = select_chain
    select_chain.limit.return_value = select_chain
    select_chain.execute.return_value = MagicMock(data=[_session_row()])

    update_chain = MagicMock()
    table.update.return_value = update_chain
    update_chain.eq.return_value = update_chain
    update_chain.execute.return_value = MagicMock(data=[{}])

    evidence_id = "evid-abc"
    result = evidence_upload_service.upload_session_evidence_media(
        session_id="sess-1",
        worker_id="worker-1",
        organization_id="org-1",
        evidence_items=[
            {
                "evidence_id": evidence_id,
                "task_id": "task-1",
                "type": "photo",
                "mime_type": "image/jpeg",
                "created_at": "2026-01-15T14:45:00Z",
            }
        ],
        files={evidence_id: _tiny_jpeg_b64()},
        uploaded_by="worker-1",
    )

    assert result is not None
    assert result["success"] is True
    assert len(result["uploaded_evidence"]) == 1
    assert result["uploaded_evidence"][0]["evidence_id"] == evidence_id
    mock_upload.assert_called_once()
    upload_args = mock_upload.call_args
    assert upload_args[0][0].endswith(f"{evidence_id}.jpg")
    stored = result["task_evidence"][0]
    assert stored["file_url"] == "https://example.com/evid.jpg"
    assert stored["storage_provider"] == "supabase"
    assert stored["synced"] is True
    assert stored.get("content", "") == ""


@patch("backend.app.services.evidence_upload_service.get_supabase_admin")
def test_upload_rejects_oversized_file(mock_admin):
    supabase = MagicMock()
    mock_admin.return_value = supabase
    table = MagicMock()
    supabase.table.return_value = table
    select_chain = MagicMock()
    table.select.return_value = select_chain
    select_chain.eq.return_value = select_chain
    select_chain.limit.return_value = select_chain
    select_chain.execute.return_value = MagicMock(data=[_session_row()])

    evidence_id = "evid-big"
    huge = base64.b64encode(b"x" * (3 * 1024 * 1024)).decode()
    with pytest.raises(ValueError, match="exceeds"):
        evidence_upload_service.upload_session_evidence_media(
            session_id="sess-1",
            worker_id="worker-1",
            organization_id="org-1",
            evidence_items=[
                {
                    "evidence_id": evidence_id,
                    "task_id": "task-1",
                    "type": "photo",
                    "mime_type": "image/jpeg",
                    "created_at": "2026-01-15T14:45:00Z",
                }
            ],
            files={evidence_id: huge},
            uploaded_by="worker-1",
        )


@patch("backend.app.services.evidence_upload_service.get_supabase_admin")
def test_upload_denies_unauthorized_worker(mock_admin):
    supabase = MagicMock()
    mock_admin.return_value = supabase
    table = MagicMock()
    supabase.table.return_value = table
    select_chain = MagicMock()
    table.select.return_value = select_chain
    select_chain.eq.return_value = select_chain
    select_chain.limit.return_value = select_chain
    select_chain.execute.return_value = MagicMock(data=[_session_row()])

    result = evidence_upload_service.upload_session_evidence_media(
        session_id="sess-1",
        worker_id="other-worker",
        organization_id="org-1",
        evidence_items=[],
        files={},
        uploaded_by="other-worker",
    )
    assert result is None
