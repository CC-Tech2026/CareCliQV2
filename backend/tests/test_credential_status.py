"""One set of credential rules everywhere: valid through the expiry date,
"expiring" inside the shared window, judged on the office's calendar."""
from __future__ import annotations

from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import pytest

from backend.app.services import credential_status
from backend.app.services.credential_status import EXPIRING_WITHIN_DAYS, live_status
from backend.app.services.credential_verification_service import verify_worker_credentials

TODAY = date(2026, 9, 29)


def _on(days: int) -> str:
    return (TODAY + timedelta(days=days)).isoformat()


@pytest.mark.parametrize(
    "offset,expected",
    [
        (-1, "expired"),
        (0, "expiring"),  # valid through the expiry date itself
        (EXPIRING_WITHIN_DAYS, "expiring"),
        (EXPIRING_WITHIN_DAYS + 1, "valid"),
    ],
)
def test_live_status_boundaries(offset, expected):
    assert live_status(_on(offset), "valid", today=TODAY) == expected


def test_review_states_are_never_upgraded():
    assert live_status(_on(200), "pending_review", today=TODAY) == "pending_review"
    assert live_status(_on(200), "rejected", today=TODAY) == "rejected"


def test_uses_the_office_calendar_not_the_server_clock():
    with patch.object(credential_status, "app_today", return_value=TODAY):
        assert live_status(_on(0), "valid") == "expiring"
        assert live_status(_on(-1), "valid") == "expired"


def _client(creds):
    client = MagicMock()
    client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = (
        MagicMock(data=creds)
    )
    return client


@pytest.mark.asyncio
async def test_rostering_check_accepts_credential_on_its_expiry_date():
    """Used to block assignment a day early: the check required expiry > today."""
    with patch.object(credential_status, "app_today", return_value=TODAY):
        result = await verify_worker_credentials(
            "w-1", "org-1",
            required_credential_types=["ndis_screening"],
            supabase=_client([{"id": "c", "credential_type": "ndis_screening", "status": "valid", "expiry_date": _on(0)}]),
        )
    assert result.valid is True
    assert "expiring soon" in (result.warning or "").lower()


@pytest.mark.asyncio
async def test_rostering_check_warns_on_the_same_window_as_everywhere_else():
    with patch.object(credential_status, "app_today", return_value=TODAY):
        within = await verify_worker_credentials(
            "w-1", "org-1",
            supabase=_client([{"id": "c", "credential_type": "first_aid", "status": "valid", "expiry_date": _on(45)}]),
        )
        outside = await verify_worker_credentials(
            "w-1", "org-1",
            supabase=_client([{"id": "c", "credential_type": "first_aid", "status": "valid", "expiry_date": _on(EXPIRING_WITHIN_DAYS + 5)}]),
        )
    # 45 days out was silent under the old 30-day window.
    assert within.valid is True and "expiring soon" in (within.warning or "").lower()
    assert outside.valid is True and outside.warning is None
