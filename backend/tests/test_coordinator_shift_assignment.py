"""Tests for shift assignment endpoint (CARECLIQV2-300).

Tests cover:
- Successful shift assignment with valid credentials
- Credential validation (valid, expired, missing)
- Worker and participant lookup validation
- Role-based access control
- HTTP integration tests
"""

import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.core.security import get_current_user
from backend.app.api import coordinator


@pytest.fixture
def coordinator_user():
    return {
        "id": "coordinator-123",
        "email": "coordinator@example.com",
        "role": "support_coordinator",
        "organization_id": "org-123",
    }


@pytest.fixture
def support_worker_user():
    return {
        "id": "worker-123",
        "email": "worker@example.com",
        "role": "support_worker",
        "organization_id": "org-123",
    }


@pytest.fixture
def test_client():
    return TestClient(app)


@pytest.fixture
def mock_active_participant_plan():
    with patch(
        "backend.app.api.coordinator._ensure_participant_active_plan",
        new=AsyncMock(return_value={"id": "plan-123", "status": "active"}),
    ):
        yield


class TestAssignShiftValidation:
    """Test request validation for shift assignment."""

    def test_assign_shift_requires_coordinator_role(self, test_client, support_worker_user):
        """Non-coordinator roles should get 403 Forbidden."""
        app.dependency_overrides[get_current_user] = lambda: support_worker_user
        
        response = test_client.post(
            "/api/coordinator/shifts",
            json={
                "worker_id": "worker-123",
                "participant_id": "participant-123",
                "scheduled_start": "2026-06-20T09:00:00Z",
            }
        )
        
        assert response.status_code == 403
        assert "Support coordinator access required" in response.json()["detail"]
        
        app.dependency_overrides.clear()

    def test_assign_shift_requires_worker_id(self, test_client, coordinator_user):
        """worker_id is required."""
        app.dependency_overrides[get_current_user] = lambda: coordinator_user
        
        response = test_client.post(
            "/api/coordinator/shifts",
            json={
                "participant_id": "participant-123",
                "scheduled_start": "2026-06-20T09:00:00Z",
            }
        )
        
        assert response.status_code == 422
        # Validation errors come as a list in response.json()
        assert "worker_id" in str(response.json()).lower()
        
        app.dependency_overrides.clear()

    def test_assign_shift_requires_participant_id(self, test_client, coordinator_user):
        """participant_id is required."""
        app.dependency_overrides[get_current_user] = lambda: coordinator_user
        
        response = test_client.post(
            "/api/coordinator/shifts",
            json={
                "worker_id": "worker-123",
                "scheduled_start": "2026-06-20T09:00:00Z",
            }
        )
        
        assert response.status_code == 422
        assert "participant_id" in str(response.json()).lower()
        
        app.dependency_overrides.clear()

    def test_assign_shift_requires_scheduled_start(self, test_client, coordinator_user):
        """scheduled_start is required."""
        app.dependency_overrides[get_current_user] = lambda: coordinator_user
        
        response = test_client.post(
            "/api/coordinator/shifts",
            json={
                "worker_id": "worker-123",
                "participant_id": "participant-123",
            }
        )
        
        assert response.status_code == 422
        assert "scheduled_start" in str(response.json()).lower()
        
        app.dependency_overrides.clear()


class TestAssignShiftWorkerValidation:
    """Test worker lookup and credential validation."""

    @patch("backend.app.api.coordinator.get_supabase_admin")
    def test_assign_shift_worker_not_found(self, mock_supabase, test_client, coordinator_user):
        """Worker not found in organization should return 404."""
        mock_client = MagicMock()
        mock_supabase.return_value = mock_client
        
        # Mock empty worker lookup
        mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[])
        )
        
        app.dependency_overrides[get_current_user] = lambda: coordinator_user
        
        response = test_client.post(
            "/api/coordinator/shifts",
            json={
                "worker_id": "nonexistent-worker",
                "participant_id": "participant-123",
                "scheduled_start": "2026-06-20T09:00:00Z",
            }
        )
        
        assert response.status_code == 404
        assert "Worker not found" in response.json()["detail"]
        
        app.dependency_overrides.clear()

    @patch("backend.app.api.coordinator.get_supabase_admin")
    def test_assign_shift_worker_inactive(self, mock_supabase, test_client, coordinator_user):
        """Inactive worker should not be assignable."""
        mock_client = MagicMock()
        mock_supabase.return_value = mock_client
        
        # Mock inactive worker lookup
        mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[{
                "id": "worker-123",
                "full_name": "John Worker",
                "email": "john@example.com",
                "role": "support_worker",
                "is_active": False,
            }])
        )
        
        app.dependency_overrides[get_current_user] = lambda: coordinator_user
        
        response = test_client.post(
            "/api/coordinator/shifts",
            json={
                "worker_id": "worker-123",
                "participant_id": "participant-123",
                "scheduled_start": "2026-06-20T09:00:00Z",
            }
        )
        
        assert response.status_code == 400
        assert "inactive worker" in response.json()["detail"].lower()
        
        app.dependency_overrides.clear()


