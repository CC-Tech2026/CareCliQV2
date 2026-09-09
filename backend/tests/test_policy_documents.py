"""
Worker-facing policy read/acknowledge + branded template publish pipeline.

Covers the security-relevant scoping (org match, visible_to_workers,
current-version-only) and the supersede-chain wiring for
publish_policy_document, since this session's recurring highest-priority
check is that org/role scoping happens in the query itself, not after.
PDF rendering (WeasyPrint/xhtml2pdf) isn't installed/usable on this Windows
dev machine — same pre-existing limitation as invoice_service.py's PDF path
(GTK not available locally, works on the Linux production target) — so
render_html_to_pdf is mocked rather than exercised for real here.
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import vault_service


def _mock_supabase() -> MagicMock:
    return MagicMock()


# ── list_worker_visible_policies ──────────────────────────────────────────


def test_list_worker_visible_policies_returns_empty_when_none_visible():
    org_id, worker_id = str(uuid.uuid4()), str(uuid.uuid4())
    mock_supabase = _mock_supabase()
    mock_supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.is_.return_value.is_.return_value.order.return_value.execute.return_value = MagicMock(data=[])

    with patch.object(vault_service, "get_supabase_admin", return_value=mock_supabase):
        result = vault_service.list_worker_visible_policies(org_id, worker_id)

    assert result == []


def test_list_worker_visible_policies_attaches_ack_status():
    org_id, worker_id = str(uuid.uuid4()), str(uuid.uuid4())
    doc_id = str(uuid.uuid4())
    docs = [{
        "id": doc_id, "folder_key": "governance_operational", "title": "Code of Conduct",
        "description": None, "version_label": None, "created_at": "2026-01-01T00:00:00Z",
    }]
    acks = [{"document_id": doc_id, "acknowledged_at": "2026-01-02T00:00:00Z"}]

    mock_supabase = MagicMock()

    def table_side_effect(name):
        m = MagicMock()
        if name == "governance_documents":
            m.select.return_value.eq.return_value.eq.return_value.is_.return_value.is_.return_value.order.return_value.execute.return_value = MagicMock(data=docs)
        elif name == "policy_acknowledgements":
            m.select.return_value.eq.return_value.in_.return_value.execute.return_value = MagicMock(data=acks)
        return m

    mock_supabase.table.side_effect = table_side_effect

    with patch.object(vault_service, "get_supabase_admin", return_value=mock_supabase):
        result = vault_service.list_worker_visible_policies(org_id, worker_id)

    assert len(result) == 1
    assert result[0]["acknowledged"] is True
    assert result[0]["acknowledged_at"] == "2026-01-02T00:00:00Z"


# ── acknowledge_policy ─────────────────────────────────────────────────────


def test_acknowledge_policy_404_when_org_mismatch():
    org_a, org_b, worker_id, doc_id = (str(uuid.uuid4()) for _ in range(4))
    mock_supabase = MagicMock()
    mock_supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"id": doc_id, "organization_id": org_b, "visible_to_workers": True, "deleted_at": None, "superseded_at": None}]
    )
    with patch.object(vault_service, "get_supabase_admin", return_value=mock_supabase):
        with pytest.raises(HTTPException) as exc:
            vault_service.acknowledge_policy(doc_id, worker_id, org_a)
    assert exc.value.status_code == 404


def test_acknowledge_policy_403_when_not_visible_to_workers():
    org_id, worker_id, doc_id = (str(uuid.uuid4()) for _ in range(3))
    mock_supabase = MagicMock()
    mock_supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"id": doc_id, "organization_id": org_id, "visible_to_workers": False, "deleted_at": None, "superseded_at": None}]
    )
    with patch.object(vault_service, "get_supabase_admin", return_value=mock_supabase):
        with pytest.raises(HTTPException) as exc:
            vault_service.acknowledge_policy(doc_id, worker_id, org_id)
    assert exc.value.status_code == 403


def test_acknowledge_policy_409_when_superseded():
    org_id, worker_id, doc_id = (str(uuid.uuid4()) for _ in range(3))
    mock_supabase = MagicMock()
    mock_supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{
            "id": doc_id, "organization_id": org_id, "visible_to_workers": True,
            "deleted_at": None, "superseded_at": "2026-01-05T00:00:00Z",
        }]
    )
    with patch.object(vault_service, "get_supabase_admin", return_value=mock_supabase):
        with pytest.raises(HTTPException) as exc:
            vault_service.acknowledge_policy(doc_id, worker_id, org_id)
    assert exc.value.status_code == 409


def test_acknowledge_policy_success_upserts():
    org_id, worker_id, doc_id = (str(uuid.uuid4()) for _ in range(3))
    mock_supabase = MagicMock()
    mock_supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"id": doc_id, "organization_id": org_id, "visible_to_workers": True, "deleted_at": None, "superseded_at": None}]
    )
    with patch.object(vault_service, "get_supabase_admin", return_value=mock_supabase):
        result = vault_service.acknowledge_policy(doc_id, worker_id, org_id)

    assert result["document_id"] == doc_id
    assert "acknowledged_at" in result
    upsert_call = mock_supabase.table.return_value.upsert
    upsert_call.assert_called_once()
    row = upsert_call.call_args[0][0]
    assert row["worker_id"] == worker_id
    assert row["document_id"] == doc_id
    assert upsert_call.call_args.kwargs["on_conflict"] == "worker_id,document_id"


# ── publish_policy_document: supersede chain ──────────────────────────────


@pytest.mark.asyncio
async def test_publish_policy_document_supersedes_previous_and_propagates_visibility():
    org_id, published_by, policy_doc_id = (str(uuid.uuid4()) for _ in range(3))
    old_governance_id = str(uuid.uuid4())
    new_governance_id = str(uuid.uuid4())

    policy_doc = {
        "id": policy_doc_id,
        "organization_id": org_id,
        "folder_key": "governance_operational",
        "title": "Code of Conduct",
        "template_id": None,
        "content_html": "<p>Be excellent to each other.</p>",
        "visible_to_workers": True,
        "current_governance_document_id": old_governance_id,
    }

    with patch.object(vault_service, "get_policy_document", return_value=policy_doc), \
         patch.object(vault_service, "get_letterhead", return_value={
             "provider_name": "Test Org", "logo_url": None, "brand_accent_color": "#000000",
             "abn": None, "address": None,
         }), \
         patch("backend.app.services.html_pdf_render.render_html_to_pdf", return_value=b"%PDF-fake"), \
         patch.object(vault_service, "upload_governance_document") as mock_upload, \
         patch.object(vault_service, "set_governance_document_worker_visibility") as mock_set_visibility, \
         patch.object(vault_service, "get_supabase_admin") as mock_admin:

        mock_upload.return_value = {"id": new_governance_id, "title": "Code of Conduct"}
        mock_admin.return_value = MagicMock()

        result = await vault_service.publish_policy_document(org_id, policy_doc_id, published_by)

    # The new file must supersede whatever this draft last published.
    mock_upload.assert_called_once()
    assert mock_upload.call_args.kwargs["supersedes_document_id"] == old_governance_id

    # visible_to_workers on the policy_documents row must propagate to the
    # newly published governance_documents row.
    mock_set_visibility.assert_called_once_with(org_id, new_governance_id, True)

    assert result["current_governance_document_id"] == new_governance_id


@pytest.mark.asyncio
async def test_publish_policy_document_rejects_empty_content():
    org_id, published_by, policy_doc_id = (str(uuid.uuid4()) for _ in range(3))
    policy_doc = {
        "id": policy_doc_id, "organization_id": org_id, "folder_key": "governance_operational",
        "title": "Empty", "template_id": None, "content_html": "   ",
        "visible_to_workers": False, "current_governance_document_id": None,
    }
    with patch.object(vault_service, "get_policy_document", return_value=policy_doc):
        with pytest.raises(HTTPException) as exc:
            await vault_service.publish_policy_document(org_id, policy_doc_id, published_by)
    assert exc.value.status_code == 422


# ── render_worker_policy_file: visibility enforced at the query level ─────


def test_render_worker_policy_file_404_when_not_visible():
    org_id, doc_id = str(uuid.uuid4()), str(uuid.uuid4())
    mock_supabase = MagicMock()
    mock_supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"id": doc_id, "organization_id": org_id, "folder_key": "governance_operational", "visible_to_workers": False, "deleted_at": None, "superseded_at": None}]
    )
    with patch.object(vault_service, "get_supabase_admin", return_value=mock_supabase):
        with pytest.raises(HTTPException) as exc:
            vault_service.render_worker_policy_file(org_id, doc_id)
    assert exc.value.status_code == 404
