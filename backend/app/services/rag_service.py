"""
CCQ-106 / CARECLIQV2-30 — RAG retrieval: org-scoped semantic search over
session_embeddings using native pgvector HNSW cosine-similarity via the
match_session_embeddings RPC function.

Organisation isolation is enforced at both the RPC and RLS layers so
embeddings from Org A can never surface in results for Org B.
"""
from __future__ import annotations

import logging
import math
from typing import Any

from .ai_service import generate_session_embedding
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

_EMBEDDING_DIM = 1536


# ── Python fallback ───────────────────────────────────────────────────────────

def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _python_similarity_search(
    rows: list[dict],
    query_vector: list[float],
    limit: int,
    min_similarity: float,
) -> list[dict[str, Any]]:
    """Client-side cosine search used when the RPC is unavailable."""
    scored: list[tuple[float, dict]] = []
    for row in rows:
        raw = row.get("embedding")
        if not raw:
            continue
        try:
            candidate = list(raw) if isinstance(raw, list) else []
            if len(candidate) != _EMBEDDING_DIM:
                continue
            sim = _cosine_similarity(query_vector, candidate)
            if sim >= min_similarity:
                scored.append(
                    (
                        sim,
                        {
                            "session_id": row["session_id"],
                            "chunk_index": row.get("chunk_index", 0),
                            "content": row.get("content"),
                            "similarity": round(sim, 4),
                            "metadata": row.get("metadata", {}),
                        },
                    )
                )
        except Exception:
            continue
    scored.sort(key=lambda t: t[0], reverse=True)
    return [item for _, item in scored[:limit]]


# ── Primary pgvector path ─────────────────────────────────────────────────────

def _rpc_similarity_search(
    supabase,
    query_vector: list[float],
    org_id: str,
    limit: int,
    min_similarity: float,
) -> list[dict[str, Any]] | None:
    """Call match_session_embeddings RPC.  Returns None on failure."""
    try:
        result = supabase.rpc(
            "match_session_embeddings",
            {
                "query_embedding": query_vector,
                "match_threshold": min_similarity,
                "match_count": limit,
                "p_org_id": org_id,
            },
        ).execute()
        rows = result.data or []
        return [
            {
                "session_id": r["session_id"],
                "chunk_index": r.get("chunk_index", 0),
                "content": r.get("content"),
                "similarity": round(float(r.get("similarity", 0)), 4),
                "metadata": r.get("metadata", {}),
            }
            for r in rows
        ]
    except Exception as exc:
        logger.warning("match_session_embeddings RPC failed, falling back: %s", exc)
        return None


# ── Public API ────────────────────────────────────────────────────────────────

async def retrieve_similar_sessions(
    query_text: str,
    org_id: str,
    limit: int = 5,
    min_similarity: float = 0.70,
) -> list[dict[str, Any]]:
    """Return up to *limit* session chunks semantically similar to *query_text*.

    Results are strictly scoped to *org_id* — no cross-org leakage is possible.

    Primary path: pgvector HNSW via match_session_embeddings RPC.
    Fallback:     client-side cosine similarity on full row scan.

    Returns:
        List of dicts: session_id, chunk_index, content, similarity, metadata.
    """
    if not query_text or not query_text.strip():
        return []
    if not org_id:
        raise ValueError("org_id is required for RAG retrieval (CCQ-106)")

    query_vector = await generate_session_embedding(query_text)
    if not query_vector:
        return []

    supabase = get_supabase_admin()

    # Preferred: native pgvector HNSW search.
    rpc_result = _rpc_similarity_search(supabase, query_vector, org_id, limit, min_similarity)
    if rpc_result is not None:
        return rpc_result

    # Fallback: fetch all org rows and compute cosine in Python.
    try:
        result = (
            supabase.table("session_embeddings")
            .select("session_id, chunk_index, content, embedding, metadata")
            .eq("organization_id", org_id)
            .execute()
        )
        rows = result.data or []
    except Exception as exc:
        logger.warning("RAG fallback DB query failed: %s", exc)
        return []

    return _python_similarity_search(rows, query_vector, limit, min_similarity)


async def retrieve_compliance_context(
    session_notes: str,
    org_id: str,
    limit: int = 3,
) -> list[dict[str, Any]]:
    """Retrieve past similar session chunks to augment compliance rule evaluation.

    Used by the RAC (Retrieval-Augmented Compliance) engine.
    """
    return await retrieve_similar_sessions(
        query_text=session_notes,
        org_id=org_id,
        limit=limit,
        min_similarity=0.75,
    )
