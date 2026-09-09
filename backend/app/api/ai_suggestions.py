"""
AI-powered suggestion endpoints for coordinator decision support.
Provides field suggestions using RAG + LLM with participant context.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import List, Optional
import logging
import json
from openai import OpenAI
import os

from ..core.security import get_current_user
from ..services.rag_service import retrieve_similar, RetrievalResult
from ..core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai", tags=["AI Suggestions"])

# Initialize OpenAI client
def _get_openai_client() -> OpenAI:
    """Get OpenAI client - prefer Replit integration or direct API key"""
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    integ_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
    if base_url and integ_key:
        return OpenAI(api_key=integ_key, base_url=base_url)
    return OpenAI(api_key=settings.openai_api_key)


# ── Pydantic Models ───────────────────────────────────────────────────────

class ContextHighlight(BaseModel):
    """Highlighted context from participant history"""
    source_type: str = Field(..., description="session_note | task_completion | goal | incident")
    source_date: str = Field(..., description="ISO 8601 date")
    source_content: str = Field(..., description="Original text from history")
    similarity_score: Optional[float] = Field(None, description="0-1 relevance score")


class Suggestion(BaseModel):
    """Single suggestion with context"""
    text: str = Field(..., description="Suggested text for the field")
    confidence: float = Field(..., ge=0, le=1, description="Confidence score 0-1")
    reasoning: str = Field(..., description="Why this suggestion is relevant")
    highlights: List[ContextHighlight] = Field(default_factory=list, description="Supporting context")


class SuggestionResponse(BaseModel):
    """Multiple suggestions for a field"""
    field_type: str = Field(..., description="e.g. 'task_completion_notes', 'goal_description'")
    participant_id: str
    suggestions: List[Suggestion] = Field(min_items=1, max_items=5, description="1-5 ranked suggestions")
    user_message: str = Field(..., description="Explanation of suggestions")


class ParticipantContextResponse(BaseModel):
    """Full participant context for decision support"""
    participant_id: str
    name: str
    recent_goals: List[dict] = Field(description="Last 3-5 goals")
    recent_completions: List[dict] = Field(description="Last 5-10 completions with evidence")
    incident_summary: Optional[str] = Field(description="Recent incidents or patterns")
    support_category: Optional[str] = Field(description="Primary support category")
    compliance_score: float = Field(description="Recent session compliance 0-1")
    health_flags: List[str] = Field(default_factory=list, description="Allergies, medications, risk alerts")


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.post("/suggestions", response_model=SuggestionResponse)
async def get_field_suggestions(
    participant_id: str = Query(..., description="Participant UUID"),
    field_type: str = Query(..., description="task_completion_notes | goal_description | task_name | shift_notes | evidence_notes"),
    current_value: str = Query("", description="Current text (if any) for context"),
    current_user: dict = Depends(get_current_user),
) -> SuggestionResponse:
    """
    Get AI suggestions for a text field based on participant history and context.
    
    **Supported Fields:**
    - `task_completion_notes` - Session completion summary
    - `goal_description` - Goal definition and success criteria
    - `task_name` - Task title
    - `shift_notes` - Pre/post-shift notes
    - `evidence_notes` - Evidence documentation notes
    - `incident_report` - Incident narrative
    
    **Returns:**
    - 1-5 ranked suggestions with confidence scores
    - Supporting context with similarity scores
    - Reasoning for each suggestion
    """
    
    try:
        from ..services.supabase_client import get_supabase_admin
        supabase_client = get_supabase_admin()
        
        # Verify participant access
        await verify_participant_access(participant_id, current_user, supabase_client)
        
        # Get participant context
        participant_context = await get_participant_context(
            participant_id, current_user.organization_id, supabase_client
        )
        
        # Retrieve relevant history using RAG — scoped to this participant
        # only. Access to participant_id was already verified above, but
        # without this filter the retrieval itself was organisation-wide,
        # so the LLM prompt could be seeded with another participant's notes.
        rag_query = build_rag_query(field_type, current_value)
        retrieved_context = await retrieve_similar(
            query=rag_query,
            organisation_id=current_user.organization_id,
            k=5,
            participant_ids=[participant_id],
        )
        
        # Build prompt for AI
        system_prompt = build_suggestion_system_prompt(field_type, participant_context)
        user_prompt = build_suggestion_user_prompt(
            field_type, current_value, retrieved_context, participant_context
        )
        
        # Get suggestions from OpenAI
        client = _get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.7,
            max_tokens=1500
        )
        
        raw_response = response.choices[0].message.content
        raw_suggestions = parse_suggestions_from_response(raw_response)
        
        # Format suggestions with context highlights
        formatted_suggestions = format_suggestions_with_highlights(
            raw_suggestions, retrieved_context
        )
        
        return SuggestionResponse(
            field_type=field_type,
            participant_id=participant_id,
            suggestions=formatted_suggestions[:5],  # Top 5
            user_message=f"Generated {len(formatted_suggestions)} suggestions based on {len(retrieved_context)} similar past events"
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Suggestion generation error: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate suggestions")


@router.get("/context/{participant_id}", response_model=ParticipantContextResponse)
async def get_participant_context_endpoint(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
) -> ParticipantContextResponse:
    """
    Get comprehensive participant context for coordinator decision-making.
    
    Includes:
    - Demographics & support category
    - Recent goals and task completions
    - Incident/risk summary
    - Compliance score
    - Health flags and alerts
    """
    
    try:
        from ..services.supabase_client import get_supabase_admin
        supabase_client = get_supabase_admin()
        
        # Verify access
        await verify_participant_access(participant_id, current_user, supabase_client)
        
        # Retrieve context
        context = await get_participant_context(
            participant_id, current_user.organization_id, supabase_client
        )
        
        return context
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Context retrieval error: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve context")


# ── Helper Functions ──────────────────────────────────────────────────────

async def verify_participant_access(
    participant_id: str, user: dict, supabase_client
) -> None:
    """Verify user has access to participant (org-scoped)"""
    result = supabase_client.table("patients").select(
        "organization_id"
    ).eq("id", participant_id).single().execute()
    
    if not result.data or result.data["organization_id"] != user.get("organization_id"):
        raise ValueError("Access denied to participant")


async def get_participant_context(
    participant_id: str, org_id: str, supabase_client
) -> ParticipantContextResponse:
    """
    Build comprehensive participant context.
    Retrieves: demographics, goals, completions, incidents, health flags.
    """
    
    # Get participant info
    participant = await supabase_client.table("patients").select(
        "id, full_name, ndis_number, disabilities, allergies, chronic_conditions"
    ).eq("id", participant_id).single().execute()
    
    if not participant.data:
        raise ValueError("Participant not found")
    
    # Get recent goals
    goals = await supabase_client.table("ndis_goals").select(
        "id, name, support_category, created_at"
    ).eq(
        "participant_id", participant_id
    ).order(
        "created_at", desc=True
    ).limit(5).execute()
    
    # Get recent completions (from task_completions if M073 applied, else empty)
    completions_result = await supabase_client.table("task_completions").select(
        "id, completion_date, duration_minutes, evidence_type, status, created_at"
    ).eq(
        "participant_id", participant_id
    ).order(
        "completion_date", desc=True
    ).limit(10).execute()
    completions = completions_result.data if completions_result.data else []
    
    # Get recent incidents
    incidents = await supabase_client.table("incidents").select(
        "id, incident_type, created_at, summary"
    ).eq(
        "participant_id", participant_id
    ).order(
        "created_at", desc=True
    ).limit(5).execute()
    
    # Get average compliance score from sessions
    sessions = await supabase_client.table("sessions").select(
        "compliance_score"
    ).eq(
        "participant_id", participant_id
    ).order(
        "session_date", desc=True
    ).limit(20).execute()
    
    avg_compliance = 0.8  # Default
    if sessions.data:
        scores = [s.get("compliance_score", 0.8) for s in sessions.data if s.get("compliance_score")]
        if scores:
            avg_compliance = sum(scores) / len(scores)
    
    # Build health flags
    health_flags = []
    if participant.data.get("allergies"):
        health_flags.append(f"Allergies: {participant.data['allergies']}")
    if participant.data.get("chronic_conditions"):
        health_flags.append(f"Conditions: {participant.data['chronic_conditions']}")
    if incidents.data:
        health_flags.append(f"⚠️ Recent incident: {incidents.data[0].get('incident_type')}")
    
    # Build incident summary
    incident_summary = None
    if incidents.data:
        incident_summary = f"{len(incidents.data)} recent incidents - {incidents.data[0]['incident_type']}"
    
    # Get primary support category from goals
    support_category = None
    if goals.data:
        support_category = goals.data[0].get("support_category")
    
    return ParticipantContextResponse(
        participant_id=participant_id,
        name=participant.data.get("full_name", "Unknown"),
        recent_goals=[
            {
                "id": g["id"],
                "title": g["name"],
                "category": g["support_category"],
                "created_at": g["created_at"]
            }
            for g in goals.data or []
        ],
        recent_completions=[
            {
                "id": c["id"],
                "date": c["completion_date"],
                "duration_minutes": c.get("duration_minutes"),
                "status": c["status"],
                "evidence_type": c.get("evidence_type")
            }
            for c in completions
        ],
        incident_summary=incident_summary,
        support_category=support_category,
        compliance_score=avg_compliance,
        health_flags=health_flags,
    )


def build_rag_query(field_type: str, current_value: str) -> str:
    """Build search query for RAG based on field type"""
    
    query_map = {
        "task_completion_notes": "task completion outcomes and results",
        "goal_description": "goal setting and success criteria",
        "task_name": "task titles and activity names",
        "shift_notes": "shift summaries and observations",
        "evidence_notes": "evidence documentation and observations",
        "incident_report": "incidents and behavioral patterns"
    }
    
    base_query = query_map.get(field_type, "participant activities and outcomes")
    
    if current_value:
        return f"{base_query} similar to: {current_value[:100]}"
    return base_query


def build_suggestion_system_prompt(field_type: str, context: ParticipantContextResponse) -> str:
    """Build system prompt for suggestion generation"""
    
    field_guidance = {
        "task_completion_notes": "Generate concise, professional completion summaries that capture what was accomplished and how the participant responded.",
        "goal_description": "Generate clear, NDIS-aligned goal descriptions with measurable success criteria.",
        "task_name": "Generate descriptive task names that are specific and actionable.",
        "shift_notes": "Generate shift briefing notes that summarize key information for workers.",
        "evidence_notes": "Generate detailed evidence documentation that supports billing and compliance.",
        "incident_report": "Generate objective incident descriptions that support safeguarding.",
    }
    
    guidance = field_guidance.get(field_type, "Generate helpful, professional suggestions.")
    
    return f"""You are CareCliQ AI, a decision support assistant for NDIS service coordinators.

