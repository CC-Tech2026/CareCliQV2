"""The vault's stat tiles open the records behind their numbers."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from backend.app.services import vault_service


def _doc(doc_id, status):
    return {"id": doc_id, "category": "incident_reports", "folder_label": "Incident Reports", "title": doc_id,
            "person_name": "P", "person_type": "Participant", "date": "2026-09-01", "status": status,
            "source_table": "incidents", "source_id": doc_id, "has_stored_file": False}


def test_flagged_only_uses_the_same_rule_as_the_count():
    docs = [_doc("a", "reported"), _doc("b", "closed"), _doc("c", "under_investigation")]
    with patch.object(vault_service, "_load_category_docs", return_value=docs), \
         patch.object(vault_service, "_load_all_category_docs", return_value={"incident_reports": docs}), \
         patch.object(vault_service, "get_supabase_admin"):
        flagged = vault_service.list_folder_documents("org-1", "incident_reports", flagged_only=True)
        stats = vault_service.list_vault_stats("org-1")
    assert [d["id"] for d in flagged] == ["a", "c"]
    assert stats["flagged_for_review"] == len(flagged)


def test_custom_folders_have_nothing_flagged():
    category = f"{vault_service.CUSTOM_FOLDER_PREFIX}abc"
    with patch.object(vault_service, "_load_category_docs", return_value=[_doc("x", "pending")]):
        assert vault_service.list_folder_documents("org-1", category, flagged_only=True) == []


def test_share_events_name_the_sharer_and_folders():
    events = [{
        "id": "e1", "created_at": "2026-09-20T01:00:00+00:00", "shared_by": "u1",
        "share_method": "download_zip", "folder_keys": ["incident_reports"],
        "document_count": 4, "recipient_hint": "auditor@example.com",
    }]
    tables = {"vault_share_events": MagicMock(), "users": MagicMock()}
    q = tables["vault_share_events"].select.return_value.eq.return_value.gte.return_value.order.return_value.limit.return_value
    q.execute.return_value = MagicMock(data=events)
    tables["users"].select.return_value.in_.return_value.execute.return_value = MagicMock(data=[{"id": "u1", "full_name": "Maria Director"}])
    client = MagicMock()
    client.table.side_effect = lambda name: tables[name]
    with patch.object(vault_service, "get_supabase_admin", return_value=client):
        result = vault_service.list_share_events("org-1")
    assert result == [{
        "id": "e1", "created_at": "2026-09-20T01:00:00+00:00", "shared_by_name": "Maria Director",
        "share_method": "download_zip", "folders": ["Incident Reports"], "document_count": 4,
        "recipient_hint": "auditor@example.com",
    }]
