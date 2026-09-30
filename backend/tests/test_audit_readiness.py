"""Audit Readiness stage 1: applicability, evidence status and the API guards."""
from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.app.api import audit_readiness as api
from backend.app.core.security import get_current_user
from backend.app.main import app
from backend.app.services import audit_readiness_service as ar

TODAY = date(2026, 9, 30)
WORKER = "aaaaaaaa-0000-0000-0000-000000000001"
PARTICIPANT = "bbbbbbbb-0000-0000-0000-000000000001"


def _items(data: ar.OrgData, profile: ar.AuditProfile = ar.AuditProfile(), settings=None):
    return {
        (i["requirement_code"], i["subject_id"]): i
        for i in ar.build_checklist(data, profile, settings or {}, today=TODAY)
    }


# ── Applicability ────────────────────────────────────────────────────────


def test_conditional_requirements_follow_registration_groups():
    wwcc = ar.REQUIREMENTS_BY_CODE["STAFF-WWCC"]
    applies, _ = ar.applicability(wwcc, ar.AuditProfile())
    assert not applies
    applies, why = ar.applicability(wwcc, ar.AuditProfile(registration_groups=("0118",)))
    assert applies and "0118" in why
    applies, _ = ar.applicability(wwcc, ar.AuditProfile(service_flags=("children",)))
    assert applies


def test_certification_only_requirements_drop_out_of_a_verification_audit():
    internal_audit = ar.REQUIREMENTS_BY_CODE["QUAL-INTERNAL-AUDIT"]
    assert ar.applicability(internal_audit, ar.AuditProfile(audit_type="verification"))[0] is False
    assert ar.applicability(internal_audit, ar.AuditProfile(audit_type="certification"))[0] is True
    # Until the audit type is set, include it rather than hide a possible gap.
    assert ar.applicability(internal_audit, ar.AuditProfile())[0] is True


def test_disabled_requirement_is_left_off_the_checklist():
    data = ar.OrgData(workers=[{"id": WORKER, "full_name": "Wren"}])
    items = _items(data, settings={"STAFF-POLICE": {"is_enabled": False}})
    assert ("STAFF-POLICE", WORKER) not in items
    assert ("STAFF-SCREENING", WORKER) in items


def test_catalogue_never_claims_compliance():
    text = " ".join(f"{r.title} {r.description} {r.evidence_hint}" for r in ar.REQUIREMENTS).lower()
    assert "compliant" not in text


# ── Evidence status ──────────────────────────────────────────────────────


def _cred(**kw):
    base = {"id": "c1", "user_id": WORKER, "credential_type": "ndis_screening", "title": "Screening",
            "status": "valid", "issue_date": "2025-01-01", "expiry_date": "2030-01-01"}
    return {**base, **kw}


@pytest.mark.parametrize(
    "cred, expected",
    [
        (_cred(), "current"),
        (_cred(expiry_date="2026-10-20"), "due_soon"),
        (_cred(expiry_date="2026-09-01"), "overdue"),
        (_cred(status="pending_review"), "awaiting_review"),
    ],
)
def test_screening_status_comes_from_the_credential(cred, expected):
    data = ar.OrgData(workers=[{"id": WORKER, "full_name": "Wren"}], credentials=[cred])
    assert _items(data)[("STAFF-SCREENING", WORKER)]["status"] == expected


def test_no_credential_is_missing_and_rejected_one_does_not_count():
    data = ar.OrgData(workers=[{"id": WORKER, "full_name": "Wren"}], credentials=[_cred(status="rejected")])
    item = _items(data)[("STAFF-SCREENING", WORKER)]
    assert item["status"] == "missing"
    assert "screening" in item["next_action"].lower()


def test_police_check_recheck_is_the_orgs_setting_not_a_fixed_rule():
    cred = _cred(credential_type="police_check", expiry_date=None, issue_date="2023-06-01")
    data = ar.OrgData(workers=[{"id": WORKER, "full_name": "Wren"}], credentials=[cred])
    # No recheck interval by default: a police check is a point-in-time record.
    assert _items(data)[("STAFF-POLICE", WORKER)]["status"] == "current"
    settings = {"STAFF-POLICE": {"is_enabled": True, "review_interval_days": 3 * 365}}
    item = _items(data, settings=settings)[("STAFF-POLICE", WORKER)]
    assert item["status"] == "overdue"


def test_best_evidence_wins():
    creds = [_cred(id="old", expiry_date="2026-01-01"), _cred(id="new", status="pending_review")]
    data = ar.OrgData(workers=[{"id": WORKER, "full_name": "Wren"}], credentials=creds)
    assert _items(data)[("STAFF-SCREENING", WORKER)]["status"] == "awaiting_review"


