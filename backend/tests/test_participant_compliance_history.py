import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_get_compliance_history_batches_audit_fetches():
    from backend.app.api.participants import get_compliance_history
    from backend.app.services import funding_service, session_service

    current_user = {
        "id": "user-1",
        "organization_id": "org-1",
        "role": "support_coordinator",
    }

    sessions = [
        {"id": "session-1", "session_date": "2026-01-01", "session_type": "support worker"},
        {"id": "session-2", "session_date": "2026-01-02", "session_type": "support worker"},
    ]

    with patch(
        "backend.app.api.participants._require_participant_access",
        new=AsyncMock(return_value={"id": "participant-1"}),
    ), patch.object(
        session_service,
        "get_sessions_by_participant",
        new=AsyncMock(return_value=sessions),
    ), patch.object(
        funding_service,
        "get_compliance_audit_logs_for_sessions",
        new=AsyncMock(
            return_value={
                "session-1": [{"session_id": "session-1", "compliance_score": 90}],
                "session-2": [{"session_id": "session-2", "compliance_score": 80}],
            }
        ),
    ) as batch_mock:
        result = await get_compliance_history("participant-1", current_user)

    assert len(result) == 2
    batch_mock.assert_awaited_once_with(["session-1", "session-2"])
