import time
import logging
from collections import defaultdict
from fastapi import APIRouter, HTTPException, Request, status, Depends
from pydantic import BaseModel, EmailStr
from ..services.supabase_client import get_supabase, get_supabase_admin
from ..core.security import create_access_token, get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

# ---------------------------------------------------------------------------
# Simple in-memory rate limiter for login (max 10 attempts / 60s per IP)
# ---------------------------------------------------------------------------
_login_attempts: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT_MAX = 10
_RATE_LIMIT_WINDOW = 60.0


def _check_rate_limit(ip: str) -> None:
    now = time.monotonic()
    window_start = now - _RATE_LIMIT_WINDOW
    attempts = [t for t in _login_attempts[ip] if t > window_start]
    _login_attempts[ip] = attempts
    if len(attempts) >= _RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts — please wait 60 seconds before retrying",
        )
    _login_attempts[ip].append(now)


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: str
    role: str = "support_worker"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_user_role(user_id: str) -> str:
    """Look up the role from the public.users table. Falls back to support_worker."""
    try:
        supabase = get_supabase_admin()
        result = supabase.table("users").select("role").eq("id", user_id).maybe_single().execute()
        if result.data and result.data.get("role"):
            return result.data["role"]
    except Exception as e:
        logger.warning(f"Could not fetch user role for {user_id}: {e}")
    return "support_worker"


async def _upsert_user_record(user_id: str, email: str, role: str, full_name: str = "") -> None:
    """Ensure a row exists in public.users (idempotent)."""
    try:
        supabase = get_supabase_admin()
        supabase.table("users").upsert(
            {
                "id": user_id,
                "email": email,
                "role": role,
                "full_name": full_name,
                "is_active": True,
            },
            on_conflict="id",
        ).execute()
    except Exception as e:
        logger.warning(f"Could not upsert user record for {user_id}: {e}")


async def _touch_last_login(user_id: str) -> None:
    try:
        supabase = get_supabase_admin()
        from datetime import datetime, timezone
        supabase.table("users").update(
            {"last_login": datetime.now(timezone.utc).isoformat()}
        ).eq("id", user_id).execute()
    except Exception as e:
        logger.warning(f"Could not update last_login for {user_id}: {e}")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/login")
async def login(body: LoginRequest, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)

    supabase = get_supabase()
    try:
        result = supabase.auth.sign_in_with_password({
            "email": body.email,
            "password": body.password,
        })
        auth_user = result.user
        session = result.session
        if not auth_user or not session:
            raise HTTPException(status_code=401, detail="Invalid credentials")
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Login failed for {body.email}: {e}")
        raise HTTPException(status_code=401, detail="Invalid email or password")

    role = await _get_user_role(auth_user.id)
    full_name = auth_user.user_metadata.get("full_name", "") if auth_user.user_metadata else ""

    token = create_access_token({
        "sub": auth_user.id,
        "email": auth_user.email,
        "role": role,
    })

    await _touch_last_login(auth_user.id)

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": auth_user.id,
            "email": auth_user.email,
            "full_name": full_name,
            "role": role,
        },
    }


@router.post("/logout")
async def logout():
    return {"message": "Logged out successfully"}


@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return {
        "user": {
            "id": current_user.get("sub"),
            "email": current_user.get("email"),
            "role": current_user.get("role", "support_worker"),
        }
    }


@router.post("/register")
async def register(body: RegisterRequest):
    if body.role not in ("admin", "support_worker", "allied_health"):
        raise HTTPException(status_code=400, detail="Invalid role")

    supabase = get_supabase()
    try:
        result = supabase.auth.sign_up({
            "email": body.email,
            "password": body.password,
            "options": {"data": {"full_name": body.full_name}},
        })
        auth_user = result.user
        if not auth_user:
            raise HTTPException(status_code=400, detail="Registration failed")

        await _upsert_user_record(auth_user.id, body.email, body.role, body.full_name)

        return {
            "message": "Registration successful. Please verify your email.",
            "user_id": auth_user.id,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Register error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
