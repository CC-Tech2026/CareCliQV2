"""Participant Onboarding pipeline (MD-only): Enquiry -> Screening ->
Meet & Greet -> Service Agreement -> Active/Inactive. Mirrors the
Applicants Board (applicant_service.py) — one board/detail record per
pipeline card, with the "active" transition creating a real row in the
existing `patients` table via participant_service.create_participant
rather than duplicating participant fields here.

Date of birth lives inside `web_intake` (jsonb), matching the frontend's
own Intake type — it's validated here rather than enforced as a DB column,
since it's also written by the post-activation profile-edit form.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from ..schemas.participant import ParticipantCreate
from . import participant_service
from .supabase_client import get_supabase_admin

TABLE = "participant_intakes"
BUCKET = "participant-intake-files"

STATUSES = (
    "enquiry", "screening", "declined", "withdrawn", "meet_greet",
    "awaiting_signatures", "signed", "active", "inactive",
)
TERMINAL_STATUSES = {"declined", "withdrawn"}
REASON_FIELD_FOR_STATUS = {
    "declined": "decline_reason",
    "withdrawn": "withdrawn_reason",
    "inactive": "suspended_reason",
}

ALLOWED_FILE_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
}
MAX_FILE_BYTES = 20 * 1024 * 1024
SIGNED_URL_EXPIRY_SECONDS = 7 * 24 * 60 * 60

_PATCHABLE_FIELDS = {
    "full_name", "service_category", "service_hours_required", "ndis_number", "email", "phone",
    "source", "status", "decline_reason", "withdrawn_reason", "board_subtitle", "screening_checks",
    "meet_greet_recording_url", "meet_greet_notes", "plan_start_date", "plan_end_date", "total_budget",
    "provider_signed_name", "provider_signed_at", "family_signed_name", "family_signed_at",
    "provider_signature_png", "family_signature_png",
    "suspended_reason", "web_intake",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_missing_schema(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg


def _calculate_age(dob_str: str) -> int | None:
    try:
        birth = date.fromisoformat(dob_str)
    except (ValueError, TypeError):
        return None
    today = date.today()
    age = today.year - birth.year
    if (today.month, today.day) < (birth.month, birth.day):
        age -= 1
    return age


def _validate_dob(web_intake: dict | None, service_category: str | None) -> str:
    dob = (web_intake or {}).get("date_of_birth")
    if not dob:
        raise HTTPException(status_code=422, detail="Date of birth is required.")
    age = _calculate_age(dob)
    if age is None:
        raise HTTPException(status_code=422, detail="Date of birth is invalid.")
    if service_category == "aged_care" and age < 65:
        raise HTTPException(
            status_code=422,
            detail="Aged Care requires a date of birth confirming the participant is 65 or over.",
        )
    return dob


def _with_fresh_document_url(row: dict[str, Any]) -> dict[str, Any]:
    path = row.get("signed_document_path")
    if not path:
        return row
    try:
        signed = get_supabase_admin().storage.from_(BUCKET).create_signed_url(path, SIGNED_URL_EXPIRY_SECONDS)
        row["signed_document_url"] = signed.get("signedURL") or signed.get("signed_url") or row.get("signed_document_url")
    except Exception:
        pass
    return row


def list_intakes(organization_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table(TABLE)
            .select("*")
            .eq("organization_id", organization_id)
            .order("created_at", desc=True)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise
    return [_with_fresh_document_url(r) for r in rows]


def get_intake(intake_id: str, organization_id: str) -> dict[str, Any]:
    resp = (
        get_supabase_admin()
        .table(TABLE)
        .select("*")
        .eq("id", intake_id)
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Participant intake not found.")
    return _with_fresh_document_url(resp.data[0])


def create_intake(
    organization_id: str,
    created_by: str,
    full_name: str,
    ndis_number: str,
    email: str,
    phone: str,
    source: str,
    service_category: str | None,
    service_hours_required: float | None,
    web_intake: dict[str, Any],
) -> dict[str, Any]:
    if not full_name.strip():
        raise HTTPException(status_code=422, detail="Full name is required.")
    if source not in ("online_form", "email", "phone_call", "coordinator_referral"):
        raise HTTPException(status_code=422, detail="Invalid enquiry source.")
    if service_category is not None and service_category not in ("aged_care", "disability"):
        raise HTTPException(status_code=422, detail="Invalid service category.")
    _validate_dob(web_intake, service_category)

    payload = {
        "id": str(uuid4()),
        "organization_id": organization_id,
        "created_by": created_by,
        "full_name": full_name.strip(),
        "ndis_number": ndis_number.strip(),
        "email": email.strip(),
        "phone": phone.strip(),
        "source": source,
        "service_category": service_category,
        "service_hours_required": service_hours_required,
        "status": "enquiry",
        "web_intake": web_intake,
    }
    result = get_supabase_admin().table(TABLE).insert(payload).execute()
    return result.data[0] if result.data else payload


def _parse_budget(total_budget: str | None) -> float | None:
    if not total_budget:
        return None
    digits = "".join(ch for ch in total_budget if ch.isdigit() or ch == ".")
    try:
        return float(digits) if digits else None
    except ValueError:
        return None


async def _activate_side_effects(existing: dict[str, Any], merged: dict[str, Any], current_user: dict) -> dict[str, Any]:
    """Called when a PATCH moves status to "active". First-time activation
    (no participant_id yet) creates the real participant record; reactivating
    a suspended participant just resumes service — the record already exists."""
    if existing.get("participant_id"):
        return {"reactivated_at": _now()}

    web_intake = merged.get("web_intake") or {}
    dob = _validate_dob(web_intake, merged.get("service_category"))

    create_body = ParticipantCreate(
        full_name=merged["full_name"],
        ndis_number=merged.get("ndis_number") or "",
        date_of_birth=dob,
        email=merged.get("email") or None,
        phone=merged.get("phone") or None,
        plan_start_date=merged.get("plan_start_date"),
        plan_end_date=merged.get("plan_end_date"),
        total_budget=_parse_budget(merged.get("total_budget")),
        service_category=merged.get("service_category"),
    )
    try:
        participant = await participant_service.create_participant(create_body, current_user)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    if not participant:
        raise HTTPException(status_code=502, detail="Could not create the participant record.")
    return {"participant_id": participant["id"], "activated_at": _now()}


async def update_intake(
    intake_id: str,
    organization_id: str,
    patch: dict[str, Any],
    current_user: dict,
) -> dict[str, Any]:
    existing = get_intake(intake_id, organization_id)
    patch = {k: v for k, v in patch.items() if k in _PATCHABLE_FIELDS}

    current_status = existing["status"]
    new_status = patch.get("status")
    if new_status is not None:
        if new_status not in STATUSES:
            raise HTTPException(status_code=422, detail="Invalid status.")
        if current_status in TERMINAL_STATUSES and new_status != current_status:
            raise HTTPException(status_code=409, detail=f"This intake is already {current_status} and can't be moved further.")
        if new_status == "active" and current_status not in ("signed", "inactive"):
            raise HTTPException(status_code=409, detail="Only a signed or suspended intake can be made active.")
        if new_status == "inactive" and current_status != "active":
            raise HTTPException(status_code=409, detail="Only an active participant can be suspended.")

    merged = {**existing, **patch}
    reason_field = REASON_FIELD_FOR_STATUS.get(new_status) if new_status else None
    if reason_field and not (merged.get(reason_field) or "").strip():
        raise HTTPException(status_code=422, detail=f"{reason_field.replace('_', ' ').capitalize()} is required.")

    update: dict[str, Any] = dict(patch)
    if new_status == "active":
        update.update(await _activate_side_effects(existing, merged, current_user))
    elif new_status == "inactive":
        update["suspended_at"] = _now()

    update["updated_at"] = _now()
    resp = (
        get_supabase_admin()
        .table(TABLE)
        .update(update)
        .eq("id", intake_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    return _with_fresh_document_url((resp.data or [{**existing, **update}])[0])


async def upload_signed_document(
    intake_id: str,
    organization_id: str,
    filename: str,
    file_bytes: bytes,
    content_type: str,
) -> dict[str, Any]:
    get_intake(intake_id, organization_id)
    if content_type not in ALLOWED_FILE_TYPES:
        raise HTTPException(status_code=422, detail="Document file must be PDF or image (JPEG/PNG).")
    if len(file_bytes) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="Document file must be 20MB or smaller.")

    supabase = get_supabase_admin()
    ext = ALLOWED_FILE_TYPES[content_type]
    path = f"{organization_id}/{intake_id}/{uuid4().hex}{ext}"
    try:
        supabase.storage.from_(BUCKET).upload(path, file_bytes, {"content-type": content_type, "upsert": "true"})
        signed = supabase.storage.from_(BUCKET).create_signed_url(path, SIGNED_URL_EXPIRY_SECONDS)
        url = signed.get("signedURL") or signed.get("signed_url")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Participant intake storage is not configured: {exc}")

    result = (
        supabase.table(TABLE)
        .update({
            "signed_document_path": path,
            "signed_document_url": url,
            "signed_document_name": filename,
            "updated_at": _now(),
        })
        .eq("id", intake_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    return result.data[0] if result.data else {
        "signed_document_path": path, "signed_document_url": url, "signed_document_name": filename,
    }
