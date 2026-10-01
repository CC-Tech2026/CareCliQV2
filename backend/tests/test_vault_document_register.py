"""Vault document register: every document gets a permanent ID like
SUNR-SN-000047, the person's own ID, and where it came from."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from backend.app.services import vault_service as vault

ORG = "org-1"


def _doc(**kw):
    base = {
        "id": "s1", "category": "session_notes", "folder_label": "Session & Progress Notes",
        "title": "Support work note", "person_name": "Noah Patel", "person_type": "Participant",
        "date": "2026-09-25", "status": "completed", "source_table": "sessions", "source_id": "s1",
        "has_stored_file": False,
    }
    return {**base, **kw}


def _register_db(rows=None, fail=False):
    db = MagicMock()
    if fail:
        db.rpc.return_value.execute.side_effect = RuntimeError("function not found")
    else:
        db.rpc.return_value.execute.return_value = MagicMock(data=rows or [])
    return db


def test_id_format():
    assert vault.format_doc_id("SUNR", "SN", 47) == "SUNR-SN-000047"
    # An org that hasn't chosen its abbreviation yet still gets a usable ID.
    assert vault.format_doc_id(None, "INC", 3) == "INC-000003"


def test_titles_read_naturally():
    assert vault._humanise("support_work") == "Support work"
    assert vault._humanise("SUPPORT_WORK") == "Support work"
    assert vault._humanise("ndis  screening") == "Ndis screening"


def test_every_document_kind_has_a_code_and_a_source():
    assert set(vault.DOC_TYPE_CODES) == set(vault.DOC_SOURCE_LABELS)
    # A plan's agreement status is a different document from the plan itself.
    plan = _doc(category="ndis_plans", source_table="ndis_plans")
    agreement = _doc(category="consent_onboarding", source_table="ndis_plans")
    assert vault._doc_kind(plan) == "ndis_plans"
    assert vault._doc_kind(agreement) == "plan_agreements"


def test_new_documents_are_numbered_oldest_first():
    newer = _doc(id="s2", source_id="s2", date="2026-09-25")
    older = _doc(id="s1", source_id="s1", date="2026-09-01")
    db = _register_db([
        {"doc_kind": "sessions", "source_id": "s1", "type_code": "SN", "seq": 1},
        {"doc_kind": "sessions", "source_id": "s2", "type_code": "SN", "seq": 2},
    ])
    with patch.object(vault, "get_supabase_admin", return_value=db), \
         patch.object(vault, "_org_abbrev", return_value="SUNR"):
        vault._assign_document_ids(ORG, [newer, older])
    sent = db.rpc.call_args.args[1]
    assert sent["p_org"] == ORG
    assert [i["source_id"] for i in sent["p_items"]] == ["s1", "s2"]
    assert (older["doc_id"], newer["doc_id"]) == ("SUNR-SN-000001", "SUNR-SN-000002")


def test_listing_still_works_without_the_register():
    doc = _doc()
    with patch.object(vault, "get_supabase_admin", return_value=_register_db(fail=True)):
        assert vault._assign_document_ids(ORG, [doc]) is False
    assert "doc_id" not in doc


def test_a_listing_without_ids_is_not_kept():
    vault._ttl_cache.clear()
    calls = []

    def load(_org):
        calls.append(1)
        return [_doc()]

    with patch.dict(vault._RECORD_LOADERS, {"session_notes": load}), \
         patch.object(vault, "_person_refs", return_value={}), \
         patch.object(vault, "_assign_document_ids", return_value=False):
        vault._load_category_docs(ORG, "session_notes")
        vault._load_category_docs(ORG, "session_notes")
    assert len(calls) == 2  # retried, not served from cache
    vault._ttl_cache.clear()


def test_a_failed_name_lookup_is_retried_not_cached():
    vault._ttl_cache.clear()
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.execute.side_effect = [
        ConnectionError("connection aborted"),
        MagicMock(data=[{"id": "p1", "full_name": "Noah Patel"}]),
    ]
    with patch.object(vault, "get_supabase_admin", return_value=db):
        assert vault._patient_name_map(ORG) == {}
        assert vault._patient_name_map(ORG) == {"p1": "Noah Patel"}
    vault._ttl_cache.clear()


def test_a_governance_document_keeps_its_id_across_versions():
    rows = [
        {"id": "v1", "superseded_by_document_id": "v2"},
        {"id": "v2", "superseded_by_document_id": "v3"},
        {"id": "v3", "superseded_by_document_id": None},
        {"id": "other", "superseded_by_document_id": None},
    ]
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(data=rows)
    with patch.object(vault, "get_supabase_admin", return_value=db):
        versions = vault._governance_first_versions(ORG, "risk_management")
    assert versions["v3"] == ("v1", 3)
    assert versions["other"] == ("other", 1)
    current = _doc(category="risk_management", source_table="governance_documents", source_id="v3",
                   register_source_id="v1")
    assert vault._register_key(current) == ("governance_documents", "v1")


def test_enrich_adds_person_ids_and_sources():
    docs = [
        _doc(person_id="p1"),
        _doc(id="c1", category="worker_credentials", source_table="credentials", source_id="c1",
             person_type="Worker", person_name="Amara Worker", person_id="u1"),
        _doc(id="g1", category="risk_management", source_table="governance_documents", source_id="g1",
             person_type="Organisation", policy_document_id="pd1"),
    ]
    refs = {"Worker": {"u1": "SW004SUNR"}, "Participant": {"p1": "NDIS 430118562"}}
    with patch.object(vault, "_person_refs", return_value=refs), \
         patch.object(vault, "_assign_document_ids"):
        vault._enrich_documents(ORG, docs)
    assert [d["person_ref"] for d in docs] == ["NDIS 430118562", "SW004SUNR", None]
    assert [d["source_label"] for d in docs] == ["Shift session note", "Worker credential", "Written in the policy editor"]


def test_search_finds_document_and_person_ids():
    doc = _doc(doc_id="SUNR-SN-000047", person_ref="NDIS 430118562")
    for q in ("sunr-sn-000047", "000047", "430118562", "noah", "support work"):
        assert vault._matches_text(doc, q), q
    assert not vault._matches_text(doc, "000048")


def test_downloads_are_named_by_document_id():
    with patch.dict(vault._RECORD_RENDERERS, {"session_notes": lambda *_: ("session-note-s1.pdf", b"%PDF")}), \
         patch.object(vault, "find_document", return_value=_doc(doc_id="SUNR-SN-000047")):
        name, data = vault.render_document_file(ORG, "session_notes", "s1")
    assert name == "SUNR-SN-000047_session-note-s1.pdf" and data == b"%PDF"
