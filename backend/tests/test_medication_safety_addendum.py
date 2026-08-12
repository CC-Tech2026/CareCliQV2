"""Tests for the Medication Safety Addendum: administration_error outcome, the high-risk
photo-verification gate, the correction-row path, and the participant-reliability signal's
refused_missed_triggered split from the general rate-threshold trigger.

Run: python3 -m unittest backend.tests.test_medication_safety_addendum -v
"""
from __future__ import annotations

import unittest
from unittest import IsolatedAsyncioTestCase
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from backend.app.services import medication_pattern_service, medication_service

MEDICATION_ID = "med-1"
PARTICIPANT_ID = "participant-1"
ORG_ID = "org-1"
SHIFT_ID = "shift-1"
WORKER_ID = "worker-1"


def _medication(**overrides) -> dict:
    base = {
        "id": MEDICATION_ID,
        "participant_id": PARTICIPANT_ID,
        "organization_id": ORG_ID,
        "name": "Metformin",
        "status": "active",
        "is_prn": False,
        "is_high_risk": False,
    }
    base.update(overrides)
    return base


def _shift() -> dict:
    return {"id": SHIFT_ID, "organization_id": ORG_ID, "participant_id": PARTICIPANT_ID}


def _mock_supabase_insert(mock_admin: MagicMock, returned_row: dict | None = None) -> MagicMock:
    """Wires get_supabase_admin() so any .table(...).insert(payload).execute() call returns
    a single row echoing the inserted payload (or an override), and any .select(...) chain
    used for incidental lookups (e.g. PRN max checks) returns an empty result."""
    mock_supabase = MagicMock()
    mock_admin.return_value = mock_supabase

    def _table(name):
        table_mock = MagicMock()

        def _insert(payload):
            insert_chain = MagicMock()
            row = returned_row if returned_row is not None else payload
            insert_chain.execute.return_value = MagicMock(data=[row])
            return insert_chain

        table_mock.insert.side_effect = _insert

        select_chain = MagicMock()
        select_chain.eq.return_value = select_chain
        select_chain.in_.return_value = select_chain
        select_chain.not_.is_.return_value = select_chain
        select_chain.gte.return_value = select_chain
        select_chain.lt.return_value = select_chain
        select_chain.execute.return_value = MagicMock(data=[], count=0)
        table_mock.select.return_value = select_chain

        return table_mock

    mock_supabase.table.side_effect = _table
    return mock_supabase