Your role: Analyze participant history and generate field suggestions that are:
- Specific to the participant's goals and support category
- Consistent with their recent activities and patterns  
- Professional and compliant with NDIS requirements
- Grounded in real participant context

Participant Summary:
- Support Category: {context.support_category or 'Unspecified'}
- Recent Goals: {len(context.recent_goals)}
- Recent Completions: {len(context.recent_completions)}
- Health Flags: {', '.join(context.health_flags) if context.health_flags else 'None'}
- Compliance Score: {context.compliance_score:.1%}

Task: {guidance}

Guidelines:
1. Return 3-5 suggestions ranked by relevance
2. Each suggestion should cite specific participant history
3. Suggestions should be immediately usable (not generic)
4. Flag any potential safeguarding concerns
5. Use formal, professional language
"""


def build_suggestion_user_prompt(
    field_type: str,
    current_value: str,
    retrieved_context: List[RetrievalResult],
    participant_context: ParticipantContextResponse,
) -> str:
    """Build user prompt with context for AI"""
    
    context_summary = ""
    if retrieved_context:
        context_summary = "Recent similar events:\n"
        for i, ctx in enumerate(retrieved_context[:3], 1):
            context_summary += f"{i}. [{ctx.content[:150]}...]\n"
    
    return f"""Field Type: {field_type}

