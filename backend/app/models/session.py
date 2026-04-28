from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime


class Session(BaseModel):
    id: Optional[str] = None
    participant_id: str
    session_date: date
    duration_minutes: int
    session_type: str
    notes: Optional[str] = None
    transcription: Optional[str] = None
    ai_summary: Optional[str] = None
    ai_insights: Optional[str] = None
    compliance_score: Optional[float] = None
    compliance_notes: Optional[str] = None
    tags: Optional[List[str]] = []
    goals_addressed: Optional[List[str]] = []
    photo_urls: Optional[List[str]] = []
    audio_url: Optional[str] = None
    status: str = "draft"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
