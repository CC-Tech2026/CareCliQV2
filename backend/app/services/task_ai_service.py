"""AI-powered task and goal suggestion service using RAG + OpenAI."""

import logging
from uuid import UUID
from typing import Optional
from ..services.ai_service import client, _openai_configured
from ..services.rag_service import retrieve_similar_sessions
from ..services.supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)


async def suggest_task_description(
    participant_id: str,
    shift_type: str,
    category: str,
    organisation_id: str,
    lookback_days: int = 30,
) -> Optional[str]:
    """
    Generate AI-powered task description suggestion based on participant history.
    
    Uses RAG to retrieve relevant past tasks/sessions, then calls GPT-4o-mini
    to suggest a task description in NDIS-compliant language.
    
    Args:
        participant_id: Participant UUID
        shift_type: morning/afternoon/night/anytime
        category: personal_care/medication/etc
        organisation_id: Org UUID for isolation
        lookback_days: How far back to look in history
    
    Returns:
        Suggested task description string, or None if no history found
    """
    if not _openai_configured():
        logger.warning("OpenAI not configured, skipping task suggestion")
        return None
    
    try:
        supabase = get_supabase_admin()
        
        # Get participant name and recent task history
        participant = await supabase.table("participants").select("name").eq(
            "id", participant_id
        ).single().execute()
        
        if not participant.data:
            return None
        
        participant_name = participant.data.get("name", "Participant")
        
        # Get recent completed tasks for this participant in same category
        query = f"Tasks completed by {participant_name} for {category.replace('_', ' ')}"
        
        similar_sessions = await retrieve_similar_sessions(
            query_text=query,
            org_id=organisation_id,
            limit=3,
            min_similarity=0.65,
        )
        
        context = ""
        if similar_sessions:
            context = "Past task completions:\n"
            for session in similar_sessions[:3]:
                context += f"- {session.get('content', '')[:200]}\n"
        
        # Build prompt for task suggestion
        prompt = f"""You are an NDIS-compliant care coordinator helping create task templates.

Participant: {participant_name}
Shift type: {shift_type}
Task category: {category.replace('_', ' ')}

{f"Recent context: {context}" if context else "No recent history available."}

Generate a clear, specific task description (1-2 sentences) that:
- Is concrete and measurable where possible
- Uses person-centered language
- Is appropriate for a {shift_type} shift
- Aligns with the {category.replace('_', ' ')} category

Respond with ONLY the task description, no additional text."""
        
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert NDIS care coordinator. Generate concise, measurable task descriptions.",
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=150,
        )
        
        suggestion = response.choices[0].message.content.strip()
        return suggestion if suggestion else None
        
    except Exception as e:
        logger.error(f"Task suggestion generation failed: {e}")
        return None


async def suggest_task_metadata(
    participant_id: str,
    shift_type: str,
    category: str,
    organisation_id: str,
) -> dict:
    """
    Generate AI suggestions for task metadata (priority, evidence requirements).
    
    Args:
        participant_id: Participant UUID
        shift_type: Shift type
        category: Task category
        organisation_id: Org UUID
    
    Returns:
        Dict with suggested priority and evidence_required values
    """
    if not _openai_configured():
        return {
            "priority": "medium",
            "evidence_required": "none",
        }
    
    try:
        supabase = get_supabase_admin()
        
        # Get recent incidents/issues for this participant
        similar_incidents = await retrieve_similar_sessions(
            query_text=f"incidents or concerns for {category}",
            org_id=organisation_id,
            limit=2,
            min_similarity=0.60,
        )
        
        incident_context = ""
        if similar_incidents:
            incident_context = "Recent concerns: " + "; ".join(
                [s.get("content", "")[:100] for s in similar_incidents[:2]]
            )
        
        prompt = f"""Given these parameters:
- Shift: {shift_type}
- Category: {category.replace('_', ' ')}
{f"- Recent context: {incident_context}" if incident_context else ""}

Suggest task metadata as JSON:
{{
  "priority": "low" | "medium" | "high",
  "evidence_required": "none" | "notes" | "photo" | "notes_and_photo"
}}

Base priority on frequency/importance. Base evidence on safety/compliance needs.
Respond ONLY with valid JSON, no other text."""
        
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "user", "content": prompt}
            ],
            temperature=0.5,
            max_tokens=100,
        )
        
        import json
        result_text = response.choices[0].message.content.strip()
        suggestion = json.loads(result_text)
        
        return {
            "priority": suggestion.get("priority", "medium"),
            "evidence_required": suggestion.get("evidence_required", "none"),
        }
        
    except Exception as e:
        logger.error(f"Task metadata suggestion failed: {e}")
        return {
            "priority": "medium",
            "evidence_required": "none",
        }


async def suggest_goal_description(
    participant_id: str,
    goal_title: str,
    organisation_id: str,
) -> Optional[str]:
    """
    Generate AI-powered goal description suggestion.
    
    Uses participant's past goals and progress to suggest relevant
    goal descriptions in NDIS-compliant language.
    
    Args:
        participant_id: Participant UUID
        goal_title: Goal title/name
        organisation_id: Org UUID
    
    Returns:
        Suggested goal description, or None if generation fails
    """
    if not _openai_configured():
        return None
    
    try:
        supabase = get_supabase_admin()
        
        # Get participant info
        participant = await supabase.table("participants").select(
            "name,date_of_birth"
        ).eq("id", participant_id).single().execute()
        
        if not participant.data:
            return None
        
        participant_name = participant.data.get("name", "Participant")
        
        # Retrieve past goals and related sessions
        similar_goals = await retrieve_similar_sessions(
            query_text=f"goals and plans for {goal_title}",
            org_id=organisation_id,
            limit=2,
            min_similarity=0.65,
        )
        
        context = ""
        if similar_goals:
            context = "Related past plans:\n" + "\n".join(
                [f"- {s.get('content', '')[:150]}" for s in similar_goals[:2]]
            )
        
        prompt = f"""Create an NDIS-compliant goal description for:

Participant: {participant_name}
Goal: {goal_title}

{f"Context: {context}" if context else "No prior goals found."}

Generate a 2-3 sentence goal description that:
- Clearly states what will be achieved
- Is measurable where possible
- Is person-centered and strength-based
- Aligns with NDIS language and principles

Respond with ONLY the goal description."""
        
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert NDIS planner. Generate clear, measurable goal descriptions.",
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=200,
        )
        
        suggestion = response.choices[0].message.content.strip()
        return suggestion if suggestion else None
        
    except Exception as e:
        logger.error(f"Goal description suggestion failed: {e}")
        return None
