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
import pathlib
from datetime import date, datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from ..core.errors import internal_error_detail
from ..schemas.participant import ParticipantCreate
from . import participant_service
from .html_pdf_render import HtmlPdfRenderError, render_html_to_pdf
from .organization_branding_service import get_letterhead
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
_TEMPLATES_DIR = pathlib.Path(__file__).parent.parent / "templates"

SERVICE_CATEGORY_LABELS = {"aged_care": "Aged Care", "disability": "Disability"}
FUNDING_TYPE_LABELS = {"ndia_managed": "NDIA-managed", "plan_managed": "Plan-managed", "self_managed": "Self-managed"}
SIGNING_REQUIRED_FIELDS = (
    "provider_signed_name", "family_signed_name", "provider_signature_png", "family_signature_png",
)

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
    "meet_greet_notes", "plan_start_date", "plan_end_date", "total_budget",
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
    # The agreement signed on the onboarding board becomes the participant's
    # service agreement of record (not just a PDF left on the intake).
    from .service_agreement_document_service import from_intake
    from_intake({**merged, "id": existing["id"], "organization_id": existing["organization_id"]}, participant["id"])
    return {"participant_id": participant["id"], "activated_at": _now()}


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


def _format_display_date(value: str | None) -> str | None:
    """Renders an ISO date (no time component) as "23 Sep 2026" for display
    on the generated PDF."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).strftime("%d %b %Y")
    except ValueError:
        return value


def _format_display_datetime(value: str | None, tz) -> str | None:
    """Renders an ISO timestamp in the org's own timezone as
    "23 Sep 2026, 2:43 pm" — the raw UTC ISO string (with milliseconds and
    a +00:00 offset) isn't something a participant should have to read on a
    signed document, and showing it in UTC would be the wrong clock anyway
    for an org outside that timezone."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if tz is not None:
            dt = dt.astimezone(tz)
        return dt.strftime("%d %b %Y, %-I:%M %p")
    except ValueError:
        return value


def _render_service_agreement_pdf(intake: dict[str, Any]) -> tuple[str, bytes]:
    from jinja2 import Environment, FileSystemLoader, select_autoescape

    from ..core.timezone import head_office_timezone

    org = get_letterhead(intake["organization_id"])
    tz = head_office_timezone(intake["organization_id"])
    web_intake = intake.get("web_intake") or {}
    context = {
        "org": org,
        "intake": {
            **intake,
            "date_of_birth": _format_display_date(web_intake.get("date_of_birth")),
            "plan_start_date": _format_display_date(intake.get("plan_start_date")),
            "plan_end_date": _format_display_date(intake.get("plan_end_date")),
            "provider_signed_at": _format_display_datetime(intake.get("provider_signed_at"), tz),
            "family_signed_at": _format_display_datetime(intake.get("family_signed_at"), tz),
            "service_category_label": SERVICE_CATEGORY_LABELS.get(intake.get("service_category"), "—"),
            "funding_type_label": FUNDING_TYPE_LABELS.get(web_intake.get("funding_type")),
        },
        "provider_signature_png": intake.get("provider_signature_png"),
        "family_signature_png": intake.get("family_signature_png"),
        "generated_date": datetime.now(timezone.utc).strftime("%d %b %Y"),
    }
    env = Environment(loader=FileSystemLoader(str(_TEMPLATES_DIR)), autoescape=select_autoescape(["html"]))
    template = env.get_template("participant_service_agreement.html")
    html_str = template.render(**context)
    pdf_bytes = render_html_to_pdf(html_str, base_url=str(_TEMPLATES_DIR))

    safe_name = "".join(c for c in intake["full_name"] if c.isalnum() or c in " -_").strip().replace(" ", "_")
    filename = f"service-agreement-{safe_name or intake['id']}.pdf"
    return filename, pdf_bytes


def _generate_and_store_service_agreement(intake: dict[str, Any]) -> dict[str, Any]:
    """Called when a PATCH moves status to "signed" — bakes both typed names
    and drawn signatures into an actual agreement PDF, so an MD no longer has
    to print/sign/scan a paper copy. Overwrites any manually-uploaded document,
    since the e-signature captured here is now the authoritative record."""
    try:
        filename, pdf_bytes = _render_service_agreement_pdf(intake)
    except HtmlPdfRenderError as exc:
        raise HTTPException(status_code=502, detail=internal_error_detail("Could not generate the service agreement", exc))

    supabase = get_supabase_admin()
    path = f"{intake['organization_id']}/{intake['id']}/{uuid4().hex}.pdf"
    try:
        supabase.storage.from_(BUCKET).upload(path, pdf_bytes, {"content-type": "application/pdf", "upsert": "true"})
        signed = supabase.storage.from_(BUCKET).create_signed_url(path, SIGNED_URL_EXPIRY_SECONDS)
        url = signed.get("signedURL") or signed.get("signed_url")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=internal_error_detail("Participant intake storage is not configured", exc))

    return {
        "service_agreement_document_path": path,
        "service_agreement_document_url": url,
        "service_agreement_document_name": filename,
    }


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
    if new_status == "signed":
        missing = [f for f in SIGNING_REQUIRED_FIELDS if not (merged.get(f) or "").strip()]
        if missing:
            raise HTTPException(status_code=422, detail=f"Missing before signing: {', '.join(missing)}.")

    update: dict[str, Any] = dict(patch)
    if new_status == "active":
        update.update(await _activate_side_effects(existing, merged, current_user))
    elif new_status == "inactive":
        update["suspended_at"] = _now()
    elif new_status == "signed":
        update.update(_generate_and_store_service_agreement(merged))

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
        raise HTTPException(status_code=502, detail=internal_error_detail("Participant intake storage is not configured", exc))

    result = (
        supabase.table(TABLE)
        .update({
            "service_agreement_document_path": path,
            "service_agreement_document_url": url,
            "service_agreement_document_name": filename,
            "updated_at": _now(),
        })
        .eq("id", intake_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    return result.data[0] if result.data else {
        "service_agreement_document_path": path,
        "service_agreement_document_url": url,
        "service_agreement_document_name": filename,
    }
