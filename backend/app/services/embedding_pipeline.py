"""
CARECLIQV2-30 — Embedding pipeline: generate and store on note create/edit.

Chunks source text on sentence boundaries (max 512 tokens per chunk), generates
text-embedding-3-small vectors for each chunk, and persists them in the
session_embeddings table (pgvector, HNSW).

Generation is never gated on compliance outcome — a flagged/failed note must
stay searchable. It is scheduled via schedule() (asyncio.create_task, not
FastAPI BackgroundTasks) so the API response is never blocked *and* so it
still runs even when the caller subsequently raises an HTTPException — see
schedule()'s docstring below for why BackgroundTasks can't be used here.

Failed embedding/storage operations are retried up to MAX_RETRIES times with
exponential back-off; a failure that survives retries is marked visibly via
embedding_status/embedding_error (see migration 180) rather than only logged.
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Coroutine
from typing import Any

from .query_embedding_service import generate_query_embedding
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

_MAX_TOKENS = 512
_CHARS_PER_TOKEN = 4  # Rough approximation; avoids a tiktoken dependency.
_MAX_CHARS = _MAX_TOKENS * _CHARS_PER_TOKEN

_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 1.0  # seconds; doubled after each failed attempt

_VALID_SOURCES = {"session", "incident"}
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+")


# ── Fire-and-forget scheduling ────────────────────────────────────────────────
#
# save_session_with_ai (and incident create/update) must trigger embedding
# generation even on a request that ultimately raises an HTTPException for a
# compliance block/warn failure. FastAPI BackgroundTasks only run when the
# endpoint returns normally, whereas asyncio.create_task() is independent of
# response construction. A strong reference is kept until each task completes.

_inflight_tasks: set[asyncio.Task[Any]] = set()


def schedule(coro: Coroutine[Any, Any, Any]) -> asyncio.Task[Any]:
    """Schedule *coro* independently of the caller's response lifecycle."""
    task = asyncio.create_task(coro)
    _inflight_tasks.add(task)
    task.add_done_callback(_inflight_tasks.discard)
    return task


# ── Text chunking ─────────────────────────────────────────────────────────────


def _split_into_sentences(text: str) -> list[str]:
    """Split text on sentence boundaries and discard empty fragments."""
    return [
        sentence.strip()
        for sentence in _SENTENCE_BOUNDARY.split(text)
        if sentence.strip()
    ]


