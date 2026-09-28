"""NEW, Supabase-native MFA (TOTP) endpoints.

Deliberately separate from the older, custom pyotp-based MFA in
`api/security.py` (`/security/mfa/*`, backed by `device_security_service.py`).
That code is left untouched. This router lives at a distinct path
(`/auth/mfa/*`, `/auth/login/mfa-native`) so it's unambiguous which
implementation a given endpoint belongs to.

Every enroll/verify/status/unenroll call here needs the caller's *live*
Supabase access_token + refresh_token (not our own app JWT, and never the
service-role key) -- see `services/supabase_mfa_service.py` for why. The
frontend already holds this pair after login (`supabase_session` in the
login response, persisted client-side for Realtime) and sends it up as the
request body on each of these calls.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..core.security import create_access_token, decode_access_token, get_current_user
from ..services import supabase_mfa_service as native_mfa
from ..services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth-mfa-native"])


class SupabaseSessionBody(BaseModel):
    """The user's current live Supabase session, as returned by /auth/login
    (or /auth/supabase-refresh) in `supabase_session`."""

    supabase_access_token: str = Field(min_length=10)
    supabase_refresh_token: str = Field(min_length=10)


class EnrollStartRequest(SupabaseSessionBody):
    friendly_name: str = "Authenticator app"


class EnrollVerifyRequest(SupabaseSessionBody):
    factor_id: str
    code: str = Field(min_length=6, max_length=8)


class StatusRequest(SupabaseSessionBody):
    pass


class UnenrollRequest(SupabaseSessionBody):
    factor_id: str
    password: str = Field(min_length=1)


class LoginMfaNativeRequest(BaseModel):
    mfa_challenge_token: str
    factor_id: str
    code: str = Field(min_length=6, max_length=8)
    trust_device: bool = False
    device_id: str = ""


def _supabase_error(exc: Exception) -> HTTPException:
    msg = str(exc)
    logger.warning("Supabase native MFA call failed: %s", msg)
    lowered = msg.lower()
    if "invalid" in lowered or "code" in lowered or "expired" in lowered:
        return HTTPException(status_code=422, detail="Invalid or expired verification code.")
    return HTTPException(status_code=502, detail="Authentication provider is unavailable.")


@router.post("/mfa/enroll/start")
async def start_native_totp_enrollment(
    body: EnrollStartRequest,
    current_user: dict = Depends(get_current_user),
):
    try:
        return native_mfa.enroll_totp(
            body.supabase_access_token,
            body.supabase_refresh_token,
            friendly_name=body.friendly_name,
        )
    except Exception as exc:
        raise _supabase_error(exc)


@router.post("/mfa/enroll/verify")
async def verify_native_totp_enrollment(
    body: EnrollVerifyRequest,
    current_user: dict = Depends(get_current_user),
):
    try:
        result = native_mfa.verify_enrollment(
            body.supabase_access_token,
            body.supabase_refresh_token,
            factor_id=body.factor_id,
            code=body.code,
        )
    except Exception as exc:
        raise _supabase_error(exc)
    return {
        "enabled": True,
        "method": "totp",
        # The just-verified factor elevates the session to aal2; hand the
        # new tokens back so the frontend keeps its stored Supabase session
        # in sync (mirrors the shape of the login response's field).
        "supabase_session": {
            "access_token": result["access_token"],
            "refresh_token": result["refresh_token"],
            "expires_at": None,
        },
    }


@router.post("/mfa/status")
async def native_mfa_status(
    body: StatusRequest,
    current_user: dict = Depends(get_current_user),
):
    try:
        return native_mfa.list_factors_and_aal(body.supabase_access_token, body.supabase_refresh_token)
    except Exception as exc:
        raise _supabase_error(exc)


@router.post("/mfa/unenroll")
async def unenroll_native_totp(
    body: UnenrollRequest,
    current_user: dict = Depends(get_current_user),
):
    email = current_user.get("email")
    if not email:
        raise HTTPException(status_code=401, detail="Authentication required")
    # Re-auth with password first, matching the security posture of the old
    # /security/mfa/disable endpoint, before removing the factor.
    try:
        result = get_supabase().auth.sign_in_with_password({"email": email, "password": body.password})
        if not result.user:
            raise HTTPException(status_code=401, detail="Current password is incorrect")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    try:
        native_mfa.unenroll_totp(
            body.supabase_access_token,
            body.supabase_refresh_token,
            factor_id=body.factor_id,
        )
    except Exception as exc:
        raise _supabase_error(exc)
    return {"enabled": False}


@router.post("/login/mfa-native")
async def login_mfa_native(
    body: LoginMfaNativeRequest,
    request: Request,
    background_tasks: BackgroundTasks,
):
    """Step 2 of login for users enrolled via the new Supabase-native flow.

    Mirrors `/auth/login/mfa` (the OLD flow's step 2) in shape and behaviour,
    but elevates the session via Supabase's own `challenge_and_verify`
    instead of a homegrown pyotp check.
    """
    # Imported lazily to avoid a circular import (auth.py imports nothing
    # from here; this keeps the dependency one-directional).
    from . import auth as auth_api

    payload = decode_access_token(body.mfa_challenge_token)
    if not payload or payload.get("type") != "mfa_challenge_native":
        raise HTTPException(status_code=401, detail="MFA challenge expired. Sign in again.")

    user_id = payload.get("sub")
    supabase_access_token = payload.get("supabase_access")
    supabase_refresh_token = payload.get("supabase_refresh")
    if not user_id or not supabase_access_token or not supabase_refresh_token:
        raise HTTPException(status_code=401, detail="MFA challenge expired. Sign in again.")

    try:
        elevated = native_mfa.challenge_and_verify_login(
            supabase_access_token,
            supabase_refresh_token,
            factor_id=body.factor_id,
            code=body.code,
        )
    except Exception as exc:
        raise _supabase_error(exc)

    profile = await auth_api._get_user_profile(str(user_id))
    role = payload.get("role") or profile.get("role") or "support_worker"
    account_type = payload.get("account_type") or profile.get("account_type") or "independent_worker"
    organization_id = payload.get("organization_id") or profile.get("organization_id")
    device_id = (body.device_id or payload.get("device_id") or request.headers.get("x-device-id") or "").strip() or None
    remember_device = bool(payload.get("remember_device"))

    elevated_user = elevated.get("user")

    class _AuthUserShim:
        id = str(user_id)
        email = payload.get("email") or profile.get("email")
        user_metadata = {"full_name": profile.get("full_name") or ""}
        # Use the real Supabase user object returned by challenge_and_verify
        # so email-verification state carries over correctly after the
        # native MFA step-up (previously hardcoded to None, which caused
        # every native-MFA login to incorrectly be treated as unverified).
        email_confirmed_at = getattr(elevated_user, "email_confirmed_at", None)
        confirmed_at = getattr(elevated_user, "confirmed_at", None)

    class _SessionShim:
        access_token = elevated["access_token"]
        refresh_token = elevated["refresh_token"]
        expires_at = None

    response = await auth_api._finalize_login_response(
        auth_user=_AuthUserShim(),
        profile=profile,
        role=role,
        account_type=account_type,
        organization_id=organization_id,
        remember_device=remember_device,
        request=request,
        device_id=device_id,
        background_tasks=background_tasks,
        supabase_session=_SessionShim(),
    )
    if body.trust_device and device_id:
        from ..services import device_security_service as dss

        device_name, os_name = dss.parse_user_agent(request.headers.get("user-agent"))
        dss.trust_device(
            str(user_id),
            device_id,
            device_name=device_name,
            os_name=os_name,
            user_agent=request.headers.get("user-agent"),
        )
    return response
