"""Tests for worker shift APIs (CARECLIQV2-116 / CARECLIQV2-134)."""

from __future__ import annotations

import copy
from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from backend.app.services import shift_service


def _sample_shift(**overrides):
    base = {
        "id": "shift-1",
        "organization_id": "org-1",
        "worker_id": "worker-1",
        "participant_id": "patient-1",
        "participant_name": "James Chen",
        "scheduled_start": f"{date.today().isoformat()}T09:00:00+00:00",
        "scheduled_end": f"{date.today().isoformat()}T11:00:00+00:00",
        "status": "scheduled",
        "tasks": [],
    }
    base.update(overrides)
    return base


def test_default_tasks_has_five_categories():
    assert len(shift_service.DEFAULT_SHIFT_TASKS) == 5
    labels = {t["label"] for t in shift_service.DEFAULT_SHIFT_TASKS}
    assert "Personal Hygiene / Showering" in labels
    assert "Documentation / Notes" in labels
    mandatory = [t for t in shift_service.DEFAULT_SHIFT_TASKS if t.get("mandatory")]
    assert len(mandatory) == 4


def test_matches_filter_today():
    shift = _sample_shift()
    assert shift_service._matches_filter(shift, "today", date.today()) is True


def test_matches_filter_upcoming():
    future = (date.today().replace(year=date.today().year + 1)).isoformat()
    shift = _sample_shift(scheduled_start=f"{future}T09:00:00+00:00")
    assert shift_service._matches_filter(shift, "upcoming", date.today()) is True


def test_shift_card_payload_scheduled_state():
    payload = shift_service._shift_card_payload(_sample_shift())
    assert payload["visual_state"] == "scheduled"


def test_shift_card_payload_clocked_in_state():
    shift = _sample_shift(status="in_progress", clocked_in_at=datetime.now(timezone.utc).isoformat())
    payload = shift_service._shift_card_payload(shift)
    assert payload["visual_state"] == "clocked_in"


def test_shift_card_payload_session_active_state():
    shift = _sample_shift(status="in_progress", clocked_in_at=datetime.now(timezone.utc).isoformat())
    session = {"id": "sess-1", "status": "draft"}
    payload = shift_service._shift_card_payload(shift, session)
    assert payload["visual_state"] == "session_active"


@patch("backend.app.services.shift_service.get_supabase_admin")
def test_clock_in_initialises_default_tasks(mock_admin):
    shift = _sample_shift()
    table = MagicMock()
    mock_admin.return_value.table.return_value = table
    table.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[shift])
    table.update.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{**shift, "status": "in_progress", "tasks": copy.deepcopy(shift_service.DEFAULT_SHIFT_TASKS)}]
    )

    result = shift_service.clock_in_shift("shift-1", "worker-1", "org-1")
    assert result is not None
    assert result["visual_state"] == "clocked_in"
    assert len(result["tasks"]) == 5
    table.update.assert_called()


@patch("backend.app.services.shift_service.get_shift_by_id")
def test_clock_in_rejects_completed(mock_get):
    mock_get.return_value = _sample_shift(status="completed")
    with pytest.raises(ValueError, match="completed"):
        shift_service.clock_in_shift("shift-1", "worker-1", "org-1")


@patch("backend.app.services.shift_service.get_shift_by_id")
@patch("backend.app.services.shift_service.update_shift_tasks")
def test_add_custom_shift_task(mock_update, mock_get):
    mock_get.return_value = _sample_shift(tasks=copy.deepcopy(shift_service.DEFAULT_SHIFT_TASKS))
    mock_update.return_value = {"id": "shift-1", "tasks": []}

    shift_service.add_custom_shift_task("shift-1", "worker-1", "org-1", "Laundry")
    mock_update.assert_called_once()
    passed_tasks = mock_update.call_args[0][3]
    assert any(t["label"] == "Laundry" and t["type"] == "custom" for t in passed_tasks)


