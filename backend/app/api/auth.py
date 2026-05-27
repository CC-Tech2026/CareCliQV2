import time
import logging
from collections import defaultdict
from typing import Optional
import json
import urllib.error
import urllib.parse
import urllib.request
from fastapi import APIRouter, HTTPException, Request, status, Depends
from pydantic import BaseModel
from ..core.config import settings
from ..services.supabase_client import get_supabase, get_supabase_admin
from ..core.security import create_access_token, get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

# ---------------------------------------------------------------------------
# Rate limiter (10 login attempts / 60 s per IP)
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
            detail="Too many login attempts — please wait 60 seconds",
        )
    _login_attempts[ip].append(now)


def _supabase_auth_request(
    path: str,
    payload: dict,
    *,
    bearer_token: str | None = None,
    method: str = "POST",
) -> dict:
    """Call Supabase Auth directly for recovery flows not covered by supabase-py."""
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(status_code=500, detail="Authentication provider is not configured.")

    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/{path.lstrip('/')}"
    headers = {
        "Content-Type": "application/json",
        "apikey": settings.supabase_anon_key,
    }
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        logger.warning("Supabase auth request failed: %s %s", exc.code, body)
        raise HTTPException(status_code=502, detail="Authentication provider rejected the request.")
    except Exception as exc:
        logger.error("Supabase auth request failed: %s", exc)
        raise HTTPException(status_code=502, detail="Authentication provider is unavailable.")


def _is_auth_user_email_verified(auth_user) -> bool:
    return bool(
        getattr(auth_user, "email_confirmed_at", None)
        or getattr(auth_user, "confirmed_at", None)
        or getattr(auth_user, "email_verified", False)
    )


# ---------------------------------------------------------------------------
# Account type → access role mapping
# ---------------------------------------------------------------------------
_ACCOUNT_TYPE_TO_ROLE: dict[str, str] = {
    "independent_worker": "support_worker",
    "allied_health":      "allied_health",
    "small_provider":     "support_coordinator",
}
VALID_ACCOUNT_TYPES = set(_ACCOUNT_TYPE_TO_ROLE.keys())


# ---------------------------------------------------------------------------
# Request schemas
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
    organization_name: Optional[str] = None
    provider_type: Optional[str] = None
    registration_status: Optional[str] = None
    team_size: Optional[str] = None
    participant_volume: Optional[str] = None
    contact_number: Optional[str] = None


class PasswordResetRequest(BaseModel):
    email: str


class PasswordResetConfirmRequest(BaseModel):
    access_token: str = ""
    token_hash: str = ""
    password: str


class ResendVerificationRequest(BaseModel):
    email: str


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _get_user_profile(user_id: str) -> dict:
    """Fetch the user's public.users row.  Two-pass: try new columns first,
    fall back to base columns so the function never crashes if the
    onboarding migration hasn't been run yet."""
    supabase = get_supabase_admin()

    # Pass 1: select with all new columns (works once migration is applied)
    try:
        result = supabase.table("users").select(
            "role, full_name, account_type, onboarding_complete, organization_id, "
            "email_verified, profile_completed, onboarding_completed, "
            "role_specific_profile_completed, profile_photo_url"
        ).eq("id", user_id).maybe_single().execute()
        if result is not None and result.data:
            return result.data
        if result is not None and result.data is None:
            # Row simply doesn't exist yet — return empty dict
            return {}
    except Exception as e1:
        logger.debug(f"Extended user profile select failed for {user_id}: {e1}")

    # Pass 2: base columns only (always available)
    try:
        result = supabase.table("users").select(
            "role, full_name, email_verified, onboarding_complete"
        ).eq("id", user_id).maybe_single().execute()
        if result is not None and result.data:
            return result.data
    except Exception as e2:
        logger.warning(f"Base user profile select also failed for {user_id}: {e2}")

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
    """Upsert into public.users.  Two-pass: full payload first,
    base-columns-only fallback so saves never fail due to missing
    onboarding migration columns."""
    supabase = get_supabase_admin()

    base_payload: dict = {
        "id": user_id,
        "email": email,
        "role": role,
        "full_name": full_name,
        "is_active": True,
    }
    extended_payload: dict = {
        **base_payload,
        "account_type": account_type,
        "onboarding_complete": onboarding_complete,
        "email_verified": bool(extra.get("email_verified")) if extra and "email_verified" in extra else False,
        "profile_completed": bool(extra.get("profile_completed")) if extra and "profile_completed" in extra else onboarding_complete,
        "onboarding_completed": bool(extra.get("onboarding_completed")) if extra and "onboarding_completed" in extra else onboarding_complete,
        "role_specific_profile_completed": bool(extra.get("role_specific_profile_completed")) if extra and "role_specific_profile_completed" in extra else onboarding_complete,
    }
    if extra:
        extended_payload.update(extra)

    # Pass 1: with new columns
    try:
        supabase.table("users").upsert(
            extended_payload, on_conflict="id"
        ).execute()
        return
    except Exception as e1:
        err = str(e1)
        # 42703 = undefined_column, PGRST116/204 = schema cache mismatch
        if "42703" in err or "does not exist" in err or "PGRST" in err:
            logger.info(
                f"Onboarding columns not yet in DB for user {user_id} — "
                "using base upsert. Run supabase_setup.sql to enable full onboarding."
            )
        else:
            # Different error — log it but still attempt fallback
            logger.warning(f"Extended upsert failed for {user_id}: {e1}")

    # Pass 2: base columns only
    try:
        supabase.table("users").upsert(
            base_payload, on_conflict="id"
        ).execute()
    except Exception as e2:
        logger.warning(f"Base upsert also failed for {user_id}: {e2}")


