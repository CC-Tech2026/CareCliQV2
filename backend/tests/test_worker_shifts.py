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
    assert len(shift_service.DEFAULT_SHIFT_TASKS) == 6
    labels = {t["label"] for t in shift_service.DEFAULT_SHIFT_TASKS}
    assert "Personal Hygiene / Showering" in labels
    assert "Documentation / Notes" in labels
    assert "Health & Wellness Check" in labels
    mandatory = [t for t in shift_service.DEFAULT_SHIFT_TASKS if t.get("mandatory")]
    assert len(mandatory) == 4


def test_matches_filter_today():
    shift = _sample_shift()
    assert shift_service._matches_filter(shift, "today", date.today()) is True


def test_matches_filter_upcoming():
    future = (date.today().replace(year=date.today().year + 1)).isoformat()
    shift = _sample_shift(scheduled_start=f"{future}T09:00:00+00:00")
    assert shift_service._matches_filter(shift, "upcoming", date.today()) is True


@pytest.mark.parametrize(
    "filter_name,shift_overrides,expected",
    [
        ("today", {}, True),
        ("today", {"status": "cancelled"}, False),
        ("today", {"scheduled_start": "2020-01-01T09:00:00+00:00"}, False),
        ("upcoming", {"scheduled_start": "2099-06-01T09:00:00+00:00"}, True),
        ("upcoming", {"scheduled_start": "2099-06-01T09:00:00+00:00", "status": "completed"}, False),
        ("upcoming", {"scheduled_start": "2099-06-01T09:00:00+00:00", "status": "cancelled"}, False),
        ("completed", {"status": "completed"}, True),
        ("completed", {"status": "scheduled"}, False),
        ("cancelled", {"status": "cancelled"}, True),
        ("cancelled", {"status": "in_progress"}, False),
        ("past", {"scheduled_start": "2020-01-01T09:00:00+00:00"}, True),
        ("past", {"scheduled_start": "2020-01-01T09:00:00+00:00", "status": "cancelled"}, False),
        ("all", {"status": "scheduled"}, True),
        ("all", {}, True),
    ],
)
def test_matches_filter_combinations(filter_name, shift_overrides, expected):
    """CARECLIQV2-132 — cover all My Shifts filter buckets."""
    shift = _sample_shift(**shift_overrides)
    assert shift_service._matches_filter(shift, filter_name, date.today()) is expected


def test_matches_filter_without_scheduled_start_only_all():
    shift = _sample_shift(scheduled_start=None)
    today = date.today()
    assert shift_service._matches_filter(shift, "all", today) is True
    assert shift_service._matches_filter(shift, "today", today) is False
    assert shift_service._matches_filter(shift, "upcoming", today) is False


def test_filter_shift_rows_returns_matching_subset():
    today = date.today()
    future = (today.replace(year=today.year + 1)).isoformat()
    rows = [
        _sample_shift(id="s1"),
        _sample_shift(id="s2", status="completed"),
        _sample_shift(id="s3", scheduled_start=f"{future}T09:00:00+00:00"),
        _sample_shift(id="s4", status="cancelled"),
    ]
    today_rows = shift_service.filter_shift_rows(rows, "today", today)
    assert {r["id"] for r in today_rows} == {"s1", "s2"}

    completed_rows = shift_service.filter_shift_rows(rows, "completed", today)
    assert {r["id"] for r in completed_rows} == {"s2"}


def test_count_shifts_by_filter():
    today = date.today()
    future = (today.replace(year=today.year + 1)).isoformat()
    rows = [
        _sample_shift(id="s1"),
        _sample_shift(id="s2", status="completed"),
        _sample_shift(id="s3", scheduled_start=f"{future}T09:00:00+00:00"),
        _sample_shift(id="s4", status="cancelled"),
        _sample_shift(id="s5", scheduled_start=f"{future}T10:00:00+00:00"),
    ]
    counts = shift_service.count_shifts_by_filter(rows, today)
    assert counts == {"today": 2, "upcoming": 2, "completed": 1, "cancelled": 1}


def test_filter_performance_with_large_dataset():
    """CARECLIQV2-133 — filter logic stays fast on large in-memory sets."""
    import time

    today = date.today()
    future = (today.replace(year=today.year + 1)).isoformat()
    rows = [
        _sample_shift(
            id=f"shift-{i}",
            scheduled_start=f"{future}T09:00:00+00:00" if i % 3 else f"{today.isoformat()}T09:00:00+00:00",
            status="completed" if i % 17 == 0 else "scheduled",
        )
        for i in range(2000)
    ]

    start = time.perf_counter()
    for filter_name in shift_service.WORKER_SHIFT_COUNT_FILTERS:
        shift_service.filter_shift_rows(rows, filter_name, today)
    elapsed = time.perf_counter() - start

    assert elapsed < 0.5


