"""Tests for worker shift APIs (CARECLIQV2-116 / CARECLIQV2-134)."""

from __future__ import annotations

import copy
from datetime import date, datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from backend.app.core.timezone import app_today
from backend.app.services import shift_service


_MOCK_SAFETY_CLEAR = {
    "requires_safety_ack": False,
    "has_safety_content": False,
    "acknowledged_version": None,
    "content_version": 0,
}


def _shift_window_start(minutes_from_now: float = 5) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes_from_now)).isoformat()


def _sample_shift(**overrides):
    base = {
        "id": "shift-1",
        "organization_id": "org-1",
        "worker_id": "worker-1",
        "participant_id": "patient-1",
        "participant_name": "James Chen",
        "scheduled_start": _shift_window_start(),
        "scheduled_end": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat(),
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
        ("today", {"status": "completed"}, False),
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
    assert {r["id"] for r in today_rows} == {"s1"}

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
    assert counts == {"today": 1, "upcoming": 2, "completed": 1, "cancelled": 1}


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
    assert counts["today"] == 1
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


@patch("backend.app.services.shift_service.log_shift_check_in")
@patch("backend.app.services.shift_service._apply_verified_check_in", return_value={"clock_in_method": "gps", "clock_in_verified": True})
@patch("backend.app.services.shift_service._ensure_risks_acknowledged_if_required")
@patch("backend.app.services.shift_service.get_supabase_admin")
def test_clock_in_clears_stale_session_link(mock_admin, _mock_ack_guard, _mock_verify, _mock_log):
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
        result = shift_service.clock_in_shift(
            "shift-1",
            "worker-1",
            "org-1",
            method="gps",
            location={"lat": -33.8688, "lng": 151.2093, "accuracy": 10},
        )

    assert result is not None
    assert result["visual_state"] == "clocked_in"
    update_payload = table.update.call_args[0][0]
    assert update_payload.get("session_id") is None


@patch("backend.app.services.shift_service.log_shift_check_in")
@patch("backend.app.services.shift_service._apply_verified_check_in", return_value={"clock_in_method": "gps", "clock_in_verified": True})
@patch("backend.app.services.shift_service._ensure_risks_acknowledged_if_required")
@patch("backend.app.services.shift_service.get_supabase_admin")
def test_clock_in_initialises_default_tasks(mock_admin, _mock_ack_guard, _mock_verify, _mock_log):
    shift = _sample_shift()
    table = MagicMock()
    mock_admin.return_value.table.return_value = table
    table.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[shift])
    table.update.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{**shift, "status": "in_progress", "clocked_in_at": datetime.now(timezone.utc).isoformat(), "tasks": copy.deepcopy(shift_service.DEFAULT_SHIFT_TASKS)}]
    )

    result = shift_service.clock_in_shift(
        "shift-1",
        "worker-1",
        "org-1",
        method="gps",
        location={"lat": -33.8688, "lng": 151.2093, "accuracy": 10},
    )
    assert result is not None
    assert result["visual_state"] == "clocked_in"
    assert len(result["tasks"]) == 6
    table.update.assert_called()


@patch("backend.app.services.shift_service._ensure_risks_acknowledged_if_required")
@patch("backend.app.services.shift_service.get_shift_by_id")
def test_clock_in_rejects_without_verification_method(mock_get, _mock_risks):
    mock_get.return_value = _sample_shift()
    with pytest.raises(ValueError, match="Verified check-in required"):
        shift_service.clock_in_shift("shift-1", "worker-1", "org-1")


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


@patch("backend.app.services.shift_service._ensure_risks_acknowledged_if_required")
@patch("backend.app.services.shift_service._get_session_for_shift")
@patch("backend.app.services.shift_service.link_shift_session")
@patch("backend.app.services.shift_service.get_supabase_admin")
@patch("backend.app.services.shift_service.get_shift_by_id")
def test_start_shift_session_uses_shift_ownership_not_assignment(
    mock_get, mock_admin, mock_link, mock_get_session, _mock_risks,
):
    shift = _sample_shift(
        status="in_progress",
        clocked_in_at=datetime.now(timezone.utc).isoformat(),
        risks_acknowledged_at=datetime.now(timezone.utc).isoformat(),
    )
    session_row = {"id": "sess-1", "status": "draft"}
    mock_get.side_effect = [shift, {**shift, "session_id": "sess-1"}]
    mock_get_session.return_value = {"id": "sess-1", "status": "draft", "start_time": "2026-01-15T09:00:00Z"}

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


