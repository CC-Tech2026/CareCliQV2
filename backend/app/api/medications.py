"""Medication management v1 — coordinator-authored prescribed medications.

Administration logging and the shift-level checklist are a later build phase (see
Medication Management spec, suggested build order). This router covers steps 1-2 only:
CRUD for what's prescribed, so a coordinator can maintain a participant's medication list.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from ..core.access import get_user_id, get_user_organization_id, has_org_wide_access, is_support_worker
from ..core.security import get_current_user
from ..services import medication_document_service, medication_pattern_service, medication_service

router = APIRouter(tags=["medications"])


def _require_coordinator(current_user: dict) -> str:
    if not has_org_wide_access(current_user):
        raise HTTPException(status_code=403, detail="Support coordinator access required.")
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=403, detail="No organization on account.")
    return str(org_id)


def _require_verifier(current_user: dict) -> str:
    """Verifying/rejecting a medication is open to support coordinators and managing directors."""
    if not has_org_wide_access(current_user):
        raise HTTPException(status_code=403, detail="Support coordinator or managing director access required.")
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
    source_document_id: Optional[str] = None
    status: Optional[str] = None


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


@router.post("/participants/{participant_id}/medications/documents", status_code=201)
async def upload_medication_document(
    participant_id: str,
    file: UploadFile = File(...),
    document_type: str = Form("other"),
    replaces_document_id: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    """Upload a prescription/script/plan (image or PDF). The file is stored immediately;
    extraction then runs against the stored file and returns suggested field values for the
    coordinator to review — extraction is a proposal, nothing becomes an active medication
    from this call alone. Pass replaces_document_id when this upload is a renewed/reissued
    version of a document already on file, to mark the old one as superseded."""
    org_id = _require_coordinator(current_user)
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=422, detail="File is empty.")
    result = await medication_document_service.upload_document(
        participant_id,
        org_id,
        get_user_id(current_user),
        file_bytes=contents,
        filename=file.filename or "document",
        content_type=file.content_type or "",
        document_type=document_type,
    )
    if replaces_document_id:
        medication_document_service.supersede_document(replaces_document_id, result["document"]["id"], org_id)
    return result


@router.get("/participants/{participant_id}/medications/documents")
async def list_participant_medication_documents(
    participant_id: str,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_coordinator(current_user)
    return {"documents": medication_document_service.list_documents_for_participant(participant_id, org_id)}


@router.get("/medications/{medication_id}/documents")
async def list_medication_documents(
    medication_id: str,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_coordinator(current_user)
    return {"documents": medication_document_service.list_documents_for_medication(medication_id, org_id)}


@router.post("/participants/{participant_id}/medications", status_code=201)
async def create_participant_medication(
    participant_id: str,
    body: MedicationCreateBody,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_coordinator(current_user)
    medication = medication_service.create_medication(
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
        source_document_id=body.source_document_id,
        status=body.status,
    )
    if body.source_document_id:
        medication_document_service.link_document_to_medication(body.source_document_id, medication["id"], org_id)
    return medication


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


class MedicationVerifyBody(BaseModel):
    """Corrections the verifier makes while confirming — extraction is a proposal, and
    correcting it here is expected; the corrected values are what get saved as final."""
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
    prn_max_per_day: Optional[int] = None
    is_high_risk: Optional[bool] = None
    high_risk_category: Optional[str] = None
    verification_notes: Optional[str] = None


class MedicationRejectBody(BaseModel):
    reason: str


@router.post("/medications/{medication_id}/verify")
async def verify_medication(
    medication_id: str,
    body: MedicationVerifyBody,
    current_user: dict = Depends(get_current_user),
):
    """The named, timestamped confirmation step — a coordinator or managing director reviews
    the extracted fields against the source document and confirms. Only this unlocks the
    medication for the worker-facing shift checklist."""
    org_id = _require_verifier(current_user)
    corrections = body.model_dump(exclude={"verification_notes"}, exclude_unset=True)
    return medication_service.verify_medication(
        medication_id,
        org_id,
        get_user_id(current_user),
        corrections=corrections,
        verification_notes=body.verification_notes,
    )


@router.post("/medications/{medication_id}/reject")
async def reject_medication(
    medication_id: str,
    body: MedicationRejectBody,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_verifier(current_user)
    return medication_service.reject_medication(medication_id, org_id, get_user_id(current_user), body.reason)


class MedicationCorrectionBody(BaseModel):
    error_subtype: str
    notes: Optional[str] = None


@router.post("/medications/{medication_id}/administrations/{administration_id}/correct", status_code=201)
async def file_medication_correction(
    medication_id: str,
    administration_id: str,
    body: MedicationCorrectionBody,
    current_user: dict = Depends(get_current_user),
):
    """Late-discovery correction — filed by whoever found the error (a coordinator reviewing
    the record, another worker on a later shift), not the administering worker. Never edits
    the original entry: inserts a new row with outcome=administration_error and
    corrects_administration_id pointing at it, exactly like every other correction on this
    ledger. administered_by stays the original worker's — error_discovered_by/at capture who
    found it and when, kept separate from who actually gave the dose."""
    org_id = _require_coordinator(current_user)
    medication = medication_service.get_medication(medication_id, org_id)
    original = medication_service.get_administration(administration_id, org_id)
    if str(original.get("medication_id")) != str(medication_id):
        raise HTTPException(status_code=422, detail="administration_id does not belong to this medication.")
    return medication_service.create_administration(
        medication=medication,
        shift={"id": original.get("shift_id")},
        organization_id=org_id,
        administered_by=original.get("administered_by"),
        action="administration_error",
        scheduled_time=original.get("scheduled_time"),
        administered_time=original.get("administered_time"),
        dose_given=None,
        notes=body.notes,
        error_subtype=body.error_subtype,
        corrects_administration_id=administration_id,
        error_discovered_at=datetime.now(timezone.utc).isoformat(),
        error_discovered_by=get_user_id(current_user),
    )


@router.get("/medications/{medication_id}/status-history")
async def medication_status_history(
    medication_id: str,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_coordinator(current_user)
    return {"history": medication_service.list_status_history(medication_id, org_id)}


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


class MedicationSettingsBody(BaseModel):
    tolerance_minutes: int


@router.get("/coordinator/medications/settings")
async def coordinator_medication_settings(current_user: dict = Depends(get_current_user)):
    """The org-wide on-time tolerance window used to classify given_on_time/given_late/
    given_early — how many minutes either side of the scheduled time still counts as on time."""
    org_id = _require_coordinator(current_user)
    return {"tolerance_minutes": medication_service.get_medication_tolerance_minutes(org_id)}


@router.put("/coordinator/medications/settings")
async def update_coordinator_medication_settings(
    body: MedicationSettingsBody,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_coordinator(current_user)
    minutes = medication_service.set_medication_tolerance_minutes(org_id, body.tolerance_minutes)
    return {"tolerance_minutes": minutes}


@router.get("/medications/{medication_id}/audit-timeline")
async def coordinator_medication_audit_timeline(
    medication_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Everything that has ever happened to this medication — uploaded, verified, activated,
    every administration with its outcome and variance, every status change — in one
    chronological view, so an auditor never has to cross-reference multiple screens."""
    org_id = _require_coordinator(current_user)
    medication = medication_service.get_medication(medication_id, org_id)
    documents = medication_document_service.list_documents_for_medication(medication_id, org_id)
    status_history = medication_service.list_status_history(medication_id, org_id)
    administrations = medication_service.list_administrations_for_medication(medication_id, org_id)

    events: list[dict] = []
    for doc in documents:
        events.append({
            "event_type": "document_uploaded",
            "timestamp": doc["uploaded_at"],
            "document": doc,
        })
    for change in status_history:
        events.append({
            "event_type": "status_change",
            "timestamp": change["changed_at"],
            "status_change": change,
        })
    for admin in administrations:
        events.append({
            "event_type": "administration",
            "timestamp": admin["administered_time"],
            "administration": admin,
        })
    events.sort(key=lambda e: e["timestamp"])

    return {"medication": medication, "documents": documents, "timeline": events}