class TestAssignShiftParticipantValidation:
    """Test participant lookup validation."""

    @patch("backend.app.api.coordinator.get_supabase_admin")
    def test_assign_shift_participant_not_found(self, mock_supabase, test_client, coordinator_user):
        """Participant not found in organization should return 404."""
        mock_client = MagicMock()
        mock_supabase.return_value = mock_client
        
        # Mock successful worker lookup
        worker_query = MagicMock()
        worker_query.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[{
                "id": "worker-123",
                "full_name": "John Worker",
                "email": "john@example.com",
                "role": "support_worker",
                "is_active": True,
            }])
        )
        
        # Mock empty participant lookup
        participant_query = MagicMock()
        participant_query.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[])
        )
        
        # Set up table() to return different queries
        side_effects = [worker_query, participant_query]
        mock_client.table.side_effect = lambda table_name: (
            side_effects[0] if table_name == "users" else side_effects[1]
        )
        
        app.dependency_overrides[get_current_user] = lambda: coordinator_user
        
        response = test_client.post(
            "/api/coordinator/shifts",
            json={
                "worker_id": "worker-123",
                "participant_id": "nonexistent-participant",
                "scheduled_start": "2026-06-20T09:00:00Z",
            }
        )
        
        assert response.status_code == 404
        assert "Participant not found" in response.json()["detail"]
        
        app.dependency_overrides.clear()