@patch("backend.app.services.shift_service._ensure_risks_acknowledged_if_required")
@patch("backend.app.services.shift_service._get_session_for_shift")
@patch("backend.app.services.shift_service.link_shift_session")
@patch("backend.app.services.shift_service.get_supabase_admin")
@patch("backend.app.services.shift_service.get_shift_by_id")
def test_start_shift_session_replaces_completed_session(
    mock_get, mock_admin, mock_link, mock_get_session, _mock_risks,
):
    """Stale completed session link must not block a new live session."""
    shift = _sample_shift(
        status="in_progress",
        clocked_in_at=datetime.now(timezone.utc).isoformat(),
        session_id="old-sess",
        risks_acknowledged_at=datetime.now(timezone.utc).isoformat(),
    )
    new_session = {"id": "sess-new", "status": "draft"}
    mock_get.side_effect = [shift, {**shift, "session_id": "sess-new"}]
    mock_get_session.side_effect = [
        {"id": "old-sess", "status": "completed"},
        {"id": "sess-new", "status": "draft", "start_time": "2026-01-15T09:00:00Z"},
    ]

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


@patch("backend.app.services.shift_service._ensure_risks_acknowledged_if_required")
@patch("backend.app.services.shift_service.get_shift_for_session")
@patch("backend.app.services.shift_service.get_supabase_admin")
def test_start_session_by_id_updates_start_time(mock_admin, mock_get_shift, _mock_risks):
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
            task["note"] = "Completed with sufficient written evidence."
    assert shift_service._mandatory_tasks_complete(tasks) is True


@patch("backend.app.services.shift_service.get_shift_by_id")
def test_update_shift_tasks_rejects_mandatory_without_evidence(mock_get):
    tasks = copy.deepcopy(shift_service.DEFAULT_SHIFT_TASKS)
    tasks[0]["completed"] = True
    mock_get.return_value = _sample_shift(tasks=tasks)
    with pytest.raises(ValueError, match="Mandatory task"):
        shift_service.update_shift_tasks("shift-1", "worker-1", "org-1", tasks)


@patch("backend.app.services.shift_signature_service.require_signature_for_shift")
@patch("backend.app.services.shift_service._get_session_for_shift")
@patch("backend.app.services.shift_service.get_supabase_admin")
@patch("backend.app.services.shift_service.get_shift_by_id")
def test_end_shift_completes_shift(mock_get, mock_admin, mock_session, _mock_signature):
    tasks = copy.deepcopy(shift_service.DEFAULT_SHIFT_TASKS)
    for task in tasks:
        if task.get("mandatory") or int(task.get("order") or 0) <= 4:
            task["completed"] = True
            task["note"] = "Completed with sufficient written evidence."
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
    assert result["completion_summary"]["mandatory_completed"] == 5


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


@patch(
    "backend.app.services.safety_protocol_service.build_worker_safety_status",
    return_value=_MOCK_SAFETY_CLEAR,
)
@patch("backend.app.services.shift_service._fetch_participant_context")
@patch("backend.app.services.shift_service._get_session_for_shift")
@patch("backend.app.services.shift_service.get_shift_by_id")
def test_get_shift_detail_rebuilds_support_instructions(
    mock_get, mock_session, mock_ctx, _mock_safety,
):
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


