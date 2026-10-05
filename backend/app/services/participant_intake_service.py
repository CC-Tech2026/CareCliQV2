"""Participant Onboarding pipeline (MD-only): Enquiry -> Screening ->
Meet & Greet -> Service Agreement -> Active/Inactive. Mirrors the
Applicants Board (applicant_service.py) — one board/detail record per
pipeline card, with the "active" transition creating a real row in the
existing `participants` table via participant_service.create_participant
rather than duplicating participant fields here.

Date of birth lives inside `web_intake` (jsonb), matching the frontend's
own Intake type — it's validated here rather than enforced as a DB column,
since it's also written by the post-activation profile-edit form.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from ..core.errors import internal_error_detail
from ..schemas.participant import ParticipantCreate
from . import participant_service
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

TABLE = "participant_intakes"
BUCKET = "participant-intake-files"
RECORDINGS_BUCKET = "meeting-recordings"
RECORDING_TYPES = {
    "audio/webm": ".webm", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a",
    "audio/ogg": ".ogg", "audio/mpeg": ".mp3", "audio/wav": ".wav",
}
MAX_RECORDING_BYTES = 25 * 1024 * 1024
RECORDING_URL_EXPIRY_SECONDS = 60 * 60


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

SIGNED_URL_EXPIRY_SECONDS = 7 * 24 * 60 * 60

_PATCHABLE_FIELDS = {
    "full_name", "service_category", "service_hours_required", "ndis_number", "email", "phone",
    "source", "status", "decline_reason", "withdrawn_reason", "board_subtitle", "screening_checks",
    "meet_greet_notes", "plan_start_date", "plan_end_date", "total_budget",
    "suspended_reason", "web_intake",
}
# Who signed is recorded by signing the service agreement itself
# (service_agreement_document_service._intake_signed), never typed in here.


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
    path = row.get("service_agreement_document_path")
    if path:
        try:
            signed = get_supabase_admin().storage.from_(BUCKET).create_signed_url(path, SIGNED_URL_EXPIRY_SECONDS)
            row["service_agreement_document_url"] = (
                signed.get("signedURL") or signed.get("signed_url") or row.get("service_agreement_document_url")
            )
        except Exception:
            pass
    recording = row.get("meet_greet_recording_path")
    if recording:
        # Short-lived: a participant's voice recording shouldn't sit behind a
        # week-long link.
        try:
            signed = get_supabase_admin().storage.from_(RECORDINGS_BUCKET).create_signed_url(
                recording, RECORDING_URL_EXPIRY_SECONDS,
            )
            row["meet_greet_recording_url"] = signed.get("signedURL") or signed.get("signed_url")
        except Exception:
            row["meet_greet_recording_url"] = None
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
    created_by: str | None,
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
    _attach_meeting_sessions(existing["id"], existing["organization_id"], participant["id"])
    # The agreement built and signed during onboarding becomes the
    # participant's service agreement of record, supports and all.
    from .service_agreement_document_service import attach_intake_agreements
    attach_intake_agreements(existing["organization_id"], existing["id"], participant["id"])
    return {"participant_id": participant["id"], "activated_at": _now()}


def _require_signed_agreement(intake: dict[str, Any]) -> None:
    """A participant can't be made active, or the intake marked signed,
    until their service agreement is signed with at least one support."""
    from .service_agreement_document_service import signed_intake_agreement

    if not signed_intake_agreement(intake["organization_id"], intake["id"]):
        first = (intake.get("full_name") or "this participant").split(" ")[0]
        raise HTTPException(
            status_code=409,
            detail=(
                f"Build {first}'s service agreement with the supports they'll receive, and have it signed, "
                "before making them active."
            ),
        )


def _attach_meeting_sessions(intake_id: str, organization_id: str, participant_id: str) -> None:
    """The Meet & Greet was recorded before this person was a participant.
    Now they are one, file it (and the consent given for it) on their record
    so it shows in their plan meetings and counts as consent evidence."""
    try:
        (
            get_supabase_admin().table("plan_meeting_sessions")
            .update({"participant_id": participant_id})
            .eq("intake_id", intake_id)
            .eq("organization_id", organization_id)
            .is_("participant_id", "null")
            .execute()
        )
    except Exception as exc:  # never block activation on this
        logger.warning("Could not attach Meet & Greet sessions for intake %s: %s", intake_id, exc)


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
        if new_status == "signed" and current_status != "awaiting_signatures":
            raise HTTPException(status_code=409, detail="Only an intake awaiting signatures can be signed.")

    merged = {**existing, **patch}
    reason_field = REASON_FIELD_FOR_STATUS.get(new_status) if new_status else None
    if reason_field and not (merged.get(reason_field) or "").strip():
        raise HTTPException(status_code=422, detail=f"{reason_field.replace('_', ' ').capitalize()} is required.")
    # The agreement is drafted from the Meet & Greet summary, so everything
    # said has to be in it, or knowingly left out, before moving on.
    if new_status == "awaiting_signatures" and current_status == "meet_greet":
        from .meet_greet_summary_service import open_lines

        waiting = open_lines(existing)
        if waiting:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"{waiting} thing{'s' if waiting != 1 else ''} said in the Meet & Greet "
                    f"{'aren' if waiting != 1 else 'isn'}'t in the summary. Include or dismiss each one first."
                ),
            )
    # Signing the agreement moves the intake to "signed" by itself; either
    # way, neither step happens without a signed agreement with supports.
    # Reactivating a suspended participant doesn't need a new one.
    if new_status == "signed" or (new_status == "active" and not existing.get("participant_id")):
        _require_signed_agreement(existing)

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


def meet_greet_summary_for_participant(participant_id: str, organization_id: str) -> dict[str, Any] | None:
    """The Meet & Greet summary from the onboarding that made this person a
    participant, if there was one."""
    rows = (
        get_supabase_admin().table(TABLE).select("id, meet_greet_summary")
        .eq("organization_id", organization_id).eq("participant_id", participant_id)
        .not_.is_("meet_greet_summary", "null").order("updated_at", desc=True).limit(1).execute()
    ).data or []
    return rows[0]["meet_greet_summary"] if rows else None


def get_intake_for_session(intake_id: str, organization_id: str) -> dict[str, Any] | None:
    rows = (
        get_supabase_admin().table(TABLE).select("id, full_name, status")
        .eq("id", intake_id).eq("organization_id", organization_id).limit(1).execute()
    ).data or []
    return rows[0] if rows else None


def upload_meet_greet_recording(
    intake_id: str,
    organization_id: str,
    session_id: str,
    file_bytes: bytes,
    content_type: str,
) -> dict[str, Any]:
    """Store the Meet & Greet audio against the intake and its consented
    recording session."""
    get_intake(intake_id, organization_id)
    base_type = (content_type or "").split(";")[0].strip().lower()
    if base_type not in RECORDING_TYPES:
        raise HTTPException(status_code=422, detail="Recording must be an audio file.")
    if not file_bytes:
        raise HTTPException(status_code=422, detail="The recording is empty.")
    if len(file_bytes) > MAX_RECORDING_BYTES:
        raise HTTPException(status_code=413, detail="Recording must be 25MB or smaller.")

    supabase = get_supabase_admin()
    session = (
        supabase.table("plan_meeting_sessions").select("id, intake_id, consent_confirmed_at")
        .eq("id", session_id).eq("organization_id", organization_id).limit(1).execute()
    ).data or []
    # Only a session started for this intake, with consent recorded, can
    # have audio attached — the consent gate is what makes storing it OK.
    if not session or str(session[0].get("intake_id")) != intake_id or not session[0].get("consent_confirmed_at"):
        raise HTTPException(status_code=409, detail="Start the recording from this intake's Meet & Greet first.")

    path = f"{organization_id}/{intake_id}/{uuid4().hex}{RECORDING_TYPES[base_type]}"
    try:
        supabase.storage.from_(RECORDINGS_BUCKET).upload(path, file_bytes, {"content-type": base_type, "upsert": "true"})
    except Exception as exc:
        raise HTTPException(status_code=502, detail=internal_error_detail("Recording storage is not configured", exc))

    supabase.table("plan_meeting_sessions").update({"recording_path": path}).eq("id", session_id).execute()
    result = (
        supabase.table(TABLE)
        .update({
            "meet_greet_recording_path": path,
            "meet_greet_session_id": session_id,
            "meet_greet_recording_url": None,
            "updated_at": _now(),
        })
        .eq("id", intake_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    return _with_fresh_document_url((result.data or [{}])[0])