@pytest.mark.usefixtures("mock_active_participant_plan")
class TestAssignShiftCredentialValidation:
    """Test credential checking for shift assignment."""

    @patch("backend.app.api.coordinator.get_supabase_admin")
    @pytest.mark.asyncio
    async def test_assign_shift_blocks_if_no_valid_credentials(self, mock_supabase, test_client, coordinator_user):
        """Shift assignment should fail if worker has no valid credentials."""
        mock_client = MagicMock()
        mock_supabase.return_value = mock_client
        
        # Mock successful lookups but no credentials
        worker_mock = MagicMock()
        worker_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[{
                "id": "worker-123",
                "full_name": "John Worker",
                "email": "john@example.com",
                "role": "support_worker",
                "is_active": True,
            }])
        )
        
        participant_mock = MagicMock()
        participant_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[{
                "id": "participant-123",
                "full_name": "Jane Participant",
                "ndis_number": "NDIS12345",
            }])
        )
        
        # Mock empty credentials lookup
        creds_mock = MagicMock()
        creds_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[])
        )
        
        call_count = 0
        def table_side_effect(table_name):
            nonlocal call_count
            call_count += 1
            if table_name == "users":
                return worker_mock
            elif table_name == "participants":
                return participant_mock
            elif table_name == "credentials":
                return creds_mock
            return MagicMock()
        
        mock_client.table.side_effect = table_side_effect
        
        app.dependency_overrides[get_current_user] = lambda: coordinator_user
        
        response = test_client.post(
            "/api/coordinator/shifts",
            json={
                "worker_id": "worker-123",
                "participant_id": "participant-123",
                "scheduled_start": "2026-06-20T09:00:00Z",
            }
        )
        
        assert response.status_code == 400
        assert "credentials" in response.json()["detail"].lower()
        
        app.dependency_overrides.clear()

    @patch("backend.app.services.induction_service.is_induction_incomplete", return_value=False)
    @patch("backend.app.services.worker_training_service.is_training_overdue", return_value=False)
    @patch("backend.app.api.coordinator.get_supabase_admin")
    @patch("backend.app.api.coordinator.notify_shift_change", new_callable=AsyncMock)
    @pytest.mark.asyncio
    async def test_assign_shift_succeeds_with_valid_credentials(
        self, mock_notify, mock_supabase, _mock_training_overdue, _mock_induction_incomplete,
        test_client, coordinator_user
    ):
        """Shift assignment should succeed when worker has valid credentials."""
        mock_client = MagicMock()
        mock_supabase.return_value = mock_client
        
        # Mock successful lookups with valid credentials
        worker_mock = MagicMock()
        worker_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[{
                "id": "worker-123",
                "full_name": "John Worker",
                "email": "john@example.com",
                "role": "support_worker",
                "is_active": True,
            }])
        )
        
        participant_mock = MagicMock()
        participant_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[{
                "id": "participant-123",
                "full_name": "Jane Participant",
                "ndis_number": "NDIS12345",
            }])
        )
        
        # Mock valid credentials
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        creds_mock = MagicMock()
        creds_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[{
                "id": "cred-123",
                "credential_type": "NDIS Screening",
                "status": "valid",
                "expiry_date": tomorrow,
            }])
        )
        
        # Mock shift creation
        shift_mock = MagicMock()
        shift_mock.insert.return_value.execute.return_value = (
            MagicMock(data=[{
                "id": "shift-123",
                "worker_id": "worker-123",
                "participant_id": "participant-123",
                "scheduled_start": "2026-06-20T09:00:00Z",
                "status": "scheduled",
            }])
        )
        
        call_count = 0
        def table_side_effect(table_name):
            nonlocal call_count
            if table_name == "users":
                return worker_mock
            elif table_name == "participants":
                return participant_mock
            elif table_name == "credentials":
                return creds_mock
            elif table_name == "shifts":
                return shift_mock
            return MagicMock()
        
        mock_client.table.side_effect = table_side_effect
        
        app.dependency_overrides[get_current_user] = lambda: coordinator_user
        
        response = test_client.post(
            "/api/coordinator/shifts",
            json={
                "worker_id": "worker-123",
                "participant_id": "participant-123",
                "scheduled_start": "2026-06-20T09:00:00Z",
                "scheduled_end": "2026-06-20T17:00:00Z",
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "shift_id" in data
        assert data["shift_id"]  # Should be a generated UUID
        assert data["shift"]["status"] == "scheduled"
        assert data["credential_status"]["valid"] is True
        
        app.dependency_overrides.clear()

    @patch("backend.app.api.coordinator.get_supabase_admin")
    @pytest.mark.asyncio
    async def test_assign_shift_blocks_expired_credentials(
        self, mock_supabase, test_client, coordinator_user
    ):
        """Shift assignment should fail if all worker credentials are expired."""
        mock_client = MagicMock()
        mock_supabase.return_value = mock_client
        
        # Mock successful lookups
        worker_mock = MagicMock()
        worker_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[{
                "id": "worker-123",
                "full_name": "John Worker",
                "email": "john@example.com",
                "role": "support_worker",
                "is_active": True,
            }])
        )
        
        participant_mock = MagicMock()
        participant_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[{
                "id": "participant-123",
                "full_name": "Jane Participant",
                "ndis_number": "NDIS12345",
            }])
        )
        
        # Mock expired credentials
        yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        creds_mock = MagicMock()
        creds_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[{
                "id": "cred-123",
                "credential_type": "NDIS Screening",
                "status": "expired",
                "expiry_date": yesterday,
            }])
        )
        
        call_count = 0
        def table_side_effect(table_name):
            nonlocal call_count
            if table_name == "users":
                return worker_mock
            elif table_name == "participants":
                return participant_mock
            elif table_name == "credentials":
                return creds_mock
            return MagicMock()
        
        mock_client.table.side_effect = table_side_effect
        
        app.dependency_overrides[get_current_user] = lambda: coordinator_user
        
        response = test_client.post(
            "/api/coordinator/shifts",
            json={
                "worker_id": "worker-123",
                "participant_id": "participant-123",
                "scheduled_start": "2026-06-20T09:00:00Z",
            }
        )
        
        assert response.status_code == 400
        assert "invalid credentials" in response.json()["detail"].lower()
        assert "NDIS Screening" in response.json()["detail"]
        
        app.dependency_overrides.clear()

    @patch("backend.app.api.coordinator.get_supabase_admin")
    @pytest.mark.asyncio
    async def test_assign_shift_blocks_when_required_shift_credential_missing(
        self, mock_supabase, test_client, coordinator_user
    ):
        """Shift assignment should fail when matrix-required credential type is missing."""
        mock_client = MagicMock()
        mock_supabase.return_value = mock_client

        worker_mock = MagicMock()
        worker_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[{
                "id": "worker-123",
                "full_name": "John Worker",
                "email": "john@example.com",
                "role": "support_worker",
                "is_active": True,
            }])
        )

        participant_mock = MagicMock()
        participant_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[{
                "id": "participant-123",
                "full_name": "Jane Participant",
                "ndis_number": "NDIS12345",
            }])
        )

        # Worker has one valid credential, but not the required shift credential type.
        creds_mock = MagicMock()
        creds_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[{
                "id": "cred-123",
                "credential_type": "NDIS Screening",
                "status": "valid",
                "expiry_date": (datetime.now(timezone.utc) + timedelta(days=90)).isoformat(),
            }])
        )

        shift_req_mock = MagicMock()
        shift_req_mock.select.return_value.eq.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[{
                "required_credential_type": "First Aid",
                "is_active": True,
            }])
        )

        def table_side_effect(table_name):
            if table_name == "users":
                return worker_mock
            if table_name == "participants":
                return participant_mock
            if table_name == "credentials":
                return creds_mock
            if table_name == "shift_credential_requirements":
                return shift_req_mock
            return MagicMock()

        mock_client.table.side_effect = table_side_effect

        app.dependency_overrides[get_current_user] = lambda: coordinator_user

        response = test_client.post(
            "/api/coordinator/shifts",
            json={
                "worker_id": "worker-123",
                "participant_id": "participant-123",
                "scheduled_start": "2026-06-20T09:00:00Z",
                "shift_type": "community_access",
            }
        )

        assert response.status_code == 400
        assert "First Aid" in response.json()["detail"]

        app.dependency_overrides.clear()