def test_fetch_participant_context_shapes_payload():
    row = {
        "id": "patient-1",
        "full_name": "James Chen",
        "preferred_name": "Jamie",
        "ndis_number": "430123456",
        "date_of_birth": "1990-01-15",
        "phone": "0400000000",
        "email": "jamie@example.com",
        "emergency_contact": {"name": "Sam Chen", "phone": "0400111222", "relationship": "Mother"},
        "case_manager_name": "Alex Rivera",
        "case_manager_phone": "0400333444",
        "communication_preferences": "Short sentences",
        "likes_dislikes": "Enjoys puzzles",
        "sensory_preferences": "Quiet spaces",
        "cultural_preferences": "Prefers morning visits",
        "visit_notes": "Shower before 10am",
        "medications": "Metformin",
        "current_conditions": "Type 2 diabetes",
        "medical_alerts": "Falls risk",
        "communication_guidance": "Offer choices, not yes/no",
        "previous_visit_notes": "Hydration plan worked well",
        "previous_visit_notes_updated_at": "2026-06-01T10:00:00Z",
        "preferred_activities": ["Gardening", "Music"],
        "behavioural_notes": [{"title": "Transitions", "body": "Give 10 min warning"}],
        "primary_disability": "Intellectual disability",
        "health_flags": None,
        "behaviour_support_plan": None,
        "restricted_behavioural_notes": None,
        "allergies": None,
    }
    with patch("backend.app.services.shift_service.get_supabase_admin") as mock_admin:
        patients_table = MagicMock()
        patients_table.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
            data=[row]
        )
        allergies_table = MagicMock()
        allergies_table.select.return_value.eq.return_value.eq.return_value.order.return_value.execute.return_value = MagicMock(
            data=[{"id": "a1", "allergen": "Peanuts", "severity": "anaphylactic", "notes": None}]
        )

        def table_router(name):
            if name == "patients":
                return patients_table
            if name == "participant_allergies":
                return allergies_table
            return MagicMock()

        mock_admin.return_value.table.side_effect = table_router
        ctx = shift_service._fetch_participant_context("patient-1", "org-1")

    assert ctx["profile"]["preferred_name"] == "Jamie"
    assert ctx["profile"]["case_manager"]["name"] == "Alex Rivera"
    assert ctx["preferences"]["likes_dislikes"] == "Enjoys puzzles"
    assert ctx["preferences"]["sensory_preferences"] == "Quiet spaces"
    assert ctx["context"]["medical"]["allergies"][0]["severity"] == "anaphylactic"
    assert ctx["context"]["preferred_activities"] == ["Gardening", "Music"]
    assert ctx["context_synced_at"]


def test_enrich_shift_participant_context_uses_shift_snapshot():
    payload: dict = {}
    shift = {
        "participant_name": "James Chen",
        "participant_phone": "0400111222",
        "participant_dob": "1990-05-01",
        "visit_notes": "Shower before 10am",
        "health_flags": "Falls risk",
        "allergies": "Peanuts — anaphylactic",
    }
    shift_service._enrich_shift_participant_context(payload, shift)
    assert payload["profile"]["preferred_name"] == "James Chen"
    assert payload["profile"]["phone"] == "0400111222"
    assert payload["preferences"]["routines"] == "Shower before 10am"
    assert payload["context"]["medical"]["alerts"] == "Peanuts — anaphylactic"


def test_get_participant_profile_for_worker():
    shift = _sample_shift(
        participant_id="patient-1",
        participant_name="James Chen",
        participant_phone="0400111222",
        participant_dob="1990-05-01",
    )
    ctx = {
        "profile": {
            "preferred_name": "Jamie",
            "ndis_number": "430123456",
            "emergency_contact": {"name": "Sam", "phone": "0400999888"},
            "case_manager": {"name": "Alex Rivera", "phone": "0400777666"},
        },
        "context_synced_at": "2026-06-18T10:00:00Z",
    }
    with patch("backend.app.services.shift_service.get_shift_by_id", return_value=shift):
        with patch(
            "backend.app.services.shift_service._fetch_participant_context",
            return_value=ctx,
        ):
            payload = shift_service.get_participant_profile_for_worker(
                "shift-1", "worker-1", "org-1"
            )
    assert payload is not None
    assert payload["shift_id"] == "shift-1"
    assert payload["participant_id"] == "patient-1"
    assert payload["profile"]["preferred_name"] == "Jamie"
    assert payload["profile"]["ndis_number"] == "430123456"
    assert payload["profile"]["emergency_contact"]["phone"] == "0400999888"
    assert payload["profile"]["case_manager"]["name"] == "Alex Rivera"
    assert payload["context_synced_at"] == "2026-06-18T10:00:00Z"


