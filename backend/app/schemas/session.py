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
    # Audit-critical clinical data — merged into ai_insights at service layer
    structured_notes: Optional[Dict[str, str]] = None
    activity_log: Optional[List[Dict[str, str]]] = None
