from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, field_validator

MAX_SCENARIOS = 8
MAX_DEESCALATION_TECHNIQUES = 10
MAX_STEPS_PER_TECHNIQUE = 5
MAX_PHYSICAL_NOTES = 20

ESCALATION_ROLES = ("coordinator", "on_call", "emergency")


class SafetyScenarioItem(BaseModel):
    trigger: str = Field(min_length=1, max_length=500)
    response: str = Field(min_length=1, max_length=2000)
    sort_order: int = 0


class DeescalationTechniqueItem(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    steps: list[str] = Field(min_length=1, max_length=MAX_STEPS_PER_TECHNIQUE)
    sort_order: int = 0

    @field_validator("steps")
    @classmethod
    def validate_steps(cls, steps: list[str]) -> list[str]:
        cleaned = [s.strip() for s in steps if s and s.strip()]
        if not cleaned:
            raise ValueError("At least one de-escalation step is required.")
        if len(cleaned) > MAX_STEPS_PER_TECHNIQUE:
            raise ValueError(f"Maximum {MAX_STEPS_PER_TECHNIQUE} steps per technique.")
        return cleaned


class PhysicalSafetyNoteItem(BaseModel):
    note: str = Field(min_length=1, max_length=500)
    sort_order: int = 0


class EscalationContactItem(BaseModel):
    role: str
    label: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=1, max_length=40)
    sort_order: int = 0

    @field_validator("role")
    @classmethod
    def validate_role(cls, role: str) -> str:
        normalized = (role or "").strip().lower()
        if normalized not in ESCALATION_ROLES:
            raise ValueError(f"role must be one of: {', '.join(ESCALATION_ROLES)}")
        return normalized


class SafetyProtocolUpdate(BaseModel):
    safety_card_body: Optional[str] = None
    scenarios: Optional[list[SafetyScenarioItem]] = None
    deescalation_techniques: Optional[list[DeescalationTechniqueItem]] = None
    physical_safety_notes: Optional[list[PhysicalSafetyNoteItem]] = None
    escalation_contacts: Optional[list[EscalationContactItem]] = None

    @field_validator("scenarios")
    @classmethod
    def validate_scenarios(cls, scenarios: Optional[list[SafetyScenarioItem]]) -> Optional[list[SafetyScenarioItem]]:
        if scenarios is not None and len(scenarios) > MAX_SCENARIOS:
            raise ValueError(f"Maximum {MAX_SCENARIOS} scenario cards per participant.")
        return scenarios


class SafetyProtocolAcknowledge(BaseModel):
    content_version: int = Field(ge=1)
    org_content_version: Optional[int] = Field(default=None, ge=1)
    shift_id: Optional[str] = None


class OrgAcknowledgementContentUpdate(BaseModel):
    body: str = Field(min_length=1, max_length=8000)
