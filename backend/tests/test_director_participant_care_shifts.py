"""The care profile and recent shifts on the director's participant page."""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from backend.app.services import director_participant_service as svc

NOW = datetime(2026, 11, 6, 10, 0, tzinfo=timezone.utc)


def _iso(hours: int) -> str:
    return (NOW + timedelta(hours=hours)).isoformat()


def test_allergies_are_listed_separately_and_nil_entries_dropped():
    assert svc._split_list("Penicillin; peanuts, Latex.") == ["Penicillin", "peanuts", "Latex"]
    assert svc._split_list("Nil") == []
    assert svc._split_list(None) == []


def test_care_profile_puts_high_risk_medication_first_and_skips_stopped_ones():
    meds = [
        {"name": "Paracetamol", "status": "active", "is_prn": True, "is_high_risk": False},
        {"name": "Warfarin", "status": "active", "is_prn": False, "is_high_risk": True},
        {"name": "Old script", "status": "discontinued"},
    ]
    row = {
        "primary_disability": "Autism",
        "allergies": "Penicillin, Atopic eczema",
        "communication_preferences": "Short sentences, visual cues",
        "emergency_contact": {"name": "Jo Carter", "relationship": "Mother", "phone": "0400 000 000"},
    }
    with patch("backend.app.services.briefing_service.list_participant_briefing_alerts", return_value=[{"alert_text": "Choking risk with dry food"}]):
        care = svc._care("p1", "org", row, meds)
    assert [m["name"] for m in care["medications"]] == ["Warfarin", "Paracetamol"]
    assert care["medications"][0]["high_risk"] is True
    assert care["allergies"] == ["Penicillin", "Atopic eczema"]
    assert care["alerts"] == ["Choking risk with dry food"]
    assert care["emergency_contact"] == {"name": "Jo Carter", "relationship": "Mother", "phone": "0400 000 000"}


def test_recent_shifts_are_newest_first_with_where_each_stands():
    shifts = [
        {"id": "future", "scheduled_start": _iso(24), "status": "scheduled", "worker_id": "w1"},
        {"id": "verified", "scheduled_start": _iso(-48), "status": "completed", "worker_id": "w1"},
        {"id": "changes", "scheduled_start": _iso(-24), "status": "completed", "worker_id": "w2"},
        {"id": "waiting", "scheduled_start": _iso(-3), "status": "completed", "worker_id": "w1"},
        {"id": "cancelled", "scheduled_start": _iso(-72), "status": "cancelled", "worker_id": None},
    ]
    people = {"w1": {"full_name": "Priya Sharma"}, "w2": {"full_name": "Ben Ito"}}
    with (
        patch("backend.app.services.shift_review_service._verified_shift_ids", return_value={"verified"}),
        patch("backend.app.services.shift_review_service.office_review_states", return_value={"changes": "changes_requested"}),
    ):
        recent = svc._recent_shifts(shifts, people, NOW)
    assert [(s["id"], s["review"]) for s in recent] == [
        ("waiting", "awaiting_review"),
        ("changes", "changes_requested"),
        ("verified", "verified"),
        ("cancelled", None),
    ]
    assert recent[0]["worker"]["name"] == "Priya Sharma"