def test_get_participant_preferences_for_worker():
    shift = _sample_shift(
        participant_id="patient-1",
        visit_notes="Shower before 10am",
        health_flags="Falls risk",
    )
    ctx = {
        "preferences": {
            "communication_style": "Short sentences",
            "likes_dislikes": "Enjoys puzzles",
            "sensory_preferences": "Quiet spaces",
            "cultural_preferences": "Prefers morning visits",
            "behaviour_support": "Use calm redirection",
        },
        "context_synced_at": "2026-06-18T10:00:00Z",
    }
    with patch("backend.app.services.shift_service.get_shift_by_id", return_value=shift):
        with patch(
            "backend.app.services.shift_service._fetch_participant_context",
            return_value=ctx,
        ):
            payload = shift_service.get_participant_preferences_for_worker(
                "shift-1", "worker-1", "org-1"
            )
    assert payload is not None
    assert payload["shift_id"] == "shift-1"
    prefs = payload["preferences"]
    assert prefs["communication_style"] == "Short sentences"
    assert prefs["likes_dislikes"] == "Enjoys puzzles"
    assert prefs["routines"] == "Shower before 10am"
    assert prefs["health_flags"] == "Falls risk"
    assert prefs["behaviour_support"] == "Use calm redirection"


def test_get_participant_profile_for_worker_denies_other_worker():
    shift = _sample_shift(worker_id="other-worker")
    with patch("backend.app.services.shift_service.get_shift_by_id", return_value=shift):
        payload = shift_service.get_participant_profile_for_worker(
            "shift-1", "worker-1", "org-1"
        )
    assert payload is None


def test_build_participant_risks_from_shift_text():
    shift = _sample_shift(
        health_alerts="⚠️ Peanut allergy — avoid all nut products\n⛔ Risk of falls — supervise transfers",
        allergies="Peanuts, tree nuts",
    )
    risks = shift_service.build_participant_risks(shift, "org-1")
    assert len(risks) >= 2
    types = {r["type"] for r in risks}
    assert "allergy" in types
    assert "falls_risk" in types
    assert all(r.get("title") and r.get("instructions") for r in risks)


def test_infer_risk_type_covers_ticket_categories():
    assert shift_service._infer_risk_type("Legal blindness") == "legal_blindness"
    assert shift_service._infer_risk_type("History of seizures") == "seizures"
    assert shift_service._infer_risk_type("Behaviour Support Plan in place") == "bsp"
    assert shift_service._infer_risk_type("Swallowing risk — thickened fluids") == "swallowing_risk"


@patch("backend.app.services.shift_service._get_session_for_shift", return_value=None)
@patch("backend.app.services.shift_service.get_shift_by_id")
def test_acknowledge_shift_risks_requires_alerts(mock_get, _mock_session):
    mock_get.return_value = _sample_shift(health_alerts=None, allergies=None)
    with pytest.raises(ValueError, match="No safety alerts"):
        shift_service.acknowledge_shift_risks("shift-1", "worker-1", "org-1")


@patch("backend.app.services.shift_service._get_session_for_shift", return_value=None)
@patch("backend.app.services.shift_service.get_supabase_admin")
@patch("backend.app.services.shift_service.get_shift_by_id")
def test_acknowledge_shift_risks_persists_timestamp(mock_get, mock_admin, _mock_session):
    shift = _sample_shift(
        health_alerts="⚠️ Peanut allergy — avoid all nut products",
    )
    mock_get.return_value = shift
    table = MagicMock()
    mock_admin.return_value.table.return_value = table
    table.update.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{**shift, "risks_acknowledged_at": "2026-06-19T10:00:00+00:00", "risks_acknowledged_by": "worker-1"}]
    )

    result = shift_service.acknowledge_shift_risks("shift-1", "worker-1", "org-1")

    assert result is not None
    assert result["risks_acknowledged"] is True
    update_payload = table.update.call_args[0][0]
    assert update_payload["risks_acknowledged_by"] == "worker-1"
    assert update_payload["risks_acknowledged_at"]


