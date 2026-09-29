"""Shared rostering gate — every path that puts a worker on a shift.

Covers the baseline NDIS worker screening requirement (previously any one
valid credential, e.g. a driver licence, passed when an org hadn't configured
shift_credential_requirements) and the assign/reassign/bulk endpoints, which
previously skipped the credential, training and induction checks entirely.
Offer-queue gating is covered in test_shift_offer_service.py.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.app.api import coordinator
from backend.app.core.security import get_current_user
from backend.app.main import app
from backend.app.services import credential_verification_service as creds
from backend.app.services import roster_eligibility_service as gate

FUTURE = (datetime.now(timezone.utc) + timedelta(days=200)).date().isoformat()


def _cred(credential_type: str, status: str = "valid", expiry: str | None = FUTURE) -> dict:
    return {"id": f"cred-{credential_type}", "credential_type": credential_type, "status": status, "expiry_date": expiry}


def _supabase(credentials: list[dict], matrix: list[str] | None = None) -> MagicMock:
    tables = {
        "credentials": MagicMock(),
        "shift_credential_requirements": MagicMock(),
    }
    tables["credentials"].select.return_value.eq.return_value.eq.return_value.execute.return_value = (
        MagicMock(data=credentials)
    )
    tables["shift_credential_requirements"].select.return_value.eq.return_value.eq.return_value.eq.return_value.execute.return_value = (
        MagicMock(data=[{"required_credential_type": t, "is_active": True} for t in (matrix or [])])
    )
    client = MagicMock()
    client.table.side_effect = lambda name: tables[name]
    return client


class TestCanonicalCredentialType:
    @pytest.mark.parametrize("label", ["ndis_screening", "NDIS Screening", "ndis-screening", " NDIS  screening ", "NDIS Worker Screening"])
    def test_screening_labels_compare_equal(self, label):
        assert creds.canonical_credential_type(label) == "ndis_screening"


class TestBaselineRequirement:
    @pytest.mark.asyncio
    async def test_driver_licence_alone_no_longer_passes(self):
        status = await gate.check_worker_credentials(
            "worker-1", "org-1", "standard_support", supabase=_supabase([_cred("drivers_licence")]),
        )
        assert status.valid is False
        assert "ndis_screening" in status.missing_credentials

    @pytest.mark.asyncio
    async def test_screening_under_legacy_label_satisfies_baseline(self):
        status = await gate.check_worker_credentials(
            "worker-1", "org-1", "standard_support", supabase=_supabase([_cred("NDIS Screening")]),
        )
        assert status.valid is True
        assert status.missing_credentials == []

    @pytest.mark.asyncio
    async def test_screening_pending_review_does_not_count(self):
        status = await gate.check_worker_credentials(
            "worker-1", "org-1", "standard_support",
            supabase=_supabase([_cred("ndis_screening", status="pending_review"), _cred("first_aid")]),
        )
        assert status.valid is False
        assert "ndis_screening" in status.missing_credentials

    @pytest.mark.asyncio
    async def test_expired_screening_blocks(self):
        yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()
        status = await gate.check_worker_credentials(
            "worker-1", "org-1", "standard_support",
            supabase=_supabase([_cred("ndis_screening", expiry=yesterday), _cred("first_aid")]),
        )
        assert status.valid is False

    @pytest.mark.asyncio
    async def test_matrix_requirements_add_to_baseline_without_duplicates(self):
        required = await creds.required_credentials_for_shift(
            "org-1", "personal_care", supabase=_supabase([], matrix=["NDIS Screening", "first_aid"]),
        )
        assert required == ["ndis_screening", "first_aid"]

    @pytest.mark.asyncio
    async def test_matrix_requirement_still_enforced(self):
        status = await gate.check_worker_credentials(
            "worker-1", "org-1", "personal_care",
            supabase=_supabase([_cred("ndis_screening")], matrix=["first_aid"]),
        )
        assert status.valid is False
        assert status.missing_credentials == ["first_aid"]


class TestEnsureWorkerCanBeRostered:
    @pytest.mark.asyncio
    async def test_passes_when_everything_current(self):
        with patch.object(gate.worker_training_service, "is_training_overdue", return_value=False), \
             patch.object(gate.induction_service, "is_induction_incomplete", return_value=False):
            status = await gate.ensure_worker_can_be_rostered(
                "worker-1", "org-1", None, supabase=_supabase([_cred("ndis_screening")]),
            )
        assert status.valid is True

    @pytest.mark.asyncio
    async def test_blocks_on_overdue_training(self):
        with patch.object(gate.worker_training_service, "is_training_overdue", return_value=True), \
             patch.object(gate.induction_service, "is_induction_incomplete", return_value=False):
            with pytest.raises(gate.WorkerNotEligibleError, match="overdue mandatory training"):
                await gate.ensure_worker_can_be_rostered(
                    "worker-1", "org-1", None, supabase=_supabase([_cred("ndis_screening")]),
                )

    @pytest.mark.asyncio
    async def test_blocks_on_incomplete_induction(self):
        with patch.object(gate.worker_training_service, "is_training_overdue", return_value=False), \
             patch.object(gate.induction_service, "is_induction_incomplete", return_value=True):
            with pytest.raises(gate.WorkerNotEligibleError, match="incomplete mandatory induction"):
                await gate.ensure_worker_can_be_rostered(
                    "worker-1", "org-1", None, supabase=_supabase([_cred("ndis_screening")]),
                )


COORDINATOR = {"id": "coord-1", "email": "c@example.com", "role": "support_coordinator", "organization_id": "org-1"}
SHIFT = {
    "id": "shift-1", "organization_id": "org-1", "worker_id": None, "participant_id": "p-1",
    "shift_type": "standard_support", "status": "unassigned",
    "scheduled_start": "2026-10-05T09:00:00+00:00", "scheduled_end": "2026-10-05T13:00:00+00:00",
}


def _not_eligible(*_args, **_kwargs):
    raise gate.WorkerNotEligibleError("Worker has invalid credentials: ndis_screening.")


@pytest.fixture
def client():
    app.dependency_overrides[get_current_user] = lambda: COORDINATOR
    yield TestClient(app)
    app.dependency_overrides.clear()


def _coordinator_supabase() -> MagicMock:
    users = MagicMock()
    users.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = (
        MagicMock(data=[{"id": "worker-1", "full_name": "W", "is_active": True}])
    )
    participants = MagicMock()
    participants.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = (
        MagicMock(data=[{"id": "p-1", "full_name": "P"}])
    )
    shifts = MagicMock()
    tables = {"users": users, "participants": participants, "shifts": shifts}
    supabase = MagicMock()
    supabase.table.side_effect = lambda name: tables.setdefault(name, MagicMock())
    supabase.tables = tables
    return supabase


class TestAssignEndpointsUseGate:
    @pytest.mark.parametrize("path,body", [
        ("/api/coordinator/shifts/shift-1/assign", {"worker_id": "worker-1"}),
        ("/api/coordinator/shifts/shift-1/reassign", {"new_worker_id": "worker-1"}),
    ])
    def test_assign_and_reassign_block_ineligible_worker(self, client, path, body):
        supabase = _coordinator_supabase()
        with patch.object(coordinator, "get_supabase_admin", return_value=supabase), \
             patch.object(coordinator.shift_service, "get_shift_by_id", return_value=SHIFT), \
             patch.object(gate, "ensure_worker_can_be_rostered", new=AsyncMock(side_effect=_not_eligible)) as check:
            response = client.put(path, json=body)

        assert response.status_code == 400
        assert "ndis_screening" in response.json()["detail"]
        check.assert_awaited_once()
        assert check.await_args.args[:3] == ("worker-1", "org-1", "standard_support")
        supabase.tables["shifts"].update.assert_not_called()

    def test_bulk_create_with_worker_blocks_ineligible_worker(self, client):
        supabase = _coordinator_supabase()
        with patch.object(coordinator, "get_supabase_admin", return_value=supabase), \
             patch.object(coordinator, "_resolve_care_coordinator_id", return_value=None), \
             patch.object(gate, "ensure_worker_can_be_rostered", new=AsyncMock(side_effect=_not_eligible)):
            response = client.post("/api/coordinator/shifts/bulk", json={
                "participant_id": "p-1", "days_of_week": [0], "start_time": "09:00",
                "end_time": "13:00", "start_date": "2026-10-05", "weeks": 2, "worker_id": "worker-1",
            })

        assert response.status_code == 400
        assert "ndis_screening" in response.json()["detail"]
        supabase.tables["shifts"].insert.assert_not_called()

    def test_bulk_create_without_worker_skips_gate(self, client):
        supabase = _coordinator_supabase()
        with patch.object(coordinator, "get_supabase_admin", return_value=supabase), \
             patch.object(coordinator, "_resolve_care_coordinator_id", return_value=None), \
             patch.object(coordinator, "participant_timezone", return_value=timezone.utc), \
             patch.object(gate, "ensure_worker_can_be_rostered", new=AsyncMock(side_effect=_not_eligible)) as check:
            response = client.post("/api/coordinator/shifts/bulk", json={
                "participant_id": "p-1", "days_of_week": [0], "start_time": "09:00",
                "end_time": "13:00", "start_date": "2026-10-05", "weeks": 1,
            })

        assert response.status_code == 200
        check.assert_not_awaited()
