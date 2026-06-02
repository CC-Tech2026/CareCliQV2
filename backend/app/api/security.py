from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from ..core.config import settings
from ..core.security import create_access_token, decode_access_token, get_current_user
from ..services.supabase_client import get_supabase

router = APIRouter(prefix="/security", tags=["security"])


class ReAuthRequest(BaseModel):
    password: str


def _reauth_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=settings.reauth_token_expire_minutes)


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
