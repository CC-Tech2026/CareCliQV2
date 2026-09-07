"""Tests for the auto-export PDF staleness check — a repeated auto-export request must not
hand back a cached PDF once its source data (notes, signature, compliance) has changed.
Run: python3 -m unittest backend.tests.test_shift_pdf_staleness -v
"""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from backend.app.services import shift_pdf_export_service as svc

SHIFT_ID = "shift-1"
SESSION_ID = "session-1"


def _rows_by_table(rows: dict[str, list[dict]]) -> MagicMock:
    """Wires get_supabase_admin() so .table(name).select(...)...execute() returns the rows
    configured for that table name, empty otherwise."""
    mock_supabase = MagicMock()

    def _table(name):
        table_mock = MagicMock()
        chain = MagicMock()
        chain.eq.return_value = chain
        chain.order.return_value = chain
        chain.limit.return_value = chain
        chain.execute.return_value = MagicMock(data=rows.get(name, []))
        table_mock.select.return_value = chain
        return table_mock

    mock_supabase.table.side_effect = _table
    return mock_supabase


class SourceLastChangedTests(unittest.TestCase):
    @patch.object(svc, "get_supabase_admin")
    def test_picks_the_latest_across_all_sources(self, mock_admin):
        mock_admin.return_value = _rows_by_table({
            "shifts": [{"updated_at": "2026-08-01T00:00:00+00:00"}],
            "sessions": [{"updated_at": "2026-08-03T00:00:00+00:00"}],  # latest
            "shift_visit_notes": [{"created_at": "2026-08-02T00:00:00+00:00"}],
            "shift_signatures": [{"signed_at": "2026-07-30T00:00:00+00:00"}],
        })
        result = svc._shift_pdf_source_last_changed(SHIFT_ID, SESSION_ID)
        self.assertEqual(result.isoformat(), "2026-08-03T00:00:00+00:00")

    @patch.object(svc, "get_supabase_admin")
    def test_no_source_rows_returns_none(self, mock_admin):
        mock_admin.return_value = _rows_by_table({})
        result = svc._shift_pdf_source_last_changed(SHIFT_ID, None)
        self.assertIsNone(result)


class CachedExportStaleTests(unittest.TestCase):
    @patch.object(svc, "get_supabase_admin")
    def test_untouched_shift_is_not_stale(self, mock_admin):
        # Every source predates the cached export's own updated_at.
        mock_admin.return_value = _rows_by_table({
            "shifts": [{"updated_at": "2026-08-01T00:00:00+00:00"}],
        })
        existing = {"updated_at": "2026-08-05T00:00:00+00:00", "created_at": "2026-08-01T00:00:00+00:00"}
        self.assertFalse(svc._cached_auto_export_is_stale(SHIFT_ID, SESSION_ID, existing))

    @patch.object(svc, "get_supabase_admin")
    def test_note_edited_after_export_is_stale(self, mock_admin):
        mock_admin.return_value = _rows_by_table({
            "shift_visit_notes": [{"created_at": "2026-08-06T00:00:00+00:00"}],  # after export
        })
        existing = {"updated_at": "2026-08-05T00:00:00+00:00", "created_at": "2026-08-01T00:00:00+00:00"}
        self.assertTrue(svc._cached_auto_export_is_stale(SHIFT_ID, SESSION_ID, existing))

    @patch.object(svc, "get_supabase_admin")
    def test_no_sources_at_all_is_not_stale(self, mock_admin):
        mock_admin.return_value = _rows_by_table({})
        existing = {"updated_at": "2026-08-05T00:00:00+00:00"}
        self.assertFalse(svc._cached_auto_export_is_stale(SHIFT_ID, SESSION_ID, existing))


class CreateShiftExportCachingTests(unittest.TestCase):
    def _detail(self):
        return {"id": SHIFT_ID, "session_id": SESSION_ID, "shift_signature": None}

    @patch.object(svc, "get_shift_history_detail")
    @patch.object(svc, "_cached_auto_export_is_stale", return_value=False)
    @patch.object(svc, "_existing_auto_export")
    def test_unchanged_shift_returns_cached_without_regenerating(
        self, mock_existing, _mock_stale, mock_detail,
    ):
        mock_detail.return_value = self._detail()
        mock_existing.return_value = {
            "id": "export-1", "status": "ready", "file_url": "https://example/old.pdf",
            "updated_at": "2026-08-05T00:00:00+00:00", "auto_generated": True,
        }
        with patch.object(svc, "_regenerate_auto_export") as mock_regen, \
             patch.object(svc, "get_supabase_admin") as mock_admin:
            result = svc.create_shift_export(SHIFT_ID, "worker-1", "org-1", auto_generated=True)
            mock_regen.assert_not_called()
            mock_admin.assert_not_called()  # no insert/update attempted for a cache hit
        self.assertTrue(result["already_exists"])
        self.assertEqual(result["file_url"], "https://example/old.pdf")

    @patch.object(svc, "get_shift_history_detail")
    @patch.object(svc, "_cached_auto_export_is_stale", return_value=True)
    @patch.object(svc, "_existing_auto_export")
    @patch.object(svc, "_regenerate_auto_export")
    def test_changed_shift_regenerates_instead_of_returning_cached(
        self, mock_regen, mock_existing, _mock_stale, mock_detail,
    ):
        detail = self._detail()
        mock_detail.return_value = detail
        existing = {
            "id": "export-1", "status": "ready", "file_url": "https://example/old.pdf",
            "updated_at": "2026-08-05T00:00:00+00:00", "auto_generated": True,
        }
        mock_existing.return_value = existing
        mock_regen.return_value = {"file_url": "https://example/new.pdf", "already_exists": False}

        result = svc.create_shift_export(SHIFT_ID, "worker-1", "org-1", auto_generated=True)

        mock_regen.assert_called_once_with(existing, detail, "org-1")
        self.assertEqual(result["file_url"], "https://example/new.pdf")
        self.assertFalse(result["already_exists"])


if __name__ == "__main__":
    unittest.main()
