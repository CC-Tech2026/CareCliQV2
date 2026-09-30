"""Consent & onboarding folder shows whether documents are actually signed."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from backend.app.services import audit_readiness_service as ar
from backend.app.services import vault_service


class _Query:
    """Chainable stand-in for a supabase query that returns fixed rows."""

    def __init__(self, rows):
        self._rows = rows

    def __getattr__(self, _name):
        return lambda *a, **k: self

    @property
    def not_(self):
        return self

    def execute(self):
        return MagicMock(data=self._rows)


def _client(tables: dict[str, list[dict]]):
    client = MagicMock()
    client.table.side_effect = lambda name: _Query(tables.get(name, []))
    return client


def test_folder_statuses():
    tables = {
        "worker_onboarding_documents": [
            {"id": "w1", "worker_id": "u1", "document_type": "offer_letter", "title": "Offer letter",
             "created_at": "2026-09-01", "signed_at": "2026-09-02T01:00:00Z"},
            {"id": "w2", "worker_id": "u1", "document_type": "other", "title": "Uploaded contract",
             "created_at": "2026-09-03", "signed_at": None},
        ],
        "employee_onboarding": [
            {"id": "h1", "full_name": "Priya Sharma", "status": "awaiting_signatures", "worker_signed_at": None},
            {"id": "h2", "full_name": "Aisha Khan", "status": "invited", "worker_signed_at": "2026-09-20T00:00:00Z"},
        ],
        "employee_onboarding_documents": [
            {"id": "d1", "onboarding_id": "h1", "title": "Offer letter", "created_at": "2026-09-28", "file_path": "a.pdf"},
            {"id": "d2", "onboarding_id": "h2", "title": "Offer letter", "created_at": "2026-09-18", "file_path": "b.pdf"},
        ],
        "ndis_plans": [
            {"id": "p1", "patient_id": "pt1", "status": "active", "agreement_status": "signed",
             "agreement_signed_at": "2026-09-30T00:00:00Z", "plan_start": "2026-10-01"},
            {"id": "p2", "patient_id": "pt2", "status": "active", "agreement_status": "unsigned", "plan_start": "2026-09-01"},
            {"id": "p3", "patient_id": "pt2", "status": "draft", "agreement_status": "unsigned", "plan_start": "2026-11-01"},
        ],
        "plan_meeting_sessions": [
            {"id": "c1", "participant_id": "pt1", "consent_confirmed_at": "2026-09-29T00:00:00Z"},
        ],
    }
    with patch.object(vault_service, "get_supabase_admin", return_value=_client(tables)), \
         patch.object(vault_service, "_user_name_map", return_value={"u1": "Tom Nguyen"}), \
         patch.object(vault_service, "_applicant_name_map", return_value={}), \
         patch.object(vault_service, "_patient_name_map", return_value={"pt1": "Liam Carter", "pt2": "Ella Davis"}):
        docs = {d["id"]: d for d in vault_service._list_consent_onboarding("org-1")}

    assert docs["w1"]["status"] == "signed"
    assert docs["w2"]["status"] == "on_file"  # no signing record: don't claim it
    assert (docs["d1"]["status"], docs["d1"]["person_name"]) == ("pending", "Priya Sharma")
    assert docs["d2"]["status"] == "signed"
    assert (docs["agreement-p1"]["title"], docs["agreement-p1"]["status"]) == ("Service agreement", "signed")
    assert docs["agreement-p2"]["status"] == "pending"
    assert "agreement-p3" not in docs  # draft plan
    assert (docs["c1"]["title"], docs["c1"]["status"]) == ("Consent to record", "signed")
    # Pending signatures count towards "flagged for review".
    assert "pending" in vault_service.FLAGGED_STATUSES


def test_expired_offer():
    assert vault_service.hire_offer_status({"status": "expired", "worker_signed_at": None}) == "expired"


def test_signed_offer_letter_evidences_the_contract_item():
    worker = "aaaaaaaa-0000-0000-0000-000000000001"
    data = ar.OrgData(
        workers=[{"id": worker, "full_name": "Tom"}],
        onboarding_documents=[
            {"id": "w1", "worker_id": worker, "document_type": "offer_letter", "title": "Offer letter",
             "signed_at": "2026-09-02T01:00:00Z"},
        ],
    )
    items = {i["requirement_code"]: i for i in ar.build_checklist(data, ar.AuditProfile(), {})}
    assert items["STAFF-CONTRACT"]["status"] == "current"

    data.onboarding_documents[0]["signed_at"] = None
    items = {i["requirement_code"]: i for i in ar.build_checklist(data, ar.AuditProfile(), {})}
    assert items["STAFF-CONTRACT"]["status"] == "awaiting_review"
    assert items["STAFF-CONTRACT"]["evidence"][0]["reviewable"] is True
