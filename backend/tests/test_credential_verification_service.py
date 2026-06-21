from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from backend.app.services.credential_verification_service import verify_worker_credentials


@pytest.mark.asyncio
async def test_verify_worker_credentials_no_credentials():
    mock_client = MagicMock()
    mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
        MagicMock(data=[])
    )

    result = await verify_worker_credentials("worker-1", "org-1", supabase=mock_client)

    assert result.valid is False
    assert result.missing_credentials == ["No credentials found"]
    assert "no credentials" in (result.warning or "").lower()


@pytest.mark.asyncio
async def test_verify_worker_credentials_valid_credential():
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

    mock_client = MagicMock()
    mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
        MagicMock(data=[
            {
                "id": "cred-1",
                "credential_type": "NDIS Screening",
                "status": "valid",
                "expiry_date": tomorrow,
            }
        ])
    )

    result = await verify_worker_credentials("worker-1", "org-1", supabase=mock_client)

    assert result.valid is True
    assert result.missing_credentials == []


@pytest.mark.asyncio
async def test_verify_worker_credentials_expired_only():
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()

    mock_client = MagicMock()
    mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
        MagicMock(data=[
            {
                "id": "cred-1",
                "credential_type": "First Aid",
                "status": "expired",
                "expiry_date": yesterday,
            }
        ])
    )

    result = await verify_worker_credentials("worker-1", "org-1", supabase=mock_client)

    assert result.valid is False
    assert result.missing_credentials == ["First Aid"]


@pytest.mark.asyncio
async def test_verify_worker_credentials_warning_for_expiring():
    soon = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()

    mock_client = MagicMock()
    mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
        MagicMock(data=[
            {
                "id": "cred-1",
                "credential_type": "WWCC",
                "status": "expiring",
                "expiry_date": soon,
            },
            {
                "id": "cred-2",
                "credential_type": "NDIS Screening",
                "status": "valid",
                "expiry_date": (datetime.now(timezone.utc) + timedelta(days=90)).isoformat(),
            },
        ])
    )

    result = await verify_worker_credentials("worker-1", "org-1", supabase=mock_client)

    assert result.valid is True
    assert result.warning is not None
    assert "expiring soon" in result.warning.lower()


@pytest.mark.asyncio
async def test_verify_worker_credentials_missing_required_type():
    future = (datetime.now(timezone.utc) + timedelta(days=120)).isoformat()

    mock_client = MagicMock()
    mock_client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
        MagicMock(data=[
            {
                "id": "cred-1",
                "credential_type": "NDIS Screening",
                "status": "valid",
                "expiry_date": future,
            }
        ])
    )

    result = await verify_worker_credentials(
        "worker-1",
        "org-1",
        required_credential_types=["First Aid"],
        supabase=mock_client,
    )

    assert result.valid is False
    assert "First Aid" in result.missing_credentials
    assert result.warning is not None
    assert "missing required credentials" in result.warning.lower()