class AdministrationErrorActionTests(unittest.TestCase):
    @patch("backend.app.services.medication_service.get_supabase_admin")
    def test_missing_error_subtype_rejected(self, mock_admin):
        _mock_supabase_insert(mock_admin)
        with self.assertRaises(HTTPException) as ctx:
            medication_service.create_administration(
                medication=_medication(),
                shift=_shift(),
                organization_id=ORG_ID,
                administered_by=WORKER_ID,
                action="administration_error",
                scheduled_time=None,
                dose_given=None,
                notes=None,
            )
        self.assertEqual(ctx.exception.status_code, 422)

    @patch("backend.app.services.medication_service.get_supabase_admin")
    def test_invalid_error_subtype_rejected(self, mock_admin):
        _mock_supabase_insert(mock_admin)
        with self.assertRaises(HTTPException) as ctx:
            medication_service.create_administration(
                medication=_medication(),
                shift=_shift(),
                organization_id=ORG_ID,
                administered_by=WORKER_ID,
                action="administration_error",
                scheduled_time=None,
                dose_given=None,
                notes=None,
                error_subtype="not_a_real_subtype",
            )
        self.assertEqual(ctx.exception.status_code, 422)

    @patch("backend.app.services.medication_service.get_supabase_admin")
    def test_other_subtype_requires_notes(self, mock_admin):
        _mock_supabase_insert(mock_admin)
        with self.assertRaises(HTTPException) as ctx:
            medication_service.create_administration(
                medication=_medication(),
                shift=_shift(),
                organization_id=ORG_ID,
                administered_by=WORKER_ID,
                action="administration_error",
                scheduled_time=None,
                dose_given=None,
                notes=None,
                error_subtype="other",
            )
        self.assertEqual(ctx.exception.status_code, 422)

    @patch("backend.app.services.medication_service.get_supabase_admin")
    def test_immediate_self_report_creates_standalone_row(self, mock_admin):
        _mock_supabase_insert(mock_admin)
        record = medication_service.create_administration(
            medication=_medication(),
            shift=_shift(),
            organization_id=ORG_ID,
            administered_by=WORKER_ID,
            action="administration_error",
            scheduled_time=None,
            dose_given=None,
            notes=None,
            error_subtype="wrong_dose",
        )
        self.assertEqual(record["outcome"], "administration_error")
        self.assertEqual(record["error_subtype"], "wrong_dose")
        self.assertIsNone(record["corrects_administration_id"])
        self.assertIsNone(record["error_discovered_at"])
        self.assertIsNone(record["error_discovered_by"])

    @patch("backend.app.services.medication_service.get_supabase_admin")
    def test_correction_row_populates_discovery_fields(self, mock_admin):
        _mock_supabase_insert(mock_admin)
        record = medication_service.create_administration(
            medication=_medication(),
            shift=_shift(),
            organization_id=ORG_ID,
            administered_by=WORKER_ID,
            action="administration_error",
            scheduled_time=None,
            dose_given=None,
            notes=None,
            error_subtype="wrong_medication",
            corrects_administration_id="original-admin-1",
            error_discovered_at="2026-08-10T00:00:00+00:00",
            error_discovered_by="coordinator-1",
        )
        self.assertEqual(record["corrects_administration_id"], "original-admin-1")
        self.assertEqual(record["error_discovered_at"], "2026-08-10T00:00:00+00:00")
        self.assertEqual(record["error_discovered_by"], "coordinator-1")

    @patch("backend.app.services.medication_service.get_supabase_admin")
    def test_discovery_fields_ignored_without_corrects_id(self, mock_admin):
        """error_discovered_at/by are only meaningful on a correction row — passing them
        without corrects_administration_id must not silently record a discovery that didn't
        happen on an otherwise-immediate self-report."""
        _mock_supabase_insert(mock_admin)
        record = medication_service.create_administration(
            medication=_medication(),
            shift=_shift(),
            organization_id=ORG_ID,
            administered_by=WORKER_ID,
            action="administration_error",
            scheduled_time=None,
            dose_given=None,
            notes=None,
            error_subtype="wrong_dose",
            error_discovered_at="2026-08-10T00:00:00+00:00",
            error_discovered_by="coordinator-1",
        )
        self.assertIsNone(record["error_discovered_at"])
        self.assertIsNone(record["error_discovered_by"])


class HighRiskPhotoGateTests(unittest.TestCase):
    @patch("backend.app.services.medication_service.get_supabase_admin")
    def test_given_outcome_without_photo_rejected(self, mock_admin):
        _mock_supabase_insert(mock_admin)
        with self.assertRaises(HTTPException) as ctx:
            medication_service.create_administration(
                medication=_medication(is_high_risk=True),
                shift=_shift(),
                organization_id=ORG_ID,
                administered_by=WORKER_ID,
                action="given",
                scheduled_time=None,
                dose_given="10mg",
                notes=None,
            )
        self.assertEqual(ctx.exception.status_code, 422)

    @patch("backend.app.services.medication_service.get_supabase_admin")
    def test_given_outcome_with_photo_allowed(self, mock_admin):
        _mock_supabase_insert(mock_admin)
        record = medication_service.create_administration(
            medication=_medication(is_high_risk=True),
            shift=_shift(),
            organization_id=ORG_ID,
            administered_by=WORKER_ID,
            action="given",
            scheduled_time=None,
            dose_given="10mg",
            notes=None,
            verification_photo_url="https://storage.example/photo.jpg",
        )
        self.assertEqual(record["verification_photo_url"], "https://storage.example/photo.jpg")
        self.assertIsNotNone(record["verification_photo_taken_at"])

    @patch("backend.app.services.medication_service.get_supabase_admin")
    def test_refused_outcome_does_not_require_photo(self, mock_admin):
        _mock_supabase_insert(mock_admin)
        record = medication_service.create_administration(
            medication=_medication(is_high_risk=True),
            shift=_shift(),
            organization_id=ORG_ID,
            administered_by=WORKER_ID,
            action="refused",
            scheduled_time=None,
            dose_given=None,
            notes="Participant declined.",
        )
        self.assertEqual(record["outcome"], "refused")

    @patch("backend.app.services.medication_service.get_supabase_admin")
    def test_non_high_risk_medication_never_gated(self, mock_admin):
        _mock_supabase_insert(mock_admin)
        record = medication_service.create_administration(
            medication=_medication(is_high_risk=False),
            shift=_shift(),
            organization_id=ORG_ID,
            administered_by=WORKER_ID,
            action="given",
            scheduled_time=None,
            dose_given="10mg",
            notes=None,
        )
        self.assertEqual(record["outcome"], "given_on_time")


