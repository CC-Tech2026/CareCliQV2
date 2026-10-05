"""FastAPI router for practitioner settings."""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..core.access import get_user_id, get_user_organization_id, is_managing_director
from ..core.security import get_current_user
from ..services.audit_service import log_action
from ..services.supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])


# ── Pydantic models ───────────────────────────────────────────────────────────


class ProviderInfo(BaseModel):
    businessName: Optional[str] = None
    abn: Optional[str] = None


class SessionDefaults(BaseModel):
    defaultDuration: Optional[int] = None
    autoStartTimer: Optional[bool] = None
    enableVoice: Optional[bool] = None


class ComplianceSettings(BaseModel):
    requireActivity: Optional[bool] = None
    requireNotes: Optional[bool] = None
    requireDuration: Optional[bool] = None
    physicalExamSessionTypes: Optional[list[str]] = None


class PractitionerSettings(BaseModel):
    id: str
    name: Optional[str] = None
    credentials: Optional[str] = None
    signature: Optional[str] = None
    avatarId: Optional[str] = None
    provider: Optional[ProviderInfo] = None
    sessionDefaults: Optional[SessionDefaults] = None
    compliance: Optional[ComplianceSettings] = None
    updated_at: Optional[str] = None


class SavePractitionerSettingsBody(BaseModel):
    name: Optional[str] = None
    credentials: Optional[str] = None
    signature: Optional[str] = None
    avatarId: Optional[str] = None
    provider: Optional[ProviderInfo] = None
    sessionDefaults: Optional[SessionDefaults] = None
    compliance: Optional[ComplianceSettings] = None


# ── Helpers ───────────────────────────────────────────────────────────────────


def _row_to_response(user_id: str, row: dict) -> dict:
    return {
        "id": user_id,
        "name": row.get("name"),
        "credentials": row.get("credentials"),
        "signature": row.get("signature"),
        "avatarId": row.get("avatar_id"),
        "provider": row.get("provider") or {},
        "sessionDefaults": row.get("session_defaults") or {},
        "compliance": row.get("compliance") or {},
        "updated_at": str(row["updated_at"]) if row.get("updated_at") else None,
    }


# ── Routes ────────────────────────────────────────────────────────────────────


_ORG_DETAIL_COLUMNS = (
    "organization_name, display_name, abn, plan_tier, ndis_provider_number, org_address, contact_number, email"
)


def _org_details(org_id: str) -> dict[str, Any]:
    result = (
        get_supabase_admin().table("organizations").select(_ORG_DETAIL_COLUMNS)
        .eq("organization_id", org_id).maybe_single().execute()
    )
    row = result.data if result and result.data else {}
    return {
        "name": row.get("display_name") or row.get("organization_name"),
        "legal_name": row.get("organization_name"),
        "abn": row.get("abn"),
        "plan_tier": row.get("plan_tier"),
        "ndis_registration_number": row.get("ndis_provider_number"),
        "address": row.get("org_address"),
        "phone": row.get("contact_number"),
        "email": row.get("email"),
    }


def abn_is_valid(abn: str) -> bool:
    """The ATO's ABN checksum: subtract 1 from the first digit, weight the
    digits, and the total must divide by 89."""
    digits = [int(c) for c in abn if c.isdigit()]
    if len(digits) != 11 or len(re.sub(r"\D", "", abn)) != len(abn.replace(" ", "")):
        return False
    digits[0] -= 1
    weights = (10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19)
    return sum(d * w for d, w in zip(digits, weights)) % 89 == 0


@router.get("/organisation")
async def get_organisation_settings(
    current_user: dict = Depends(get_current_user),
):
    """The organisation's business details — the ones printed on invoices,
    service agreements and NDIA claims."""
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required")
    return _org_details(org_id)


class OrganisationDetailsBody(BaseModel):
    legal_name: Optional[str] = Field(default=None, max_length=200)
    abn: Optional[str] = Field(default=None, max_length=20)
    ndis_registration_number: Optional[str] = Field(default=None, max_length=20)
    address: Optional[str] = Field(default=None, max_length=300)
    phone: Optional[str] = Field(default=None, max_length=40)
    email: Optional[str] = Field(default=None, max_length=200)


