"""FastAPI router for practitioner settings."""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..core.access import get_user_id
from ..core.security import get_current_user
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
