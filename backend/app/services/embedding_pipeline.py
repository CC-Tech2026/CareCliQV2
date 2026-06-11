"""
CARECLIQV2-30 — Embedding pipeline: generate and store on session approval.

Chunks source text on sentence boundaries (max 512 tokens per chunk), generates
text-embedding-3-small vectors for each chunk, and persists them in the
session_embeddings table (pgvector, HNSW).

All operations run as FastAPI BackgroundTasks so the API response is never
blocked.  Failed embedding/storage operations are retried up to MAX_RETRIES
times with exponential back-off and fully logged.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

from .query_embedding_service import generate_query_embedding
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

# ── Chunking constants ────────────────────────────────────────────────────────

_MAX_TOKENS: int = 512
# Rough approximation: 1 token ≈ 4 English characters — avoids tiktoken dep.
_CHARS_PER_TOKEN: int = 4
_MAX_CHARS: int = _MAX_TOKENS * _CHARS_PER_TOKEN  # 2 048 chars

# Sentence-boundary split: split on .  !  ?  followed by whitespace or end.
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+")

_MAX_RETRIES: int = 3
_RETRY_BASE_DELAY: float = 1.0  # seconds; doubled each attempt


# ── Text chunking ─────────────────────────────────────────────────────────────

def _split_into_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_BOUNDARY.split(text) if s.strip()]


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // _CHARS_PER_TOKEN)


def chunk_text(text: str) -> list[str]:
    """Split *text* into chunks ≤ MAX_TOKENS tokens on sentence boundaries.

    A single sentence that exceeds MAX_TOKENS is hard-split at the character
    level so no chunk ever exceeds the limit.
    """
    if not text or not text.strip():
        return []

    sentences = _split_into_sentences(text)
    chunks: list[str] = []
    current_sentences: list[str] = []
    current_tokens: int = 0

    for sentence in sentences:
        sentence_tokens = _estimate_tokens(sentence)

        # Sentence is too large on its own — hard-split it first.
        if sentence_tokens > _MAX_TOKENS:
            if current_sentences:
                chunks.append(" ".join(current_sentences))
                current_sentences = []
                current_tokens = 0
            for i in range(0, len(sentence), _MAX_CHARS):
                sub = sentence[i : i + _MAX_CHARS].strip()
                if sub:
                    chunks.append(sub)
            continue

        if current_tokens + sentence_tokens > _MAX_TOKENS and current_sentences:
            chunks.append(" ".join(current_sentences))
            current_sentences = []
            current_tokens = 0

        current_sentences.append(sentence)
        current_tokens += sentence_tokens

    if current_sentences:
        chunks.append(" ".join(current_sentences))

    return [c for c in chunks if c.strip()]


# ── Retry helpers ─────────────────────────────────────────────────────────────

async def _embed_with_retry(text: str) -> list[float]:
    """Return embedding vector, retrying up to MAX_RETRIES times."""
    for attempt in range(_MAX_RETRIES):
        try:
            vec = await generate_query_embedding(text)
            if vec:
                return vec
        except Exception as exc:
            logger.warning(
                "Embedding attempt %d/%d failed: %s", attempt + 1, _MAX_RETRIES, exc
            )
        if attempt < _MAX_RETRIES - 1:
            await asyncio.sleep(_RETRY_BASE_DELAY * (2**attempt))
    logger.error("Embedding generation failed after %d attempts", _MAX_RETRIES)
    return []


def _upsert_conflict_key(row: dict[str, Any]) -> str:
    """Return the on_conflict column pair for a session_embeddings row."""
    if row.get("incident_id") and not row.get("session_id"):
        return "incident_id,chunk_index"
    return "session_id,chunk_index"


async def _store_chunks_with_retry(rows: list[dict[str, Any]]) -> int:
    """Upsert *rows* into session_embeddings, retrying on failure.

    Returns the number of successfully stored rows.
    """
    if not rows:
        return 0

    supabase = get_supabase_admin()
    conflict_key = _upsert_conflict_key(rows[0])
    for attempt in range(_MAX_RETRIES):
        try:
            supabase.table("session_embeddings").upsert(
                rows,
                on_conflict=conflict_key,
            ).execute()
            return len(rows)
        except Exception as exc:
            logger.warning(
                "Chunk store attempt %d/%d failed (%d rows): %s",
                attempt + 1,
                _MAX_RETRIES,
                len(rows),
                exc,
            )
            if attempt < _MAX_RETRIES - 1:
                await asyncio.sleep(_RETRY_BASE_DELAY * (2**attempt))

    # Last attempt: try rows one-by-one so partial success is captured.
    stored = 0
    for row in rows:
        row_conflict = _upsert_conflict_key(row)
        for attempt in range(_MAX_RETRIES):
            try:
                supabase.table("session_embeddings").upsert(
                    row, on_conflict=row_conflict
                ).execute()
                stored += 1
                break
            except Exception as exc:
                logger.warning(
                    "Single-row store attempt %d/%d failed (chunk %s): %s",
                    attempt + 1,
                    _MAX_RETRIES,
                    row.get("chunk_index"),
                    exc,
                )
                if attempt < _MAX_RETRIES - 1:
                    await asyncio.sleep(_RETRY_BASE_DELAY * (2**attempt))

    return stored


# ── Core pipeline ─────────────────────────────────────────────────────────────

async def _run_pipeline(
    *,
    source: str,
    source_id: str,
    session_id: str | None,
    organization_id: str,
    text: str,
    participant_id: str | None = None,
    worker_id: str | None = None,
    extra_metadata: dict[str, Any] | None = None,
    incident_id: str | None = None,
) -> None:
    """Chunk *text*, embed each chunk, and persist to session_embeddings.

    Args:
        source:          "session" or "incident"
        source_id:       Primary key of the source record.
        session_id:      The sessions.id this embedding belongs to.
        organization_id: Organisation UUID for RLS scoping.
        text:            Full text to embed.
        participant_id:  Optional FK → patients.id
        worker_id:       Optional FK → users.id
        extra_metadata:  Extra JSONB metadata to store alongside each chunk.
    """
    if not text or not text.strip():
        logger.info("embedding_pipeline: skipping %s %s — no text", source, source_id)
        return

    if not organization_id:
        logger.error(
            "embedding_pipeline: skipping %s %s — organization_id missing", source, source_id
        )
        return

    chunks = chunk_text(text)
    if not chunks:
        logger.info(
            "embedding_pipeline: no chunks produced for %s %s", source, source_id
        )
        return

    logger.info(
        "embedding_pipeline: processing %s %s — %d chunk(s) from %d chars",
        source,
        source_id,
        len(chunks),
        len(text),
    )

    rows: list[dict[str, Any]] = []
    base_metadata: dict[str, Any] = {
        "source": source,
        "source_id": source_id,
        "model": "text-embedding-3-small",
        **(extra_metadata or {}),
    }

    for idx, chunk in enumerate(chunks):
        vec = await _embed_with_retry(chunk)
        if not vec:
            logger.warning(
                "embedding_pipeline: chunk %d/%d skipped — embedding empty (%s %s)",
                idx,
                len(chunks) - 1,
                source,
                source_id,
            )
            continue

        row: dict[str, Any] = {
            "organization_id": organization_id,
            "participant_id": participant_id,
            "worker_id": worker_id,
            "chunk_index": idx,
            "content": chunk,
            "embedding": vec,
            "metadata": {**base_metadata, "chunk_index": idx, "total_chunks": len(chunks)},
        }
        if session_id:
            row["session_id"] = session_id
        if incident_id:
            row["incident_id"] = incident_id
        rows.append(row)

    if not rows:
        logger.warning(
            "embedding_pipeline: no rows to store for %s %s — all chunks failed",
            source,
            source_id,
        )
        return

    stored = await _store_chunks_with_retry(rows)
    logger.info(
        "embedding_pipeline: stored %d/%d chunk(s) for %s %s",
        stored,
        len(rows),
        source,
        source_id,
    )


# ── Public entry points (FastAPI BackgroundTask targets) ──────────────────────

async def run_session_embedding_pipeline(
    *,
    session_id: str,
    organization_id: str,
    text: str,
    participant_id: str | None = None,
    worker_id: str | None = None,
) -> None:
    """Background task: embed and store a completed session note.

    Triggered from the save-with-ai endpoint after status = 'completed'.
    Never raises — all errors are logged so the caller is not affected.
    """
    try:
        await _run_pipeline(
            source="session",
            source_id=session_id,
            session_id=session_id,
            organization_id=organization_id,
            text=text,
            participant_id=participant_id,
            worker_id=worker_id,
        )
    except Exception as exc:
        logger.error(
            "embedding_pipeline: unhandled error for session %s: %s", session_id, exc
        )


async def run_incident_embedding_pipeline(
    *,
    incident_id: str,
    organization_id: str,
    text: str,
    session_id: str | None = None,
    participant_id: str | None = None,
    worker_id: str | None = None,
) -> None:
    """Background task: embed and store an incident report.

    Triggered from the incidents create endpoint on submission.
    Never raises — all errors are logged so the caller is not affected.
    """
    try:
        await _run_pipeline(
            source="incident",
            source_id=incident_id,
            session_id=session_id,
            organization_id=organization_id,
            text=text,
            participant_id=participant_id,
            worker_id=worker_id,
            incident_id=incident_id,
            extra_metadata={"incident_id": incident_id},
        )
    except Exception as exc:
        logger.error(
            "embedding_pipeline: unhandled error for incident %s: %s", incident_id, exc
        )
