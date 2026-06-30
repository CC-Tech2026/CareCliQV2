"""CARECLIQV2-33 — high-scoring participant note retrieval."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest

from backend.app.services import rag_service

ORG = str(uuid.uuid4())
PARTICIPANT = str(uuid.uuid4())


def _mock_supabase_sessions(rows: list[dict]) -> MagicMock:
    supabase = MagicMock()
    chain = MagicMock()
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.gte.return_value = chain
    chain.order.return_value = chain
    chain.limit.return_value = chain
    chain.execute.return_value = MagicMock(data=rows)
    supabase.table.return_value = chain
    return supabase


@pytest.mark.asyncio
async def test_retrieve_high_scoring_direct_lookup():
    rows = [
        {
            "id": "s1",
            "session_date": "2026-06-01",
            "compliance_score": 92,
            "compliance_input_text": "Participant engaged well in community access.",
            "translated_english_note": None,
            "notes": None,
        }
    ]
    with patch(
        "backend.app.services.rag_service.get_supabase_admin",
        return_value=_mock_supabase_sessions(rows),
    ):
        result = await rag_service.retrieve_high_scoring_participant_notes(
            participant_id=PARTICIPANT,
            organisation_id=ORG,
            query_text="community access note",
            min_score=85.0,
            k=3,
        )
    assert len(result) == 1
    assert result[0]["compliance_score"] == 92
    assert "engaged well" in result[0]["content"]


@pytest.mark.asyncio
async def test_retrieve_high_scoring_empty_without_ids():
    assert await rag_service.retrieve_high_scoring_participant_notes("", ORG, "q") == []
