"""
CARECLIQV2-32 — Incident pattern recognition via RAG + GPT-4o.

Retrieves semantically similar past incidents for an organisation and
generates an AI summary of recognised patterns, de-escalation strategies,
and support-plan recommendations.
"""
from __future__ import annotations

import logging
from typing import Any

from .ai_service import analyze_incident_patterns
from .rag_service import (
    _MIN_INCIDENTS_FOR_PATTERN,
    count_incidents_in_vector_db,
    retrieve_similar_incidents,
)
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

_PARTICIPANT_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _build_incident_query_text(incident: dict[str, Any]) -> str:
    parts = [
        incident.get("title", ""),
        incident.get("description", ""),
        incident.get("participant_impact", ""),
        incident.get("worker_actions", ""),
        incident.get("investigation_notes", ""),
        incident.get("corrective_actions", ""),
        incident.get("incident_type", ""),
    ]
    return " ".join(str(p) for p in parts if p).strip()


def _participant_labels(participant_ids: list[str | None]) -> dict[str | None, str]:
    """Map participant UUIDs to redacted labels (Participant A, B, …)."""
    labels: dict[str | None, str] = {}
    letter_idx = 0
    for pid in participant_ids:
        if pid in labels:
            continue
        if pid is None:
            labels[pid] = "Participant"
        else:
            label = _PARTICIPANT_LABELS[letter_idx % len(_PARTICIPANT_LABELS)]
            labels[pid] = f"Participant {label}"
            letter_idx += 1
    return labels


def _truncate_excerpt(text: str, max_len: int = 280) -> str:
    text = (text or "").strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


async def _fetch_incident_summaries(
    incident_ids: list[str], org_id: str
) -> dict[str, dict[str, Any]]:
    """Batch-fetch incident rows for matched IDs, org-scoped."""
    if not incident_ids:
        return {}
    supabase = get_supabase_admin()
    try:
        result = (
            supabase.table("incidents")
            .select(
                "id, incident_date, participant_id, incident_type, severity, status, "
                "description, worker_actions, corrective_actions, investigation_notes"
            )
            .eq("organization_id", org_id)
            .in_("id", incident_ids)
            .execute()
        )
        return {str(row["id"]): row for row in (result.data or [])}
    except Exception as exc:
        logger.warning("Failed to fetch incident summaries for pattern matching: %s", exc)
        return {}


async def get_incident_pattern_analysis(
    incident: dict[str, Any],
    org_id: str,
) -> dict[str, Any]:
    """Build similar-incident matches and GPT-4o pattern analysis for *incident*."""
    empty_response: dict[str, Any] = {
        "sufficient_context": False,
        "incident_count": 0,
        "matches": [],
        "ai_summary": None,
    }

    if not org_id or not incident:
        return empty_response

    incident_count = await count_incidents_in_vector_db(org_id)
    empty_response["incident_count"] = incident_count

    if incident_count < _MIN_INCIDENTS_FOR_PATTERN:
        return empty_response

    incident_id = str(incident.get("id", ""))
    query_text = _build_incident_query_text(incident)
    if not query_text:
        return {**empty_response, "sufficient_context": True}

    raw_matches = await retrieve_similar_incidents(
        query_text=query_text,
        org_id=org_id,
        exclude_incident_id=incident_id or None,
        limit=5,
    )
    if not raw_matches:
        return {**empty_response, "sufficient_context": True}

    matched_ids = [m["incident_id"] for m in raw_matches if m.get("incident_id")]
    incident_rows = await _fetch_incident_summaries(matched_ids, org_id)

    participant_ids = [
        str(incident_rows.get(iid, {}).get("participant_id") or m.get("participant_id"))
        for iid, m in zip(matched_ids, raw_matches)
        if iid in incident_rows or m.get("participant_id")
    ]
    label_map = _participant_labels(participant_ids)

    matches: list[dict[str, Any]] = []
    context_for_ai: list[dict[str, Any]] = []

    for chunk in raw_matches:
        iid = chunk.get("incident_id")
        if not iid or iid not in incident_rows:
            continue
        row = incident_rows[iid]
        pid_raw = row.get("participant_id") or chunk.get("participant_id")
        pid_key = str(pid_raw) if pid_raw else None
        participant_label = label_map.get(pid_key, "Participant")

        excerpt = _truncate_excerpt(chunk.get("content") or row.get("description") or "")

        match_entry = {
            "incident_id": iid,
            "date": row.get("incident_date"),
            "participant_label": participant_label,
            "similarity_score": chunk.get("similarity", 0),
            "excerpt": excerpt,
        }
        matches.append(match_entry)

        context_for_ai.append(
            {
                "date": row.get("incident_date"),
                "type": row.get("incident_type"),
                "severity": row.get("severity"),
                "status": row.get("status"),
                "similarity": chunk.get("similarity"),
                "description": row.get("description"),
                "worker_actions": row.get("worker_actions"),
                "corrective_actions": row.get("corrective_actions"),
                "investigation_notes": row.get("investigation_notes"),
            }
        )

    if not matches:
        return {**empty_response, "sufficient_context": True}

    ai_summary = await analyze_incident_patterns(
        new_incident={
            "title": incident.get("title"),
            "description": incident.get("description"),
            "incident_type": incident.get("incident_type"),
            "severity": incident.get("severity"),
            "worker_actions": incident.get("worker_actions"),
            "participant_impact": incident.get("participant_impact"),
        },
        similar_incidents=context_for_ai,
    )

    return {
        "sufficient_context": True,
        "incident_count": incident_count,
        "matches": matches,
        "ai_summary": ai_summary,
    }
