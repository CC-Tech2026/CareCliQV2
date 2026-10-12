"""Folder sizes: measured once per document, re-measured when it changes,
summed per folder, organised folder, subfolder and person."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from backend.app.services import vault_size_service as sizes

ORG = "org-sizes"


def _doc(category: str, doc_id: str, **extra):
    return {
        "id": doc_id, "category": category, "title": "Doc", "status": "completed",
        "date": "2026-10-01", "person_id": extra.pop("person_id", None), "person_name": "", **extra,
    }


@pytest.fixture(autouse=True)
def _isolated():
    sizes._memory.clear()
    sizes._failed.clear()
    sizes._measuring.clear()
    sizes._table_missing = False
    missing = MagicMock()
    missing.table.return_value.select.return_value.eq.return_value.execute.side_effect = Exception(
        'relation "public.vault_document_sizes" does not exist'
    )
    # Measure inline instead of on the background thread.
    with patch.object(sizes, "get_supabase_admin", return_value=missing), \
         patch.object(sizes, "_start_measuring", side_effect=lambda org, items: sizes._measure(org, items)):
        yield


def test_first_load_is_pending_then_sizes_are_summed():
    docs = {
        "session_notes": [_doc("session_notes", "s1", person_id="p1"), _doc("session_notes", "s2", person_id="p2")],
        "worker_credentials": [_doc("worker_credentials", "c1", person_id="w1")],
    }
    rendered = {"s1": 1000, "s2": 3000, "c1": 500}
    with patch.object(sizes.vs, "_load_all_category_docs", return_value=docs), \
         patch.object(sizes.vs, "_tree_placement", side_effect=lambda d: ("participant", "clinical_docs") if d["category"] == "session_notes" else ("staff", "checks")), \
         patch.object(sizes, "_render_size", side_effect=lambda org, cat, doc_id: rendered[doc_id]) as render:
        first = sizes.folder_sizes(ORG)
        assert first["pending"] == 3  # nothing known yet; measured now
        second = sizes.folder_sizes(ORG)

    assert render.call_count == 3  # each document rendered once
    assert second["pending"] == 0
    assert second["total"]["bytes"] == 4500
    assert second["folders"]["session_notes"] == {"bytes": 4000, "pending": 0, "files": 2, "unavailable": 0}
    assert second["tree"]["participant"]["subfolders"]["clinical_docs"]["bytes"] == 4000
    assert second["people"]["participant"]["p2"]["bytes"] == 3000
    assert second["people"]["staff"]["w1"]["subfolders"]["checks"]["bytes"] == 500


def test_changed_document_is_measured_again_and_failures_are_retried_later():
    docs = {"incident_reports": [_doc("incident_reports", "i1"), _doc("incident_reports", "i2")]}
    with patch.object(sizes.vs, "_load_all_category_docs", return_value=docs), \
         patch.object(sizes.vs, "_tree_placement", return_value=None), \
         patch.object(sizes, "_render_size", side_effect=[2048, RuntimeError("file gone")]):
        sizes.folder_sizes(ORG)
        after = sizes.folder_sizes(ORG)
    assert after["folders"]["incident_reports"] == {"bytes": 2048, "pending": 0, "files": 2, "unavailable": 0}

    docs["incident_reports"][0]["status"] = "closed"  # record changed
    with patch.object(sizes.vs, "_load_all_category_docs", return_value=docs), \
         patch.object(sizes.vs, "_tree_placement", return_value=None), \
         patch.object(sizes, "_render_size", return_value=4096) as render:
        sizes.folder_sizes(ORG)
        latest = sizes.folder_sizes(ORG)
    assert render.call_count == 1  # only the changed one; the failed one waits its turn
    assert latest["folders"]["incident_reports"]["bytes"] == 4096

    # Once the retry window has passed, the one that failed is tried again.
    with patch.object(sizes.vs, "_load_all_category_docs", return_value=docs), \
         patch.object(sizes.vs, "_tree_placement", return_value=None), \
         patch.object(sizes, "RETRY_FAILED_AFTER_SECONDS", 0), \
         patch.object(sizes, "_render_size", return_value=1024) as retry:
        sizes.folder_sizes(ORG)
        retried = sizes.folder_sizes(ORG)
    assert retry.call_count == 1
    assert retried["folders"]["incident_reports"]["bytes"] == 4096 + 1024
    assert not sizes._failed


def test_a_missing_file_waits_a_day_before_being_tried_again():
    from fastapi import HTTPException

    docs = {"worker_credentials": [_doc("worker_credentials", "c1")]}
    with patch.object(sizes.vs, "_load_all_category_docs", return_value=docs), \
         patch.object(sizes.vs, "_tree_placement", return_value=None), \
         patch.object(sizes, "RETRY_FAILED_AFTER_SECONDS", 0), \
         patch.object(sizes, "_render_size", side_effect=HTTPException(status_code=404, detail="Credential file not found.")) as render:
        sizes.folder_sizes(ORG)
        again = sizes.folder_sizes(ORG)
    # A passing glitch would have been retried (window 0); a missing file is not.
    assert render.call_count == 1
    assert again["folders"]["worker_credentials"] == {"bytes": 0, "pending": 0, "files": 1, "unavailable": 1}
