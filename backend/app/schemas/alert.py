from pydantic import BaseModel
from typing import Optional


class AlertCreate(BaseModel):
    participant_id: Optional[str] = None
    session_id: Optional[str] = None
    shift_id: Optional[str] = None
    alert_type: str
    severity: str = "medium"
    title: str
    message: str
    recipient_user_id: Optional[str] = None


class AlertUpdate(BaseModel):
    is_read: Optional[bool] = None