async def _touch_last_login(user_id: str) -> None:
    try:
        from datetime import datetime, timezone
        supabase = get_supabase_admin()
        supabase.table("users").update(
            {"last_login": datetime.now(timezone.utc).isoformat()}
        ).eq("id", user_id).execute()
    except Exception as e:
        logger.debug(f"Could not update last_login for {user_id}: {e}")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/register", status_code=201)
async def register(body: RegisterRequest):
    """Create a new user account.

    Uses the service-role admin API to create the Supabase Auth user
    so that the FK constraint (public.users.id -> auth.users.id) is
    satisfied before we upsert the profile row. Email verification is
    not bypassed unless AUTH_AUTO_CONFIRM_EMAIL is explicitly enabled
    for local/demo environments.
    """
    if body.account_type not in VALID_ACCOUNT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid account_type. Must be one of: {', '.join(VALID_ACCOUNT_TYPES)}",
        )

    role = _ACCOUNT_TYPE_TO_ROLE[body.account_type]
    supabase_admin = get_supabase_admin()

    try:
        # Admin create_user guarantees the auth.users row is fully committed
        # before we upsert into public.users, eliminating the FK race condition.
        create_payload = {
            "email": body.email,
            "password": body.password,
            "user_metadata": {"full_name": body.full_name},
            "email_confirm": settings.auth_auto_confirm_email,
        }
        result = supabase_admin.auth.admin.create_user(create_payload)
        auth_user = result.user
        if not auth_user:
            raise HTTPException(status_code=400, detail="Registration failed — please try again")

    except HTTPException:
        raise
    except Exception as e:
        err_msg = str(e)
        logger.error(f"Admin create_user failed for {body.email}: {err_msg}")
        if "already registered" in err_msg.lower() or "already been registered" in err_msg.lower() or "already exists" in err_msg.lower():
            raise HTTPException(
                status_code=409,
                detail="An account with this email already exists. Please sign in.",
            )
        raise HTTPException(
            status_code=400,
            detail="Registration failed — please check your details and try again.",
        )

    # Create public.users profile row (two-pass resilient)
    await _upsert_user_record(
        user_id=str(auth_user.id),
        email=body.email,
        role=role,
        full_name=body.full_name,
        account_type=body.account_type,
        onboarding_complete=False,
        extra={
            "email_verified": settings.auth_auto_confirm_email,
            "profile_completed": False,
            "onboarding_completed": False,
            "role_specific_profile_completed": False,
        },
    )

    if not settings.auth_auto_confirm_email:
        try:
            redirect_to = f"{settings.frontend_base_url.rstrip('/')}/login?verified=1"
            _supabase_auth_request(
                "resend",
                {
                    "type": "signup",
                    "email": body.email,
                    "options": {"email_redirect_to": redirect_to},
                },
                method="POST",
            )
        except Exception as exc:
            logger.warning("Could not send verification email for %s: %s", body.email, exc)

    return {
        "message": "Account created successfully. Verify your email before signing in.",
        "user_id": str(auth_user.id),
        "account_type": body.account_type,
        "role": role,
        "email_confirmed": settings.auth_auto_confirm_email,
    }


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
            raise HTTPException(
                status_code=401,
                detail="Please verify your email address before signing in.",
            )
        provider_unavailable_markers = (
            "no address associated with hostname",
            "name or service not known",
            "temporary failure in name resolution",
            "connection refused",
            "timed out",
            "connecterror",
            "network is unreachable",
        )
        if any(marker in msg for marker in provider_unavailable_markers):
            logger.error("Authentication provider unreachable for %s: %s", body.email, e)
            raise HTTPException(
                status_code=503,
                detail=(
                    "Authentication provider is unreachable. Check Docker internet/DNS "
                    "and Supabase configuration, then try again."
                ),
            )
        logger.warning(f"Login failed for {body.email}: {e}")
        raise HTTPException(status_code=401, detail="Invalid email or password")

    profile = await _get_user_profile(str(auth_user.id))
    role = profile.get("role") or "support_worker"
    full_name = profile.get("full_name") or (
        auth_user.user_metadata.get("full_name", "") if auth_user.user_metadata else ""
    )
    account_type = profile.get("account_type") or "independent_worker"
    email_verified = _is_auth_user_email_verified(auth_user)
    if not email_verified:
        email_verified = bool(profile.get("email_verified")) and settings.auth_auto_confirm_email

    # Existing users who pre-date the onboarding system are treated as complete
    onboarding_complete = profile.get("onboarding_complete")
    if onboarding_complete is None:
        onboarding_complete = True

    # If the user row doesn't exist yet (e.g., created via another auth path),
    # create it now so future lookups succeed.
    if not profile:
        await _upsert_user_record(
            user_id=str(auth_user.id),
            email=str(auth_user.email),
            role=role,
            full_name=full_name,
            account_type=account_type,
            onboarding_complete=True,  # treat as complete since they pre-dated onboarding
        )

    token = create_access_token({
        "sub": str(auth_user.id),
        "email": str(auth_user.email),
        "role": role,
        "account_type": account_type,
        "organization_id": profile.get("organization_id"),
    })

    await _touch_last_login(str(auth_user.id))
    if email_verified != bool(profile.get("email_verified")):
        try:
            get_supabase_admin().table("users").update({"email_verified": email_verified}).eq("id", str(auth_user.id)).execute()
        except Exception as e:
            logger.debug("Could not persist email_verified for %s: %s", auth_user.id, e)

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(auth_user.id),
            "email": str(auth_user.email),
            "full_name": full_name,
            "role": role,
            "account_type": account_type,
            "organization_id": profile.get("organization_id"),
            "onboarding_complete": bool(onboarding_complete),
            "email_verified": email_verified,
            "profile_completed": bool(profile.get("profile_completed")),
            "onboarding_completed": bool(profile.get("onboarding_completed") or onboarding_complete),
            "role_specific_profile_completed": bool(profile.get("role_specific_profile_completed")),
            "profile_photo_url": profile.get("profile_photo_url"),
        },
    }


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
        "profile_completed": True,
        "role_specific_profile_completed": True,
        "onboarding_completed": True,
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
            logger.warning(f"Could not create organisation for {user_id}: {e}")

    # Two-pass update: with new columns, then fallback
    try:
        supabase.table("users").update(update_payload).eq("id", user_id).execute()
    except Exception as e:
        err = str(e)
        if "42703" in err or "does not exist" in err:
            logger.warning(f"Onboarding columns missing — skipping extended update for {user_id}")
            # At minimum record that onboarding happened (if base column exists)
        else:
            logger.error(f"Could not complete onboarding for {user_id}: {e}")
            raise HTTPException(status_code=500, detail="Could not save your profile. Please try again.")

    return {
        "success": True,
        "message": "Onboarding complete.",
        "organization_id": update_payload.get("organization_id") or current_user.get("organization_id"),
    }