def test_governance_document_awaits_review_until_approved():
    doc = {"id": "g1", "title": "Complaints policy", "folder_key": "feedback_complaints", "created_at": "2026-02-01"}
    data = ar.OrgData(governance_documents=[doc])
    item = _items(data)[("GOV-COMPLAINTS", None)]
    assert item["status"] == "awaiting_review"
    assert item["evidence"][0]["reviewable"] is True

    approved = {"id": "l1", "requirement_code": "GOV-COMPLAINTS", "subject_type": "organisation", "subject_id": None,
                "source_table": "governance_documents", "source_id": "g1", "review_status": "approved",
                "reviewed_at": "2026-03-01T00:00:00Z", "reviewed_by": "u1"}
    data.links = [approved]
    data.user_names = {"u1": "Maria Director"}
    item = _items(data)[("GOV-COMPLAINTS", None)]
    assert item["status"] == "current"
    assert item["evidence"][0]["reviewed_by"] == "Maria Director"
    # Annual review: approved 2026-03-01, so due 2027-03-01 — not yet due soon.
    assert item["due_date"] == "2027-03-01"


def test_linked_document_with_expiry_goes_overdue():
    link = {"id": "l2", "requirement_code": "INS-PUBLIC-LIABILITY", "subject_type": "organisation",
            "subject_id": None, "source_table": "vault_custom_files", "source_id": "f1",
            "source_title": "Certificate of currency", "review_status": "approved",
            "reviewed_at": "2025-09-01T00:00:00Z", "expiry_date": "2026-09-15"}
    item = _items(ar.OrgData(links=[link]))[("INS-PUBLIC-LIABILITY", None)]
    assert item["status"] == "overdue"
    assert item["evidence"][0]["title"] == "Certificate of currency"


def test_rejected_link_removes_self_approved_record_from_counting():
    link = {"id": "l3", "requirement_code": "STAFF-SCREENING", "subject_type": "worker", "subject_id": WORKER,
            "source_table": "credentials", "source_id": "c1", "review_status": "rejected",
            "review_note": "Wrong person's clearance"}
    data = ar.OrgData(workers=[{"id": WORKER, "full_name": "Wren"}], credentials=[_cred()], links=[link])
    assert _items(data)[("STAFF-SCREENING", WORKER)]["status"] == "missing"


def test_service_agreement_from_plan_or_agreement_table():
    participant = {"id": PARTICIPANT, "full_name": "Pat"}
    unsigned = {"id": "p1", "patient_id": PARTICIPANT, "plan_start": "2026-01-01", "plan_end": "2027-01-01",
                "status": "active", "agreement_status": "unsigned"}
    data = ar.OrgData(participants=[participant], ndis_plans=[unsigned])
    assert _items(data)[("PART-AGREEMENT", PARTICIPANT)]["status"] == "missing"
    data.ndis_plans = [{**unsigned, "agreement_status": "signed"}]
    assert _items(data)[("PART-AGREEMENT", PARTICIPANT)]["status"] == "current"
    data.ndis_plans = []
    data.service_agreements = [{"id": "sa1", "participant_id": PARTICIPANT, "status": "active",
                                "start_date": "2026-01-01", "end_date": "2026-11-01"}]
    assert _items(data)[("PART-AGREEMENT", PARTICIPANT)]["status"] == "due_soon"


def test_induction_needs_every_mandatory_item():
    data = ar.OrgData(
        workers=[{"id": WORKER, "full_name": "Wren"}],
        mandatory_induction_items={"i1", "i2"},
        induction_completions=[{"id": "x", "worker_id": WORKER, "item_id": "i1", "completed_at": "2026-05-01"}],
    )
    item = _items(data)[("STAFF-INDUCTION", WORKER)]
    assert item["status"] == "missing"
    assert "1 of 2" in item["evidence"][0]["detail"]
    data.induction_completions.append({"id": "y", "worker_id": WORKER, "item_id": "i2", "completed_at": "2026-05-02"})
    assert _items(data)[("STAFF-INDUCTION", WORKER)]["status"] == "current"