@patch("backend.app.services.shift_service._fetch_worker_shift_rows")
def test_count_shifts_for_worker_uses_lightweight_rows(mock_fetch):
    mock_fetch.return_value = [
        {"status": "scheduled", "scheduled_start": f"{date.today().isoformat()}T09:00:00+00:00"},
        {"status": "completed", "scheduled_start": f"{date.today().isoformat()}T11:00:00+00:00"},
    ]
    counts = shift_service.count_shifts_for_worker("worker-1", "org-1")
    mock_fetch.assert_called_once_with(
        "worker-1",
        "org-1",
        columns="status, scheduled_start",
    )
    assert counts["today"] == 2
    assert counts["completed"] == 1


@patch("backend.app.services.shift_service._get_session_for_shift")
@patch("backend.app.services.shift_service._fetch_worker_shift_rows")
def test_list_shifts_for_worker_applies_server_filter(mock_fetch, mock_session):
    """CARECLIQV2-133 — list endpoint should not load every shift when filtered."""
    shift = _sample_shift(status="completed")
    mock_fetch.return_value = [shift]
    mock_session.return_value = None

    shift_service.list_shifts_for_worker("worker-1", "org-1", "completed")

    mock_fetch.assert_called_once_with(
        "worker-1",
        "org-1",
        filter_name="completed",
    )


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
def test_clock_in_clears_stale_session_link(mock_admin):
    """Fresh clock-in must not inherit an old session (CARECLIQV2-127)."""
    shift = _sample_shift(status="scheduled", session_id="old-sess")
    table = MagicMock()
    mock_admin.return_value.table.return_value = table
    table.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"id": "old-sess", "status": "draft"}]
    )
    table.update.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{
            **shift,
            "status": "in_progress",
            "clocked_in_at": datetime.now(timezone.utc).isoformat(),
            "session_id": None,
            "tasks": copy.deepcopy(shift_service.DEFAULT_SHIFT_TASKS),
        }]
    )

    with patch("backend.app.services.shift_service.get_shift_by_id", return_value=shift):
        result = shift_service.clock_in_shift("shift-1", "worker-1", "org-1")

    assert result is not None
    assert result["visual_state"] == "clocked_in"
    update_payload = table.update.call_args[0][0]
    assert update_payload.get("session_id") is None


@patch("backend.app.services.shift_service.get_supabase_admin")
def test_clock_in_initialises_default_tasks(mock_admin):
    shift = _sample_shift()
    table = MagicMock()
    mock_admin.return_value.table.return_value = table
    table.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[shift])
    table.update.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{**shift, "status": "in_progress", "clocked_in_at": datetime.now(timezone.utc).isoformat(), "tasks": copy.deepcopy(shift_service.DEFAULT_SHIFT_TASKS)}]
    )

    result = shift_service.clock_in_shift("shift-1", "worker-1", "org-1")
    assert result is not None
    assert result["visual_state"] == "clocked_in"
    assert len(result["tasks"]) == 6
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
    insert_payload = table.insert.call_args[0][0]
    assert insert_payload.get("start_time")
    mock_link.assert_called_once_with("shift-1", "sess-1")


@patch("backend.app.services.shift_service.link_shift_session")
@patch("backend.app.services.shift_service.get_supabase_admin")
@patch("backend.app.services.shift_service.get_shift_by_id")
def test_start_shift_session_replaces_completed_session(mock_get, mock_admin, mock_link):
    """Stale completed session link must not block a new live session."""
    shift = _sample_shift(
        status="in_progress",
        clocked_in_at=datetime.now(timezone.utc).isoformat(),
        session_id="old-sess",
        risks_acknowledged_at=datetime.now(timezone.utc).isoformat(),
    )
    new_session = {"id": "sess-new", "status": "draft"}
    mock_get.side_effect = [shift, {**shift, "session_id": "sess-new"}]

    table = MagicMock()
    mock_admin.return_value.table.return_value = table
    patients_chain = table.select.return_value.eq.return_value.eq.return_value.limit.return_value
    patients_chain.execute.return_value = MagicMock(data=[{"id": "patient-1"}])
    table.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"id": "old-sess", "status": "completed"}]
    )
    table.insert.return_value.execute.return_value = MagicMock(data=[new_session])

    user = {"id": "worker-1", "role": "support_worker", "organization_id": "org-1"}
    result = shift_service.start_shift_session("shift-1", "worker-1", "org-1", user)

    assert result is not None
    assert result["visual_state"] == "session_active"
    mock_link.assert_called_once_with("shift-1", "sess-new")


