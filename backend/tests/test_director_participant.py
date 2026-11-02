"""The director's participant profile: what needs a decision, and that only
the managing director can use it."""

from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.api import director_participants
from backend.app.services.director_participant_service import decisions_for, describe_audit_entry

TODAY = date(2026, 10, 31)


def _summary(**overrides):
    base = {
        "participant": {"plan_end_date": "2027-10-31", "upcoming_review_date": None},
        "funding": {"categories": [], "ahead_by": 0, "percent_used": 40, "percent_time_elapsed": 40},
        "risk": {"incidents_open": [], "complaints_open": []},
        "delivery": {"unfilled_14d": 0},
        "team": {"coordinator": {"id": "c"}, "main_worker": {"id": "w"}, "backups": [{"id": "b"}]},
        "agreement": {"status": "active", "end_date": "2027-10-31"},
        "quality": {"needs_attention_30d": 0},
        "medication": {"pending_verification": 0},
    }
    base.update(overrides)
    return base


def keys(summary):
    return [d["key"] for d in decisions_for(summary, TODAY)]


def test_nothing_to_decide_when_all_is_well():
    assert decisions_for(_summary(), TODAY) == []


def test_plan_ending_soon_is_urgent_and_says_whether_a_review_is_booked():
    soon = decisions_for(_summary(participant={"plan_end_date": "2026-11-20", "upcoming_review_date": None}), TODAY)
    assert soon[0]["key"] == "plan_ending" and soon[0]["tone"] == "danger"
    assert "No plan review" in soon[0]["detail"]
    later = decisions_for(_summary(participant={"plan_end_date": "2027-01-20", "upcoming_review_date": "2026-12-04"}), TODAY)
    assert later[0]["tone"] == "warning" and "4 Dec 2026" in later[0]["detail"]


def test_spending_ahead_of_time_and_overspent_categories():
    summary = _summary(funding={
        "categories": [{"category": "core", "label": "Core", "overspent": True}],
        "ahead_by": 30, "percent_used": 84, "percent_time_elapsed": 54,
    })
    found = decisions_for(summary, TODAY)
    assert [d["key"] for d in found][:2] == ["overspent_core", "spending_ahead"]
    assert all(d["tone"] == "danger" for d in found[:2])


def test_open_incidents_complaints_and_unfilled_shifts():
    summary = _summary(
        risk={
            "incidents_open": [{"id": "i1", "title": "Fall", "severity": "high", "ndis_reportable": True}],
            "complaints_open": [{"id": "c1", "subject": "Roster"}],
        },
        delivery={"unfilled_14d": 2},
    )
    found = {d["key"]: d for d in decisions_for(summary, TODAY)}
    assert found["incident_i1"]["tone"] == "danger" and "NDIS reportable" in found["incident_i1"]["detail"]
    assert found["complaint_c1"]["tone"] == "warning"
    assert found["unfilled"]["title"] == "2 upcoming shifts have no worker"


def test_team_and_agreement_gaps():
    assert "no_backup" in keys(_summary(team={"coordinator": {"id": "c"}, "main_worker": {"id": "w"}, "backups": []}))
    assert {"no_main_worker", "no_coordinator"} <= set(keys(_summary(team={"coordinator": None, "main_worker": None, "backups": []})))
    assert "no_agreement" in keys(_summary(agreement=None))
    assert "agreement_ending" in keys(_summary(agreement={"status": "active", "end_date": "2026-11-15"}))


def test_danger_comes_before_warning():
    summary = _summary(
        team={"coordinator": None, "main_worker": {"id": "w"}, "backups": [{"id": "b"}]},
        agreement=None,
    )
    tones = [d["tone"] for d in decisions_for(summary, TODAY)]
    assert tones == sorted(tones, key=lambda t: {"danger": 0, "warning": 1}[t])


def test_audit_entries_read_as_plain_words():
    assert describe_audit_entry({"action_type": "participant.team_changed"}) == "Changed the care team"
    assert describe_audit_entry({"action_type": "participant.services_ended", "details": {"reason": "Moved interstate"}}) == "Ended services: Moved interstate"
    assert describe_audit_entry({"action_type": "participant.document_uploaded", "details": {"title": "GP letter"}}) == "Uploaded GP letter"
    assert describe_audit_entry({"action_type": "participant_portal.ndis_plan_viewed"}) == "Viewed their NDIS plan in the portal"


@pytest.mark.parametrize("role", ["support_coordinator", "support_worker", "participant"])
def test_only_the_managing_director_can_use_it(role):
    app = FastAPI()
    app.include_router(director_participants.router, prefix="/api")
    app.dependency_overrides[director_participants.get_current_user] = lambda: {"id": "u", "role": role, "organization_id": "org"}
    client = TestClient(app)
    assert client.get("/api/director/participants/p-1/overview").status_code == 403
    assert client.get("/api/director/participants/p-1/audit-trail").status_code == 403
    assert client.post("/api/director/participants/p-1/services", json={"action": "end", "reason": "x"}).status_code == 403