@patch("backend.app.services.shift_service._purge_session_task_evidence")
@patch("backend.app.services.shift_service.get_shift_by_id")
@patch("backend.app.services.shift_service.update_shift_tasks")
def test_delete_custom_shift_task(mock_update, mock_get, mock_purge):
    custom = {
        "task_id": "custom_abc123",
        "type": "custom",
        "label": "Laundry",
        "completed": False,
        "order": 6,
    }
    tasks = copy.deepcopy(shift_service.DEFAULT_SHIFT_TASKS) + [custom]
    mock_get.return_value = _sample_shift(tasks=tasks, session_id="sess-1")
    mock_update.return_value = {"id": "shift-1", "tasks": shift_service.DEFAULT_SHIFT_TASKS}

    shift_service.delete_custom_shift_task("shift-1", "worker-1", "org-1", "custom_abc123")

    mock_purge.assert_called_once_with("sess-1", "custom_abc123")
    passed_tasks = mock_update.call_args[0][3]
    assert all(t["task_id"] != "custom_abc123" for t in passed_tasks)


@patch("backend.app.services.shift_service.get_shift_by_id")
def test_delete_custom_shift_task_rejects_default(mock_get):
    tasks = copy.deepcopy(shift_service.DEFAULT_SHIFT_TASKS)
    mock_get.return_value = _sample_shift(tasks=tasks)

    with pytest.raises(ValueError, match="Only custom tasks"):
        shift_service.delete_custom_shift_task(
            "shift-1",
            "worker-1",
            "org-1",
            tasks[0]["task_id"],
        )


@patch("backend.app.services.shift_service.link_shift_session")
@patch("backend.app.services.shift_service.get_supabase_admin")
@patch("backend.app.services.shift_service.get_shift_by_id")
def test_start_shift_session_uses_shift_ownership_not_assignment(mock_get, mock_admin, mock_link):
    shift = _sample_shift(
        status="in_progress",
        clocked_in_at=datetime.now(timezone.utc).isoformat(),
        risks_acknowledged_at=datetime.now(timezone.utc).isoformat(),
    )
    session_row = {"id": "sess-1", "status": "draft"}
    mock_get.side_effect = [shift, {**shift, "session_id": "sess-1"}]

    table = MagicMock()
    mock_admin.return_value.table.return_value = table
    patients_chain = table.select.return_value.eq.return_value.eq.return_value.limit.return_value
    patients_chain.execute.return_value = MagicMock(data=[{"id": "patient-1"}])
    table.insert.return_value.execute.return_value = MagicMock(data=[session_row])

    user = {"id": "worker-1", "role": "support_worker", "organization_id": "org-1"}
    result = shift_service.start_shift_session("shift-1", "worker-1", "org-1", user)

    assert result is not None
    assert result["visual_state"] == "session_active"
    mock_link.assert_called_once_with("shift-1", "sess-1")


def test_mandatory_tasks_complete():
    tasks = copy.deepcopy(shift_service.DEFAULT_SHIFT_TASKS)
    assert shift_service._mandatory_tasks_complete(tasks) is False
    for task in tasks:
        if task.get("mandatory") or int(task.get("order") or 0) <= 4:
            task["completed"] = True
    assert shift_service._mandatory_tasks_complete(tasks) is True


@patch("backend.app.services.shift_service._get_session_for_shift")
@patch("backend.app.services.shift_service.get_supabase_admin")
@patch("backend.app.services.shift_service.get_shift_by_id")
def test_end_shift_completes_shift(mock_get, mock_admin, mock_session):
    tasks = copy.deepcopy(shift_service.DEFAULT_SHIFT_TASKS)
    for task in tasks:
        if task.get("mandatory") or int(task.get("order") or 0) <= 4:
            task["completed"] = True
    shift = _sample_shift(
        status="in_progress",
        clocked_in_at=datetime.now(timezone.utc).isoformat(),
        session_id="sess-1",
        tasks=tasks,
    )
    mock_get.return_value = shift
    mock_session.return_value = {"id": "sess-1", "status": "completed", "notes": "done"}

    table = MagicMock()
    mock_admin.return_value.table.return_value = table
    table.update.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{**shift, "status": "completed"}]
    )

    result = shift_service.end_shift("shift-1", "worker-1", "org-1")
    assert result is not None
    assert result["visual_state"] == "completed"
    assert result["completion_summary"]["mandatory_completed"] == 4