@patch("backend.app.services.shift_service.get_shift_for_session")
@patch("backend.app.services.shift_service.get_supabase_admin")
def test_start_session_by_id_updates_start_time(mock_admin, mock_get_shift):
    session = {
        "id": "sess-1",
        "status": "draft",
        "organization_id": "org-1",
        "participant_id": "patient-1",
        "shift_id": "shift-1",
    }
    shift = _sample_shift(
        status="in_progress",
        clocked_in_at=datetime.now(timezone.utc).isoformat(),
        session_id="sess-1",
        risks_acknowledged_at=datetime.now(timezone.utc).isoformat(),
    )
    mock_get_shift.return_value = shift

    table = MagicMock()
    mock_admin.return_value.table.return_value = table
    table.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[session]
    )
    updated_session = {**session, "start_time": "2026-06-17T10:00:00Z"}
    table.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[updated_session])
    table.select.return_value.eq.return_value.limit.return_value.execute.side_effect = [
        MagicMock(data=[session]),
        MagicMock(data=[updated_session]),
    ]

    result = shift_service.start_session_by_id(
        "sess-1",
        "worker-1",
        "org-1",
        started_at="2026-06-17T10:00:00Z",
    )

    assert result["success"] is True
    assert result["session"]["sessionId"] == "sess-1"
    assert result["session"]["status"] == "active"
    assert result["session"]["startedAt"] == "2026-06-17T10:00:00Z"


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


def test_build_support_instructions_uses_stored_json():
    shift = _sample_shift(
        support_instructions=[
            {
                "category": "Mobility",
                "body": "Use ramp on left side.",
                "critical": False,
                "image_url": "https://example.com/ramp.png",
            },
            {"category": "Meals", "body": "Offer fluids hourly.", "critical": "false"},
        ]
    )
    sections = shift_service.build_support_instructions(shift)
    assert len(sections) == 2
    assert sections[0]["category"] == "Mobility"
    assert sections[0]["image_url"] == "https://example.com/ramp.png"
    assert sections[1]["category"] == "Meals"


def test_build_support_instructions_legacy_mapping():
    shift = _sample_shift(
        access_instructions="Wheelchair ramp on left.",
        visit_notes="Use gait belt for transfers.\nPrompt morning medications with MAR chart.",
        health_flags="Falls risk in bathroom",
        allergies="Peanuts",
        coordinator_notes="Focus on hydration and meals today.",
    )
    ctx = {
        "preferences": {"behaviour_support": "Use calm redirection when anxious."},
        "profile": {"medications": "Metformin 500mg morning"},
    }
    sections = shift_service.build_support_instructions(shift, ctx)
    categories = [section["category"] for section in sections]
    assert "Mobility" in categories
    assert "Transfers" in categories
    assert "Medication Prompts" in categories
    assert "Behaviour Support" in categories
    assert "Personal Care" in categories
    transfers = next(section for section in sections if section["category"] == "Transfers")
    assert transfers["critical"] == "true"


def test_get_support_instructions_for_worker():
    shift = _sample_shift(
        support_instructions=[
            {"category": "Transfers", "body": "⛔ Use gait belt.", "critical": True},
        ]
    )
    with patch("backend.app.services.shift_service.get_shift_by_id", return_value=shift):
        with patch(
            "backend.app.services.shift_service._fetch_participant_context",
            return_value={},
        ):
            payload = shift_service.get_support_instructions_for_worker(
                "shift-1", "worker-1", "org-1"
            )
    assert payload is not None
    assert payload["shift_id"] == "shift-1"
    assert payload["support_instructions"][0]["category"] == "Transfers"


@patch("backend.app.services.shift_service._fetch_participant_context")
@patch("backend.app.services.shift_service._get_session_for_shift")
@patch("backend.app.services.shift_service.get_shift_by_id")
def test_get_shift_detail_rebuilds_support_instructions(mock_get, mock_session, mock_ctx):
    shift = _sample_shift(
        visit_notes="Prompt medications at 9am.",
        access_instructions="Ramp on left.",
    )
    mock_get.return_value = shift
    mock_session.return_value = None
    mock_ctx.return_value = {
        "preferences": {"behaviour_support": "Offer breaks when overwhelmed."},
        "profile": {},
    }
    detail = shift_service.get_shift_detail_for_worker("shift-1", "worker-1", "org-1")
    assert detail is not None
    categories = [section["category"] for section in detail["support_instructions"]]
    assert "Mobility" in categories
    assert "Medication Prompts" in categories
    assert "Behaviour Support" in categories
