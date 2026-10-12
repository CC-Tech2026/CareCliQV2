"""The organised vault folders file every document under one subfolder, and
the split categories (consent, credentials) follow the document's own kind."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from backend.app.services import vault_service


def _doc(category, source_table="x", person_type="Worker", subtype=None, status="on_file",
         person_id=None, person_name="", doc_id="d"):
    return {"id": doc_id, "category": category, "folder_label": "", "title": "", "person_name": person_name,
            "person_type": person_type, "date": "2026-09-01", "status": status,
            "source_table": source_table, "source_id": doc_id, "has_stored_file": True, "subtype": subtype,
            "person_id": person_id}


def test_participant_records_file_under_participant_folder():
    assert vault_service._tree_placement(_doc("session_notes")) == ("participant", "clinical_docs")
    assert vault_service._tree_placement(_doc("medication_records")) == ("participant", "clinical_docs")
    assert vault_service._tree_placement(_doc("incident_reports")) == ("participant", "incident_reports")
    assert vault_service._tree_placement(_doc("invoices")) == ("participant", "invoices")
    assert vault_service._tree_placement(_doc("ndis_plans")) == ("participant", "service_support")


def test_consent_is_split_by_who_it_is_about():
    consent = _doc("consent_onboarding", "plan_meeting_sessions", person_type="Participant")
    assert vault_service._tree_placement(consent) == ("participant", "intake_docs")
    intake_agreement = _doc("consent_onboarding", "participant_intakes", person_type="Participant")
    assert vault_service._tree_placement(intake_agreement) == ("participant", "service_support")
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


def test_folder_state_complete_missing_expired_and_not_applicable():
    current = _doc("x", status="signed")
    expired = _doc("x", status="expired")
    rejected = _doc("x", status="rejected")
    assert vault_service._folder_state([current], True) == ("complete", [])
    assert vault_service._folder_state([], True) == ("missing", [])
    assert vault_service._folder_state([expired], True) == ("expired", [])
    assert vault_service._folder_state([rejected], True) == ("missing", [])
    assert vault_service._folder_state([], False) == ("not_applicable", [])
    assert vault_service._folder_state([expired], False) == ("complete", [])


def test_folder_state_names_each_required_credential_missing_or_lapsed():
    first_aid = _doc("worker_credentials", subtype="first_aid", status="valid")
    cpr = _doc("worker_credentials", subtype="cpr", status="expired")
    assert vault_service._folder_state([first_aid], True, ("first_aid", "cpr")) == ("missing", ["CPR"])
    assert vault_service._folder_state([first_aid, cpr], True, ("first_aid", "cpr")) == (
        "expired", ["CPR (expired)"])


def test_required_staff_credentials_come_from_the_onboarding_gate():
    from backend.app.services.onboarding_escalation_service import REQUIRED_CREDENTIAL_TYPES
    flat = [t for types in vault_service.REQUIRED_STAFF_CREDENTIALS.values() for t in types]
    assert sorted(flat) == sorted(REQUIRED_CREDENTIAL_TYPES)
    assert "id_documents" not in vault_service.REQUIRED_STAFF_CREDENTIALS


def _people(top, grouped, participants=None, workers=None):
    with patch.object(vault_service, "_tree_documents", return_value=grouped), \
         patch.object(vault_service, "_person_refs", return_value={"Participant": {}, "Worker": {}}), \
         patch.object(vault_service, "_participant_facts", return_value=participants or {}), \
         patch.object(vault_service, "_worker_facts", return_value=workers or {}):
        return {p["id"]: p for p in vault_service.list_tree_people("org-1", top)}


def _states(person):
    return {s["key"]: s["state"] for s in person["subfolders"]}


def _participant(active=True, **flags):
    return {"name": "Liam Carter", "active": active, "behaviour_support": False, "sil": False,
            "support_coordination": False, **flags}


def test_active_participant_with_no_documents_shows_required_gaps():
    people = _people("participant", {}, participants={"p1": _participant()})
    states = _states(people["p1"])
    assert states["service_support"] == states["intake_docs"] == states["emergency_risk"] == "missing"
    assert states["behaviour_support"] == states["sil_docs"] == states["support_coordination"] == "not_applicable"
    assert states["invoices"] == "not_applicable"
    assert people["p1"]["gap_count"] == 3


def test_participant_services_switch_their_folders_on():
    people = _people("participant", {}, participants={
        "p1": _participant(behaviour_support=True, sil=True, support_coordination=True)})
    states = _states(people["p1"])
    assert states["behaviour_support"] == states["sil_docs"] == states["support_coordination"] == "missing"


def test_exited_participant_has_no_gaps():
    people = _people("participant", {}, participants={"p1": _participant(active=False)})
    assert people["p1"]["status"] == "exited"
    assert people["p1"]["gap_count"] == 0


def test_purged_participant_is_not_active():
    rows = [{"id": "p1", "full_name": "Purged Participant 1", "plan_status": None, "is_purged": True},
            {"id": "p2", "full_name": "Liam Carter", "plan_status": None, "is_purged": False}]
    client = MagicMock()
    client.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(data=rows)
    client.table.return_value.select.return_value.eq.return_value.in_.return_value.execute.return_value = MagicMock(data=[])
    with patch.object(vault_service, "get_supabase_admin", return_value=client), \
         patch.object(vault_service, "_cached", side_effect=lambda key, compute: compute()):
        facts = vault_service._participant_facts("org-1")
    assert facts["p1"]["active"] is False
    assert facts["p2"]["active"] is True


def test_documents_file_under_their_person():
    agreement = _doc("consent_onboarding", "service_agreements", person_type="Participant",
                     status="signed", person_id="p1")
    people = _people("participant", {("participant", "service_support"): [agreement]},
                     participants={"p1": _participant(), "p2": _participant()})
    assert _states(people["p1"])["service_support"] == "complete"
    assert _states(people["p2"])["service_support"] == "missing"


def test_someone_not_yet_a_participant_gets_a_folder_by_name_with_no_gaps():
    intake = _doc("consent_onboarding", "participant_intakes", person_type="Participant",
                  status="signed", person_name="Ava  Nguyen")
    people = _people("participant", {("participant", "service_support"): [intake]})
    person = people["name:ava nguyen"]
    assert person["status"] == "prospective"
    assert person["document_count"] == 1
    assert person["gap_count"] == 0


def _worker(support_worker=True, active=True):
    return {"name": "Sam Lee", "support_worker": support_worker, "active": active}


def test_worker_checks_list_what_is_missing_and_vehicle_needs_a_licence():
    screening = _doc("worker_credentials", subtype="ndis_screening", status="valid", person_id="w1")
    people = _people("staff", {("staff", "checks"): [screening]}, workers={"w1": _worker()})
    checks = next(s for s in people["w1"]["subfolders"] if s["key"] == "checks")
    assert checks["state"] == "missing"
    assert checks["missing"] == ["Working with Children Check"]
    assert _states(people["w1"])["vehicle_insurance"] == "not_applicable"
    assert _states(people["w1"])["id_documents"] == "not_applicable"

    licence = _doc("worker_credentials", subtype="drivers_licence", status="valid", person_id="w1", doc_id="l")
    people = _people("staff", {("staff", "id_documents"): [licence]}, workers={"w1": _worker()})
    assert _states(people["w1"])["vehicle_insurance"] == "missing"


def test_office_staff_are_listed_only_with_documents_and_have_no_requirements():
    people = _people("staff", {}, workers={"w1": _worker(), "c1": _worker(support_worker=False)})
    assert set(people) == {"w1"}
    cred = _doc("worker_credentials", subtype="first_aid", status="valid", person_id="c1")
    people = _people("staff", {("staff", "first_aid_cpr"): [cred]}, workers={"c1": _worker(support_worker=False)})
    assert people["c1"]["gap_count"] == 0


def _tree(grouped=None, groups=()):
    with patch.object(vault_service, "_tree_documents", return_value=grouped or {}), \
         patch.object(vault_service, "_person_refs", return_value={"Participant": {}, "Worker": {}}), \
         patch.object(vault_service, "_participant_facts", return_value={"p1": _participant()}), \
         patch.object(vault_service, "_worker_facts", return_value={"w1": _worker()}), \
         patch.object(vault_service, "_registered_groups", return_value=frozenset(groups)):
        return {t["key"]: t for t in vault_service.list_vault_tree("org-1")}


def test_tree_shows_every_subfolder_with_gap_totals():
    tree = _tree()
    for top, subs in vault_service.VAULT_TREE_SUBFOLDERS.items():
        assert [s["key"] for s in tree[top]["subfolders"]] == [key for key, _ in subs]
    assert tree["participant"]["gap_count"] == 3
    assert tree["participant"]["gap_people"] == 1
    assert tree["staff"]["gap_count"] == 4
    governance = {s["key"]: s["state"] for s in tree["governance"]["subfolders"]}
    assert governance["gov_insurances"] == governance["gov_ndis_registration"] == "missing"
    assert governance["gov_meeting_minutes"] == "not_applicable"
    assert tree["governance"]["gap_count"] == len(vault_service.REQUIRED_GOVERNANCE_SUBFOLDERS)


def test_vault_opens_in_the_four_folders_of_the_audit_structure():
    assert list(vault_service.VAULT_TREE_TOPS.values()) == [
        "Governance", "Participant Folder", "Policy & Procedures", "Staff Folder"]
    assert [label for _, label in vault_service.VAULT_TREE_SUBFOLDERS["governance"]] == [
        "Business & Continuity Plan", "Conflict of Interest", "Emergency Management", "Feedback & Complaints",
        "Incident Management", "Insurances", "Meeting Minutes", "NDIS Registration", "Quality Management",
        "Risk Management", "Training"]
    assert [label for _, label in vault_service.VAULT_TREE_SUBFOLDERS["policy"]] == [
        "Core Module", "Module 1", "Module 2", "Module 3", "Module 4", "Module 5", "Module 5A"]


def test_policies_sit_under_core_module_and_audit_packs_under_quality():
    assert vault_service._tree_placement(_doc("risk_management")) == ("policy", "core_module")
    assert vault_service._tree_placement(_doc("policy_module_2")) == ("policy", "policy_module_2")
    assert vault_service._tree_placement(_doc("gov_insurances")) == ("governance", "gov_insurances")
    assert vault_service._tree_placement(_doc("audit_packs", person_type="Organisation")) == (
        "governance", "gov_quality_management")


def test_core_module_lists_its_nine_policy_areas_and_the_empty_ones():
    policy = _doc("risk_management", status="on_file")
    tree = _tree({("policy", "core_module"): [policy]})
    core = tree["policy"]["subfolders"][0]
    assert [s["key"] for s in core["sections"]] == list(vault_service.POLICY_CORE_KEYS)
    assert core["state"] == "missing"
    assert core["gap_count"] == 8
    assert "Risk Management" not in core["missing"]


def test_modules_apply_by_registration_group():
    tree = _tree(groups={"0110"})
    modules = {s["key"]: s["state"] for s in tree["policy"]["subfolders"]}
    assert modules["policy_module_2"] == "missing"
    assert modules["policy_module_1"] == modules["policy_module_5a"] == "not_applicable"


def test_governance_upload_expiry_status():
    from datetime import date, timedelta
    today = date.today()
    assert vault_service.governance_expiry_status(None) == "on_file"
    assert vault_service.governance_expiry_status((today + timedelta(days=400)).isoformat()) == "on_file"
    assert vault_service.governance_expiry_status((today + timedelta(days=10)).isoformat()) == "expiring"
    assert vault_service.governance_expiry_status((today - timedelta(days=1)).isoformat()) == "expired"


def test_expired_insurance_is_a_gap():
    insurance = _doc("gov_insurances", status="expired", person_type="Organisation")
    tree = _tree({("governance", "gov_insurances"): [insurance]})
    states = {s["key"]: s["state"] for s in tree["governance"]["subfolders"]}
    assert states["gov_insurances"] == "expired"


def test_folder_pages_know_where_they_sit_in_the_tree():
    assert [c["label"] for c in vault_service.category_tree_path("risk_management")] == [
        "Policy & Procedures", "Core Module"]
    assert [c["label"] for c in vault_service.category_tree_path("gov_insurances")] == ["Governance"]
    assert vault_service.category_tree_path("session_notes") == []


def test_search_matches_name_title_id_or_folder_and_gives_the_path():
    agreement = _doc("consent_onboarding", "service_agreements", person_type="Participant",
                     status="signed", person_id="p1", person_name="Liam Carter", doc_id="a")
    agreement["title"] = "Service agreement SA-2026-0001"
    agreement["doc_id"] = "SUNR-AGR-000001"
    insurance = _doc("gov_insurances", person_type="Organisation", status="expiring", doc_id="i")
    insurance["title"] = "Public liability certificate"
    grouped = {("participant", "service_support"): [agreement], ("governance", "gov_insurances"): [insurance]}

    def search(q="", flagged=False):
        with patch.object(vault_service, "_tree_documents", return_value=grouped), \
             patch.object(vault_service, "_person_refs", return_value={"Participant": {}, "Worker": {}}), \
             patch.object(vault_service, "_participant_facts", return_value={"p1": _participant()}), \
             patch.object(vault_service, "_worker_facts", return_value={}):
            return vault_service.search_vault_tree("org-1", q, flagged)

    for q in ("liam", "SUNR-AGR-000001", "service a & support", "sa-2026"):
        results = search(q)
        assert [r["document"]["id"] for r in results] == ["a"], q
    assert results[0]["path"] == ["Participant Folder", "Liam Carter", "Service A & Support P"]
    assert results[0]["href"] == "/md/vault/tree/participant/person/p1/service_support"
    assert [r["document"]["id"] for r in search("insurances")] == ["i"]
    assert search("insurances")[0]["href"] == "/md/vault/gov_insurances"
    assert [r["document"]["id"] for r in search(flagged=True)] == ["i"]
    assert search() == []


def test_subfolder_documents_filter_to_one_person():
    a = _doc("invoices", person_type="Participant", person_id="p1", doc_id="a")
    b = _doc("invoices", person_type="Participant", person_id="p2", doc_id="b")
    with patch.object(vault_service, "_tree_documents", return_value={("participant", "invoices"): [a, b]}):
        assert [d["id"] for d in vault_service.list_tree_subfolder_documents("o", "participant", "invoices", "p1")] == ["a"]
        assert len(vault_service.list_tree_subfolder_documents("o", "participant", "invoices")) == 2
