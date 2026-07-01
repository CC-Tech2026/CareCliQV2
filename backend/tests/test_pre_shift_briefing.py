"""Tests for pre-shift briefing (CARECLIQV2-267)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from backend.app.services import briefing_service


def _sample_shift(**overrides):
    base = {
        "id": "shift-1",
        "organization_id": "org-1",
        "worker_id": "worker-1",
        "participant_id": "patient-1",
        "participant_name": "Ben Taylor",
        "status": "scheduled",
        "briefing_content_version": 1,
    }
    base.update(overrides)
    return base


@patch("backend.app.services.briefing_service._get_briefing_ack", return_value=None)
@patch("backend.app.services.briefing_service.list_participant_briefing_alerts", return_value=[])
def test_is_briefing_incomplete_without_ack(_mock_alerts, _mock_ack):
    assert briefing_service.is_briefing_complete_for_shift(_sample_shift(), "worker-1") is False


@patch("backend.app.services.briefing_service._list_alert_ack_ids", return_value={"alert-1"})
@patch("backend.app.services.briefing_service.list_participant_briefing_alerts", return_value=[{"id": "alert-1"}])
@patch("backend.app.services.briefing_service._fetch_patient_briefing_fields")
@patch("backend.app.services.briefing_service._get_briefing_ack")
def test_is_briefing_complete_when_versions_match(mock_ack, mock_patient, _mock_alerts, _mock_alert_ids):
    mock_ack.return_value = {
        "patient_briefing_version": 2,
        "shift_briefing_version": 1,
    }
    mock_patient.return_value = {"briefing_content_version": 2}
    shift = _sample_shift(briefing_content_version=1)
    assert briefing_service.is_briefing_complete_for_shift(shift, "worker-1") is True


@patch("backend.app.services.briefing_service._briefing_ack_lookup_available", return_value=True)
@patch("backend.app.services.briefing_service._briefing_schema_available", return_value=True)
@patch("backend.app.services.briefing_service.is_briefing_complete_for_shift", return_value=False)
def test_ensure_briefing_completed_raises(_mock_complete, _mock_schema, _mock_lookup):
    with pytest.raises(ValueError, match="pre-shift briefing"):
        briefing_service.ensure_briefing_completed(_sample_shift(), "worker-1")


@patch("backend.app.services.briefing_service._briefing_ack_lookup_available", return_value=False)
@patch("backend.app.services.briefing_service._briefing_schema_available", return_value=True)
@patch("backend.app.services.briefing_service.is_briefing_complete_for_shift", return_value=False)
def test_ensure_briefing_completed_skips_when_lookup_unavailable(_mock_complete, _mock_schema, _mock_lookup):
    briefing_service.ensure_briefing_completed(_sample_shift(), "worker-1")


@patch("backend.app.services.briefing_service._briefing_schema_available", return_value=False)
@patch("backend.app.services.briefing_service.is_briefing_complete_for_shift", return_value=False)
def test_ensure_briefing_completed_skips_when_schema_missing(_mock_complete, _mock_schema):
    briefing_service.ensure_briefing_completed(_sample_shift(), "worker-1")


@patch("backend.app.services.briefing_service._get_worker_shift")
@patch("backend.app.services.briefing_service._fetch_patient_briefing_fields")
@patch("backend.app.services.briefing_service.list_participant_briefing_alerts", return_value=[])
@patch("backend.app.services.briefing_service._list_alert_ack_ids", return_value=set())
@patch("backend.app.services.briefing_service._fetch_latest_visit_note", return_value=None)
@patch("backend.app.services.briefing_service.resolve_emergency_contacts", return_value=[])
@patch("backend.app.services.briefing_service.is_briefing_complete_for_shift", return_value=False)
def test_get_briefing_payload(
    _mock_complete,
    _mock_contacts,
    _mock_note,
    _mock_alert_ids,
    _mock_alerts,
    mock_patient,
    mock_shift,
):
    mock_shift.return_value = _sample_shift()
    mock_patient.return_value = {
        "preferred_name": "Ben",
        "background_summary": "Ben enjoys music. He lives with family.",
        "background_summary_updated_at": datetime.now(timezone.utc).isoformat(),
        "briefing_content_version": 1,
        "communication_guidance": "Speak slowly and use short sentences.",
        "emergency_contact": {"name": "Sam", "phone": "0400111222", "relationship": "Brother"},
    }
    payload = briefing_service.get_briefing_for_worker("shift-1", "worker-1", "org-1")
    assert payload["participant_first_name"] == "Ben"
    assert "Ben enjoys music" in payload["background_summary"]["text"]
    assert payload["communication_preferences"] == "Speak slowly and use short sentences."
    assert payload["briefing_complete"] is False


def test_save_participant_briefing_alerts_rejects_more_than_three():
    with patch("backend.app.services.briefing_service.get_supabase_admin"):
        with pytest.raises(ValueError, match="Maximum 3"):
            briefing_service.save_participant_briefing_alerts(
                "patient-1",
                "org-1",
                ["one", "two", "three", "four"],
            )


def test_background_summary_sentence_validation():
    with patch("backend.app.services.briefing_service.get_supabase_admin"):
        with pytest.raises(ValueError, match="2–4 sentences"):
            briefing_service.update_participant_background_summary(
                "patient-1",
                "org-1",
                "Only one sentence.",
            )


def test_resolve_emergency_contacts_parses_json_string():
    from backend.app.services.shift_service import _parse_emergency_contact

    raw = '{"name": "Karen Walsh", "phone": "0418 220 145", "relationship": "Mother"}'
    parsed = _parse_emergency_contact(raw)
    assert parsed == {
        "name": "Karen Walsh",
        "phone": "0418 220 145",
        "relationship": "Mother",
        "display": "Karen Walsh — Mother — 0418 220 145",
    }

    contacts = briefing_service.resolve_emergency_contacts("patient-1", "org-1", raw)
    assert contacts == [
        {"name": "Karen Walsh", "role": "Mother", "phone": "0418 220 145"},
    ]


@patch("backend.app.services.briefing_service.get_briefing_for_worker")
@patch("backend.app.services.briefing_service._acknowledge_all_briefing_alerts")
@patch("backend.app.services.briefing_service._get_worker_shift")
@patch("backend.app.services.briefing_service.get_supabase_admin")
def test_complete_briefing_auto_acknowledges_alerts(mock_admin, mock_shift, mock_ack_all, mock_payload):
    mock_shift.return_value = _sample_shift()
    mock_payload.return_value = {
        "all_alerts_acknowledged": True,
        "patient_briefing_version": 1,
        "shift_briefing_version": 1,
        "briefing_complete": True,
    }
    mock_admin.return_value.table.return_value.upsert.return_value.execute.return_value = None

    result = briefing_service.complete_briefing("shift-1", "worker-1", "org-1")

    mock_ack_all.assert_called_once_with("shift-1", "worker-1", "patient-1", "org-1")
    assert result["briefing_complete"] is True


@patch("backend.app.services.briefing_service.ensure_briefing_completed")
@patch("backend.app.services.shift_service._ensure_risks_acknowledged_if_required")
@patch("backend.app.services.shift_service.get_shift_by_id")
def test_clock_in_blocked_without_briefing(mock_get, _mock_risks, mock_briefing):
    from backend.app.services import shift_service

    mock_get.return_value = _sample_shift(
        scheduled_start=(datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
    )
    mock_briefing.side_effect = ValueError("Complete the pre-shift briefing before clocking in.")
    with pytest.raises(ValueError, match="pre-shift briefing"):
        shift_service.clock_in_shift("shift-1", "worker-1", "org-1", method="gps", location={"lat": 0, "lng": 0})
