"""The organised vault folders file every document under one subfolder, and
the split categories (consent, credentials) follow the document's own kind."""
from __future__ import annotations

from backend.app.services import vault_service


def _doc(category, source_table="x", person_type="Worker", subtype=None):
    return {"id": "d", "category": category, "folder_label": "", "title": "", "person_name": "",
            "person_type": person_type, "date": "2026-09-01", "status": "on_file",
            "source_table": source_table, "source_id": "d", "has_stored_file": True, "subtype": subtype}


def test_governance_categories_are_their_own_subfolders():
    assert vault_service._tree_placement(_doc("risk_management")) == ("governance", "risk_management")
    assert vault_service._tree_placement(_doc("audit_packs", person_type="Organisation")) == ("governance", "audit_packs")


def test_participant_records_file_under_participant_folder():
    assert vault_service._tree_placement(_doc("session_notes")) == ("participant", "clinical_docs")
    assert vault_service._tree_placement(_doc("medication_records")) == ("participant", "clinical_docs")
    assert vault_service._tree_placement(_doc("incident_reports")) == ("participant", "incident_reports")
    assert vault_service._tree_placement(_doc("invoices")) == ("participant", "invoices")
    assert vault_service._tree_placement(_doc("ndis_plans")) == ("participant", "service_support")


def test_consent_is_split_by_who_it_is_about():
    intake = _doc("consent_onboarding", "participant_intakes", person_type="Participant")
    assert vault_service._tree_placement(intake) == ("participant", "intake_docs")
    agreement = _doc("consent_onboarding", "service_agreements", person_type="Participant")
    assert vault_service._tree_placement(agreement) == ("participant", "service_support")
    plan_agreement = _doc("consent_onboarding", "ndis_plans", person_type="Participant")
    assert vault_service._tree_placement(plan_agreement) == ("participant", "service_support")
    worker_offer = _doc("consent_onboarding", "employee_onboarding_documents", person_type="Worker")
    assert vault_service._tree_placement(worker_offer) == ("staff", "contracts_info")


def test_worker_credentials_are_filed_by_their_type():
    assert vault_service._tree_placement(_doc("worker_credentials", subtype="wwcc")) == ("staff", "checks")
    assert vault_service._tree_placement(_doc("worker_credentials", subtype="police_check")) == ("staff", "checks")
    assert vault_service._tree_placement(_doc("worker_credentials", subtype="first_aid")) == ("staff", "first_aid_cpr")
    assert vault_service._tree_placement(_doc("worker_credentials", subtype="drivers_licence")) == ("staff", "id_documents")
    assert vault_service._tree_placement(_doc("worker_credentials", subtype="manual_handling")) == (
        "staff", "training_qualifications")
    assert vault_service._tree_placement(_doc("worker_credentials", subtype="code_of_conduct")) == (
        "staff", "contracts_info")


def test_vehicle_credentials_file_under_vehicle_insurance_and_rego():
    for sub_type in ("vehicle_insurance", "vehicle_registration"):
        assert vault_service._tree_placement(_doc("worker_credentials", subtype=sub_type)) == (
            "staff", "vehicle_insurance")


# Every type the web team page, worker detail and mobile app let someone save.
OFFERED_CREDENTIAL_TYPES = [
    "ndis_screening", "wwcc", "code_of_conduct", "police_check", "Police Check", "first_aid", "cpr",
    "manual_handling", "infection_control", "medication_admin", "drivers_licence",
    "vehicle_registration", "vehicle_insurance", "qualification", "Other",
    "AHPRA Registration", "Professional Indemnity Insurance", "First Aid/CPR",
    "Discipline-specific Certificate",
]


def test_every_offered_credential_type_has_a_subfolder():
    for sub_type in OFFERED_CREDENTIAL_TYPES:
        assert vault_service._tree_placement(_doc("worker_credentials", subtype=sub_type)) is not None, sub_type


def test_unknown_credential_type_is_not_placed_by_fallback(caplog):
    with caplog.at_level("WARNING"):
        assert vault_service._tree_placement(_doc("worker_credentials", subtype="brand_new_type")) is None
        assert vault_service._tree_placement(_doc("worker_credentials", subtype=None)) is None
    assert "brand_new_type" in caplog.text


def test_custom_folder_documents_are_not_placed():
    assert vault_service._tree_placement(_doc("custom_folder:abc")) is None


def test_every_placement_target_is_a_listed_subfolder():
    listed = {(top, key) for top, subs in vault_service.VAULT_TREE_SUBFOLDERS.items() for key, _ in subs}
    targets = {
        vault_service._tree_placement(_doc(category, subtype=sub_type))
        for category in list(vault_service.CATEGORY_META) + ["consent_onboarding"]
        for sub_type in list(vault_service.STAFF_CREDENTIAL_SUBFOLDERS) + [None]
    }
    assert {t for t in targets if t} <= listed