def _estimate_tokens(text: str) -> int:
    """Estimate token count without adding a tokenizer dependency."""
    return max(1, len(text) // _CHARS_PER_TOKEN)


def chunk_text(text: str) -> list[str]:
    """Split *text* into chunks of at most roughly ``_MAX_TOKENS`` tokens.

    Sentence boundaries are preserved when possible. A single oversized
    sentence is hard-split by character count so no generated chunk exceeds
    the configured approximation limit.
    """
    if not text or not text.strip():
        return []

    sentences = _split_into_sentences(text)
    chunks: list[str] = []
    current_sentences: list[str] = []
    current_tokens = 0

    for sentence in sentences:
        sentence_tokens = _estimate_tokens(sentence)

        if sentence_tokens > _MAX_TOKENS:
            if current_sentences:
                chunks.append(" ".join(current_sentences))
                current_sentences = []
                current_tokens = 0

            for start in range(0, len(sentence), _MAX_CHARS):
                segment = sentence[start : start + _MAX_CHARS].strip()
                if segment:
                    chunks.append(segment)
            continue

        if current_sentences and current_tokens + sentence_tokens > _MAX_TOKENS:
            chunks.append(" ".join(current_sentences))
            current_sentences = []
            current_tokens = 0

        current_sentences.append(sentence)
        current_tokens += sentence_tokens

    if current_sentences:
        chunks.append(" ".join(current_sentences))

    return [chunk for chunk in chunks if chunk.strip()]


# ── Source/status helpers ─────────────────────────────────────────────────────


def _target_table(source: str) -> str:
    """Return the source table that owns embedding status fields."""
    if source == "session":
        return "sessions"
    if source == "incident":
        return "incidents"
    raise ValueError(f"Unsupported embedding source: {source!r}")


def _source_key_column(source: str) -> str:
    """Return the source FK column used by session_embeddings."""
    if source == "session":
        return "session_id"
    if source == "incident":
        return "incident_id"
    raise ValueError(f"Unsupported embedding source: {source!r}")


def _mark_embedding_failed(source: str, source_id: str, error: str) -> None:
    """Persist a visible embedding failure marker on the source record."""
    if not source_id:
        return

    try:
        (
            get_supabase_admin()
            .table(_target_table(source))
            .update(
                {
                    "embedding_status": "failed",
                    "embedding_error": error,
                }
            )
            .eq("id", source_id)
            .execute()
        )
    except Exception as exc:
        logger.error(
            "embedding_pipeline: could not mark embedding failure for %s %s: %s",
            source,
            source_id,
            exc,
        )


def _mark_embedding_succeeded(source: str, source_id: str) -> None:
    """Clear any previous embedding failure marker after a complete success."""
    if not source_id:
        return
    try:
        get_supabase_admin().table(_target_table(source)).update({
            "embedding_status": None,
            "embedding_error": None,
        }).eq("id", source_id).execute()
    except Exception as exc:
        logger.error(
            "embedding_pipeline: could not clear embedding status for %s %s: %s",
            source,
            source_id,
            exc,
        )


def _delete_stale_chunks(
    source: str,
    source_id: str,
    organization_id: str,
    keep_below: int,
) -> None:
    """Delete source chunks whose index is greater than or equal to keep_below."""
    if not source_id:
        return

    try:
        (
            get_supabase_admin()
            .table("session_embeddings")
            .delete()
            .eq(_source_key_column(source), source_id)
            .eq("organization_id", organization_id)
            .gte("chunk_index", keep_below)
            .execute()
        )
    except Exception as exc:
        logger.warning(
            "embedding_pipeline: stale chunk cleanup failed for %s %s: %s",
            source,
            source_id,
            exc,
        )


# ── Retry helpers ─────────────────────────────────────────────────────────────


async def _embed_with_retry(text: str) -> list[float]:
    """Generate an embedding vector, retrying transient failures."""
    for attempt in range(_MAX_RETRIES):
        try:
            vector = await generate_query_embedding(text)
            if vector:
                return vector
        except Exception as exc:
            logger.warning(
                "embedding_pipeline: embedding attempt %d/%d failed: %s",
                attempt + 1,
                _MAX_RETRIES,
                exc,
            )

        if attempt < _MAX_RETRIES - 1:
            await asyncio.sleep(_RETRY_BASE_DELAY * (2**attempt))

    logger.error(
        "embedding_pipeline: embedding generation failed after %d attempts",
        _MAX_RETRIES,
    )
    return []


def _upsert_conflict_key(row: dict[str, Any]) -> str:
    """Return the unique-column pair used to upsert one embedding row."""
    if row.get("incident_id") and not row.get("session_id"):
        return "incident_id,chunk_index"
    return "session_id,chunk_index"


async def _store_chunks_with_retry(rows: list[dict[str, Any]]) -> int:
    """Upsert embedding rows and return the number successfully stored.

    The batch is retried first. If all batch attempts fail, rows are retried
    individually so partial success can still be recorded accurately.
    """
    if not rows:
        return 0

    supabase = get_supabase_admin()
    conflict_key = _upsert_conflict_key(rows[0])

    for attempt in range(_MAX_RETRIES):
        try:
            (
                supabase.table("session_embeddings")
                .upsert(rows, on_conflict=conflict_key)
                .execute()
            )
            return len(rows)
        except Exception as exc:
            logger.warning(
                "embedding_pipeline: chunk store attempt %d/%d failed "
                "(%d rows): %s",
                attempt + 1,
                _MAX_RETRIES,
                len(rows),
                exc,
            )

            if attempt < _MAX_RETRIES - 1:
                await asyncio.sleep(_RETRY_BASE_DELAY * (2**attempt))

    stored = 0
    for row in rows:
        row_conflict_key = _upsert_conflict_key(row)

        for attempt in range(_MAX_RETRIES):
            try:
                (
                    supabase.table("session_embeddings")
                    .upsert(row, on_conflict=row_conflict_key)
                    .execute()
                )
                stored += 1
                break
            except Exception as exc:
                logger.warning(
                    "embedding_pipeline: single-row store attempt %d/%d failed "
                    "(chunk %s): %s",
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
        source: "session" or "incident".
        source_id: Primary key of the source record.
        session_id: The sessions.id this embedding belongs to, when applicable.
        organization_id: Organisation UUID used for tenant/RLS scoping.
        text: Full source text to embed.
        participant_id: Optional FK to the participant/patient record.
        worker_id: Optional FK to the worker/user record.
        extra_metadata: Additional JSON metadata stored with every chunk.
        incident_id: The incidents.id this embedding belongs to, when applicable.
    """
    if not source_id:
        logger.error("embedding_pipeline: missing source_id for %s", source)
        return
    if source not in {"session", "incident"}:
        logger.error("embedding_pipeline: invalid source %r", source)
        return
    if not text or not text.strip():
        logger.info(
            "embedding_pipeline: clearing embeddings for %s %s — no text",
            source,
            source_id,
        )
        _delete_stale_chunks(
            source,
            source_id,
            organization_id,
            keep_below=0,
        )
        _mark_embedding_succeeded(source, source_id)
        return
    if not organization_id:
        logger.error(
            "embedding_pipeline: skipping %s %s — organization_id missing",
            source,
            source_id,
        )
        _mark_embedding_failed(source, source_id, "organization_id missing")
        return

    chunks = chunk_text(text)
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

    failed_chunk_indexes: list[int] = []
    for idx, chunk in enumerate(chunks):
        vector = await _embed_with_retry(chunk)
        if not vector:
            failed_chunk_indexes.append(idx)
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
            "embedding": vector,
            "metadata": {
                **base_metadata,
                "chunk_index": idx,
                "total_chunks": len(chunks),
            },
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
        _mark_embedding_failed(
            source,
            source_id,
            f"embedding generation failed for all {len(chunks)} chunk(s)",
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

    # Remove chunks left over from a previous, longer version.
    _delete_stale_chunks(
        source,
        source_id,
        organization_id,
        keep_below=len(chunks),
    )
    failure_reasons: list[str] = []
    if failed_chunk_indexes:
        failure_reasons.append(
            "embedding generation failed for chunk(s): "
            + ", ".join(str(index) for index in failed_chunk_indexes)
        )
    if stored < len(rows):
        failure_reasons.append(
            f"stored only {stored}/{len(rows)} generated chunk(s)"
        )
    if failure_reasons:
        _mark_embedding_failed(
            source,
            source_id,
            "; ".join(failure_reasons),
        )
        return
    _mark_embedding_succeeded(source, source_id)


# ── Public entry points ───────────────────────────────────────────────────────


async def run_session_embedding_pipeline(
    *,
    session_id: str,
    organization_id: str,
    text: str,
    participant_id: str | None = None,
    worker_id: str | None = None,
) -> None:
    """Embed and store a session note on create or edit.

    This runs for every save regardless of compliance outcome. It never lets
    embedding failures propagate back to the API caller; failures are logged
    and recorded on the source row instead.
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
            "embedding_pipeline: unhandled error for session %s: %s",
            session_id,
            exc,
        )
        _mark_embedding_failed("session", session_id, str(exc))


async def run_incident_embedding_pipeline(
    *,
    incident_id: str,
    organization_id: str,
    text: str,
    session_id: str | None = None,
    participant_id: str | None = None,
    worker_id: str | None = None,
) -> None:
    """Embed and store an incident report on create or edit.

    This entry point has the same failure isolation guarantees as the session
    pipeline: errors are logged and persisted rather than raised to the caller.
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
            "embedding_pipeline: unhandled error for incident %s: %s",
            incident_id,
            exc,
        )
        _mark_embedding_failed("incident", incident_id, str(exc))