@patch("backend.app.services.shift_service._get_session_for_shift", return_value=None)
@patch("backend.app.services.shift_service.get_shift_by_id")
def test_clock_in_shift_blocked_without_risk_acknowledgement(mock_get, _mock_session):
    mock_get.return_value = _sample_shift(
        health_alerts="⛔ Risk of falls — supervise transfers",
    )
    with pytest.raises(ValueError, match="Acknowledge risks"):
        shift_service.clock_in_shift("shift-1", "worker-1", "org-1")


@patch("backend.app.services.shift_service._get_session_for_shift", return_value=None)
@patch("backend.app.services.shift_service.get_supabase_admin")
@patch("backend.app.services.shift_service.get_shift_by_id")
def test_get_participant_risks_for_worker(mock_get, mock_admin, _mock_session):
    shift = _sample_shift(
        health_alerts="⚠️ Peanut allergy — avoid all nut products",
    )
    mock_get.return_value = shift
    mock_admin.return_value.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(data=[])

    payload = shift_service.get_participant_risks_for_worker("shift-1", "worker-1", "org-1")

    assert payload is not None
    assert payload["shift_id"] == "shift-1"
    assert len(payload["alerts"]) >= 1
    assert payload["risks_acknowledged"] is False


@patch("backend.app.services.shift_service.log_shift_check_in")
@patch("backend.app.services.shift_service._ensure_risks_acknowledged_if_required")
@patch("backend.app.services.shift_service.resolve_participant_coordinates", return_value=(-33.8688, 151.2093))
@patch("backend.app.services.shift_service.get_supabase_admin")
def test_clock_in_with_gps_verification(mock_admin, _mock_coords, _mock_ack, _mock_log):
    shift = _sample_shift(participant_latitude=-33.8688, participant_longitude=151.2093)
    table = MagicMock()
    mock_admin.return_value.table.return_value = table
    table.update.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{
            **shift,
            "status": "in_progress",
            "clocked_in_at": datetime.now(timezone.utc).isoformat(),
            "clock_in_method": "gps",
            "clock_in_verified": True,
            "tasks": copy.deepcopy(shift_service.DEFAULT_SHIFT_TASKS),
        }]
    )

    with patch("backend.app.services.shift_service.get_shift_by_id", return_value=shift):
        result = shift_service.clock_in_shift(
            "shift-1",
            "worker-1",
            "org-1",
            method="gps",
            location={"lat": -33.8688, "lng": 151.2093, "accuracy": 10},
        )

    assert result is not None
    assert result["clock_in_method"] == "gps"
    assert result["clock_in_verified"] is True
    _mock_log.assert_called_once()


@patch("backend.app.services.shift_service._ensure_risks_acknowledged_if_required")
@patch("backend.app.services.shift_service.resolve_participant_coordinates", return_value=(-33.8688, 151.2093))
@patch("backend.app.services.shift_service.get_shift_by_id")
def test_clock_in_gps_rejects_far_location(mock_get, _mock_coords, _mock_ack):
    mock_get.return_value = _sample_shift()
    with pytest.raises(ValueError, match="too far"):
        shift_service.clock_in_shift(
            "shift-1",
            "worker-1",
            "org-1",
            method="gps",
            location={"lat": -34.0, "lng": 151.5},
        )


@patch("backend.app.services.shift_service._ensure_risks_acknowledged_if_required")
@patch("backend.app.services.shift_service.get_shift_by_id")
def test_clock_in_rejects_outside_time_window(mock_get, _mock_ack):
    mock_get.return_value = _sample_shift(scheduled_start=_shift_window_start(60))
    with pytest.raises(ValueError, match="Too early"):
        shift_service.clock_in_shift("shift-1", "worker-1", "org-1")


def test_goal_id_for_shift_task_resolves_from_tasks_json():
    shift = _sample_shift(
        tasks=[
            {
                "task_id": "default_personal_hygiene",
                "goal_id": "daily_living_skills",
            }
        ]
    )
    assert shift_service._goal_id_for_shift_task(shift, "default_personal_hygiene") == "daily_living_skills"
    assert shift_service._goal_id_for_shift_task(shift, "missing") is None


