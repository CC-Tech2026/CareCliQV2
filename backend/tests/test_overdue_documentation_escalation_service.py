from unittest.mock import AsyncMock, MagicMock, patch

from backend.app.services import overdue_documentation_escalation_service as svc


def _query_result(rows):
    resp = MagicMock()
    resp.data = rows
    chain = MagicMock()
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.is_.return_value = chain
    chain.lt.return_value = chain
    chain.execute.return_value = resp
    return chain


@patch("backend.app.services.overdue_documentation_escalation_service._org_coordinator_user_ids", return_value=["coord-1"])
@patch("backend.app.services.overdue_documentation_escalation_service.notify_worker", new_callable=AsyncMock)
@patch("backend.app.services.overdue_documentation_escalation_service.audit_service.log_action", new_callable=AsyncMock)
@patch("backend.app.services.overdue_documentation_escalation_service.get_supabase_admin")
def test_overdue_documentation_gets_escalated_once(mock_admin, mock_audit, mock_notify, mock_coords):
    row = {
        "id": "shift-1",
        "organization_id": "org-1",
        "worker_id": "worker-1",
        "participant_name": "James Chen",
        "documentation_due_at": "2026-01-01T09:00:00+00:00",
    }
    select_chain = _query_result([row])
    update_resp = MagicMock()
    update_resp.data = [{"id": "shift-1"}]
    update_chain = MagicMock()
    update_chain.eq.return_value = update_chain
    update_chain.is_.return_value = update_chain
    update_chain.execute.return_value = update_resp

    table = MagicMock()
    table.select.return_value = select_chain
    table.update.return_value = update_chain
    mock_admin.return_value.table.return_value = table

    import asyncio

    count = asyncio.run(svc.run_overdue_documentation_escalation_pass())

    assert count == 1
    mock_audit.assert_called_once()
    assert mock_audit.call_args.kwargs["action_type"] == "system.shift.documentation_overdue"
    # Worker + one coordinator both notified.
    assert mock_notify.await_count == 2
    update_chain.eq.assert_any_call("id", "shift-1")


@patch("backend.app.services.overdue_documentation_escalation_service._org_coordinator_user_ids", return_value=[])
@patch("backend.app.services.overdue_documentation_escalation_service.notify_worker", new_callable=AsyncMock)
@patch("backend.app.services.overdue_documentation_escalation_service.audit_service.log_action", new_callable=AsyncMock)
@patch("backend.app.services.overdue_documentation_escalation_service.get_supabase_admin")
def test_already_escalated_or_finished_shift_is_not_double_counted(mock_admin, mock_audit, mock_notify, mock_coords):
    """The guarded update (documentation_pending=True AND documentation_escalated_at
    IS NULL) returning no row means a concurrent pass already handled it, or the
    worker finished the documentation in the gap - not a failure, just skip it."""
    row = {
        "id": "shift-1",
        "organization_id": "org-1",
        "worker_id": "worker-1",
        "participant_name": "James Chen",
        "documentation_due_at": "2026-01-01T09:00:00+00:00",
    }
    select_chain = _query_result([row])
    update_resp = MagicMock()
    update_resp.data = []  # no row matched the guarded update
    update_chain = MagicMock()
    update_chain.eq.return_value = update_chain
    update_chain.is_.return_value = update_chain
    update_chain.execute.return_value = update_resp

    table = MagicMock()
    table.select.return_value = select_chain
    table.update.return_value = update_chain
    mock_admin.return_value.table.return_value = table

    import asyncio

    count = asyncio.run(svc.run_overdue_documentation_escalation_pass())

    assert count == 0
    mock_audit.assert_not_called()
    mock_notify.assert_not_called()
