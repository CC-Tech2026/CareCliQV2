"""Participant Onboarding Board API (MD-only) — Enquiry -> Screening ->
Meet & Greet -> Service Agreement -> Active/Inactive. See
participant_intake_service for the pipeline rules (reason-required
transitions, activation creating a real participant record).
"""

from __future__ import annotations

import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from ..core.access import is_managing_director
from ..core.security import get_current_user
from ..services import participant_intake_service as svc
from ..services.organization_branding_service import get_branding

router = APIRouter(prefix="/participant-intakes", tags=["participant-intake"])


def _require_md(current_user: dict) -> str:
    if not is_managing_director(current_user):
        raise HTTPException(status_code=403, detail="Managing Director access required.")
    org_id = current_user.get("organization_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="Organization membership required.")
    return org_id


# ── Public referral form ─────────────────────────────────────────────────────
# Families and referrers aren't CareCliQ users, so these two routes take no
# auth. The organisation comes from the link the provider shares
# (/participant-referral?org=<id>); a referral lands on that provider's
# Onboarding board as an Enquiry. Previously the form saved referrals to the
# referrer's own browser storage, so they never reached the provider.

_PUBLIC_MAX_REFERRALS = 5
_PUBLIC_WINDOW_SECONDS = 600.0
_public_referrals: dict[str, list[float]] = defaultdict(list)


def _check_referral_rate_limit(ip: str) -> None:
    now = time.monotonic()
    recent = [t for t in _public_referrals[ip] if t > now - _PUBLIC_WINDOW_SECONDS]
    if len(recent) >= _PUBLIC_MAX_REFERRALS:
        _public_referrals[ip] = recent
        raise HTTPException(status_code=429, detail="Too many referrals from this connection. Please try again later.")
    recent.append(now)
    _public_referrals[ip] = recent


def _public_org(org_id: str) -> dict[str, Any]:
    try:
        uuid.UUID(org_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="This referral link isn't valid.")
    try:
        return get_branding(org_id)
    except HTTPException as exc:
        if exc.status_code == 404:
            raise HTTPException(status_code=404, detail="This referral link isn't valid.") from exc
        raise


class PublicReferralBody(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    service_category: Literal["aged_care", "disability"] = "disability"
    date_of_birth: str = Field(min_length=8, max_length=10)
    phone: str = Field(default="", max_length=40)
    email: str = Field(default="", max_length=254)
    ndis_number: str = Field(default="", max_length=20)
    primary_disability: str = Field(default="", max_length=500)
    support_needs: str = Field(default="", max_length=4000)
    service_hours_required: Optional[float] = Field(default=None, ge=0, le=168)
    referrer_name: str = Field(min_length=1, max_length=200)
    referrer_relationship: str = Field(default="", max_length=60)
    referrer_phone: str = Field(default="", max_length=40)
    referrer_email: str = Field(default="", max_length=254)
    # Honeypot: hidden from people, filled in by bots.
    website: str = Field(default="", max_length=200)


@router.get("/public/{org_id}")
async def public_referral_provider(org_id: str):
    """The provider a referral link belongs to, so the form can name them."""
    branding = _public_org(org_id)
    return {"display_name": branding.get("display_name"), "logo_url": branding.get("logo_url")}


@router.post("/public/{org_id}", status_code=201)
async def submit_public_referral(org_id: str, body: PublicReferralBody, request: Request):
    _public_org(org_id)
    _check_referral_rate_limit(request.client.host if request.client else "unknown")
    if body.website.strip():
        # Looks like a bot; answer as if accepted so it doesn't retry.
        return {"received": True}

    referrer = {
        "name": body.referrer_name.strip(),
        "relationship": body.referrer_relationship.strip(),
        "phone": body.referrer_phone.strip(),
        "email": body.referrer_email.strip(),
    }
    notes = [f"Referred by {referrer['name']}" + (f" ({referrer['relationship']})" if referrer["relationship"] else "")]
    contact = " · ".join(v for v in (referrer["phone"], referrer["email"]) if v)
    if contact:
        notes.append(f"Referrer contact: {contact}")
    if body.support_needs.strip():
        notes.append(f"Support needs: {body.support_needs.strip()}")
    web_intake = {
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "submitted_by": referrer["name"],
        "date_of_birth": body.date_of_birth.strip(),
        "referral_source": "online_form",
        "presenting_needs": [body.primary_disability.strip()] if body.primary_disability.strip() else [],
        "notes": "\n".join(notes),
        "referrer": referrer,
    }
    svc.create_intake(
        organization_id=org_id,
        created_by=None,
        full_name=body.full_name,
        ndis_number=body.ndis_number,
        email=body.email,
        phone=body.phone,
        source="online_form",
        service_category=body.service_category,
        service_hours_required=body.service_hours_required,
        web_intake=web_intake,
    )
    # Don't echo the stored record back to an unauthenticated caller.
    return {"received": True}


class IntakeCreateBody(BaseModel):
    full_name: str
    ndis_number: str = ""
    email: str = ""
    phone: str = ""
    source: str = "coordinator_referral"
    service_category: Optional[str] = None
    service_hours_required: Optional[float] = None
    web_intake: dict[str, Any] = {}


@router.get("")
async def list_intakes(current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    return svc.list_intakes(org_id)


@router.post("", status_code=201)
async def create_intake(body: IntakeCreateBody, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    return svc.create_intake(
        organization_id=org_id,
        created_by=current_user.get("sub") or current_user.get("id"),
        full_name=body.full_name,
        ndis_number=body.ndis_number,
        email=body.email,
        phone=body.phone,
        source=body.source,
        service_category=body.service_category,
        service_hours_required=body.service_hours_required,
        web_intake=body.web_intake,
    )


@router.patch("/{intake_id}")
async def update_intake(intake_id: str, body: dict[str, Any], current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    return await svc.update_intake(intake_id, org_id, body, current_user)


@router.post("/{intake_id}/meet-greet/recording", status_code=201)
async def upload_meet_greet_recording(
    intake_id: str,
    session_id: str = Form(...),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_md(current_user)
    raw = await file.read()
    return svc.upload_meet_greet_recording(intake_id, org_id, session_id, raw, file.content_type or "")


@router.post("/{intake_id}/signed-document", status_code=201)
async def upload_signed_document(
    intake_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_md(current_user)
    raw = await file.read()
    return await svc.upload_signed_document(
        intake_id, org_id, file.filename or "service-agreement", raw, file.content_type or "",
    )
