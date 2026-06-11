"""
CARECLIQV2-83 — Retrieval result DTO for org-scoped RAG search.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class RetrievalResult(BaseModel):
    """A single chunk returned by retrieve_similar()."""

    content: Optional[str] = None
    session_id: str
    participant_id: Optional[str] = None
    session_date: Optional[datetime] = None
    compliance_score: Optional[float] = None
    similarity_score: float = Field(ge=0.0, le=1.0)