# ── Pattern detection (build order step 7) ────────────────────────────────────────────────
# Two deliberately separate signals — see medication_pattern_service module docstring.
# participant_reliability is compliance-facing (Compliance Centre, audit-exportable, never
# names a worker). worker_coaching is coaching-facing only and never appears here.


@router.get("/coordinator/medications/pattern-signals")
async def coordinator_participant_reliability_flags(
    participant_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_coordinator(current_user)
    return {"flags": medication_pattern_service.list_participant_reliability_flags(org_id, participant_id)}


@router.post("/coordinator/medications/pattern-signals/run")
async def coordinator_run_pattern_detection(current_user: dict = Depends(get_current_user)):
    """Manual recalculation — the background scheduler also runs this on every pass, this
    is for "recalculate now" rather than waiting for the next tick."""
    org_id = _require_coordinator(current_user)
    participant_count = medication_pattern_service.calculate_participant_reliability_flags(org_id)
    worker_count = medication_pattern_service.calculate_worker_coaching_signals(org_id)
    return {"participant_signals": participant_count, "worker_signals": worker_count}


@router.get("/coordinator/workers/{worker_id}/medication-coaching-signal")
async def coordinator_worker_coaching_signal(
    worker_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Coaching-only view for a coordinator having a 1:1 with this worker — deliberately
    separate from anything Compliance Centre / audit-exportable."""
    org_id = _require_coordinator(current_user)
    return {"signal": medication_pattern_service.get_worker_coaching_signal(org_id, worker_id)}


@router.get("/worker/medication-coaching-signal")
async def worker_own_coaching_signal(current_user: dict = Depends(get_current_user)):
    if not is_support_worker(current_user):
        raise HTTPException(status_code=403, detail="Support worker access required.")
    org_id = get_user_organization_id(current_user)
    return {"signal": medication_pattern_service.get_worker_coaching_signal(org_id, get_user_id(current_user))}
