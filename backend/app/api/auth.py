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


# ---------------------------------------------------------------------------
# Account type → access role mapping
# ---------------------------------------------------------------------------
_ACCOUNT_TYPE_TO_ROLE: dict[str, str] = {
    "independent_worker": "support_worker",
    "allied_health":      "allied_health",
    "small_provider":     "support_coordinator",
}

# Roles that map to coordinator-level access (full org visibility).
# Includes "admin" as a legacy alias for rows created before the
# support_coordinator constraint migration was applied.
COORDINATOR_ROLES = frozenset({"support_coordinator", "admin"})
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
            "role, full_name, account_type, onboarding_complete, organization_id"
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
            "role, full_name"
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
        elif "23514" in err or "check constraint" in err.lower() or "role_check" in err:
            # DB role constraint hasn't been migrated to include support_coordinator yet.
            # Fallback: store as "admin" (coordinator-equivalent) until migration applied.
            logger.info(
                f"Role '{role}' not yet in DB role constraint for {user_id} — "
                "falling back to 'admin'. Run supabase_setup.sql to add support_coordinator."
            )
            fallback = {**extended_payload, "role": "admin"}
            try:
                supabase.table("users").upsert(fallback, on_conflict="id").execute()
                return
            except Exception as efb:
                logger.warning(f"Role-fallback upsert also failed for {user_id}: {efb}")
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
    so that the FK constraint (public.users.id → auth.users.id) is
    satisfied before we upsert the profile row.  Email confirmation is
    auto-granted for MVP; remove `email_confirm=True` to re-enable it.
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
        result = supabase_admin.auth.admin.create_user({
            "email": body.email,
            "password": body.password,
            "user_metadata": {"full_name": body.full_name},
            "email_confirm": True,   # auto-confirm for MVP friction-free onboarding
        })
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
    )

    return {
        "message": "Account created successfully.",
        "user_id": str(auth_user.id),
        "account_type": body.account_type,
        "role": role,
        "email_confirmed": True,
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
        logger.warning(f"Login failed for {body.email}: {e}")
        raise HTTPException(status_code=401, detail="Invalid email or password")

    profile = await _get_user_profile(str(auth_user.id))
    role = profile.get("role") or "support_worker"
    full_name = profile.get("full_name") or (
        auth_user.user_metadata.get("full_name", "") if auth_user.user_metadata else ""
    )
    account_type = profile.get("account_type") or "independent_worker"

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

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(auth_user.id),
            "email": str(auth_user.email),
            "full_name": full_name,
            "role": role,
            "account_type": account_type,
            "onboarding_complete": bool(onboarding_complete),
        },
    }


@router.post("/complete-onboarding")
async def complete_onboarding(
    body: OnboardingCompleteRequest,
    current_user: dict = Depends(get_current_user),
):
    """Save professional/organisation details and mark onboarding complete.

    Returns a fresh JWT that includes the new ``organization_id`` so the
    client does not need a second login call to pick up org scope.
    """
    user_id = current_user.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    from ..services import migration_state as _ms

    supabase = get_supabase_admin()
    update_payload: dict = {
        "account_type": body.account_type,
        "onboarding_data": body.onboarding_data,
        "onboarding_complete": True,
    }

    org_created = False

    # For small providers: create an organisation row and link it
    if body.account_type == "small_provider" and body.organization_name:
        if _ms.organizations_table_missing:
            logger.warning(
                "Cannot create organisation for %s: organizations table missing — "
                "run backend/supabase_setup.sql in Supabase SQL editor.",
                user_id,
            )
        else:
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
                    org_created = True
                    logger.info("Organisation created for user %s: %s", user_id, org_result.data[0]["id"])
            except Exception as e:
                logger.warning(f"Could not create organisation for {user_id}: {e}")

    # Two-pass update: with new columns, then fallback
    try:
        supabase.table("users").update(update_payload).eq("id", user_id).execute()
    except Exception as e:
        err = str(e)
        if "42703" in err or "does not exist" in err:
            logger.warning(f"Onboarding columns missing — skipping extended update for {user_id}")
        else:
            logger.error(f"Could not complete onboarding for {user_id}: {e}")
            raise HTTPException(status_code=500, detail="Could not save your profile. Please try again.")

    # Re-fetch the saved profile so the fresh token carries accurate state.
    # org_id from the just-created org takes priority over any stale JWT value.
    org_id_for_token = update_payload.get("organization_id") or current_user.get("organization_id")
    current_role = current_user.get("role", "support_worker")
    try:
        profile = await _get_user_profile(user_id)
        current_role = profile.get("role") or current_role
        if not org_id_for_token:
            org_id_for_token = profile.get("organization_id")
    except Exception:
        pass

    new_token = create_access_token({
        "sub": user_id,
        "email": current_user.get("email", ""),
        "role": current_role,
        "account_type": body.account_type,
        "organization_id": org_id_for_token,
    })

    return {
        "success": True,
        "message": "Onboarding complete.",
        "org_created": org_created,
        "organization_id": org_id_for_token,
        "access_token": new_token,
        "token_type": "bearer",
    }


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
            "onboarding_complete": bool(onboarding_complete),
        }
    }