class RefusedMissedSignalSplitTests(unittest.TestCase):
    """The incident cross-link must fire only on a refused/missed concentration for one
    specific medication, never on the general late/early/missed rate threshold."""

    def _admins(self, outcomes_by_medication: dict[str, list[str]]) -> list[dict]:
        rows = []
        for medication_id, outcomes in outcomes_by_medication.items():
            for outcome in outcomes:
                rows.append({
                    "participant_id": PARTICIPANT_ID,
                    "medication_id": medication_id,
                    "organization_id": ORG_ID,
                    "outcome": outcome,
                })
        return rows

    @patch("backend.app.services.medication_pattern_service._fire_incident_for_refused_missed_signal")
    @patch("backend.app.services.medication_pattern_service._latest_calculated_at", return_value=None)
    @patch("backend.app.services.medication_pattern_service.get_supabase_admin")
    def test_rate_threshold_alone_does_not_set_refused_missed_flag(self, mock_admin, _latest, mock_fire):
        # 5 doses, 2 late (40% > 20% rate threshold, meets min sample) but no medication has
        # 3+ refused/missed — general triggered=True, refused_missed_triggered must stay False.
        admins = self._admins({"med-a": ["given_late", "given_late", "given_on_time", "given_on_time", "given_on_time"]})
        mock_supabase = MagicMock()
        mock_admin.return_value = mock_supabase
        select_chain = MagicMock()
        select_chain.gte.return_value = select_chain
        select_chain.eq.return_value = select_chain
        select_chain.execute.return_value = MagicMock(data=admins)
        insert_chain = MagicMock()
        insert_chain.execute.return_value = MagicMock(data=[{"id": "signal-1", "organization_id": ORG_ID}])
        table_mock = MagicMock()
        table_mock.select.return_value = select_chain
        table_mock.insert.return_value = insert_chain
        mock_supabase.table.return_value = table_mock

        medication_pattern_service.calculate_participant_reliability_flags(ORG_ID)

        insert_payload = insert_chain.execute.call_args
        self.assertIsNotNone(insert_payload)
        inserted_row = table_mock.insert.call_args[0][0]
        self.assertTrue(inserted_row["triggered"])
        self.assertFalse(inserted_row["refused_missed_triggered"])
        mock_fire.assert_not_called()

    @patch("backend.app.services.medication_pattern_service._fire_incident_for_refused_missed_signal")
    @patch("backend.app.services.medication_pattern_service._latest_calculated_at", return_value=None)
    @patch("backend.app.services.medication_pattern_service.get_supabase_admin")
    def test_refused_missed_concentration_sets_flag_and_fires_hook(self, mock_admin, _latest, mock_fire):
        # 3 refused doses for the same medication meets PARTICIPANT_REFUSED_MISSED_THRESHOLD.
        admins = self._admins({"med-a": ["refused", "refused", "refused"]})
        mock_supabase = MagicMock()
        mock_admin.return_value = mock_supabase
        select_chain = MagicMock()
        select_chain.gte.return_value = select_chain
        select_chain.eq.return_value = select_chain
        select_chain.execute.return_value = MagicMock(data=admins)
        insert_chain = MagicMock()
        insert_chain.execute.return_value = MagicMock(data=[{"id": "signal-1", "organization_id": ORG_ID}])
        table_mock = MagicMock()
        table_mock.select.return_value = select_chain
        table_mock.insert.return_value = insert_chain
        mock_supabase.table.return_value = table_mock

        medication_pattern_service.calculate_participant_reliability_flags(ORG_ID)

        inserted_row = table_mock.insert.call_args[0][0]
        self.assertTrue(inserted_row["refused_missed_triggered"])
        self.assertEqual(inserted_row["worst_medication_id"], "med-a")
        mock_fire.assert_called_once()
        called_signal, called_participant, called_medication_id = mock_fire.call_args[0]
        self.assertEqual(called_participant, PARTICIPANT_ID)
        self.assertEqual(called_medication_id, "med-a")


