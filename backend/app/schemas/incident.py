from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime

INCIDENT_TYPES = [
    "injury",
    "medication_error",
    "behaviour_of_concern",
    "property_damage",
    "abuse_neglect",
    "restrictive_practice",
    "environmental",
    "elopement",
    "near_miss",
    "other",
]

INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"]
INCIDENT_STATUSES = ["reported", "under_investigation", "resolved", "closed"]

# These types are automatically NDIS reportable
NDIS_REPORTABLE_TYPES = {"abuse_neglect", "restrictive_practice"}
NDIS_REPORTABLE_SEVERITIES = {"critical"}

# NDIS Practice Standard each incident type relates to
PRACTICE_STANDARD_MAP: dict[str, str] = {
    "injury":                "Standard 3.1 — Safe environment",
    "medication_error":      "Standard 2.4 — Medication management",
    "behaviour_of_concern":  "Standard 4.2 — Behaviour support",
    "property_damage":       "Standard 3.1 — Safe environment",
    "abuse_neglect":         "Standard 1.3 — Participant rights",
    "restrictive_practice":  "Standard 4.2 — Behaviour support",
    "environmental":         "Standard 3.1 — Safe environment",
    "elopement":             "Standard 2.1 — Risk management",
    "near_miss":             "Standard 2.1 — Risk management",
    "other":                 "Standard 2.3 — Incident management",
}

# Notification timeframe in hours (NDIS QSC requirements)
NDIS_NOTIFICATION_HOURS: dict[str, int] = {
    "critical": 24,
    "high": 120,       # 5 business days
    "medium": 240,
    "low": 480,
}


def is_ndis_reportable(incident_type: str, severity: str) -> bool:
    return incident_type in NDIS_REPORTABLE_TYPES or severity in NDIS_REPORTABLE_SEVERITIES


class IncidentCreate(BaseModel):
    participant_id: Optional[str] = None
    session_id: Optional[str] = None
    shift_id: Optional[str] = None
    title: str
    description: str
    incident_type: str = "other"
    severity: str = "medium"
    incident_date: datetime
    location: Optional[str] = None
    witnesses: Optional[str] = None
    participant_impact: Optional[str] = None
    worker_actions: Optional[str] = None
    follow_up_required: bool = False
    follow_up_date: Optional[date] = None
    escalate: bool = False
    photo_urls: Optional[list[str]] = None
    photo_data: Optional[list[str]] = None
    created_by: Optional[str] = None


class IncidentUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    incident_type: Optional[str] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    incident_date: Optional[datetime] = None
    resolved_date: Optional[datetime] = None
    location: Optional[str] = None
    witnesses: Optional[str] = None
    participant_impact: Optional[str] = None
    worker_actions: Optional[str] = None
    investigation_notes: Optional[str] = None
    corrective_actions: Optional[str] = None
    follow_up_required: Optional[bool] = None
    follow_up_date: Optional[date] = None
    ndis_reported_at: Optional[datetime] = None
