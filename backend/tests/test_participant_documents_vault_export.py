"""Documents imported on the director's participant profile appear in the
vault's participant folders and can be included in the records export."""

import pytest
from fastapi import HTTPException
from unittest.mock import MagicMock, patch

from backend.app.services import participant_records_service, vault_service

MD = {"id": "u-1", "role": "managing_director", "organization_id": "org-1"}


def _doc(kind):
    return {
        "id": "d-1", "category": "participant_documents", "subtype": kind,
        "source_table": "participant_documents", "person_type": "Participant",
    }


@pytest.mark.parametrize("kind, subfolder", [
    ("gp_letter", "clinical_docs"),
    ("clinical_assessment", "clinical_docs"),
    ("therapy_report", "clinical_docs"),
    ("other", "clinical_docs"),
    ("behaviour_support_plan", "behaviour_support"),
    ("risk_assessment", "emergency_risk"),
    ("ndis_plan", "service_support"),
    ("consent", "intake_docs"),
])
def test_each_kind_files_into_its_participant_subfolder(kind, subfolder):
    assert vault_service._tree_placement(_doc(kind)) == ("participant", subfolder)


def test_participant_documents_are_a_registered_vault_category():
    assert "participant_documents" in vault_service.CATEGORY_META
    assert vault_service._RECORD_LOADERS["participant_documents"] is vault_service._list_participant_documents
    assert vault_service._RECORD_RENDERERS["participant_documents"] is vault_service._render_participant_document
    assert vault_service.DOC_TYPE_CODES["participant_documents"] == "CLN"


def test_vault_listing_is_empty_before_the_migration():
    admin = MagicMock()
    admin.table.side_effect = Exception('relation "participant_documents" does not exist')
    with patch.object(vault_service, "get_supabase_admin", return_value=admin):
        assert vault_service._list_participant_documents("org-1") == []


@pytest.mark.asyncio
async def test_documents_cannot_be_a_single_pdf():
    with pytest.raises(HTTPException) as exc:
        await participant_records_service.export_records(MD, "p-1", [], [], "pdf", include_documents=True)
    assert exc.value.status_code == 422
    assert "ZIP" in exc.value.detail


def test_export_only_takes_files_stored_under_this_participant():
    own = MagicMock()
    own.execute.return_value.data = [
        {"id": "a", "category": "gp_letter", "title": "GP summary", "document_date": "2026-10-20", "uploaded_at": None,
         "file_path": "org-1/p-1/a.pdf"},
        {"id": "b", "category": "other", "title": "Someone else's", "document_date": None, "uploaded_at": "2026-10-21",
         "file_path": "org-1/p-2/b.pdf"},
    ]
    admin = MagicMock()
    admin.table.return_value.select.return_value.eq.return_value.eq.return_value.is_.return_value.order.return_value = own
    admin.storage.from_.return_value.download.return_value = b"%PDF-1.4"
    with patch.object(participant_records_service, "get_supabase_admin", return_value=admin), \
         patch("backend.app.services.medication_document_service.list_documents_for_participant", return_value=[]):
        files, manifest, unreadable = participant_records_service._document_files("org-1", "p-1")
    assert list(files) == ["Documents/GP letter/2026-10-20 GP summary.pdf"]
    assert unreadable == ["Someone else's"]
    assert manifest[0]["kind"] == "GP letter"
