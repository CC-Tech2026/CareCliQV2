from unittest.mock import AsyncMock, MagicMock, patch

from backend.app.services import overdue_shift_autoend_service as svc


def _query_result(rows):
    resp = MagicMock()
    resp.data = rows
    chain = MagicMock()
    chain.select.return_value = chain
    chain.in_.return_value = chain
    chain.is_.return_value = chain
    chain.lt.return_value = chain
    chain.execute.return_value = resp
    return chain


@patch("backend.app.services.overdue_shift_autoend_service._org_coordinator_user_ids", return_value=["coord-1"])
@patch("backend.app.services.overdue_shift_autoend_service.notify_worker", new_callable=AsyncMock)
@patch("backend.app.services.overdue_shift_autoend_service.audit_service.log_action", new_callable=AsyncMock)
@patch("backend.app.services.overdue_shift_autoend_service.shift_service.end_shift")
@patch("backend.app.services.overdue_shift_autoend_service.get_supabase_admin")
def test_overdue_shift_gets_auto_ended_and_audited(
    mock_admin, mock_end_shift, mock_audit, mock_notify, mock_coords,
):
    row = {
        "id": "shift-1",
        "organization_id": "org-1",
        "worker_id": "worker-1",
        "participant_name": "James Chen",
        "scheduled_end": "2026-01-01T09:00:00+00:00",
        "status": "clocked_in",
        "clocked_in_at": "2026-01-01T07:00:00+00:00",
        "clocked_out_at": None,
    }
    mock_admin.return_value.table.return_value = _query_result([row])
    mock_end_shift.return_value = {"id": "shift-1", "status": "completed"}

    import asyncio

    count = asyncio.run(svc.run_overdue_shift_autoend_pass())

    assert count == 1
    mock_end_shift.assert_called_once_with(
        "shift-1",
        worker_id="worker-1",
        organization_id="org-1",
        force=True,
        reason=svc.AUTO_END_REASON,
        system_initiated=True,
    )
    mock_audit.assert_called_once()
    assert mock_audit.call_args.kwargs["action_type"] == "system.shift.auto_ended_overdue"
    # Worker + one coordinator both notified.
    assert mock_notify.await_count == 2


@patch("backend.app.services.overdue_shift_autoend_service._org_coordinator_user_ids", return_value=[])
@patch("backend.app.services.overdue_shift_autoend_service.notify_worker", new_callable=AsyncMock)
@patch("backend.app.services.overdue_shift_autoend_service.audit_service.log_action", new_callable=AsyncMock)
@patch("backend.app.services.overdue_shift_autoend_service.shift_service.end_shift")
@patch("backend.app.services.overdue_shift_autoend_service.get_supabase_admin")
def test_already_completed_shift_is_skipped_not_double_counted(
    mock_admin, mock_end_shift, mock_audit, mock_notify, mock_coords,
):
    """A concurrent pass (or the worker themselves) may have completed the shift
    between our query and this update - end_shift raising ValueError for that
    must not be treated as a hard failure."""
    row = {
        "id": "shift-1",
        "organization_id": "org-1",
        "worker_id": "worker-1",
        "participant_name": "James Chen",
        "scheduled_end": "2026-01-01T09:00:00+00:00",
        "status": "clocked_in",
        "clocked_in_at": "2026-01-01T07:00:00+00:00",
        "clocked_out_at": None,
    }
    mock_admin.return_value.table.return_value = _query_result([row])
    mock_end_shift.side_effect = ValueError("Shift is already completed.")

    import asyncio

    count = asyncio.run(svc.run_overdue_shift_autoend_pass())

    assert count == 0
    mock_audit.assert_not_called()
    mock_notify.assert_not_called()