@patch("backend.app.services.shift_service.get_shift_for_session")
@patch("backend.app.services.shift_service.get_supabase_admin")
def test_sync_session_notes_upserts_by_client_id(mock_admin, mock_shift_for_session):
    session = {
        "id": "sess-1",
        "shift_id": "shift-1",
        "worker_id": "worker-1",
        "organization_id": "org-1",
    }
    shift = _sample_shift(
        id="shift-1",
        session_id="sess-1",
        tasks=[{"task_id": "default_meal_prep", "goal_id": "daily_living_skills"}],
    )
    mock_shift_for_session.return_value = shift

    sessions_table = MagicMock()
    notes_table = MagicMock()
    mock_admin.return_value.table.side_effect = lambda name: sessions_table if name == "sessions" else notes_table

    sessions_table.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[session]
    )
    notes_table.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[]
    )
    notes_table.insert.return_value.execute.return_value = MagicMock(
        data=[
            {
                "id": "note-db-1",
                "client_note_id": "client-1",
                "session_id": "sess-1",
                "content": "Benjamin showered independently",
                "task_id": None,
                "goal_id": None,
                "created_at": "2026-01-15T14:45:00Z",
                "auto_saved_at": "2026-01-15T14:45:30Z",
            }
        ]
    )

    result = shift_service.sync_session_notes(
        "sess-1",
        "worker-1",
        "org-1",
        [
            {
                "note_id": "client-1",
                "content": "Benjamin showered independently",
                "created_at": "2026-01-15T14:45:00Z",
                "auto_saved_at": "2026-01-15T14:45:30Z",
            }
        ],
    )

    assert result is not None
    assert result["session_id"] == "sess-1"
    assert len(result["notes"]) == 1
    assert result["notes"][0]["content"] == "Benjamin showered independently"
    notes_table.insert.assert_called_once()


def test_get_shift_detail_denies_wrong_worker():
    shift = _sample_shift(worker_id="worker-1")
    with patch("backend.app.services.shift_service.get_shift_by_id", return_value=shift):
        with pytest.raises(shift_service.ShiftAccessDenied):
            shift_service.get_shift_detail_for_worker("shift-1", "other-worker", "org-1")


def test_get_shift_detail_denies_wrong_org():
    shift = _sample_shift(organization_id="org-1")
    with patch("backend.app.services.shift_service.get_shift_by_id", return_value=shift):
        with pytest.raises(shift_service.ShiftAccessDenied):
            shift_service.get_shift_detail_for_worker("shift-1", "worker-1", "org-2")


def test_validate_shift_scheduled_today_rejects_wrong_day():
    past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    with pytest.raises(shift_service.ShiftNotScheduledToday):
        shift_service.validate_shift_scheduled_today(past)


def test_today_filter_matches_clock_in_adelaide_day():
    """UTC prefix 'today' must not disagree with Adelaide clock-in validation."""
    adelaide_today = app_today()
    # Stored as naive UTC wall clock (the original bug pattern)
    wrong_utc = f"{adelaide_today.isoformat()}T19:30:00+00:00"
    shift = _sample_shift(scheduled_start=wrong_utc)
    assert shift_service._matches_filter(shift, "today", adelaide_today) is False
    with pytest.raises(shift_service.ShiftNotScheduledToday):
        shift_service.validate_shift_scheduled_today(wrong_utc, today=adelaide_today)

    correct_utc = f"{adelaide_today.isoformat()}T10:00:00+00:00"
    good_shift = _sample_shift(scheduled_start=correct_utc)
    assert shift_service._matches_filter(good_shift, "today", adelaide_today) is True
    shift_service.validate_shift_scheduled_today(correct_utc, today=adelaide_today)


def test_clock_in_raises_when_already_clocked():
    shift = _sample_shift(clocked_in_at=datetime.now(timezone.utc).isoformat())
    with patch("backend.app.services.shift_service.get_shift_by_id", return_value=shift):
        with pytest.raises(shift_service.ShiftAlreadyClockedIn):
            shift_service.clock_in_shift("shift-1", "worker-1", "org-1", method="gps")