Current Value: {current_value if current_value else '(empty)'}

Participant Context:
- Goals: {', '.join(g['title'] for g in participant_context.recent_goals[:3]) if participant_context.recent_goals else 'None'}
- Recent Completions: {len(participant_context.recent_completions)} in last 10 records
- Incidents: {participant_context.incident_summary or 'None'}
- Compliance: {participant_context.compliance_score:.1%}

{context_summary}

Generate 3-5 suggestions for this field. Format your response as a JSON array with objects containing:
- "text": the suggestion text (50-200 words)
- "reasoning": why it's relevant (one sentence)  
- "confidence": confidence score from 0.5 to 0.99

Return ONLY valid JSON array, no other text.
Example format:
[
  {{"text": "...", "reasoning": "...", "confidence": 0.92}},
  {{"text": "...", "reasoning": "...", "confidence": 0.85}}
]
"""


def parse_suggestions_from_response(response_text: str) -> List[dict]:
    """Parse JSON suggestions from LLM response"""
    try:
        # Try to extract JSON array
        response_text = response_text.strip()
        start_idx = response_text.find('[')
        end_idx = response_text.rfind(']') + 1
        
        if start_idx >= 0 and end_idx > start_idx:
            json_str = response_text[start_idx:end_idx]
            suggestions = json.loads(json_str)
            
            # Validate structure
            validated = []
            for sugg in suggestions:
                if isinstance(sugg, dict) and "text" in sugg:
                    validated.append({
                        "text": str(sugg.get("text", ""))[:500],
                        "reasoning": str(sugg.get("reasoning", "Based on participant history"))[:200],
                        "confidence": min(1.0, max(0.5, float(sugg.get("confidence", 0.75))))
                    })
            
            return validated if validated else [{"text": "Unable to generate suggestions", "reasoning": "Error parsing response", "confidence": 0.5}]
    
    except Exception as e:
        logger.error(f"Failed to parse suggestions: {e}")
    
    return [{"text": "Unable to generate suggestions", "reasoning": "Error parsing response", "confidence": 0.5}]


def format_suggestions_with_highlights(
    raw_suggestions: List[dict],
    retrieved_context: List[RetrievalResult]
) -> List[Suggestion]:
    """Format AI suggestions with highlighted context"""
    
    formatted = []
    
    for i, suggestion in enumerate(raw_suggestions):
        # Find matching context highlights
        highlights = []
        for ctx in retrieved_context[:2]:  # Top 2 matches per suggestion
            highlights.append(
                ContextHighlight(
                    source_type="session_note",  # RAG returns session chunks
                    source_date=ctx.session_date.isoformat() if ctx.session_date else "Unknown",
                    source_content=ctx.content[:200],
                    similarity_score=ctx.similarity_score
                )
            )
        
        formatted.append(
            Suggestion(
                text=suggestion.get("text", ""),
                confidence=suggestion.get("confidence", 0.7),
                reasoning=suggestion.get("reasoning", "Based on participant history"),
                highlights=highlights
            )
        )
    
    return formatted
