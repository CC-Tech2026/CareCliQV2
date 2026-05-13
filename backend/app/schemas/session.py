from pydantic import BaseModel
from typing import Optional, List, Dict
from datetime import date


class SessionCreate(BaseModel):
    participant_id: str
    session_date: date
    duration_minutes: int
    session_type: str
    notes: Optional[str] = None
    tags: Optional[List[str]] = []
    goals_addressed: Optional[List[str]] = []
    status: str = "draft"
    activities_performed: Optional[str] = None
    outcomes: Optional[str] = None
    participant_response: Optional[str] = None
    progress_toward_goals: Optional[str] = None


class SessionUpdate(BaseModel):
    session_date: Optional[date] = None
    duration_minutes: Optional[int] = None
    session_type: Optional[str] = None
    notes: Optional[str] = None
    transcription: Optional[str] = None
    tags: Optional[List[str]] = None
    goals_addressed: Optional[List[str]] = None
    photo_urls: Optional[List[str]] = None
    status: Optional[str] = None
    # Structured note fields — persisted as individual DB columns for search/reporting
    activities_performed: Optional[str] = None
    outcomes: Optional[str] = None
    participant_response: Optional[str] = None
    progress_toward_goals: Optional[str] = None
    # Legacy: merged into ai_insights for backward compatibility
    structured_notes: Optional[Dict[str, str]] = None
    activity_log: Optional[List[Dict[str, str]]] = None
    # Physical examination body markers — list of {zone, color, note} dicts
    body_markers: Optional[List[Dict]] = None
    # Restrictive practice detection fields
    restrictive_practice_detected: Optional[bool] = None
    restrictive_practice_types: Optional[List[str]] = None
    compliance_flags: Optional[Dict] = None
    compliance_checked_at: Optional[str] = None
    input_language: Optional[str] = None
    voice_input: Optional[str] = None
    incident_language_detected: Optional[bool] = None
