"""
CARECLIQV2-31 — RAG retrieval: org-scoped semantic search over
session_embeddings using native pgvector HNSW cosine-similarity via the
match_session_embeddings RPC function.

Organisation isolation is enforced at both the RPC and RLS layers so
embeddings from Org A can never surface in results for Org B.
"""
from __future__ import annotations

import logging
import math
from datetime import datetime
from typing import Any

from ..schemas.retrieval import RetrievalResult
from .query_embedding_service import generate_query_embedding
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

_EMBEDDING_DIM = 1536
_MIN_INCIDENTS_FOR_PATTERN = 10


# ── Python fallback ───────────────────────────────────────────────────────────

def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _parse_session_date(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _parse_compliance_score(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _row_to_retrieval_result(row: dict[str, Any]) -> RetrievalResult:
    participant = row.get("participant_id")
    return RetrievalResult(
        content=row.get("content"),
        session_id=str(row["session_id"]),
        participant_id=str(participant) if participant else None,
        session_date=_parse_session_date(row.get("session_date")),
        compliance_score=_parse_compliance_score(row.get("compliance_score")),
        similarity_score=round(float(row.get("similarity_score", row.get("similarity", 0))), 4),
    )


def _fetch_session_metadata(
    supabase, session_ids: list[str]
) -> dict[str, dict[str, Any]]:
    """Batch-fetch session_date, compliance_score, patient_id for enrichment."""
    if not session_ids:
        return {}
    try:
        result = (
            supabase.table("sessions")
            .select("id, session_date, compliance_score, patient_id")
            .in_("id", session_ids)
            .execute()
        )
        return {str(r["id"]): r for r in (result.data or [])}
    except Exception as exc:
        logger.warning("Session metadata fetch failed during RAG enrichment: %s", exc)
        return {}


def _enrich_chunk_rows(
    supabase,
    chunks: list[dict[str, Any]],
) -> list[RetrievalResult]:
    """Attach session metadata to raw chunk rows (Python fallback path)."""
    session_ids = list({str(c["session_id"]) for c in chunks if c.get("session_id")})
    meta_by_session = _fetch_session_metadata(supabase, session_ids)

    enriched: list[RetrievalResult] = []
    for chunk in chunks:
        sid = str(chunk["session_id"])
        meta = meta_by_session.get(sid, {})
        participant = chunk.get("participant_id") or meta.get("patient_id")
        enriched.append(
            RetrievalResult(
                content=chunk.get("content"),
                session_id=sid,
                participant_id=str(participant) if participant else None,
                session_date=_parse_session_date(
                    chunk.get("session_date") or meta.get("session_date")
                ),
                compliance_score=_parse_compliance_score(
                    chunk.get("compliance_score") or meta.get("compliance_score")
                ),
                similarity_score=round(float(chunk.get("similarity", 0)), 4),
            )
        )
    return enriched


def _python_similarity_search(
    rows: list[dict],
    query_vector: list[float],
    limit: int,
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
            scored.append(
                (
                    sim,
                    {
                        "session_id": row["session_id"],
                        "content": row.get("content"),
                        "participant_id": row.get("participant_id"),
                        "similarity": round(sim, 4),
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
    organisation_id: str,
    top_k: int,
) -> list[RetrievalResult] | None:
    """Call match_session_embeddings RPC.  Returns None on failure."""
    try:
        result = supabase.rpc(
            "match_session_embeddings",
            {
                "query_embedding": query_vector,
                "organisation_id": organisation_id,
                "top_k": top_k,
            },
        ).execute()
        rows = result.data or []
        return [_row_to_retrieval_result(r) for r in rows]
    except Exception as exc:
        logger.warning("match_session_embeddings RPC failed, falling back: %s", exc)
        return None


# ── Public API ────────────────────────────────────────────────────────────────

async def retrieve_similar(
    query: str,
    organisation_id: str,
    k: int = 5,
) -> list[RetrievalResult]:
    """Return up to *k* session chunks semantically similar to *query*.

    Results are strictly scoped to *organisation_id* — no cross-org leakage.

    Primary path: pgvector HNSW via match_session_embeddings RPC (org filter
    applied before ranking).  Fallback: client-side cosine on org-scoped rows.
    """
    if not query or not query.strip():
        return []
    if not organisation_id:
        raise ValueError("organisation_id is required for RAG retrieval (CARECLIQV2-31)")
    if k <= 0:
        return []

    query_vector = await generate_query_embedding(query)
    if not query_vector:
        return []

    supabase = get_supabase_admin()

    rpc_result = _rpc_similarity_search(supabase, query_vector, organisation_id, k)
    if rpc_result is not None:
        return rpc_result

    try:
        result = (
            supabase.table("session_embeddings")
            .select("session_id, content, embedding, participant_id")
            .eq("organization_id", organisation_id)
            .execute()
        )
        rows = result.data or []
    except Exception as exc:
        logger.warning("RAG fallback DB query failed: %s", exc)
        return []

    chunks = _python_similarity_search(rows, query_vector, k)
    return _enrich_chunk_rows(supabase, chunks)


async def retrieve_similar_sessions(
    query_text: str,
    org_id: str,
    limit: int = 5,
    min_similarity: float = 0.70,
) -> list[dict[str, Any]]:
    """Backward-compatible wrapper returning dicts (filters by min_similarity)."""
    results = await retrieve_similar(query_text, org_id, k=limit)
    filtered = [r for r in results if r.similarity_score >= min_similarity]
    return [
        {
            "session_id": r.session_id,
            "content": r.content,
            "similarity": r.similarity_score,
            "participant_id": r.participant_id,
            "session_date": r.session_date.isoformat() if r.session_date else None,
            "compliance_score": r.compliance_score,
            "metadata": {},
        }
        for r in filtered
    ]


def _extract_incident_id(row: dict[str, Any]) -> str | None:
    """Resolve incident_id from a session_embeddings row."""
    if row.get("incident_id"):
        return str(row["incident_id"])
    metadata = row.get("metadata") or {}
    if isinstance(metadata, dict) and metadata.get("incident_id"):
        return str(metadata["incident_id"])
    return None


def _incident_rpc_similarity_search(
    supabase,
    query_vector: list[float],
    org_id: str,
    limit: int,
    min_similarity: float,
    exclude_incident_id: str | None = None,
) -> list[dict[str, Any]] | None:
    """Call match_incident_embeddings RPC. Returns None on failure."""
    try:
        params: dict[str, Any] = {
            "query_embedding": query_vector,
            "match_threshold": min_similarity,
            "match_count": limit * 3,  # over-fetch; dedupe by incident below
            "p_org_id": org_id,
        }
        if exclude_incident_id:
            params["p_exclude_incident_id"] = exclude_incident_id
        result = supabase.rpc("match_incident_embeddings", params).execute()
        rows = result.data or []
        return [
            {
                "session_id": r.get("session_id"),
                "incident_id": _extract_incident_id(r),
                "chunk_index": r.get("chunk_index", 0),
                "content": r.get("content"),
                "similarity": round(float(r.get("similarity", 0)), 4),
                "metadata": r.get("metadata", {}),
                "participant_id": r.get("participant_id"),
            }
            for r in rows
        ]
    except Exception as exc:
        logger.warning("match_incident_embeddings RPC failed, falling back: %s", exc)
        return None


def _dedupe_incident_matches(
    chunks: list[dict[str, Any]], limit: int
) -> list[dict[str, Any]]:
    """Keep the highest-similarity chunk per incident, up to *limit*."""
    best_by_incident: dict[str, dict[str, Any]] = {}
    for chunk in chunks:
        iid = chunk.get("incident_id")
        if not iid:
            continue
        existing = best_by_incident.get(iid)
        if not existing or chunk.get("similarity", 0) > existing.get("similarity", 0):
            best_by_incident[iid] = chunk
    ranked = sorted(
        best_by_incident.values(),
        key=lambda c: c.get("similarity", 0),
        reverse=True,
    )
    return ranked[:limit]


async def count_incidents_in_vector_db(org_id: str) -> int:
    """Return the number of distinct incidents embedded for *org_id*."""
    if not org_id:
        return 0
    supabase = get_supabase_admin()
    try:
        result = supabase.rpc("count_incident_embeddings", {"p_org_id": org_id}).execute()
        if result.data is not None:
            return int(result.data)
    except Exception as exc:
        logger.warning("count_incident_embeddings RPC failed, falling back: %s", exc)

    try:
        result = (
            supabase.table("session_embeddings")
            .select("incident_id, metadata")
            .eq("organization_id", org_id)
            .eq("metadata->>source", "incident")
            .execute()
        )
        incident_ids: set[str] = set()
        for row in result.data or []:
            iid = _extract_incident_id(row)
            if iid:
                incident_ids.add(iid)
        return len(incident_ids)
    except Exception as exc:
        logger.warning("count incidents fallback failed: %s", exc)
        return 0


async def retrieve_similar_incidents(
    query_text: str,
    org_id: str,
    exclude_incident_id: str | None = None,
    limit: int = 5,
    min_similarity: float = 0.65,
) -> list[dict[str, Any]]:
    """Return up to *limit* past incident chunks similar to *query_text*.

    Results are strictly scoped to *org_id* and filtered to incident embeddings only.
    """
    if not query_text or not query_text.strip():
        return []
    if not org_id:
        raise ValueError("org_id is required for incident RAG retrieval (CARECLIQV2-32)")

    query_vector = await generate_session_embedding(query_text)
    if not query_vector:
        return []

    supabase = get_supabase_admin()
    fetch_limit = limit * 3

    rpc_result = _incident_rpc_similarity_search(
        supabase,
        query_vector,
        org_id,
        fetch_limit,
        min_similarity,
        exclude_incident_id=exclude_incident_id,
    )
    if rpc_result is not None:
        return _dedupe_incident_matches(rpc_result, limit)

    try:
        result = (
            supabase.table("session_embeddings")
            .select("session_id, incident_id, chunk_index, content, embedding, metadata, participant_id")
            .eq("organization_id", org_id)
            .eq("metadata->>source", "incident")
            .execute()
        )
        rows = result.data or []
    except Exception as exc:
        logger.warning("Incident RAG fallback DB query failed: %s", exc)
        return []

    if exclude_incident_id:
        rows = [r for r in rows if _extract_incident_id(r) != exclude_incident_id]

    scored = _python_similarity_search(rows, query_vector, fetch_limit, min_similarity)
    for item in scored:
        item["incident_id"] = _extract_incident_id(item)
    return _dedupe_incident_matches(scored, limit)


async def retrieve_compliance_context(
    session_notes: str,
    org_id: str,
    limit: int = 3,
) -> list[dict[str, Any]]:
    """Retrieve past similar session chunks to augment compliance rule evaluation."""
    return await retrieve_similar_sessions(
        query_text=session_notes,
        org_id=org_id,
        limit=limit,
        min_similarity=0.75,
    )


async def retrieve_high_scoring_participant_notes(
    participant_id: str,
    organisation_id: str,
    query_text: str,
    min_score: float = 85.0,
    k: int = 3,
) -> list[dict[str, Any]]:
    """CARECLIQV2-33 — RAG retrieval of high-scoring past notes for same participant."""
    if not participant_id or not organisation_id:
        return []

    supabase = get_supabase_admin()
    direct: list[dict[str, Any]] = []
    try:
        result = (
            supabase.table("sessions")
            .select(
                "id, session_date, compliance_score, compliance_input_text, "
                "translated_english_note, notes"
            )
            .eq("organization_id", organisation_id)
            .eq("patient_id", participant_id)
            .eq("status", "completed")
            .gte("compliance_score", min_score)
            .order("session_date", desc=True)
            .limit(k)
            .execute()
        )
        for row in result.data or []:
            content = (
                row.get("compliance_input_text")
                or row.get("translated_english_note")
                or row.get("notes")
                or ""
            )
            if not str(content).strip():
                continue
            direct.append({
                "session_id": str(row.get("id")),
                "session_date": row.get("session_date"),
                "compliance_score": row.get("compliance_score"),
                "content": str(content).strip(),
            })
    except Exception as exc:
        logger.warning("High-scoring session lookup failed: %s", exc)

    if direct:
        return direct[:k]

    if not query_text or not query_text.strip():
        return []

    semantic = await retrieve_similar(query_text, organisation_id, k=k * 2)
    filtered = [
        {
            "session_id": r.session_id,
            "session_date": r.session_date.isoformat() if r.session_date else None,
            "compliance_score": r.compliance_score,
            "content": r.content or "",
        }
        for r in semantic
        if r.participant_id == participant_id
        and (r.compliance_score is None or r.compliance_score >= min_score)
        and (r.content or "").strip()
    ]
    return filtered[:k]
