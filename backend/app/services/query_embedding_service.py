"""
CARECLIQV2-80 — Query embedding service.

Generates text-embedding-3-small vectors for raw query strings with retry
logic and structured error logging.  Reused by the RAG retrieval service and
the session embedding pipeline.
"""
from __future__ import annotations

import asyncio
import logging

from .ai_service import _build_openai_client

logger = logging.getLogger(__name__)

_EMBEDDING_MODEL = "text-embedding-3-small"
_EMBEDDING_DIM = 1536
_MAX_INPUT_CHARS = 8000
_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 1.0  # seconds; doubled each attempt


def _create_embedding_sync(text: str) -> list[float]:
    """Single OpenAI embeddings API call (sync client)."""
    client = _build_openai_client()
    response = client.embeddings.create(
        model=_EMBEDDING_MODEL,
        input=text,
    )
    vec = response.data[0].embedding
    if len(vec) != _EMBEDDING_DIM:
        raise ValueError(
            f"Unexpected embedding dimension {len(vec)} (expected {_EMBEDDING_DIM})"
        )
    return vec


async def generate_query_embedding(query: str) -> list[float]:
    """Generate a text-embedding-3-small vector for a raw query string.

    Retries up to MAX_RETRIES times with exponential back-off on transient
    failures.  Returns an empty list when the query is blank or all attempts fail.
    """
    if not query or not query.strip():
        return []

    truncated = query.strip()[:_MAX_INPUT_CHARS]

    for attempt in range(_MAX_RETRIES):
        try:
            vec = await asyncio.to_thread(_create_embedding_sync, truncated)
            if vec:
                return vec
        except Exception as exc:
            logger.warning(
                "Query embedding attempt %d/%d failed: %s",
                attempt + 1,
                _MAX_RETRIES,
                exc,
            )
        if attempt < _MAX_RETRIES - 1:
            await asyncio.sleep(_RETRY_BASE_DELAY * (2**attempt))

    logger.error(
        "Query embedding generation failed after %d attempts for query length %d",
        _MAX_RETRIES,
        len(truncated),
    )
    return []
