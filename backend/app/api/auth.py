import time
import logging
from collections import defaultdict
from typing import Optional
from fastapi import APIRouter, HTTPException, Request, status, Depends
from pydantic import BaseModel
from ..services.supabase_client import get_supabase, get_supabase_admin
from ..core.security import create_access_token, get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

# ---------------------------------------------------------------------------
# Rate limiter (max 10 login attempts / 60s per IP)
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
# Account type → access role mapping
# ---------------------------------------------------------------------------
_ACCOUNT_TYPE_TO_ROLE: dict[str, str] = {
    "independent_worker": "support_worker",
    "allied_health": "allied_health",
    "small_provider": "admin",
}

VALID_ACCOUNT_TYPES = set(_ACCOUNT_TYPE_TO_ROLE.keys())


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
    account_type: str = "independent_worker"


class OnboardingCompleteRequest(BaseModel):
    account_type: str
    onboarding_data: dict = {}
    # Small provider fields
    organization_name: Optional[str] = None
    provider_type: Optional[str] = None
    registration_status: Optional[str] = None
    team_size: Optional[str] = None
    participant_volume: Optional[str] = None
    contact_number: Optional[str] = None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _get_user_profile(user_id: str) -> dict:
    """Return the user's profile row from public.users."""
    try:
        supabase = get_supabase_admin()
        result = (
            supabase.table("users")
            .select("role, full_name, account_type, onboarding_complete, organization_id")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        if result.data:
            return result.data
    except Exception as e:
        logger.warning(f"Could not fetch user profile for {user_id}: {e}")
    return {}


async def _upsert_user_record(
    user_id: str,
    email: str,
    role: str,
    full_name: str = "",
    account_type: str = "independent_worker",
    onboarding_complete: bool = False,
    extra: Optional[dict] = None,
) -> None:
    """Ensure a row exists in public.users (idempotent upsert)."""
    try:
        supabase = get_supabase_admin()
        payload: dict = {
            "id": user_id,
            "email": email,
            "role": role,
            "full_name": full_name,
            "account_type": account_type,
            "onboarding_complete": onboarding_complete,
            "is_active": True,
        }
        if extra:
            payload.update(extra)
        supabase.table("users").upsert(payload, on_conflict="id").execute()
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
        if not auth_user or not result.session:
            raise HTTPException(status_code=401, detail="Invalid credentials")
    except HTTPException:
        raise
    except Exception as e:
        msg = str(e).lower()
        if "email not confirmed" in msg:
            raise HTTPException(status_code=401, detail="Please verify your email address before signing in.")
        logger.warning(f"Login failed for {body.email}: {e}")
        raise HTTPException(status_code=401, detail="Invalid email or password")

    profile = await _get_user_profile(auth_user.id)
    role = profile.get("role") or "support_worker"
    full_name = profile.get("full_name") or (
        auth_user.user_metadata.get("full_name", "") if auth_user.user_metadata else ""
    )
    account_type = profile.get("account_type") or "independent_worker"
    # Existing users (no account_type set) are treated as fully onboarded
    onboarding_complete = profile.get("onboarding_complete")
    if onboarding_complete is None:
        onboarding_complete = True

    token = create_access_token({
        "sub": auth_user.id,
        "email": auth_user.email,
        "role": role,
        "account_type": account_type,
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
            "account_type": account_type,
            "onboarding_complete": bool(onboarding_complete),
        },
    }


@router.post("/register", status_code=201)
async def register(body: RegisterRequest):
    if body.account_type not in VALID_ACCOUNT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid account_type. Must be one of: {', '.join(VALID_ACCOUNT_TYPES)}",
        )

    role = _ACCOUNT_TYPE_TO_ROLE[body.account_type]

    supabase = get_supabase()
    try:
        result = supabase.auth.sign_up({
            "email": body.email,
            "password": body.password,
            "options": {"data": {"full_name": body.full_name}},
        })
        auth_user = result.user
        if not auth_user:
            raise HTTPException(status_code=400, detail="Registration failed — please try again")

        await _upsert_user_record(
            user_id=auth_user.id,
            email=body.email,
            role=role,
            full_name=body.full_name,
            account_type=body.account_type,
            onboarding_complete=False,
        )

        return {
            "message": "Account created successfully.",
            "user_id": auth_user.id,
            "account_type": body.account_type,
            "role": role,
        }
    except HTTPException:
        raise
    except Exception as e:
        err_msg = str(e)
        logger.error(f"Register error for {body.email}: {err_msg}")
        if "already registered" in err_msg.lower() or "already been registered" in err_msg.lower():
            raise HTTPException(status_code=409, detail="An account with this email already exists. Please sign in.")
        raise HTTPException(status_code=400, detail="Registration failed — please check your details and try again.")


@router.post("/complete-onboarding")
async def complete_onboarding(
    body: OnboardingCompleteRequest,
    current_user: dict = Depends(get_current_user),
):
    """Save professional/organisation details and mark onboarding complete."""
    user_id = current_user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    supabase = get_supabase_admin()
    update_payload: dict = {
        "account_type": body.account_type,
        "onboarding_data": body.onboarding_data,
        "onboarding_complete": True,
    }

    # For small providers: create an organisation row and link it
    if body.account_type == "small_provider" and body.organization_name:
        try:
            org_payload = {
                "owner_user_id": user_id,
                "organization_name": body.organization_name,
                "provider_type": body.provider_type,
                "registration_status": body.registration_status,
                "team_size": body.team_size,
                "participant_volume": body.participant_volume,
                "contact_number": body.contact_number,
            }
            org_payload = {k: v for k, v in org_payload.items() if v is not None}
            org_result = supabase.table("organizations").insert(org_payload).execute()
            if org_result.data:
                update_payload["organization_id"] = org_result.data[0]["id"]
        except Exception as e:
            logger.error(f"Could not create organisation for user {user_id}: {e}")

    try:
        supabase.table("users").update(update_payload).eq("id", user_id).execute()
    except Exception as e:
        logger.error(f"Could not complete onboarding for {user_id}: {e}")
        raise HTTPException(status_code=500, detail="Could not save your profile. Please try again.")

    return {"success": True, "message": "Onboarding complete."}


@router.post("/logout")
async def logout():
    return {"message": "Logged out successfully"}


@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("sub")
    profile = await _get_user_profile(user_id) if user_id else {}
    onboarding_complete = profile.get("onboarding_complete")
    if onboarding_complete is None:
        onboarding_complete = True
    return {
        "user": {
            "id": user_id,
            "email": current_user.get("email"),
            "role": current_user.get("role", "support_worker"),
            "account_type": current_user.get("account_type") or profile.get("account_type") or "independent_worker",
            "onboarding_complete": bool(onboarding_complete),
        }
    }
