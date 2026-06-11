"""
CARECLIQV2-31 — RAG retrieval service tests.

Run:
    pytest backend/tests/test_rag_retrieval.py -v

Performance benchmark (requires INTEGRATION_REAL_DB=1):
    pytest backend/tests/test_rag_retrieval.py -v -k performance
"""
from __future__ import annotations

import os
import time
import uuid
from unittest.mock import MagicMock, patch

import pytest

from backend.app.schemas.retrieval import RetrievalResult
from backend.app.services import query_embedding_service, rag_service

ORG_A = str(uuid.uuid4())
ORG_B = str(uuid.uuid4())
SESSION_A = str(uuid.uuid4())
SESSION_B = str(uuid.uuid4())
PARTICIPANT_A = str(uuid.uuid4())


def _mock_rpc_result(rows: list[dict]) -> MagicMock:
    mock = MagicMock()
    mock.execute.return_value = MagicMock(data=rows)
    return mock


def _mock_supabase_for_rpc(rows: list[dict]) -> MagicMock:
    supabase = MagicMock()
    supabase.rpc.return_value = _mock_rpc_result(rows)
    return supabase


# ── CARECLIQV2-80: Query embedding service ────────────────────────────────────


@pytest.mark.asyncio
async def test_generate_query_embedding_empty_query():
    assert await query_embedding_service.generate_query_embedding("") == []
    assert await query_embedding_service.generate_query_embedding("   ") == []


@pytest.mark.asyncio
async def test_generate_query_embedding_retry_then_success():
    calls = {"n": 0}

    def flaky(_text: str) -> list[float]:
        calls["n"] += 1
        if calls["n"] < 3:
            raise ConnectionError("transient")
        return [0.1] * query_embedding_service._EMBEDDING_DIM

    with patch.object(
        query_embedding_service,
        "_create_embedding_sync",
        side_effect=flaky,
    ), patch("backend.app.services.query_embedding_service.asyncio.sleep", return_value=None):
        vec = await query_embedding_service.generate_query_embedding("clinical note text")

    assert len(vec) == query_embedding_service._EMBEDDING_DIM
    assert calls["n"] == 3


@pytest.mark.asyncio
async def test_generate_query_embedding_logs_after_exhausted_retries(caplog):
    with patch.object(
        query_embedding_service,
        "_create_embedding_sync",
        side_effect=RuntimeError("api down"),
    ), patch("backend.app.services.query_embedding_service.asyncio.sleep", return_value=None):
        with caplog.at_level("ERROR"):
            vec = await query_embedding_service.generate_query_embedding("query")

    assert vec == []
    assert any("failed after" in r.message.lower() for r in caplog.records)


# ── CARECLIQV2-81/83: retrieve_similar ────────────────────────────────────────


@pytest.mark.asyncio
async def test_retrieve_similar_requires_organisation_id():
    with pytest.raises(ValueError, match="organisation_id"):
        await rag_service.retrieve_similar("query", "")


@pytest.mark.asyncio
async def test_retrieve_similar_empty_query():
    assert await rag_service.retrieve_similar("", ORG_A) == []
    assert await rag_service.retrieve_similar("  ", ORG_A) == []


@pytest.mark.asyncio
async def test_retrieve_similar_returns_retrieval_result_dto():
    rpc_rows = [
        {
            "content": "Participant engaged in community access.",
            "session_id": SESSION_A,
            "participant_id": PARTICIPANT_A,
            "session_date": "2026-06-01T10:00:00+00:00",
            "compliance_score": 88.5,
            "similarity_score": 0.91,
        }
    ]
    mock_supabase = _mock_supabase_for_rpc(rpc_rows)

    with patch(
        "backend.app.services.rag_service.generate_query_embedding",
        return_value=[0.2] * rag_service._EMBEDDING_DIM,
    ), patch(
        "backend.app.services.rag_service.get_supabase_admin",
        return_value=mock_supabase,
    ):
        results = await rag_service.retrieve_similar("community access", ORG_A, k=5)

    assert len(results) == 1
    r = results[0]
    assert isinstance(r, RetrievalResult)
    assert r.content == rpc_rows[0]["content"]
    assert r.session_id == SESSION_A
    assert r.participant_id == PARTICIPANT_A
    assert r.compliance_score == 88.5
    assert r.similarity_score == 0.91
    assert r.session_date is not None

    mock_supabase.rpc.assert_called_once_with(
        "match_session_embeddings",
        {
            "query_embedding": [0.2] * rag_service._EMBEDDING_DIM,
            "organisation_id": ORG_A,
            "top_k": 5,
        },
    )


