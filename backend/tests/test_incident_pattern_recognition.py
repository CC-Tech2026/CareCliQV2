"""Tests for CARECLIQV2-32 incident pattern recognition."""
from __future__ import annotations

from backend.app.services.incident_pattern_service import (
    _build_incident_query_text,
    _participant_labels,
    _truncate_excerpt,
)
from backend.app.services.rag_service import _dedupe_incident_matches, _extract_incident_id


class TestExtractIncidentId:
    def test_from_column(self):
        row = {"incident_id": "abc-123", "metadata": {}}
        assert _extract_incident_id(row) == "abc-123"

    def test_from_metadata(self):
        row = {"metadata": {"incident_id": "meta-456", "source": "incident"}}
        assert _extract_incident_id(row) == "meta-456"

    def test_missing(self):
        assert _extract_incident_id({}) is None


class TestDedupeIncidentMatches:
    def test_keeps_highest_similarity_per_incident(self):
        chunks = [
            {"incident_id": "a", "similarity": 0.7, "content": "low"},
            {"incident_id": "a", "similarity": 0.9, "content": "high"},
            {"incident_id": "b", "similarity": 0.8, "content": "b chunk"},
        ]
        result = _dedupe_incident_matches(chunks, limit=5)
        assert len(result) == 2
        assert result[0]["incident_id"] == "a"
        assert result[0]["similarity"] == 0.9
        assert result[1]["incident_id"] == "b"

    def test_respects_limit(self):
        chunks = [
            {"incident_id": "a", "similarity": 0.9},
            {"incident_id": "b", "similarity": 0.8},
            {"incident_id": "c", "similarity": 0.7},
        ]
        result = _dedupe_incident_matches(chunks, limit=2)
        assert len(result) == 2
        assert [r["incident_id"] for r in result] == ["a", "b"]


class TestParticipantLabels:
    def test_redacts_unique_participants(self):
        labels = _participant_labels(["p1", "p2", "p1"])
        assert labels["p1"] == "Participant A"
        assert labels["p2"] == "Participant B"

    def test_none_participant(self):
        labels = _participant_labels([None])
        assert labels[None] == "Participant"


class TestBuildIncidentQueryText:
    def test_joins_fields(self):
        incident = {
            "title": "Fall in bathroom",
            "description": "Participant slipped",
            "worker_actions": "Called nurse",
            "incident_type": "injury",
        }
        text = _build_incident_query_text(incident)
        assert "Fall in bathroom" in text
        assert "Participant slipped" in text
        assert "injury" in text


class TestTruncateExcerpt:
    def test_short_text_unchanged(self):
        assert _truncate_excerpt("hello") == "hello"

    def test_long_text_truncated(self):
        long = "x" * 300
        result = _truncate_excerpt(long)
        assert len(result) <= 280
        assert result.endswith("…")