@pytest.mark.usefixtures("mock_active_participant_plan")
class TestAssignShiftDurationCalculation:
    """Test duration calculation from start/end times."""

    @patch("backend.app.services.induction_service.is_induction_incomplete", return_value=False)
    @patch("backend.app.services.worker_training_service.is_training_overdue", return_value=False)
    @patch("backend.app.api.coordinator.get_supabase_admin")
    @patch("backend.app.api.coordinator.notify_shift_change", new_callable=AsyncMock)
    @pytest.mark.asyncio
    async def test_assign_shift_calculates_duration(
        self, mock_notify, mock_supabase, _mock_training_overdue, _mock_induction_incomplete,
        test_client, coordinator_user
    ):
        """Duration should be calculated from start/end times if not provided."""
        mock_client = MagicMock()
        mock_supabase.return_value = mock_client
        
        # Mock all dependencies
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        
        worker_mock = MagicMock()
        worker_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[{
                "id": "worker-123",
                "full_name": "John Worker",
                "email": "john@example.com",
                "role": "support_worker",
                "is_active": True,
            }])
        )
        
        participant_mock = MagicMock()
        participant_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[{
                "id": "participant-123",
                "full_name": "Jane Participant",
                "ndis_number": "NDIS12345",
            }])
        )
        
        creds_mock = MagicMock()
        creds_mock.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
            MagicMock(data=[{
                "id": "cred-123",
                "credential_type": "NDIS Screening",
                "status": "valid",
                "expiry_date": tomorrow,
            }])
        )
        
        shift_mock = MagicMock()
        shift_mock.insert.return_value.execute.return_value = (
            MagicMock(data=[{
                "id": "shift-123",
                "worker_id": "worker-123",
                "participant_id": "participant-123",
                "scheduled_start": "2026-06-20T09:00:00Z",
                "scheduled_end": "2026-06-20T13:00:00Z",
                "duration_minutes": 240,
                "status": "scheduled",
            }])
        )
        
        def table_side_effect(table_name):
            if table_name == "users":
                return worker_mock
            elif table_name == "participants":
                return participant_mock
            elif table_name == "credentials":
                return creds_mock
            elif table_name == "shifts":
                return shift_mock
            return MagicMock()
        
        mock_client.table.side_effect = table_side_effect
        
        app.dependency_overrides[get_current_user] = lambda: coordinator_user
        
        response = test_client.post(
            "/api/coordinator/shifts",
            json={
                "worker_id": "worker-123",
                "participant_id": "participant-123",
                "scheduled_start": "2026-06-20T09:00:00Z",
                "scheduled_end": "2026-06-20T13:00:00Z",
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["shift"]["duration_minutes"] == 240  # 4 hours
        
        app.dependency_overrides.clear()