@router.post("/password-reset/request")
async def request_password_reset(body: PasswordResetRequest):
    """Send a Supabase recovery email without revealing whether the account exists."""
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=422, detail="Enter a valid email address.")

    redirect_to = f"{settings.frontend_base_url.rstrip('/')}/reset-password"
    encoded_redirect = urllib.parse.quote(redirect_to, safe="")
    _supabase_auth_request(
        f"recover?redirect_to={encoded_redirect}",
        {"email": email},
        method="POST",
    )
    return {
        "message": "If an account exists for this email, a password reset link has been sent.",
    }


@router.post("/password-reset/confirm")
async def confirm_password_reset(body: PasswordResetConfirmRequest):
    """Set a new password using the Supabase recovery access token."""
    token = body.access_token.strip()
    token_hash = body.token_hash.strip()
    password = body.password
    if len(password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters.")
    if not token and token_hash:
        verify_result = _supabase_auth_request(
            "verify",
            {"type": "recovery", "token_hash": token_hash},
            method="POST",
        )
        token = verify_result.get("access_token") or verify_result.get("session", {}).get("access_token", "")
    if not token:
        raise HTTPException(status_code=422, detail="Reset token is missing or expired.")

    _supabase_auth_request(
        "user",
        {"password": password},
        bearer_token=token,
        method="PUT",
    )
    return {"message": "Password updated successfully. You can now sign in."}


@router.post("/verification/resend")
async def resend_verification(body: ResendVerificationRequest):
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    redirect_to = f"{settings.frontend_base_url.rstrip('/')}/login?verified=1"
    try:
        _supabase_auth_request(
            "resend",
            {
                "type": "signup",
                "email": email,
                "options": {"email_redirect_to": redirect_to},
            },
            method="POST",
        )
    except HTTPException:
        # Do not leak whether an account exists.
        pass
    return {"message": "If the account exists, a verification email has been sent."}


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
            "role": profile.get("role") or current_user.get("role", "support_worker"),
            "account_type": current_user.get("account_type") or profile.get("account_type") or "independent_worker",
            "organization_id": profile.get("organization_id") or current_user.get("organization_id"),
            "onboarding_complete": bool(onboarding_complete),
            "email_verified": bool(profile.get("email_verified")),
            "profile_completed": bool(profile.get("profile_completed")),
            "onboarding_completed": bool(profile.get("onboarding_completed") or onboarding_complete),
            "role_specific_profile_completed": bool(profile.get("role_specific_profile_completed")),
            "profile_photo_url": profile.get("profile_photo_url"),
        }
    }
