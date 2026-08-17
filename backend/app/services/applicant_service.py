"""Applicants Board — the front half of hiring (Applied -> Interview ->
Offer extended -> Hired / Rejected), feeding into the existing
employee_onboarding flow at the Offer extended stage rather than
duplicating its documents/signature UI.

Stage transitions are split by role at the service layer (also enforced in
the API layer, not just hidden client-side): coordinators can triage
Applied/Interview, but moving a card to Offer extended or Rejected is
MD-only, since Offer extended creates the real MD-gated hire record. Moving
to Hired isn't a transition this service exposes at all — it's a side
effect of the candidate signing (see employee_onboarding_service.sign_as_worker
-> _mark_applicant_hired), matching "the applicant actually signing it is
what creates the real worker record and moves the card to Hired
automatically."
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from . import employee_onboarding_service
from .supabase_client import get_supabase_admin

STAGES = ("applied", "interview", "offer_extended", "hired", "rejected")

# Transitions a coordinator (not just MD) may make.
COORDINATOR_ALLOWED_TRANSITIONS = {
    ("applied", "interview"),
    ("interview", "applied"),
}


def _is_missing_schema(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def list_applicants(organization_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("applicants")
            .select("*")
            .eq("organization_id", organization_id)
            .order("created_at", desc=True)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


def get_applicant(applicant_id: str, organization_id: str) -> dict[str, Any]:
    resp = (
        get_supabase_admin()
        .table("applicants")
        .select("*")
        .eq("id", applicant_id)
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Applicant not found.")
    return resp.data[0]


def get_applicant_by_onboarding_id(onboarding_id: str, organization_id: str) -> dict[str, Any] | None:
    """Looks up the applicant a hire record originated from — used to surface their
    resume-extracted profile and intake documents (resume/cover letter/ID) on the
    Hire detail view, which otherwise only shows offer-stage paperwork."""
    try:
        resp = (
            get_supabase_admin()
            .table("applicants")
            .select("id, resume_summary, resume_skills, resume_experience_years")
            .eq("employee_onboarding_id", onboarding_id)
            .eq("organization_id", organization_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_schema(exc):
            return None
        raise
    return resp.data[0] if resp.data else None


def update_applicant_notes(applicant_id: str, organization_id: str, notes: str) -> dict[str, Any]:
    get_applicant(applicant_id, organization_id)
    resp = (
        get_supabase_admin()
        .table("applicants")
        .update({"notes": notes.strip() or None, "updated_at": _now()})
        .eq("id", applicant_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    return (resp.data or [{}])[0]


def create_applicant(
    organization_id: str,
    created_by: str,
    full_name: str,
    email: str,
    phone: str | None,
    role: str,
) -> dict[str, Any]:
    if role not in {"support_worker", "support_coordinator"}:
        raise HTTPException(status_code=422, detail="Invalid role.")
    if not full_name.strip() or not email.strip():
        raise HTTPException(status_code=422, detail="Full name and email are required.")
    payload = {
        "id": str(uuid4()),
        "organization_id": organization_id,
        "created_by": created_by,
        "full_name": full_name.strip(),
        "email": email.strip().lower(),
        "phone": (phone or "").strip() or None,
        "role": role,
        "stage": "applied",
        "stage_entered_at": _now(),
    }
    result = get_supabase_admin().table("applicants").insert(payload).execute()
    return result.data[0] if result.data else payload


def move_applicant_stage(
    applicant_id: str,
    organization_id: str,
    new_stage: str,
    actor_user_id: str,
    actor_is_hire_manager: bool,
    rejected_reason: str | None = None,
) -> dict[str, Any]:
    if new_stage not in STAGES:
        raise HTTPException(status_code=422, detail="Invalid stage.")
    if new_stage == "hired":
        raise HTTPException(
            status_code=409,
            detail="Hired is not a manual transition — it happens automatically when the candidate signs their offer.",
        )

    applicant = get_applicant(applicant_id, organization_id)
    current_stage = applicant["stage"]
    if current_stage in {"hired", "rejected"}:
        raise HTTPException(status_code=409, detail=f"This applicant is already {current_stage} and can't be moved further.")

    transition = (current_stage, new_stage)
    is_coordinator_allowed = transition in COORDINATOR_ALLOWED_TRANSITIONS
    if not actor_is_hire_manager and not is_coordinator_allowed:
        raise HTTPException(
            status_code=403,
            detail="Only a managing director can move an applicant to Offer extended or Rejected.",
        )

    update: dict[str, Any] = {
        "stage": new_stage,
        "stage_entered_at": _now(),
        "stage_reminder_sent_at": None,
        "updated_at": _now(),
    }
    if new_stage == "rejected":
        update["rejected_reason"] = (rejected_reason or "").strip() or None

    if new_stage == "offer_extended":
        # The key integration point: this creates the real hire record via
        # the existing employee_onboarding flow rather than a parallel one.
        # It does NOT send for signature yet — that still requires
        # documents to be attached first, via the existing HireDetail UI,
        # matching the existing hire flow's own sequencing.
        hire = employee_onboarding_service.create_hire(
            organization_id=organization_id,
            created_by=actor_user_id,
            full_name=applicant["full_name"],
            email=applicant["email"],
            phone=applicant.get("phone"),
            role=applicant["role"],
        )
        update["employee_onboarding_id"] = hire["id"]

    resp = (
        get_supabase_admin()
        .table("applicants")
        .update(update)
        .eq("id", applicant_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    return (resp.data or [{**applicant, **update}])[0]


def mark_applicant_hired_by_onboarding_id(employee_onboarding_id: str) -> None:
    """Called from employee_onboarding_service.sign_as_worker() — the
    signature itself is what moves the card to Hired, not a coordinator
    action. Silently no-ops if this hire didn't originate from the board
    (an MD-created hire with no applicant record)."""
    try:
        get_supabase_admin().table("applicants").update({
            "stage": "hired",
            "stage_entered_at": _now(),
            "updated_at": _now(),
        }).eq("employee_onboarding_id", employee_onboarding_id).eq("stage", "offer_extended").execute()
    except Exception as exc:
        if not _is_missing_schema(exc):
            raise
