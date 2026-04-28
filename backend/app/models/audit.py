from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class AuditLog(BaseModel):
    id: Optional[str] = None
    user_id: Optional[str] = None
    action: str
    resource_type: str
    resource_id: Optional[str] = None
    details: Optional[dict] = None
    ip_address: Optional[str] = None
    created_at: Optional[datetime] = None
