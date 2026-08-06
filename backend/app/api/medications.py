"""Medication management v1 — coordinator-authored prescribed medications.

Administration logging and the shift-level checklist are a later build phase (see
Medication Management spec, suggested build order). This router covers steps 1-2 only:
CRUD for what's prescribed, so a coordinator can maintain a participant's medication list.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..core.access import get_user_id, get_user_organization_id, is_coordinator_role
from ..core.security import get_current_user
from ..services import medication_extraction_service, medication_service

router = APIRouter(tags=["medications"])


def _require_coordinator(current_user: dict) -> str:
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=403, detail="Support coordinator access required.")
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=403, detail="No organization on account.")
    return str(org_id)


class MedicationCreateBody(BaseModel):
    name: str
    strength: Optional[str] = None
    route: str = "oral"
    dosage: Optional[str] = None
    frequency_type: str = "scheduled"
    scheduled_times: Optional[list[str]] = None
    prescriber_name: Optional[str] = None
    prescriber_contact: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    is_prn: bool = False
    prn_max_per_day: Optional[int] = None


class MedicationUpdateBody(BaseModel):
    name: Optional[str] = None
    strength: Optional[str] = None
    route: Optional[str] = None
    dosage: Optional[str] = None
    frequency_type: Optional[str] = None
    scheduled_times: Optional[list[str]] = None
    prescriber_name: Optional[str] = None
    prescriber_contact: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    is_prn: Optional[bool] = None
    prn_max_per_day: Optional[int] = None
    status: Optional[str] = None


@router.get("/participants/{participant_id}/medications")
async def list_participant_medications(
    participant_id: str,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_coordinator(current_user)
    return {"medications": medication_service.list_medications(participant_id, org_id, status)}


@router.post("/participants/{participant_id}/medications/extract")
async def extract_medication_document(
    participant_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Upload a prescription/script (image or PDF) and get back suggested medication field
    values for the coordinator to review — nothing is saved here, this only pre-fills the form."""
    _require_coordinator(current_user)
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=422, detail="File is empty.")
    return await medication_extraction_service.extract_medication_fields(contents, file.content_type or "")


@router.post("/participants/{participant_id}/medications", status_code=201)
async def create_participant_medication(
    participant_id: str,
    body: MedicationCreateBody,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_coordinator(current_user)
    return medication_service.create_medication(
        participant_id,
        org_id,
        get_user_id(current_user),
        name=body.name,
        strength=body.strength,
        route=body.route,
        dosage=body.dosage,
        frequency_type=body.frequency_type,
        scheduled_times=body.scheduled_times,
        prescriber_name=body.prescriber_name,
        prescriber_contact=body.prescriber_contact,
        start_date=body.start_date,
        end_date=body.end_date,
        is_prn=body.is_prn,
        prn_max_per_day=body.prn_max_per_day,
    )


@router.patch("/medications/{medication_id}")
async def update_medication(
    medication_id: str,
    body: MedicationUpdateBody,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_coordinator(current_user)
    return medication_service.update_medication(
        medication_id,
        org_id,
        get_user_id(current_user),
        body.model_dump(exclude_unset=True),
    )


# ── Compliance Centre Medication Register (coordinator) ──────────────────────────────────────


@router.get("/coordinator/medications")
async def coordinator_list_medications(
    participant_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_coordinator(current_user)
    return {"medications": medication_service.list_org_medications(org_id, participant_id)}


@router.get("/coordinator/medications/review-items")
async def coordinator_medication_review_items(current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    return medication_service.list_medication_review_items(org_id)


@router.get("/medications/{medication_id}/history")
async def coordinator_medication_history(
    medication_id: str,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_coordinator(current_user)
    medication = medication_service.get_medication(medication_id, org_id)
    history = medication_service.list_administrations_for_medication(medication_id, org_id)
    return {"medication": medication, "history": history}
