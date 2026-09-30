"""Participants Portal access management.

MD-only: granting access, sending/resending invites, revoking, and recording
a "not using portal" decision. Support coordinators can view a participant's
portal access (to answer questions) but not change it.

The /invites/{token} endpoints are public — they're what the emailed invite
link drives: confirm identity, then set a password. See
participant_portal_access_service for the rules.
"""

from __future__ import annotations

import time
from collections import defaultdict
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from ..core.access import get_user_id, get_user_organization_id, is_coordinator_role, is_managing_director
from ..core.security import get_current_user
from ..services import participant_portal_access_service as svc

router = APIRouter(prefix="/participant-portal-access", tags=["participant-portal-access"])

# Per-IP limit on the public invite endpoints, on top of the per-invite
# 5-attempt lockout — same pattern as invitations.py's lookup limiter.
_invite_attempts: dict[str, list[float]] = defaultdict(list)
_INVITE_RATE_LIMIT_MAX = 20
_INVITE_RATE_LIMIT_WINDOW = 60.0


def _check_invite_rate_limit(ip: str) -> None:
    now = time.monotonic()
    attempts = [t for t in _invite_attempts[ip] if t > now - _INVITE_RATE_LIMIT_WINDOW]
    _invite_attempts[ip] = attempts
    if len(attempts) >= _INVITE_RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts — please wait a minute and try again.",
        )
    _invite_attempts[ip].append(now)


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _require_md(current_user: dict) -> tuple[str, str]:
    if not is_managing_director(current_user):
        raise HTTPException(status_code=403, detail="Only the Managing Director can manage portal access.")
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=403, detail="Organization membership required.")
    return org_id, get_user_id(current_user)


def _require_viewer(current_user: dict) -> str:
    if not (is_managing_director(current_user) or is_coordinator_role(current_user)):
        raise HTTPException(status_code=403, detail="Not allowed to view portal access.")
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=403, detail="Organization membership required.")
    return org_id


class GrantBody(BaseModel):
    email: str
    full_name: str
    relationship: str
    identity_method: str = "participant_dob"
    authority_notes: Optional[str] = None
    consent_method: Optional[str] = None


class RevokeBody(BaseModel):
    reason: str


class NotUsingBody(BaseModel):
    reason: str
    note: Optional[str] = None
    review_date: Optional[date] = None


class VerifyBody(BaseModel):
    answer: str


class AcceptBody(BaseModel):
    password: str


# ── MD / coordinator ─────────────────────────────────────────────────────


@router.get("/participants/{participant_id}")
async def get_portal_access(participant_id: str, current_user: dict = Depends(get_current_user)):
    org_id = _require_viewer(current_user)
    return svc.portal_summary(participant_id, org_id)


@router.post("/participants/{participant_id}/grants", status_code=201)
async def grant_portal_access(participant_id: str, body: GrantBody, current_user: dict = Depends(get_current_user)):
    org_id, actor_id = _require_md(current_user)
    return await svc.grant_access(
        participant_id=participant_id,
        org_id=org_id,
        actor_id=actor_id,
        email=body.email,
        full_name=body.full_name,
        relationship=body.relationship,
        identity_method=body.identity_method,
        authority_notes=body.authority_notes,
        consent_method=body.consent_method,
    )


@router.put("/participants/{participant_id}/not-using")
async def record_not_using_portal(participant_id: str, body: NotUsingBody, current_user: dict = Depends(get_current_user)):
    org_id, actor_id = _require_md(current_user)
    return await svc.set_not_using(
        participant_id=participant_id,
        org_id=org_id,
        actor_id=actor_id,
        reason=body.reason,
        note=body.note,
        review_date=body.review_date,
    )


@router.post("/grants/{access_id}/resend")
async def resend_portal_invite(access_id: str, current_user: dict = Depends(get_current_user)):
    org_id, actor_id = _require_md(current_user)
    return await svc.resend_invite(access_id=access_id, org_id=org_id, actor_id=actor_id)


@router.post("/grants/{access_id}/revoke")
async def revoke_portal_access(access_id: str, body: RevokeBody, current_user: dict = Depends(get_current_user)):
    org_id, actor_id = _require_md(current_user)
    return await svc.revoke_access(access_id=access_id, org_id=org_id, actor_id=actor_id, reason=body.reason)


# ── Public invite flow ───────────────────────────────────────────────────


@router.get("/invites/{token}")
async def get_invite(token: str, request: Request):
    _check_invite_rate_limit(_client_ip(request))
    return svc.invite_summary(token)


@router.post("/invites/{token}/verify")
async def verify_invite_identity(token: str, body: VerifyBody, request: Request):
    ip = _client_ip(request)
    _check_invite_rate_limit(ip)
    return await svc.verify_identity(token=token, answer=body.answer, ip_address=ip)


@router.post("/invites/{token}/accept", status_code=201)
async def accept_portal_invite(token: str, body: AcceptBody, request: Request):
    ip = _client_ip(request)
    _check_invite_rate_limit(ip)
    return await svc.accept_invite(token=token, password=body.password, ip_address=ip)
