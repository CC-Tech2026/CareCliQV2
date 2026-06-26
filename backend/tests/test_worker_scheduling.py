"""Tests for worker scheduling features (CARECLIQV2-281/283/284)."""

from __future__ import annotations

from datetime import date

from unittest.mock import patch

from backend.app.services import worker_calendar_service, worker_availability_service


def test_extract_suburb_from_address():
    assert worker_calendar_service.extract_suburb("12 King William St, Adelaide SA 5000") == "Adelaide"
    assert worker_calendar_service.extract_suburb("") is None


def test_calendar_display_status_cancelled():
    assert worker_calendar_service._calendar_display_status({"status": "cancelled"}) == "cancelled"


def test_calendar_display_status_tentative():
    assert worker_calendar_service._calendar_display_status({
        "status": "scheduled",
        "confirmation_status": "tentative",
    }) == "tentative"


def test_calendar_display_status_confirmed():
    assert worker_calendar_service._calendar_display_status({
        "status": "scheduled",
        "confirmation_status": "confirmed",
    }) == "confirmed"


def test_participant_colour_map_max_four():
    shifts = [{"participant_id": f"p{i}"} for i in range(6)]
    colours = worker_calendar_service._participant_colour_map(shifts)
    assert len(set(colours.values())) == 1
    assert colours["p0"] == worker_calendar_service.MULTIPLE_COLOUR


def test_anonymise_participant_name():
    assert worker_calendar_service.anonymise_participant_name("James Chen") == "James C."


def test_slot_for_hour():
    assert worker_availability_service.slot_for_hour(8) == "morning"
    assert worker_availability_service.slot_for_hour(14) == "afternoon"
    assert worker_availability_service.slot_for_hour(18) == "evening"


def test_slot_statuses_defined():
    assert worker_availability_service.SLOT_STATUSES == frozenset({"available", "unavailable", "preferred"})


def test_build_ical_contains_calendar_header():
    with patch.object(worker_calendar_service, "list_shifts_for_calendar", return_value=[]):
        ical = worker_calendar_service.build_ical_feed("nonexistent", "org")
    assert "BEGIN:VCALENDAR" in ical
    assert "END:VCALENDAR" in ical


def test_calendar_route_not_captured_by_shift_id_param():
    """GET /worker/shifts/calendar must not hit /worker/shifts/{shift_id} (uuid 'calendar' 500)."""
    from fastapi.testclient import TestClient

    from backend.app.core.security import get_current_user
    from backend.app.main import app

    worker = {
        "sub": "worker-123",
        "id": "worker-123",
        "role": "support_worker",
        "organization_id": "org-123",
    }
    app.dependency_overrides[get_current_user] = lambda: worker
    try:
        with patch.object(
            worker_calendar_service,
            "get_calendar_payload",
            return_value={"shifts": [], "time_off_blocks": [], "start_date": "2026-06-01", "end_date": "2026-06-30"},
        ):
            client = TestClient(app)
            response = client.get(
                "/api/worker/shifts/calendar",
                params={"start_date": "2026-06-01", "end_date": "2026-06-30"},
            )
        assert response.status_code == 200
        assert "shifts" in response.json()
    finally:
        app.dependency_overrides.clear()
