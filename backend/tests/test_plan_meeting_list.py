"""Plan reviews and meetings: a recording that was discarded or never
transcribed has nothing to show, so it stays out of the participant's list;
a saved meeting says whether goals and tasks were looked for and when they
were added to the plan."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.app.api import plan_meetings
from backend.app.core.security import get_current_user
from backend.app.main import app

MD = {"sub": "md-1", "id": "md-1", "role": "managing_director", "organization_id": "org-1"}


def _db(rows_by_table: dict[str, list[dict]]) -> MagicMock:
    """Every query builder call returns the same chain; execute() gives the
    rows for whichever table was asked for."""
    db = MagicMock()

    def table(name: str):
        chain = MagicMock()
        for method in ("select", "insert", "update", "eq", "gte", "lte", "order", "limit"):
            getattr(chain, method).return_value = chain
        chain.execute.return_value = MagicMock(data=rows_by_table.get(name, []))
        return chain

    db.table.side_effect = table
    return db


def _get(path: str, db: MagicMock):
    app.dependency_overrides[get_current_user] = lambda: MD
    try:
        with patch.object(plan_meetings, "get_supabase_admin", return_value=db), \
             patch.object(plan_meetings, "get_user_organization_id", return_value="org-1"):
            return TestClient(app).get(path)
    finally:
        app.dependency_overrides.clear()


def test_unfinished_recordings_are_left_out_of_the_list():
    db = _db({
        "participant_plan_meetings": [],
        "plan_meeting_sessions": [
            {"id": "done", "meeting_type": "plan_review", "created_at": "2026-11-12T00:00:00Z", "stage_1_status": "complete", "review_status": "pending"},
            {"id": "discarded", "meeting_type": "check_in", "created_at": "2026-11-13T00:00:00Z", "stage_1_status": "pending", "review_status": "pending"},
            {"id": "failed", "meeting_type": "check_in", "created_at": "2026-11-14T00:00:00Z", "stage_1_status": "error", "review_status": "pending"},
            {"id": "older-row", "meeting_type": "goal_review", "created_at": "2026-10-01T00:00:00Z", "review_status": "approved"},
        ],
    })
    res = _get("/api/coordinator/participants/p-1/plan-meetings", db)
    assert res.status_code == 200
    ids = [m["id"] for m in res.json()["meetings"]]
    assert ids == ["done", "older-row"]
    statuses = {m["id"]: m["suggestions_status"] for m in res.json()["meetings"]}
    assert statuses == {"done": "pending_review", "older-row": "applied"}


def test_a_saved_meeting_says_if_suggestions_were_looked_for_and_when_added():
    db = _db({
        "participant_plan_meetings": [],
        "plan_meeting_sessions": [{
            "id": "s1", "participant_id": "p-1", "meeting_type": "plan_review",
            "created_at": "2026-11-12T00:00:00Z", "stage_1_status": "complete",
            "stage_2_status": "complete", "review_status": "approved", "reviewed_at": "2026-11-13T01:00:00Z",
            "clean_transcript": [], "raw_transcript": [], "extracted_goals": [], "extracted_tasks": [],
            "attention_flags": [{"description": "Check the goals are in Liam's words."}],
        }],
    })
    res = _get("/api/coordinator/plan-meetings/s1", db)
    assert res.status_code == 200
    meeting = res.json()["meeting"]
    assert meeting["stage_2_status"] == "complete"
    assert meeting["reviewed_at"] == "2026-11-13T01:00:00Z"
    assert meeting["suggestions_status"] == "applied"
    assert meeting["attention_flags"][0]["description"].startswith("Check the goals")


def _call(method: str, path: str, voice: str, db: MagicMock | None = None, json: dict | None = None):
    app.dependency_overrides[get_current_user] = lambda: MD
    try:
        with patch.object(plan_meetings.voice_access.settings, "voice_notes_org_ids", voice), \
             patch.object(plan_meetings, "get_supabase_admin", return_value=db or _db({})), \
             patch.object(plan_meetings, "get_user_organization_id", return_value="org-1"):
            return TestClient(app).request(method, path, json=json)
    finally:
        app.dependency_overrides.clear()


def test_the_app_can_ask_whether_meetings_can_be_recorded():
    on = _call("GET", "/api/coordinator/plan-meetings/voice-access", voice="all").json()
    assert on == {"enabled": True, "message": None}
    off = _call("GET", "/api/coordinator/plan-meetings/voice-access", voice="none").json()
    assert off["enabled"] is False
    assert off["message"].startswith("Voice recording is switched off")


def test_no_recording_session_starts_while_voice_is_off():
    db = _db({})
    res = _call(
        "POST", "/api/coordinator/plan-meetings/sessions", voice="none", db=db,
        json={"meeting_type": "check_in", "participant_id": "p-1", "consent_given_by": "participant", "consent_method": "verbal"},
    )
    assert res.status_code == 403
    assert "switched off" in res.json()["detail"]
    db.table.assert_not_called()


def test_a_written_meeting_is_saved_while_voice_is_off():
    db = _db({"participant_plan_meetings": [{"id": "w1", "meeting_type": "plan_review"}]})
    res = _call(
        "POST", "/api/coordinator/plan-meetings", voice="none", db=db,
        json={"participant_id": "p-1", "meeting_date": "2026-11-19", "meeting_type": "plan_review",
              "attendees": ["Sarah Carter"], "agreed_outcomes": "Practise the bus app on Tuesdays."},
    )
    assert res.status_code == 200
    assert res.json()["meeting"]["id"] == "w1"