def test_not_applicable_decision_and_summary():
    na = {"id": "n1", "requirement_code": "INS-PROFESSIONAL-INDEMNITY", "subject_type": "organisation",
          "subject_id": None, "reason": "No professional advice services delivered.", "approved_by": "u1",
          "approved_at": "2026-09-01T00:00:00Z"}
    data = ar.OrgData(na_decisions=[na], user_names={"u1": "Maria Director"})
    items = ar.build_checklist(data, ar.AuditProfile(), {}, today=TODAY)
    item = next(i for i in items if i["requirement_code"] == "INS-PROFESSIONAL-INDEMNITY")
    assert item["status"] == "not_applicable"
    assert item["not_applicable"]["approved_by"] == "Maria Director"

    summary = ar.summarise(items)
    assert summary["counts"]["not_applicable"] == 1
    assert summary["applicable"] == summary["total"] - 1
    # Nothing is evidenced in an empty org, so every critical org item is a gap.
    critical_org = [i for i in items if i["critical"] and i["status"] == "missing"]
    assert summary["critical_gaps"] == len(critical_org) > 0
    assert summary["readiness_percent"] == 0


# ── API ──────────────────────────────────────────────────────────────────

MD = {"id": "md-1", "email": "md@example.com", "role": "managing_director", "organization_id": "org-1"}
WORKER_USER = {"id": "w-1", "email": "w@example.com", "role": "support_worker", "organization_id": "org-1"}


@pytest.fixture
def as_user():
    def _set(user):
        app.dependency_overrides[get_current_user] = lambda: user
        return TestClient(app)
    yield _set
    app.dependency_overrides.clear()


def test_support_workers_are_refused(as_user):
    with patch.object(api, "has_active_grant", return_value=False):
        res = as_user(WORKER_USER).get("/api/audit-readiness/checklist")
    assert res.status_code == 403


def test_na_needs_a_reason(as_user):
    res = as_user(MD).post("/api/audit-readiness/na-decisions", json={
        "requirement_code": "GOV-RISK", "subject_type": "organisation", "reason": "n/a",
    })
    assert res.status_code == 422


def test_scope_mismatch_is_rejected(as_user):
    res = as_user(MD).post("/api/audit-readiness/na-decisions", json={
        "requirement_code": "STAFF-SCREENING", "subject_type": "organisation",
        "reason": "Nobody here needs one, apparently",
    })
    assert res.status_code == 422


def test_rejecting_evidence_needs_a_note(as_user):
    with patch.object(ar, "subject_exists", return_value=True):
        res = as_user(MD).post("/api/audit-readiness/evidence-reviews", json={
            "requirement_code": "GOV-RISK", "subject_type": "organisation",
            "source_table": "governance_documents", "source_id": "g1", "decision": "rejected",
        })
    assert res.status_code == 422


def test_linking_a_document_outside_the_vault_is_refused(as_user):
    with patch.object(ar, "subject_exists", return_value=True), \
         patch.object(api.vault_service, "find_document", return_value=None):
        res = as_user(MD).post("/api/audit-readiness/evidence-links", json={
            "requirement_code": "INS-PUBLIC-LIABILITY", "subject_type": "organisation",
            "vault_category": "governance_operational", "document_id": "someone-elses",
        })
    assert res.status_code == 404


def test_reviewing_an_unlinked_non_governance_record_is_refused(as_user):
    with patch.object(ar, "subject_exists", return_value=True), \
         patch.object(ar, "find_live_link", return_value=None):
        res = as_user(MD).post("/api/audit-readiness/evidence-reviews", json={
            "requirement_code": "GOV-RISK", "subject_type": "organisation",
            "source_table": "credentials", "source_id": "c1", "decision": "approved",
        })
    assert res.status_code == 404


def test_approving_an_auto_found_policy_creates_and_reviews_a_link(as_user):
    doc = {"id": "g1", "title": "Risk framework", "folder_key": "risk_management"}
    with patch.object(ar, "subject_exists", return_value=True), \
         patch.object(ar, "find_live_link", return_value=None), \
         patch.object(ar, "governance_doc_in_folders", return_value=doc) as in_folders, \
         patch.object(ar, "create_link", return_value={"id": "l1"}) as create, \
         patch.object(ar, "review_link", return_value={"id": "l1", "review_status": "approved"}) as review, \
         patch.object(api, "log_action", new=AsyncMock()):
        res = as_user(MD).post("/api/audit-readiness/evidence-reviews", json={
            "requirement_code": "GOV-RISK", "subject_type": "organisation",
            "source_table": "governance_documents", "source_id": "g1", "decision": "approved",
            "expiry_date": "2027-06-30",
        })
    assert res.status_code == 200
    in_folders.assert_called_once_with("org-1", "g1", ("risk_management",))
    assert create.call_args.args[5:7] == ("governance_documents", "g1")
    assert review.call_args.args[2:4] == ("l1", "approved")
    assert review.call_args.args[5] == date(2027, 6, 30)
