"""Meet & Greet Easy Capture: recordings are stored against a consented
session for the intake, and follow the person when they become a participant."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app.core.security import get_current_user
from backend.app.main import app
from backend.app.services import participant_intake_service as svc

ORG = "org-1"
INTAKE = "11111111-1111-1111-1111-111111111111"


def _supabase(session_row: dict | None):
    client = MagicMock()
    sessions = MagicMock()
    intakes = MagicMock()
    sessions.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[session_row] if session_row else []
    )
    intakes.update.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{"id": INTAKE, "meet_greet_recording_path": "p", "meet_greet_session_id": "s1"}]
    )
    client.table.side_effect = lambda name: sessions if name == "plan_meeting_sessions" else intakes
    storage = MagicMock()
    storage.create_signed_url.return_value = {"signedURL": "https://signed/rec"}
    client.storage.from_.return_value = storage
    return client, sessions, intakes, storage


@pytest.fixture
def intake_exists():
    with patch.object(svc, "get_intake", return_value={"id": INTAKE}):
        yield


def test_rejects_non_audio(intake_exists):
    with pytest.raises(HTTPException) as err:
        svc.upload_meet_greet_recording(INTAKE, ORG, "s1", b"x" * 100, "application/pdf")
    assert err.value.status_code == 422


def test_rejects_session_from_another_intake(intake_exists):
    client, *_ = _supabase({"id": "s1", "intake_id": "someone-else", "consent_confirmed_at": "2026-09-30T00:00:00Z"})
    with patch.object(svc, "get_supabase_admin", return_value=client), pytest.raises(HTTPException) as err:
        svc.upload_meet_greet_recording(INTAKE, ORG, "s1", b"x" * 100, "audio/webm")
    assert err.value.status_code == 409


def test_rejects_session_without_consent(intake_exists):
    client, *_ = _supabase({"id": "s1", "intake_id": INTAKE, "consent_confirmed_at": None})
    with patch.object(svc, "get_supabase_admin", return_value=client), pytest.raises(HTTPException) as err:
        svc.upload_meet_greet_recording(INTAKE, ORG, "s1", b"x" * 100, "audio/webm;codecs=opus")
    assert err.value.status_code == 409


def test_stores_recording_privately_and_returns_a_fresh_link(intake_exists):
    client, sessions, intakes, storage = _supabase(
        {"id": "s1", "intake_id": INTAKE, "consent_confirmed_at": "2026-09-30T00:00:00Z"}
    )
    with patch.object(svc, "get_supabase_admin", return_value=client):
        result = svc.upload_meet_greet_recording(INTAKE, ORG, "s1", b"x" * 100, "audio/webm;codecs=opus")
    client.storage.from_.assert_any_call("meeting-recordings")
    path = storage.upload.call_args.args[0]
    assert path.startswith(f"{ORG}/{INTAKE}/") and path.endswith(".webm")
    sessions.update.assert_called_once_with({"recording_path": path})
    patch_body = intakes.update.call_args.args[0]
    assert patch_body["meet_greet_recording_path"] == path
    assert patch_body["meet_greet_session_id"] == "s1"
    assert result["meet_greet_recording_url"] == "https://signed/rec"


def test_recording_url_is_not_client_patchable():
    assert "meet_greet_recording_url" not in svc._PATCHABLE_FIELDS


def test_activation_files_the_meet_and_greet_on_the_participant():
    client = MagicMock()
    with patch.object(svc, "get_supabase_admin", return_value=client):
        svc._attach_meeting_sessions(INTAKE, ORG, "participant-9")
    client.table.assert_called_with("plan_meeting_sessions")
    update = client.table.return_value.update
    update.assert_called_once_with({"participant_id": "participant-9"})
    chain = update.return_value
    chain.eq.assert_called_once_with("intake_id", INTAKE)
    chain.eq.return_value.eq.assert_called_once_with("organization_id", ORG)
    chain.eq.return_value.eq.return_value.is_.assert_called_once_with("participant_id", "null")


def test_session_for_unknown_intake_is_refused():
    app.dependency_overrides[get_current_user] = lambda: {
        "id": "md-1", "role": "managing_director", "organization_id": ORG,
    }
    try:
        with patch("backend.app.services.participant_intake_service.get_intake_for_session", return_value=None):
            res = TestClient(app).post("/api/coordinator/plan-meetings/sessions", json={
                "meeting_type": "meet_greet", "intake_id": INTAKE,
                "consent_given_by": "participant", "consent_method": "verbal",
            })
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 404
