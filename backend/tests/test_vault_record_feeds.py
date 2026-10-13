"""Governance folders show what the app records, not only uploads: the
complaints register and each complaint and piece of staff feedback, the
incident register, the training and policy acknowledgement registers."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import participant_complaint_service as complaints
from backend.app.services import vault_record_feeds as feeds

ORG = "org-1"

COMPLAINT = {
    "id": "c1", "participant_id": "p1", "participant_name": "Sam Rivera", "raised_by": "Mother",
    "subject": "Late visits", "description": "Worker arrived late three times.", "status": "resolved",
    "resolution_notes": "Rostered a new worker.", "responded_at": "2026-10-02T01:00:00Z", "responded_by": None,
    "filed_at": "2026-10-01T01:00:00Z", "created_at": "2026-10-01T01:00:00Z",
}
FEEDBACK = {
    "id": "f1", "reporter_id": "u1", "reporter_name": "Amara Worker", "category": "equipment",
    "title": "Hoist battery", "description": "The hoist battery won't hold charge.", "status": "open",
    "resolution_notes": None, "resolved_by": None, "resolved_by_name": None, "resolved_at": None,
    "created_at": "2026-10-03T01:00:00Z",
}


def _list(category: str) -> list[dict]:
    return feeds.list_feed_documents(ORG, category, folder_label="Folder", org_name="Sunshine")


def test_complaints_folder_lists_the_register_each_complaint_and_staff_feedback():
    with patch.object(feeds, "_complaints", return_value=[COMPLAINT]), \
         patch.object(feeds, "_staff_feedback", return_value=[FEEDBACK]):
        docs = _list("feedback_complaints")
    assert [d["id"] for d in docs] == ["register:complaints", "complaint:c1", "feedback:f1"]
    register, complaint, feedback = docs
    assert register["title"] == "Complaints register" and register["detail"].startswith("1 entry")
    assert complaint["title"] == "Complaint: Late visits"
    assert complaint["person_name"] == "Sam Rivera" and complaint["status"] == "resolved"
    assert complaint["source_table"] == "participant_complaints"
    assert feedback["person_type"] == "Worker" and feedback["source_table"] == "operational_feedback"


def test_registers_are_listed_even_when_empty():
    with patch.dict(feeds.REGISTERS["incidents"], {"load": lambda org: []}):
        docs = _list("incident_management_system")
    assert [d["title"] for d in docs] == ["Incident register"]
    assert docs[0]["detail"].startswith("0 entries")


def test_folders_without_app_records_list_nothing_extra():
    assert _list("continuity_of_supports") == []
    assert _list("risk_management") == []


def test_feed_ids_are_told_apart_from_uploaded_files():
    assert feeds.is_feed_document("register:incidents")
    assert feeds.is_feed_document("complaint:abc")
    assert not feeds.is_feed_document("8f0e2a1c-0000-4000-8000-000000000000")


def test_register_renders_a_pdf_of_the_live_rows():
    rows = [{"incident_date": "2026-09-25", "reference_number": "INC-1", "title": "Fall", "participant_name": "Noah",
             "severity": "medium", "status": "reported", "ndis_reportable": False}]
    with patch.dict(feeds.REGISTERS["incidents"], {"load": lambda org: rows}), \
         patch("backend.app.services.organization_branding_service.build_pdf_letterhead", return_value=([], "#1B1745")):
        name, data = feeds.render_feed_document(ORG, "incident_management_system", "register:incidents")
    assert name == "Incident-register.pdf"
    assert data.startswith(b"%PDF")


def test_a_complaint_renders_with_what_was_done():
    captured = {}

    def fake_pdf(org_id, title, meta, sections):
        captured.update(title=title, meta=dict(meta), sections=dict(sections))
        return b"%PDF-fake"

    with patch.object(complaints, "get_complaint", return_value=COMPLAINT), \
         patch("backend.app.services.vault_service._render_record_pdf", side_effect=fake_pdf):
        name, data = feeds.render_feed_document(ORG, "feedback_complaints", "complaint:c1")
    assert data == b"%PDF-fake" and name.startswith("Complaint-Late-visits")
    assert captured["meta"]["Participant"] == "Sam Rivera" and captured["meta"]["Status"] == "Resolved"
    assert captured["sections"]["What was done"] == "Rostered a new worker."


def test_a_feed_document_only_opens_from_its_own_folder():
    with pytest.raises(HTTPException) as wrong_folder:
        feeds.render_feed_document(ORG, "risk_management", "register:incidents")
    with pytest.raises(HTTPException) as wrong_kind:
        feeds.render_feed_document(ORG, "incident_management_system", "register:complaints")
    assert wrong_folder.value.status_code == 404 and wrong_kind.value.status_code == 404


# ── Complaints service ────────────────────────────────────────────────────

def _client(rows_by_call: list[list[dict]]):
    """A supabase stand-in returning successive result sets and recording writes."""
    client, calls = MagicMock(), {"writes": []}
    results = iter(rows_by_call)

    class Query:
        def __getattr__(self, name):
            if name in ("insert", "update"):
                return lambda payload: (calls["writes"].append((name, payload)), self)[1]
            return lambda *a, **k: self

        def execute(self):
            return SimpleNamespace(data=next(results, []))

    client.table.side_effect = lambda name: Query()
    return client, calls


def test_a_complaint_needs_a_subject_description_and_who_it_is_about():
    with pytest.raises(HTTPException):
        complaints.create_complaint(ORG, "u1", subject=" ", description="x", participant_name="Sam")
    with pytest.raises(HTTPException):
        complaints.create_complaint(ORG, "u1", subject="Late", description="x")


def test_logging_a_complaint_names_the_participant_from_their_record():
    client, calls = _client([[{"id": "p1", "full_name": "Sam Rivera"}], [{"id": "c9"}]])
    with patch.object(complaints, "get_supabase_admin", return_value=client):
        complaints.create_complaint(ORG, "u1", subject="Late visits", description="Late again.", participant_id="p1")
    (kind, payload), = calls["writes"]
    assert kind == "insert"
    assert payload["participant_name"] == "Sam Rivera" and payload["status"] == "open" and payload["created_by"] == "u1"


def test_resolving_needs_notes_and_records_who_responded():
    with pytest.raises(HTTPException) as no_notes:
        complaints.update_complaint(ORG, "c1", "u1", status="resolved", resolution_notes="  ")
    assert no_notes.value.status_code == 422

    client, calls = _client([[{"id": "c1"}], [{"id": "c1", "status": "resolved"}]])
    with patch.object(complaints, "get_supabase_admin", return_value=client):
        complaints.update_complaint(ORG, "c1", "u1", status="resolved", resolution_notes="Rostered a new worker.")
    (kind, patch_), = calls["writes"]
    assert kind == "update" and patch_["responded_by"] == "u1" and patch_["resolution_notes"] == "Rostered a new worker."


def test_complaints_list_is_empty_not_an_error_before_the_migration():
    client = MagicMock()
    client.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.side_effect = Exception(
        'relation "public.participant_complaints" does not exist'
    )
    with patch.object(complaints, "get_supabase_admin", return_value=client):
        assert complaints.list_complaints(ORG, raise_if_missing=False) == []
        with pytest.raises(HTTPException) as unavailable:
            complaints.list_complaints(ORG)
    assert unavailable.value.status_code == 503
