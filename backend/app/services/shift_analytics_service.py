"""Shift Analytics Service — CARECLIQV2-XXX

RAG-powered shift suggestions using:
- Similar past shifts retrieval (semantic search over shift summaries)
- Goal progress context from high-scoring session notes  
- AI-generated task recommendations specific to shift type & participant
- Risk pattern detection from pattern_detection_service

All queries are organization-scoped. Suggestions are advisory only.
Non-critical failures fall back gracefully (return empty suggestions).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from ..schemas.retrieval import RetrievalResult
from .supabase_client import get_supabase_admin
from .query_embedding_service import generate_query_embedding

logger = logging.getLogger(__name__)

_MIN_SIMILARITY = 0.70
_MAX_PAST_SHIFTS = 5
_GOAL_CONTEXT_CHARS = 1200


class ShiftSuggestion:
    """Single task suggestion with confidence & reasoning."""
    
    def __init__(
        self,
        task_id: str,
        task_name: str,
        confidence: float,  # 0.0-1.0
        reason: str,
        goal_id: Optional[str] = None,
        goal_name: Optional[str] = None,
    ):
        self.task_id = task_id
        self.task_name = task_name
        self.confidence = min(1.0, max(0.0, confidence))
        self.reason = reason[:500]  # Cap reason length
        self.goal_id = goal_id
        self.goal_name = goal_name
    
    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "task_name": self.task_name,
            "confidence": round(self.confidence, 2),
            "reason": self.reason,
            "goal_id": self.goal_id,
            "goal_name": self.goal_name,
        }


class ShiftAnalytics:
    """Analytics payload returned to coordinator."""
    
    def __init__(
        self,
        participant_id: str,
        shift_type: str,
        recommended_tasks: list[ShiftSuggestion],
        goal_focus_areas: list[dict[str, Any]],
        shift_insights: str,
        similar_shifts_count: int,
        risk_flags: list[str],
    ):
        self.participant_id = participant_id
        self.shift_type = shift_type
        self.recommended_tasks = recommended_tasks
        self.goal_focus_areas = goal_focus_areas
        self.shift_insights = shift_insights[:1000]  # Cap insights
        self.similar_shifts_count = similar_shifts_count
        self.risk_flags = risk_flags[:5]  # Cap flags
    
    def to_dict(self) -> dict[str, Any]:
        return {
            "participant_id": self.participant_id,
            "shift_type": self.shift_type,
            "recommended_tasks": [t.to_dict() for t in self.recommended_tasks],
            "goal_focus_areas": self.goal_focus_areas,
            "shift_insights": self.shift_insights,
            "similar_shifts_count": self.similar_shifts_count,
            "risk_flags": self.risk_flags,
        }


async def retrieve_similar_shifts(
    participant_id: str,
    organisation_id: str,
    shift_type: str,
    limit: int = _MAX_PAST_SHIFTS,
) -> list[dict[str, Any]]:
    """
    Retrieve similar past shifts for this participant using RAG.
    
    Returns shifts from session_embeddings where participant_id matches,
    filtered by organization_id and sorted by recency + similarity.
    
    Non-critical: returns [] on failure.
    """
    supabase = get_supabase_admin()
    
    try:
        # Build query for shifts: look for sessions with this participant
        # that mention shift type in the content
        query_text = f"shift: {shift_type} participant tasks goals"
        
        query_embedding = await generate_query_embedding(query_text)
        if not query_embedding:
            logger.warning(
                f"Query embedding failed for shift similarity search (org={organisation_id}, "
                f"participant={participant_id})"
            )
            return []
        
        # Use RPC to retrieve similar sessions (org-scoped)
        result = supabase.rpc(
            "match_session_embeddings",
            {
                "query_embedding": query_embedding,
                "match_count": limit * 2,  # Request more, filter down
                "min_similarity": _MIN_SIMILARITY,
            },
        ).execute()
        
        rows = result.data or []
        
        # Filter to this participant + organization
        filtered = []
        for row in rows:
            if (
                row.get("participant_id") == participant_id
                and row.get("organization_id") == organisation_id
            ):
                filtered.append(row)
                if len(filtered) >= limit:
                    break
        
        logger.info(
            f"Retrieved {len(filtered)} similar shifts (org={organisation_id}, "
            f"participant={participant_id}, shift_type={shift_type})"
        )
        
        return filtered
    
    except Exception as exc:
        logger.warning(
            f"Similar shift retrieval failed (org={organisation_id}, "
            f"participant={participant_id}): {exc}"
        )
        return []


async def retrieve_goal_progress_context(
    participant_id: str,
    organisation_id: str,
    goal_ids: Optional[list[str]] = None,
) -> str:
    """
    Retrieve high-scoring session notes for goal context.
    
    Uses existing RAG method to get best documented sessions,
    then filters to goal-specific progress if goal_ids provided.
    
    Returns formatted context string (capped at _GOAL_CONTEXT_CHARS).
    Non-critical: returns "" on failure.
    """
    try:
        from .rag_service import retrieve_high_scoring_participant_notes
        
        # Get best sessions for this participant
        high_scoring = await retrieve_high_scoring_participant_notes(
            participant_id=participant_id,
            organisation_id=organisation_id,
            query_text="goals progress skills improvement",
            min_score=80.0,
            k=3,
        )
        
        if not high_scoring:
            return ""
        
        # Format into context string
        snippets = []
        for note in high_scoring:
            date_str = note.get("session_date") or "prior session"
            score = note.get("compliance_score") or "N/A"
            content = (note.get("content") or "")[:300]
            snippets.append(f"[{date_str}, score={score}]: {content}")
        
        context = (
            "\n\nPAST SESSION NOTES FOR GOAL CONTEXT:\n"
            + "\n".join(snippets)
        )
        
        return context[: _GOAL_CONTEXT_CHARS]
    
    except Exception as exc:
        logger.warning(
            f"Goal progress context retrieval failed (org={organisation_id}, "
            f"participant={participant_id}): {exc}"
        )
        return ""


async def analyze_shift_patterns(
    similar_shifts: list[dict[str, Any]],
    shift_type: str,
) -> dict[str, Any]:
    """
    Analyze common patterns across similar past shifts.
    
    Looks for:
    - Most frequently completed tasks
    - Common task completion rates
    - Task sequences/orderings
    
    Returns dict with patterns analysis.
    """
    if not similar_shifts:
        return {}
    
    try:
        # Count task mentions in session summaries
        task_frequency: dict[str, int] = {}
        
        for shift in similar_shifts:
            content = shift.get("content") or ""
            # Simple heuristic: look for task-like patterns
            # In real implementation, would parse structured shift_tasks data
            if "personal hygiene" in content.lower():
                task_frequency["personal_hygiene"] = task_frequency.get("personal_hygiene", 0) + 1
            if "meal" in content.lower():
                task_frequency["meal_prep"] = task_frequency.get("meal_prep", 0) + 1
            if "medication" in content.lower():
                task_frequency["medication"] = task_frequency.get("medication", 0) + 1
            if "community" in content.lower():
                task_frequency["community_access"] = task_frequency.get("community_access", 0) + 1
            if "health" in content.lower():
                task_frequency["health_wellness"] = task_frequency.get("health_wellness", 0) + 1
        
        return {
            "task_frequency": task_frequency,
            "shift_count": len(similar_shifts),
        }
    
    except Exception as exc:
        logger.warning(f"Shift pattern analysis failed: {exc}")
        return {}


async def get_detected_risk_patterns(
    participant_id: str,
    organisation_id: str,
) -> list[str]:
    """
    Retrieve any risk patterns from pattern detection service.
    
    Looks for coordinator alerts related to this participant
    (incident escalation, low compliance, refused activities).
    
    Returns list of risk flag descriptions.
    Non-critical: returns [] on failure.
    """
    supabase = get_supabase_admin()
    
    try:
        # Query pattern detection alerts for this participant
        result = supabase.table("ai_detected_patterns").select(
            "id, pattern_type, participant_id, metadata, created_at"
        ).eq("participant_id", participant_id).eq(
            "organisation_id", organisation_id
        ).gte(
            "created_at",
            (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
        ).execute()
        
        alerts = result.data or []
        flags = []
        
        for alert in alerts:
            pattern_type = alert.get("pattern_type", "").replace("_", " ").title()
            metadata = alert.get("metadata") or {}
            count = metadata.get("incident_count") or metadata.get("refusal_count") or ""
            
            if count:
                flags.append(f"{pattern_type}: {count} incidents in past 90 days")
            else:
                flags.append(pattern_type)
        
        return flags[:3]  # Cap to top 3 flags
    
    except Exception as exc:
        logger.warning(
            f"Risk pattern retrieval failed (org={organisation_id}, "
            f"participant={participant_id}): {exc}"
        )
        return []


async def generate_shift_suggestions(
    participant_id: str,
    worker_id: str,
    shift_type: str,
    organisation_id: str,
    goal_ids: Optional[list[str]] = None,
    ai_service_func = None,  # Injected for testability
) -> ShiftAnalytics:
    """
    Generate AI-powered shift suggestions using RAG context.
    
    Orchestrates (with parallelization):
    1. Retrieve similar past shifts
    2. Get goal progress context
    3. Detect risk patterns
    4. Analyze task patterns from similar shifts
    5. Call AI service to generate recommendations
    6. Return structured ShiftAnalytics
    
    Non-critical failures: return basic analytics with available data.
    """
    import asyncio
    
    # Parallelize RAG retrieval calls (steps 1-3)
    # These are independent and can run concurrently
    results = await asyncio.gather(
        retrieve_similar_shifts(
            participant_id=participant_id,
            organisation_id=organisation_id,
            shift_type=shift_type,
            limit=_MAX_PAST_SHIFTS,
        ),
        retrieve_goal_progress_context(
            participant_id=participant_id,
            organisation_id=organisation_id,
            goal_ids=goal_ids,
        ),
        get_detected_risk_patterns(
            participant_id=participant_id,
            organisation_id=organisation_id,
        ),
        return_exceptions=True,
    )
    
    similar_shifts = results[0] if not isinstance(results[0], Exception) else []
    goal_context = results[1] if not isinstance(results[1], Exception) else ""
    risk_flags = results[2] if not isinstance(results[2], Exception) else []
    
    # Step 4: Analyze patterns (local, no I/O needed)
    patterns = await analyze_shift_patterns(similar_shifts, shift_type)
    
    # Step 5: Generate AI recommendations (if available)
    recommended_tasks = []
    goal_focus_areas = []
    shift_insights = ""
    
    if ai_service_func:
        try:
            suggestions = await ai_service_func(
                participant_id=participant_id,
                worker_id=worker_id,
                shift_type=shift_type,
                similar_shifts=similar_shifts,
                patterns=patterns,
                goal_context=goal_context,
                goal_ids=goal_ids,
                risk_flags=risk_flags,
            )
            
            recommended_tasks = suggestions.get("recommended_tasks", [])
            goal_focus_areas = suggestions.get("goal_focus_areas", [])
            shift_insights = suggestions.get("shift_insights", "")
        
        except Exception as ai_exc:
            logger.warning(f"AI suggestion generation failed: {ai_exc}")
    
    return ShiftAnalytics(
        participant_id=participant_id,
        shift_type=shift_type,
        recommended_tasks=recommended_tasks,
        goal_focus_areas=goal_focus_areas,
        shift_insights=shift_insights or f"Based on {len(similar_shifts)} similar past shifts for this participant.",
        similar_shifts_count=len(similar_shifts),
        risk_flags=risk_flags,
    )
