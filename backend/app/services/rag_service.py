"""
CCQ-106 — RAG retrieval service: org-scoped semantic search over session_embeddings.

All similarity searches enforce WHERE organization_id = org_id so embeddings
from Org A never surface in results for Org B.

Embedding storage: text-embedding-3-small vectors stored as JSONB float arrays
(1536 dimensions).  Cosine similarity is computed in Python until a future
migration converts the column to pgvector's native `vector` type for
server-side ANN indexing.
"""
from __future__ import annotations

import logging
import math
from typing import Any

from .ai_service import generate_session_embedding
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

_EMBEDDING_DIM = 1536


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


async def retrieve_similar_sessions(
    query_text: str,
    org_id: str,
    limit: int = 5,
    min_similarity: float = 0.70,
) -> list[dict[str, Any]]:
    """Return up to `limit` sessions semantically similar to `query_text`.

    Results are strictly scoped to `org_id` — an embedding from another org
    can never appear regardless of similarity score (CCQ-106 AC).

    Args:
        query_text:      The text to embed and search against.
        org_id:          Caller's organisation UUID — mandatory, no default.
        limit:           Maximum number of results to return.
        min_similarity:  Cosine similarity threshold (0–1); results below
                         this score are discarded.

    Returns:
        List of dicts with keys: session_id, similarity, model.
    """
    if not query_text or not query_text.strip():
        return []
    if not org_id:
        raise ValueError("org_id is required for RAG retrieval (CCQ-106)")

    query_vector = await generate_session_embedding(query_text)
    if not query_vector:
        return []

    supabase = get_supabase_admin()
    try:
        result = (
            supabase.table("session_embeddings")
            .select("session_id, embedding, model")
            .eq("organization_id", org_id)   # CCQ-106: hard org_id filter
            .execute()
        )
        rows = result.data or []
    except Exception as exc:
        logger.warning("RAG retrieval DB query failed: %s", exc)
        return []

    scored: list[tuple[float, dict]] = []
    for row in rows:
        raw_embedding = row.get("embedding")
        if not raw_embedding:
            continue
        try:
            candidate = list(raw_embedding) if isinstance(raw_embedding, list) else []
            if len(candidate) != _EMBEDDING_DIM:
                continue
            sim = _cosine_similarity(query_vector, candidate)
            if sim >= min_similarity:
                scored.append((sim, {"session_id": row["session_id"], "similarity": round(sim, 4), "model": row.get("model")}))
        except Exception:
            continue

    scored.sort(key=lambda t: t[0], reverse=True)
    return [item for _, item in scored[:limit]]


async def retrieve_compliance_context(
    session_notes: str,
    org_id: str,
    limit: int = 3,
) -> list[dict[str, Any]]:
    """Retrieve past similar sessions to augment compliance rule evaluation.

    Used by the RAC (Retrieval-Augmented Compliance) engine to ground
    rule checks in real documented evidence from the same organisation.
    """
    return await retrieve_similar_sessions(
        query_text=session_notes,
        org_id=org_id,
        limit=limit,
        min_similarity=0.75,
    )
