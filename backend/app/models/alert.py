from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class Alert(BaseModel):
    id: Optional[str] = None
    participant_id: Optional[str] = None
    session_id: Optional[str] = None
    alert_type: str
    severity: str = "medium"
    title: str
    message: str
    is_read: bool = False
    created_at: Optional[datetime] = None