class MedicationIncidentServiceTests(IsolatedAsyncioTestCase):
    @patch("backend.app.services.medication_incident_service.notify_incident_reported")
    @patch("backend.app.services.medication_incident_service.create_incident")
    async def test_administration_error_incident_uses_correct_fields(self, mock_create_incident, mock_notify):
        mock_create_incident.return_value = {
            "id": "incident-1", "title": "Medication administration error", "description": "desc",
            "severity": "medium", "reference_number": "INC-1",
        }
        from backend.app.services.medication_incident_service import create_incident_from_medication_error

        administration = {
            "id": "admin-1",
            "participant_id": PARTICIPANT_ID,
            "organization_id": ORG_ID,
            "shift_id": SHIFT_ID,
            "administered_by": WORKER_ID,
            "scheduled_time": "2026-08-10T08:00:00+00:00",
            "administered_time": "2026-08-10T08:05:00+00:00",
            "outcome": "administration_error",
            "error_subtype": "wrong_dose",
            "corrects_administration_id": None,
            "error_discovered_at": None,
            "error_discovered_by": None,
            "notes": None,
        }
        medication = {"id": MEDICATION_ID, "name": "Metformin", "strength": "500mg"}

        await create_incident_from_medication_error(administration, medication)

        mock_create_incident.assert_called_once()
        body, kwargs = mock_create_incident.call_args[0][0], mock_create_incident.call_args[1]
        self.assertEqual(body.incident_type, "medication_error")
        self.assertEqual(body.source_type, "medication_administration_error")
        self.assertEqual(body.source_id, "admin-1")
        self.assertEqual(kwargs["org_id"], ORG_ID)
        self.assertEqual(kwargs["user_id"], WORKER_ID)

        # The system-generated incident must alert a coordinator, not just sit in the list —
        # create_incident() itself doesn't notify (only the human-report API paths do).
        mock_notify.assert_called_once()
        notify_kwargs = mock_notify.call_args[1]
        self.assertEqual(notify_kwargs["incident_id"], "incident-1")
        self.assertEqual(notify_kwargs["org_id"], ORG_ID)
        self.assertEqual(notify_kwargs["participant_id"], PARTICIPANT_ID)

    @patch("backend.app.services.medication_incident_service.notify_incident_reported")
    @patch("backend.app.services.medication_incident_service.create_incident")
    async def test_notification_failure_does_not_raise(self, mock_create_incident, mock_notify):
        """A failed coordinator notification must never undo or fail the incident record."""
        mock_create_incident.return_value = {"id": "incident-3"}
        mock_notify.side_effect = RuntimeError("notification service down")
        from backend.app.services.medication_incident_service import create_incident_from_medication_error

        administration = {
            "id": "admin-2",
            "participant_id": PARTICIPANT_ID,
            "organization_id": ORG_ID,
            "shift_id": SHIFT_ID,
            "administered_by": WORKER_ID,
            "scheduled_time": None,
            "administered_time": "2026-08-10T08:05:00+00:00",
            "outcome": "administration_error",
            "error_subtype": "other",
            "corrects_administration_id": None,
            "error_discovered_at": None,
            "error_discovered_by": None,
            "notes": "Gave to wrong participant briefly, caught immediately.",
        }
        medication = {"id": MEDICATION_ID, "name": "Metformin"}

        result = await create_incident_from_medication_error(administration, medication)
        self.assertEqual(result["id"], "incident-3")

    @patch("backend.app.services.medication_incident_service.create_incident")
    async def test_pattern_signal_incident_only_uses_actor_none(self, mock_create_incident):
        mock_create_incident.return_value = {"id": "incident-2"}
        from backend.app.services.medication_incident_service import create_incident_from_pattern_signal

        signal = {
            "id": "signal-1",
            "organization_id": ORG_ID,
            "window_start": "2026-08-03T00:00:00+00:00",
            "window_end": "2026-08-10T00:00:00+00:00",
            "trigger_reason": "3 refused/missed doses for the same medication in the last 7 days.",
            "refused_missed_triggered": True,
            "calculated_at": "2026-08-10T00:00:00+00:00",
        }

        await create_incident_from_pattern_signal(signal, participant_id=PARTICIPANT_ID, medication_name="Metformin")

        mock_create_incident.assert_called_once()
        body, kwargs = mock_create_incident.call_args[0][0], mock_create_incident.call_args[1]
        self.assertEqual(body.source_type, "medication_pattern_signal")
        self.assertEqual(body.source_id, "signal-1")
        self.assertIsNone(kwargs["user_id"])


if __name__ == "__main__":
    unittest.main()
