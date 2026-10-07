"""Signed onboarding agreement PDFs in the Vault: listed until the
participant's structured agreement is (never in neither place), downloadable
only within the organisation, and the ID an MD saw on the PDF carries over
to the agreement that replaces it."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import vault_service as vault

ORG = "org-1"


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.negate = db, table, [], False

    def select(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a):
        return self

    @property
    def not_(self):
        self.negate = True
        return self

    def _add(self, test):
        negate, self.negate = self.negate, False
        self.filters.append((lambda r: not test(r)) if negate else test)
        return self

    def eq(self, key, value):
        return self._add(lambda r: str(r.get(key)) == str(value))

    def neq(self, key, value):
        return self._add(lambda r: str(r.get(key)) != str(value))

    def in_(self, key, values):
        values = {str(v) for v in values}
        return self._add(lambda r: str(r.get(key)) in values)

    def is_(self, key, _null):
        return self._add(lambda r: r.get(key) is None)

    def execute(self):
        if self.table in self.db.fail:
            raise RuntimeError("relation does not exist")
        rows = [r for r in self.db.tables.get(self.table, []) if all(f(r) for f in self.filters)]
        return MagicMock(data=rows)


class _DB:
    def __init__(self, fail=(), **tables):
        self.tables, self.fail, self.registered = tables, set(fail), []

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        """assign_vault_document_ids: number unseen keys, return all."""
        assert name == "assign_vault_document_ids"
        register = self.tables.setdefault("vault_document_register", [])
        for item in params["p_items"]:
            key = (item["kind"], item["source_id"])
            if not any((r["doc_kind"], r["source_id"]) == key for r in register):
                seq = 1 + max((r["seq"] for r in register if r["type_code"] == item["type_code"]), default=0)
                register.append({"organization_id": params["p_org"], "doc_kind": key[0], "source_id": key[1],
                                 "type_code": item["type_code"], "seq": seq})
                self.registered.append(key)
        wanted = {(i["kind"], i["source_id"]) for i in params["p_items"]}
        rows = [r for r in register if (r["doc_kind"], r["source_id"]) in wanted]
        return MagicMock(execute=lambda: MagicMock(data=rows))


INTAKE = {"id": "intake-1", "organization_id": ORG, "full_name": "Mia Thompson",
          "provider_signed_at": "2026-10-01", "family_signed_at": "2026-10-01",
          "service_agreement_document_path": "org-1/intake-1/agreement.pdf",
          "service_agreement_document_name": "Mia's agreement (signed).pdf", "updated_at": "2026-10-01"}


def _agreement(participant_id=None, status="active", **kw):
    return {"id": "sa-1", "organization_id": ORG, "intake_id": "intake-1", "participant_id": participant_id,
            "status": status, "agreement_number": "SA-2026-0001", "signed_date": "2026-10-02", **kw}


def _listed(db):
    with patch.object(vault, "get_supabase_admin", return_value=db):
        intake_docs = vault._list_intake_service_agreements(ORG)
        with patch("backend.app.services.service_agreement_document_service.effective_status",
                   side_effect=lambda row: row["status"]), \
             patch.object(vault, "_list_plan_agreements", return_value=[]):
            agreement_docs = vault._list_participant_agreements(ORG, {"p-1": "Mia Thompson"})
    return intake_docs, agreement_docs


# ── Listing ──────────────────────────────────────────────────────────────

def test_the_signed_pdf_is_listed_until_its_agreement_is():
    intake_docs, agreement_docs = _listed(_DB(participant_intakes=[INTAKE]))
    assert [d["id"] for d in intake_docs] == ["intake-intake-1"] and agreement_docs == []
    assert intake_docs[0]["status"] == "signed"

    # Signed, but the participant isn't active yet: the agreement isn't
    # listed, so the PDF must still be (it used to vanish from both).
    intake_docs, agreement_docs = _listed(_DB(participant_intakes=[INTAKE], service_agreements=[_agreement()]))
    assert [d["id"] for d in intake_docs] == ["intake-intake-1"] and agreement_docs == []

    # Participant active: the agreement is listed instead, never both.
    intake_docs, agreement_docs = _listed(
        _DB(participant_intakes=[INTAKE], service_agreements=[_agreement(participant_id="p-1")]))
    assert intake_docs == [] and [d["id"] for d in agreement_docs] == ["sa-sa-1"]


def test_a_draft_agreement_doesnt_hide_the_signed_pdf():
    intake_docs, _ = _listed(
        _DB(participant_intakes=[INTAKE], service_agreements=[_agreement(participant_id="p-1", status="draft")]))
    assert [d["id"] for d in intake_docs] == ["intake-intake-1"]


# ── Downloading ──────────────────────────────────────────────────────────

def test_the_pdf_downloads_only_within_the_organisation():
    db = _DB(participant_intakes=[INTAKE])
    with patch.object(vault, "get_supabase_admin", return_value=db), \
         patch.object(vault, "_download_stored_file", return_value=b"%PDF") as download:
        name, data = vault._render_consent_onboarding(ORG, "intake-intake-1")
        assert (name, data) == ("Mia-s-agreement-signed.pdf", b"%PDF")
        assert download.call_args.args == ("participant-intake-files", "org-1/intake-1/agreement.pdf")
        with pytest.raises(HTTPException) as other_org:
            vault._render_consent_onboarding("org-2", "intake-intake-1")
    assert other_org.value.status_code == 404


# ── The permanent ID carries over ────────────────────────────────────────

def test_the_agreement_takes_the_id_the_pdf_had():
    db = _DB(participant_intakes=[INTAKE])
    with patch.object(vault, "get_supabase_admin", return_value=db), \
         patch.object(vault, "_org_abbrev", return_value="CPND"):
        intake_docs, _ = _listed(db)
        vault._assign_document_ids(ORG, intake_docs)
        pdf_id = intake_docs[0]["doc_id"]

        db.tables["service_agreements"] = [_agreement(participant_id="p-1")]
        _, agreement_docs = _listed(db)
        vault._assign_document_ids(ORG, agreement_docs)
        assert agreement_docs[0]["doc_id"] == pdf_id == "CPND-AGR-000001"

        # And keeps it on every later listing.
        _, again = _listed(db)
        vault._assign_document_ids(ORG, again)
    assert again[0]["doc_id"] == pdf_id
    assert ("service_agreements", "sa-1") not in db.registered


def test_an_agreement_already_numbered_keeps_its_own_id():
    db = _DB(participant_intakes=[INTAKE], service_agreements=[_agreement(participant_id="p-1")],
             vault_document_register=[
                 {"organization_id": ORG, "doc_kind": "participant_intakes", "source_id": "intake-1",
                  "type_code": "AGR", "seq": 1},
                 {"organization_id": ORG, "doc_kind": "service_agreements", "source_id": "sa-1",
                  "type_code": "AGR", "seq": 2},
             ])
    with patch.object(vault, "get_supabase_admin", return_value=db), \
         patch.object(vault, "_org_abbrev", return_value="CPND"):
        _, agreement_docs = _listed(db)
        vault._assign_document_ids(ORG, agreement_docs)
    assert agreement_docs[0]["doc_id"] == "CPND-AGR-000002"


def test_without_the_register_lookup_the_agreement_is_numbered_as_new():
    db = _DB(fail={"vault_document_register"}, participant_intakes=[INTAKE],
             service_agreements=[_agreement(participant_id="p-1")])
    db.tables["vault_document_register"] = [{"organization_id": ORG, "doc_kind": "participant_intakes",
                                             "source_id": "intake-1", "type_code": "AGR", "seq": 1}]
    with patch.object(vault, "get_supabase_admin", return_value=db), \
         patch.object(vault, "_org_abbrev", return_value="CPND"):
        _, agreement_docs = _listed(db)
        assert vault._assign_document_ids(ORG, agreement_docs) is True
    assert agreement_docs[0]["doc_id"] == "CPND-AGR-000002"