@router.put("/organisation")
async def save_organisation_settings(
    body: OrganisationDetailsBody,
    current_user: dict = Depends(get_current_user),
):
    """Managing director only. Invoices, service agreements and NDIA claim
    files all read these — before this, ABN typed in Settings was saved to
    the user's own profile and never reached them, and there was no way to
    enter the NDIS registration number at all."""
    if not is_managing_director(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the managing director can change organisation details.")
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required")

    update: dict[str, Any] = {}
    sent = body.model_dump(exclude_unset=True)
    if "legal_name" in sent:
        name = (body.legal_name or "").strip()
        if not name:
            raise HTTPException(status_code=422, detail="The organisation's legal name can't be blank.")
        update["organization_name"] = name
    if "abn" in sent:
        abn = re.sub(r"\s", "", body.abn or "")
        if abn and not abn_is_valid(abn):
            raise HTTPException(status_code=422, detail="That ABN isn't valid — check the 11 digits.")
        update["abn"] = abn or None
    if "ndis_registration_number" in sent:
        number = re.sub(r"\s", "", body.ndis_registration_number or "")
        if number and not re.fullmatch(r"\d{9,10}", number):
            raise HTTPException(status_code=422, detail="An NDIS registration number is 9 or 10 digits (it usually starts with 405).")
        update["ndis_provider_number"] = number or None
    if "address" in sent:
        update["org_address"] = (body.address or "").strip() or None
    if "phone" in sent:
        update["contact_number"] = (body.phone or "").strip() or None
    if "email" in sent:
        email = (body.email or "").strip()
        if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise HTTPException(status_code=422, detail="Enter a valid email address.")
        update["email"] = email or None
    if not update:
        return _org_details(org_id)

    before = _org_details(org_id)
    get_supabase_admin().table("organizations").update(update).eq("organization_id", org_id).execute()
    after = _org_details(org_id)
    await log_action(
        action_type="organization.details_updated", entity_type="organization", entity_id=org_id,
        user_id=get_user_id(current_user), organization_id=org_id,
        before_state={k: before.get(k) for k in ("legal_name", "abn", "ndis_registration_number", "address", "phone", "email")},
        after_state={k: after.get(k) for k in ("legal_name", "abn", "ndis_registration_number", "address", "phone", "email")},
    )
    return after


class AgreementChecksBody(BaseModel):
    level: str = Field(pattern="^(warn|reason|strict)$")


@router.get("/agreement-checks")
async def get_agreement_checks(current_user: dict = Depends(get_current_user)):
    """How strictly shifts are held to the service agreement (migration
    239): warn, reason (the default) or strict."""
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required")
    from ..services.agreement_support_service import check_level

    return {"level": check_level(org_id)}


@router.put("/agreement-checks")
async def save_agreement_checks(body: AgreementChecksBody, current_user: dict = Depends(get_current_user)):
    if not is_managing_director(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the managing director can change this.")
    org_id = get_user_organization_id(current_user)
    if not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization membership required")
    from ..services.agreement_support_service import check_level

    before = check_level(org_id)
    try:
        get_supabase_admin().table("organizations").update({"agreement_check_level": body.level}) \
            .eq("organization_id", org_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="This setting needs database migration 239. Apply it first.") from exc
    await log_action(
        action_type="organization.agreement_check_level_updated", entity_type="organization", entity_id=org_id,
        user_id=get_user_id(current_user), organization_id=org_id,
        before_state={"level": before}, after_state={"level": body.level},
    )
    return {"level": body.level}


@router.get("/practitioner", response_model=PractitionerSettings)
async def get_practitioner_settings(
    current_user: dict = Depends(get_current_user),
):
    uid = get_user_id(current_user)
    if not uid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    supabase = get_supabase_admin()
    result = (
        supabase.table("practitioner_settings")
        .select("*")
        .eq("user_id", uid)
        .maybe_single()
        .execute()
    )

    if not result or not result.data:
        # Return empty defaults — row will be created on first save
        return {
            "id": uid,
            "name": None,
            "credentials": None,
            "signature": None,
            "avatarId": None,
            "provider": {},
            "sessionDefaults": {},
            "compliance": {},
            "updated_at": None,
        }

    return _row_to_response(uid, result.data)


@router.put("/practitioner", response_model=PractitionerSettings)
async def save_practitioner_settings(
    body: SavePractitionerSettingsBody,
    current_user: dict = Depends(get_current_user),
):
    uid = get_user_id(current_user)
    if not uid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    supabase = get_supabase_admin()

    payload: dict[str, Any] = {
        "user_id": uid,
        "updated_at": "now()",
    }
    if body.name is not None:
        payload["name"] = body.name
    if body.credentials is not None:
        payload["credentials"] = body.credentials
    if body.signature is not None:
        payload["signature"] = body.signature
    if body.avatarId is not None:
        payload["avatar_id"] = body.avatarId
    if body.provider is not None:
        payload["provider"] = body.provider.model_dump(exclude_none=True)
    if body.sessionDefaults is not None:
        payload["session_defaults"] = body.sessionDefaults.model_dump(exclude_none=True)
    if body.compliance is not None:
        payload["compliance"] = body.compliance.model_dump(exclude_none=True)

    try:
        result = (
            supabase.table("practitioner_settings")
            .upsert(payload, on_conflict="user_id")
            .execute()
        )
        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to save settings",
            )
        return _row_to_response(uid, result.data[0])
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("save_practitioner_settings(%s) failed", uid)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        )
