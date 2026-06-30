from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from ..core.config import settings
from ..core.security import create_access_token, decode_access_token, get_current_user
from ..services import device_security_service as dss
from ..services.supabase_client import get_supabase

router = APIRouter(prefix="/security", tags=["security"])


class ReAuthRequest(BaseModel):
    password: str


class TotpVerifyRequest(BaseModel):
    code: str = Field(min_length=6, max_length=8)


class RenameDeviceRequest(BaseModel):
    custom_name: str = Field(min_length=1, max_length=80)


class LogoutOthersRequest(BaseModel):
    password: str


class SecureAccountRequest(BaseModel):
    token: str


def _reauth_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=settings.reauth_token_expire_minutes)


def _user_id(current_user: dict) -> str:
    user_id = current_user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return str(user_id)


def _current_jti(current_user: dict) -> str | None:
    return current_user.get("jti")


def _device_id(request: Request) -> str | None:
    return request.headers.get("x-device-id") or request.headers.get("X-Device-Id")


@router.post("/reauthenticate")
async def reauthenticate(body: ReAuthRequest, current_user: dict = Depends(get_current_user)):
    email = current_user.get("email")
    if not email:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not body.password:
        raise HTTPException(status_code=422, detail="Password is required")

    try:
        result = get_supabase().auth.sign_in_with_password({"email": email, "password": body.password})
        if not result.user or not result.session:
            raise HTTPException(status_code=401, detail="Current password is incorrect")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    expires = _reauth_expiry()
    token = create_access_token(
        {
            "sub": current_user.get("sub"),
            "email": email,
            "role": current_user.get("role"),
            "organization_id": current_user.get("organization_id"),
            "reauth": True,
        },
        expires_delta=timedelta(minutes=settings.reauth_token_expire_minutes),
    )
    return {
        "reauthenticated": True,
        "reauthenticated_until": expires.isoformat(),
        "reauth_token": token,
    }


def require_recent_reauth(
    request: Request,
    current_user: dict,
) -> None:
    token = request.headers.get("x-reauth-token") or request.headers.get("X-Reauth-Token")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "reauth_required", "message": "Recent re-authentication is required."},
        )
    payload = decode_access_token(token)
    if not payload or payload.get("reauth") is not True or payload.get("sub") != current_user.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "reauth_required", "message": "Re-authentication has expired."},
        )


@router.get("/mfa/status")
async def mfa_status(current_user: dict = Depends(get_current_user)):
    settings_row = dss.get_mfa_settings(_user_id(current_user))
    return {
        "enabled": bool(settings_row.get("mfa_enabled")),
        "method": settings_row.get("mfa_method"),
        "phone": settings_row.get("mfa_phone"),
    }


@router.post("/mfa/totp/enroll/start")
async def start_totp_enrollment(current_user: dict = Depends(get_current_user)):
    email = current_user.get("email") or "user"
    payload = dss.start_totp_enrollment(_user_id(current_user), email)
    return payload


@router.post("/mfa/totp/enroll/verify")
async def verify_totp_enrollment(
    body: TotpVerifyRequest,
    current_user: dict = Depends(get_current_user),
):
    try:
        recovery_codes = dss.complete_totp_enrollment(_user_id(current_user), body.code)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return {"enabled": True, "method": "totp", "recovery_codes": recovery_codes}


@router.post("/mfa/disable")
async def disable_mfa(body: ReAuthRequest, current_user: dict = Depends(get_current_user)):
    email = current_user.get("email")
    try:
        result = get_supabase().auth.sign_in_with_password({"email": email, "password": body.password})
        if not result.user:
            raise HTTPException(status_code=401, detail="Current password is incorrect")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    dss.disable_mfa(_user_id(current_user))
    return {"enabled": False}


@router.get("/devices/trusted")
async def list_trusted_devices(request: Request, current_user: dict = Depends(get_current_user)):
    return dss.list_trusted_devices(_user_id(current_user), _device_id(request))


@router.patch("/devices/trusted/{device_row_id}")
async def rename_trusted_device(
    device_row_id: str,
    body: RenameDeviceRequest,
    current_user: dict = Depends(get_current_user),
):
    dss.rename_trusted_device(_user_id(current_user), device_row_id, body.custom_name)
    return {"updated": True}


@router.delete("/devices/trusted/{device_row_id}", status_code=204)
async def revoke_trusted_device(device_row_id: str, current_user: dict = Depends(get_current_user)):
    dss.revoke_trusted_device(_user_id(current_user), device_row_id)
    return None


@router.get("/sessions")
async def list_sessions(current_user: dict = Depends(get_current_user)):
    return dss.list_sessions(_user_id(current_user), _current_jti(current_user))


@router.patch("/sessions/{session_id}")
async def rename_session(
    session_id: str,
    body: RenameDeviceRequest,
    current_user: dict = Depends(get_current_user),
):
    dss.rename_session(_user_id(current_user), session_id, body.custom_name)
    return {"updated": True}


@router.post("/sessions/logout-others")
async def logout_other_sessions(
    body: LogoutOthersRequest,
    current_user: dict = Depends(get_current_user),
):
    email = current_user.get("email")
    try:
        result = get_supabase().auth.sign_in_with_password({"email": email, "password": body.password})
        if not result.user:
            raise HTTPException(status_code=401, detail="Current password is incorrect")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    count = dss.revoke_other_sessions(_user_id(current_user), _current_jti(current_user))
    return {"revoked_sessions": count}


@router.get("/login-history")
async def login_history(current_user: dict = Depends(get_current_user)):
    return dss.list_login_history(_user_id(current_user))


@router.post("/account/secure")
async def secure_account(body: SecureAccountRequest):
    user_id = dss.consume_account_security_token(body.token)
    if not user_id:
        raise HTTPException(status_code=400, detail="This secure link is invalid or expired.")
    return {"secured": True, "message": "All sessions were signed out. Please sign in again."}
