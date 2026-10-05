"""Meet & Greet summary: nothing added (every point cited, numbers only if
said), nothing missed (uncited lines listed for review), and supports that
draft the service agreement."""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import meet_greet_summary_service as svc

SOURCES = [
    {"id": "r1-s1", "speaker": "Sarah Lee", "text": "So what would you like help with?", "coordinator": True},
    {"id": "r1-s2", "speaker": "Liam Carter", "text": "I'd like help with showering three days a week at home.", "coordinator": False},
    {"id": "r1-s3", "speaker": "Liam Carter", "text": "I want to get back to swimming at the local pool.", "coordinator": False},
    {"id": "r1-s4", "speaker": "Mary Carter", "text": "He gets anxious with new men, a female worker is best.", "coordinator": False},
    {"id": "r1-s5", "speaker": "Liam Carter", "text": "Yeah okay.", "coordinator": False},
    {"id": "n1", "speaker": "Coordinator notes", "text": "Allergic to penicillin.", "coordinator": False},
]
CODES = {"01_011_0107_1_1", "04_104_0125_6_1"}


def _raw(**over):
    raw = {
        "topics": {
            "goals": [{"text": "Get back to swimming at the local pool", "source_ids": ["r1-s3"]}],
            "preferences": [{"text": "Prefers a female worker; anxious with new men", "source_ids": ["r1-s4"]}],
            # Invented: cites nothing, or a line that doesn't exist.
            "access_and_risk": [{"text": "Uses a wheelchair", "source_ids": []},
                                {"text": "Has epilepsy", "source_ids": ["r9-s1"]}],
        },
        "supports": [{
            "description": "Help with showering", "item_code": "01_011_0107_1_1", "hours_per_week": 3,
            "frequency": "weekly", "location": "home", "source_ids": ["r1-s2"],
        }],
    }
    raw.update(over)
    return raw


def test_points_must_cite_lines_that_exist():
    result = svc.check_summary(_raw(), SOURCES, CODES)
    assert [p["text"] for p in result["topics"]["goals"]] == ["Get back to swimming at the local pool"]
    assert result["topics"]["access_and_risk"] == []
    assert result["dropped_points"] == 2


def test_supports_keep_only_what_was_said():
    support = svc.check_summary(_raw(), SOURCES, CODES)["supports"][0]
    # "three days a week at home": 3 is said (as a word), weekly and home too.
    assert (support["hours_per_week"], support["frequency"], support["location"]) == (3.0, "weekly", "home")
    assert support["unverified"] == []
    guessed = _raw(supports=[{
        "description": "Help with showering", "item_code": "99_999_9999_9_9", "hours_per_week": 6,
        "frequency": "monthly", "location": "clinic", "source_ids": ["r1-s2"],
    }])
    support = svc.check_summary(guessed, SOURCES, CODES)["supports"][0]
    # Not said, so left blank for the managing director, never guessed.
    assert (support["hours_per_week"], support["frequency"], support["location"], support["item_code"]) == (None, None, None, None)
    assert support["unverified"] == ["hours", "frequency", "location"]


def test_anything_the_person_said_that_isnt_covered_is_listed():
    uncovered = svc.check_summary(_raw(), SOURCES, CODES)["uncovered"]
    # The allergy in the notes isn't in the summary; the coordinator's own
    # question and "Yeah okay." aren't details to miss.
    assert [(u["id"], u["status"]) for u in uncovered] == [("n1", "open")]


def test_what_the_person_agrees_to_counts_even_when_the_coordinator_said_it():
    sources = [
        {"id": "r1-s1", "speaker": "Sarah Lee", "text": "So three hours on Tuesday mornings?", "coordinator": True},
        {"id": "r1-s2", "speaker": "Liam Carter", "text": "Yes, that's right.", "coordinator": False},
        {"id": "r1-s3", "speaker": "Sarah Lee", "text": "Lovely to meet you both.", "coordinator": True},
        {"id": "r1-s4", "speaker": "Liam Carter", "text": "Thank you.", "coordinator": False},
    ]
    uncovered = svc.check_summary({"topics": {}, "supports": []}, sources, CODES)["uncovered"]
    assert [u["id"] for u in uncovered] == ["r1-s1"]


def test_including_a_missed_line_adds_it_word_for_word():
    intake = {"id": "i-1", "organization_id": "org-1",
              "meet_greet_summary": {"topics": {"other": []}, "uncovered": [
                  {"id": "n1", "speaker": "Coordinator notes", "text": "Allergic to penicillin.", "status": "open"},
                  {"id": "r1-s9", "speaker": "Liam Carter", "text": "My cat is called Biscuit.", "status": "open"},
              ]}}
    with patch.object(svc, "get_supabase_admin", return_value=MagicMock()):
        summary = svc.review_line(intake, "n1", "include")
        assert summary["topics"]["other"] == [{"text": "Allergic to penicillin.", "source_ids": ["n1"]}]
        assert svc.open_lines(intake) == 1
        svc.review_line(intake, "r1-s9", "dismiss")
    assert svc.open_lines(intake) == 0
    with pytest.raises(HTTPException):
        svc.review_line(intake, "n1", "include")  # already reviewed


class _Q:
    def __init__(self, rows):
        self.rows = rows

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        return MagicMock(data=self.rows)


def test_sources_are_every_recording_then_the_typed_notes():
    sessions = [
        {"id": "ses-1", "coordinator_id": "u-1", "clean_transcript": json.dumps([
            {"segment_id": "s1", "speaker_name": "Sarah Lee", "text": "Hi Liam."},
            {"segment_id": "s2", "speaker_name": "Liam Carter", "text": "Hi."},
        ])},
        {"id": "ses-2", "coordinator_id": "u-1", "clean_transcript": [
            {"segment_id": "s1", "speaker_name": "Liam Carter", "text": "One more thing."},
        ]},
    ]
    db = MagicMock()
    db.table.side_effect = lambda name: _Q(sessions if name == "plan_meeting_sessions" else [{"id": "u-1", "full_name": "Sarah Lee"}])
    intake = {"id": "i-1", "organization_id": "org-1", "meet_greet_notes": "Allergic to penicillin.\n\nTranscript:\nSarah Lee: Hi Liam."}
    with patch.object(svc, "get_supabase_admin", return_value=db):
        lines = svc.gather_sources(intake)
    assert [(l["id"], l["coordinator"]) for l in lines] == [
        ("r1-s1", True), ("r1-s2", False), ("r2-s1", False), ("n1", False),
    ]
    # The transcript pasted into the notes isn't counted twice.
    assert lines[-1]["text"] == "Allergic to penicillin."


def test_summarising_needs_something_to_summarise():
    with patch.object(svc, "gather_sources", return_value=[]):
        with pytest.raises(HTTPException) as err:
            svc.summarise({"id": "i-1", "organization_id": "org-1"}, "u-1")
    assert err.value.status_code == 422
