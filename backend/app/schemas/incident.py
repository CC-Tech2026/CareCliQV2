from pydantic import BaseModel, Field, field_validator
from typing import Optional
from datetime import date, datetime

WORKER_REPORT_TYPES = [
    "safety_hazard",
    "participant_behaviour",
    "equipment_damage",
    "travel_accident",
    "other",
]

BEHAVIOUR_SUBTYPES = ["verbal", "physical", "property"]

WORKER_SEVERITIES = ["low", "medium", "high", "emergency"]

WORKER_REPORT_TYPE_TO_INCIDENT: dict[str, str] = {
    "safety_hazard": "environmental",
    "participant_behaviour": "behaviour_of_concern",
    "equipment_damage": "property_damage",
    "travel_accident": "injury",
    "other": "other",
}

WORKER_STATUS_LABELS: dict[str, str] = {
    "reported": "Under review",
    "under_investigation": "Under review",
    "resolved": "Actioned",
    "closed": "Closed",
}


def map_worker_severity(severity: str) -> str:
    normalized = (severity or "medium").strip().lower()
    if normalized == "emergency":
        return "critical"
    if normalized in INCIDENT_SEVERITIES:
        return normalized
    return "medium"


def worker_status_label(status: str) -> str:
    return WORKER_STATUS_LABELS.get((status or "").strip().lower(), "Under review")

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


LOCATION_TYPES = ["private_home", "supported_accommodation", "provider_premises", "community", "other"]
SUBJECT_TYPES = ["worker", "participant", "other"]
INTERVIEWEE_TYPES = ["worker", "participant", "witness", "other"]


class IncidentPhotoItem(BaseModel):
    data: str
    description: Optional[str] = None
    captured_at: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class WitnessItem(BaseModel):
    name: str
    contact: Optional[str] = None
    relationship: Optional[str] = None


class IncidentCreate(BaseModel):
    participant_id: str
    session_id: Optional[str] = None
    shift_id: Optional[str] = None
    title: str
    description: str
    incident_type: str = "other"
    severity: str = "medium"
    incident_date: datetime
    identified_at: Optional[datetime] = None
    location: Optional[str] = None
    location_type: Optional[str] = None
    witnesses: Optional[str] = None
    witnesses_structured: Optional[list[WitnessItem]] = None
    connection_to_service: Optional[bool] = None
    connection_to_service_reasoning: Optional[str] = None
    participant_impact: Optional[str] = None
    worker_actions: Optional[str] = None
    follow_up_required: bool = False
    follow_up_date: Optional[date] = None
    escalate: bool = False
    photo_urls: Optional[list[str]] = None
    photo_data: Optional[list[str]] = None
    photo_items: Optional[list[IncidentPhotoItem]] = None
    created_by: Optional[str] = None
    worker_report_type: Optional[str] = None
    behaviour_subtype: Optional[str] = None
    participant_present: Optional[bool] = None
    participant_harmed: Optional[str] = None
    # Set only by system-generated incidents (e.g. the medication error/pattern cross-link) —
    # never user-facing input. source_type identifies what kind of record source_id points at.
    source_type: Optional[str] = None
    source_id: Optional[str] = None


class WorkerIncidentCreate(BaseModel):
    """Worker shift incident report (CARECLIQV2-265)."""

    participant_id: Optional[str] = None
    session_id: Optional[str] = None
    shift_id: Optional[str] = None
    worker_report_type: str = "other"
    behaviour_subtype: Optional[str] = None
    severity: str = "medium"
    description: str = Field(min_length=20, max_length=2000)
    incident_date: datetime
    location: Optional[str] = None
    participant_present: Optional[bool] = None
    participant_harmed: Optional[str] = None
    worker_actions: Optional[str] = None
    photo_items: Optional[list[IncidentPhotoItem]] = None

    @field_validator("worker_report_type")
    @classmethod
    def validate_worker_report_type(cls, value: str) -> str:
        normalized = (value or "").strip().lower()
        if normalized not in WORKER_REPORT_TYPES:
            raise ValueError(f"worker_report_type must be one of: {', '.join(WORKER_REPORT_TYPES)}")
        return normalized

    @field_validator("behaviour_subtype")
    @classmethod
    def validate_behaviour_subtype(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip().lower()
        if normalized not in BEHAVIOUR_SUBTYPES:
            raise ValueError(f"behaviour_subtype must be one of: {', '.join(BEHAVIOUR_SUBTYPES)}")
        return normalized

    @field_validator("severity")
    @classmethod
    def validate_worker_severity(cls, value: str) -> str:
        normalized = (value or "medium").strip().lower()
        if normalized not in WORKER_SEVERITIES:
            raise ValueError(f"severity must be one of: {', '.join(WORKER_SEVERITIES)}")
        return normalized

    @field_validator("participant_harmed")
    @classmethod
    def validate_participant_harmed(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip().lower()
        if normalized not in ("yes", "no", "unknown"):
            raise ValueError("participant_harmed must be yes, no, or unknown")
        return normalized


class IncidentCorrectionCreate(BaseModel):
    note: str = Field(min_length=1, max_length=2000)


class IncidentUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    incident_type: Optional[str] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    incident_date: Optional[datetime] = None
    resolved_date: Optional[datetime] = None
    identified_at: Optional[datetime] = None
    location: Optional[str] = None
    location_type: Optional[str] = None
    witnesses: Optional[str] = None
    witnesses_structured: Optional[list[WitnessItem]] = None
    connection_to_service: Optional[bool] = None
    connection_to_service_reasoning: Optional[str] = None
    participant_impact: Optional[str] = None
    worker_actions: Optional[str] = None
    investigation_notes: Optional[str] = None
    corrective_actions: Optional[str] = None
    follow_up_required: Optional[bool] = None
    follow_up_date: Optional[date] = None
    ndis_reported_at: Optional[datetime] = None
    ndis_notification_content: Optional[str] = None
    escalate: Optional[bool] = None


class SubjectOfAllegationCreate(BaseModel):
    subject_type: str
    subject_user_id: Optional[str] = None
    subject_name: Optional[str] = None
    subject_role: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("subject_type")
    @classmethod
    def validate_subject_type(cls, value: str) -> str:
        normalized = (value or "").strip().lower()
        if normalized not in SUBJECT_TYPES:
            raise ValueError(f"subject_type must be one of: {', '.join(SUBJECT_TYPES)}")
        return normalized


class AssignInvestigatorBody(BaseModel):
    investigator_user_id: str


class InterviewCreate(BaseModel):
    interviewee_name: str = Field(min_length=1, max_length=200)
    interviewee_type: str
    interviewee_user_id: Optional[str] = None
    interviewed_at: Optional[datetime] = None
    notes: Optional[str] = None

    @field_validator("interviewee_type")
    @classmethod
    def validate_interviewee_type(cls, value: str) -> str:
        normalized = (value or "").strip().lower()
        if normalized not in INTERVIEWEE_TYPES:
            raise ValueError(f"interviewee_type must be one of: {', '.join(INTERVIEWEE_TYPES)}")
        return normalized


class ReportableOverrideBody(BaseModel):
    """Coordinator correction to the auto-classified reportability. Requires a reason, and
    (per the spec) is retained permanently once set — see incident_service.py for the
    one-time-only enforcement."""
    is_reportable: bool
    reason: str = Field(min_length=1, max_length=2000)
