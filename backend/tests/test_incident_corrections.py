"""Tests for structured incident corrections (field_name/old_value/new_value), replacing the
free-text-only note that made "what did this say before the correction" unanswerable without
a human reading prose and comparing it to the row by eye.
Run: python3 -m unittest backend.tests.test_incident_corrections -v
"""
from __future__ import annotations

import unittest
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

from backend.app.services import incident_service

INCIDENT_ID = "incident-1"
WORKER_ID = "worker-1"
ORG_ID = "org-1"


def _mock_supabase(prior_correction_rows: list[dict] | None = None) -> MagicMock:
    mock_supabase = MagicMock()

    def _table(name):
        table_mock = MagicMock()
        select_chain = MagicMock()
        select_chain.eq.return_value = select_chain
        select_chain.order.return_value = select_chain
        select_chain.limit.return_value = select_chain
        select_chain.execute.return_value = MagicMock(data=prior_correction_rows or [])
        table_mock.select.return_value = select_chain

        def _insert(payload):
            insert_chain = MagicMock()
            insert_chain.execute.return_value = MagicMock(data=[payload])
            return insert_chain

        table_mock.insert.side_effect = _insert
        return table_mock

    mock_supabase.table.side_effect = _table
    return mock_supabase


class AddIncidentCorrectionTests(IsolatedAsyncioTestCase):
    @patch("backend.app.services.incident_service.get_supabase_admin")
    @patch("backend.app.services.incident_service.get_incident_by_id", new_callable=AsyncMock)
    async def test_diff_computed_against_original_value_when_no_prior_correction(
        self, mock_get_incident, mock_admin,
    ):
        mock_get_incident.return_value = {
            "id": INCIDENT_ID, "user_id": WORKER_ID, "description": "Fell near the kitchen.",
        }
        mock_admin.return_value = _mock_supabase(prior_correction_rows=[])

        result = await incident_service.add_incident_correction(
            INCIDENT_ID,
            worker_id=WORKER_ID,
            org_id=ORG_ID,
            field_name="description",
            new_value="Fell near the bathroom, not the kitchen.",
            note="Corrected the location detail.",
        )

        self.assertEqual(result["field_name"], "description")
        self.assertEqual(result["old_value"], "Fell near the kitchen.")
        self.assertEqual(result["new_value"], "Fell near the bathroom, not the kitchen.")
        self.assertEqual(result["note"], "Corrected the location detail.")

    @patch("backend.app.services.incident_service.get_supabase_admin")
    @patch("backend.app.services.incident_service.get_incident_by_id", new_callable=AsyncMock)
    async def test_diff_computed_against_prior_correction_when_field_corrected_before(
        self, mock_get_incident, mock_admin,
    ):
        mock_get_incident.return_value = {
            "id": INCIDENT_ID, "user_id": WORKER_ID, "description": "Original text.",
        }
        # An earlier correction already changed "description" to "First correction." — the
        # new correction's old_value must be that, not the original incident row's text.
        mock_admin.return_value = _mock_supabase(
            prior_correction_rows=[{"new_value": "First correction."}],
        )

        result = await incident_service.add_incident_correction(
            INCIDENT_ID,
            worker_id=WORKER_ID,
            org_id=ORG_ID,
            field_name="description",
            new_value="Second correction.",
        )

        self.assertEqual(result["old_value"], "First correction.")
        self.assertEqual(result["new_value"], "Second correction.")
        self.assertIsNone(result["note"])

    @patch("backend.app.services.incident_service.get_supabase_admin")
    @patch("backend.app.services.incident_service.get_incident_by_id", new_callable=AsyncMock)
    async def test_rejects_field_not_in_allowlist(self, mock_get_incident, mock_admin):
        mock_get_incident.return_value = {"id": INCIDENT_ID, "user_id": WORKER_ID}
        mock_admin.return_value = _mock_supabase()
        with self.assertRaises(ValueError):
            await incident_service.add_incident_correction(
                INCIDENT_ID, worker_id=WORKER_ID, org_id=ORG_ID,
                field_name="status", new_value="closed",
            )

    @patch("backend.app.services.incident_service.get_supabase_admin")
    @patch("backend.app.services.incident_service.get_incident_by_id", new_callable=AsyncMock)
    async def test_rejects_unchanged_value(self, mock_get_incident, mock_admin):
        mock_get_incident.return_value = {
            "id": INCIDENT_ID, "user_id": WORKER_ID, "location": "Front yard",
        }
        mock_admin.return_value = _mock_supabase()
        with self.assertRaises(ValueError):
            await incident_service.add_incident_correction(
                INCIDENT_ID, worker_id=WORKER_ID, org_id=ORG_ID,
                field_name="location", new_value="Front yard",
            )

    @patch("backend.app.services.incident_service.get_supabase_admin")
    @patch("backend.app.services.incident_service.get_incident_by_id", new_callable=AsyncMock)
    async def test_rejects_correction_from_someone_other_than_reporter(
        self, mock_get_incident, mock_admin,
    ):
        mock_get_incident.return_value = {"id": INCIDENT_ID, "user_id": "someone-else"}
        mock_admin.return_value = _mock_supabase()
        with self.assertRaises(ValueError):
            await incident_service.add_incident_correction(
                INCIDENT_ID, worker_id=WORKER_ID, org_id=ORG_ID,
                field_name="location", new_value="Updated location",
            )


if __name__ == "__main__":
    unittest.main()