@pytest.mark.asyncio
async def test_retrieve_similar_cross_org_isolation():
    """Org A query must not return Org B session chunks (CARECLIQV2-31 AC)."""
    org_a_rows = [
        {
            "content": "Org A note",
            "session_id": SESSION_A,
            "participant_id": PARTICIPANT_A,
            "session_date": "2026-06-01T10:00:00+00:00",
            "compliance_score": 90.0,
            "similarity_score": 0.95,
        }
    ]

    def rpc_side_effect(name, params):
        assert params["organisation_id"] == ORG_A
        assert params["organisation_id"] != ORG_B
        return _mock_rpc_result(org_a_rows)

    mock_supabase = MagicMock()
    mock_supabase.rpc.side_effect = rpc_side_effect

    with patch(
        "backend.app.services.rag_service.generate_query_embedding",
        return_value=[0.3] * rag_service._EMBEDDING_DIM,
    ), patch(
        "backend.app.services.rag_service.get_supabase_admin",
        return_value=mock_supabase,
    ):
        results = await rag_service.retrieve_similar(
            "find similar sessions", ORG_A, k=5
        )

    assert len(results) == 1
    assert results[0].session_id == SESSION_A
    assert all(r.session_id != SESSION_B for r in results)

    mock_supabase.rpc.side_effect = lambda _name, params: _mock_rpc_result([])
    with patch(
        "backend.app.services.rag_service.generate_query_embedding",
        return_value=[0.3] * rag_service._EMBEDDING_DIM,
    ), patch(
        "backend.app.services.rag_service.get_supabase_admin",
        return_value=mock_supabase,
    ):
        org_b_results = await rag_service.retrieve_similar(
            "find similar sessions", ORG_B, k=5
        )
    assert org_b_results == []


@pytest.mark.asyncio
async def test_retrieve_similar_null_safe_metadata():
    rpc_rows = [
        {
            "content": "chunk",
            "session_id": SESSION_A,
            "participant_id": None,
            "session_date": None,
            "compliance_score": None,
            "similarity_score": 0.72,
        }
    ]
    mock_supabase = _mock_supabase_for_rpc(rpc_rows)

    with patch(
        "backend.app.services.rag_service.generate_query_embedding",
        return_value=[0.1] * rag_service._EMBEDDING_DIM,
    ), patch(
        "backend.app.services.rag_service.get_supabase_admin",
        return_value=mock_supabase,
    ):
        results = await rag_service.retrieve_similar("query", ORG_A, k=1)

    r = results[0]
    assert r.participant_id is None
    assert r.session_date is None
    assert r.compliance_score is None


@pytest.mark.asyncio
async def test_retrieve_similar_respects_k_parameter():
    rpc_rows = [
        {
            "content": f"chunk {i}",
            "session_id": str(uuid.uuid4()),
            "participant_id": PARTICIPANT_A,
            "session_date": "2026-06-01T10:00:00+00:00",
            "compliance_score": 80.0,
            "similarity_score": 0.9 - i * 0.01,
        }
        for i in range(3)
    ]
    mock_supabase = MagicMock()

    def rpc_side_effect(_name, params):
        assert params["top_k"] == 2
        return _mock_rpc_result(rpc_rows[:2])

    mock_supabase.rpc.side_effect = rpc_side_effect

    with patch(
        "backend.app.services.rag_service.generate_query_embedding",
        return_value=[0.1] * rag_service._EMBEDDING_DIM,
    ), patch(
        "backend.app.services.rag_service.get_supabase_admin",
        return_value=mock_supabase,
    ):
        results = await rag_service.retrieve_similar("query", ORG_A, k=2)

    assert len(results) == 2


# ── Performance (optional, real DB) ───────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.environ.get("INTEGRATION_REAL_DB") != "1",
    reason="Set INTEGRATION_REAL_DB=1 to run p99 latency benchmark",
)
async def test_retrieve_similar_p99_latency_under_500ms():
    """p99 ≤ 500 ms for k=5 on a populated session_embeddings table."""
    org_id = os.environ.get("RAG_BENCHMARK_ORG_ID")
    if not org_id:
        pytest.skip("RAG_BENCHMARK_ORG_ID not set")

    latencies: list[float] = []
    for _ in range(100):
        t0 = time.perf_counter()
        await rag_service.retrieve_similar("participant community access goals", org_id, k=5)
        latencies.append((time.perf_counter() - t0) * 1000)

    latencies.sort()
    p99 = latencies[98]
    assert p99 <= 500, f"p99 latency {p99:.1f}ms exceeds 500ms budget"
