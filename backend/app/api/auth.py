import asyncio
import re
import time
import uuid
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional
import json
import urllib.error
import urllib.parse
import urllib.request
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status, Depends
from pydantic import BaseModel, Field, model_validator
from ..core.config import settings
from ..services.supabase_client import get_supabase, get_supabase_admin
from ..core.security import create_access_token, decode_access_token, get_current_user
from ..services import email_service
from ..services import device_security_service as dss

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
# Account lockout (5 failed attempts → 15 min cooldown)
# ---------------------------------------------------------------------------
_LOCKOUT_MAX_ATTEMPTS = 5
_LOCKOUT_COOLDOWN_MINUTES = 15
_REMEMBER_DEVICE_DAYS = 30


def _looks_like_email(identifier: str) -> bool:
    return "@" in identifier


def _normalize_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("61") and len(digits) >= 11:
        digits = "0" + digits[2:]
    return digits


def _phone_lookup_candidates(phone: str) -> list[str]:
    normalized = _normalize_phone(phone)
    if not normalized:
        return []
    candidates = {normalized, normalized.lstrip("0")}
    if normalized.startswith("0"):
        candidates.add("+61" + normalized[1:])
        candidates.add("61" + normalized[1:])
    return [c for c in candidates if c]


async def _resolve_login_email(identifier: str) -> str:
    """Resolve email or mobile identifier to the auth email address."""
    raw = (identifier or "").strip()
    if not raw:
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    if _looks_like_email(raw):
        return raw.lower()

    admin = get_supabase_admin()
    for candidate in _phone_lookup_candidates(raw):
        try:
            result = await asyncio.to_thread(
                lambda c=candidate: admin.table("users")
                .select("email")
                .eq("phone", c)
                .maybe_single()
                .execute()
            )
            if result and result.data and result.data.get("email"):
                return str(result.data["email"]).lower()
        except Exception as exc:
            logger.debug("Phone lookup failed for %s: %s", candidate, exc)
    return raw.lower()


async def _get_lockout_state(email: str) -> dict:
    admin = get_supabase_admin()
    try:
        result = await asyncio.to_thread(
            lambda: admin.table("users")
            .select("id, email, failed_login_count, locked_until")
            .eq("email", email.lower())
            .maybe_single()
            .execute()
        )
        return result.data if result and result.data else {}
    except Exception as exc:
        logger.debug("Lockout lookup failed for %s: %s", email, exc)
        return {}


def _parse_locked_until(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


async def _check_account_lockout(email: str) -> None:
    state = await _get_lockout_state(email)
    locked_until = _parse_locked_until(state.get("locked_until"))
    if locked_until and locked_until > datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "Too many failed attempts. Please try again in 15 minutes "
                "or check your email."
            ),
        )


async def _record_failed_login(email: str, background_tasks: BackgroundTasks) -> None:
    state = await _get_lockout_state(email)
    user_id = state.get("id")
    if not user_id:
        return

    count = int(state.get("failed_login_count") or 0) + 1
    payload: dict = {"failed_login_count": count}
    if count >= _LOCKOUT_MAX_ATTEMPTS:
        locked_until = datetime.now(timezone.utc) + timedelta(
            minutes=_LOCKOUT_COOLDOWN_MINUTES
        )
        payload["locked_until"] = locked_until.isoformat()
        email_service.send_account_lockout_email_safe(
            to_email=email,
            locked_until=locked_until,
        )

    admin = get_supabase_admin()
    try:
        await asyncio.to_thread(
            lambda: admin.table("users").update(payload).eq("id", user_id).execute()
        )
    except Exception as exc:
        logger.warning("Could not record failed login for %s: %s", email, exc)


async def _clear_failed_login(user_id: str) -> None:
    admin = get_supabase_admin()
    try:
        await asyncio.to_thread(
            lambda: admin.table("users")
            .update({"failed_login_count": 0, "locked_until": None})
            .eq("id", user_id)
            .execute()
        )
    except Exception as exc:
        logger.debug("Could not clear failed login for %s: %s", user_id, exc)


async def _mark_successful_login(user_id: str, *, email_verified: bool | None = None) -> None:
    """Single users-table write after a successful login."""
    admin = get_supabase_admin()
    payload: dict = {
        "failed_login_count": 0,
        "locked_until": None,
        "last_login": datetime.now(timezone.utc).isoformat(),
    }
    if email_verified is not None:
        payload["email_verified"] = email_verified
    try:
        await asyncio.to_thread(
            lambda: admin.table("users").update(payload).eq("id", user_id).execute()
        )
    except Exception as exc:
        logger.debug("Could not mark successful login for %s: %s", user_id, exc)


def _supabase_auth_request(
    path: str,
    payload: dict,
    *,
    bearer_token: str | None = None,
    method: str = "POST",
) -> dict:
    """Call Supabase Auth directly for recovery flows not covered by supabase-py."""
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise HTTPException(
            status_code=500, detail="Authentication provider is not configured."
        )

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
        raise HTTPException(
            status_code=502, detail="Authentication provider rejected the request."
        )
    except Exception as exc:
        logger.error("Supabase auth request failed: %s", exc)
        raise HTTPException(
            status_code=502, detail="Authentication provider is unavailable."
        )


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
    "small_provider": "support_coordinator",
    "managing_director": "managing_director",
}
VALID_ACCOUNT_TYPES = set(_ACCOUNT_TYPE_TO_ROLE.keys())


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class LoginRequest(BaseModel):
    email: str = ""
    identifier: str = ""
    password: str
    remember_device: bool = False
    device_id: str = ""

    @model_validator(mode="after")
    def _require_identifier(self):
        if not (self.identifier or self.email).strip():
            raise ValueError("Email or mobile number is required")
        return self

    def resolved_identifier(self) -> str:
        return (self.identifier or self.email).strip()


class MfaLoginRequest(BaseModel):
    mfa_challenge_token: str
    code: str = Field(min_length=6, max_length=12)
    trust_device: bool = False
    device_id: str = ""


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
    address: Optional[str] = None
    org_address: Optional[str] = None


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
        result = await asyncio.to_thread(
            lambda: supabase.table("users")
            .select(
                "role, full_name, account_type, onboarding_complete, organization_id, "
                "email_verified, profile_completed, onboarding_completed, "
                "role_specific_profile_completed, profile_photo_url"
            )
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        if result is not None and result.data:
            return result.data
        if result is not None and result.data is None:
            # Row simply doesn't exist yet — return empty dict
            return {}
    except Exception as e1:
        logger.debug(f"Extended user profile select failed for {user_id}: {e1}")

    # Pass 2: base columns only (always available)
    try:
        result = await asyncio.to_thread(
            lambda: supabase.table("users")
            .select("role, full_name, email_verified, onboarding_complete")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
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
        "email_verified": bool(extra.get("email_verified"))
        if extra and "email_verified" in extra
        else False,
        "profile_completed": bool(extra.get("profile_completed"))
        if extra and "profile_completed" in extra
        else onboarding_complete,
        "onboarding_completed": bool(extra.get("onboarding_completed"))
        if extra and "onboarding_completed" in extra
        else onboarding_complete,
        "role_specific_profile_completed": bool(
            extra.get("role_specific_profile_completed")
        )
        if extra and "role_specific_profile_completed" in extra
        else onboarding_complete,
    }
    if extra:
        extended_payload.update(extra)

    # Pass 1: with new columns
    try:
        await asyncio.to_thread(
            lambda: supabase.table("users").upsert(extended_payload, on_conflict="id").execute()
        )
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
        await asyncio.to_thread(
            lambda: supabase.table("users").upsert(base_payload, on_conflict="id").execute()
        )
    except Exception as e2:
        logger.warning(f"Base upsert also failed for {user_id}: {e2}")


async def _resolve_org_member_role(
    user_id: str, org_id: str, fallback_role: str
) -> str:
    """Upsert into organization_members and return the authoritative role.

    If a membership already exists we trust its role (admin may have changed it
    in the Team panel). If no row exists (first login after onboarding), we
    create one with the fallback_role derived from users.role.
    Returns the final role to embed in the JWT.
    """
    try:
        supabase = get_supabase_admin()

        # Look up an existing active membership first
        existing = await asyncio.to_thread(
            lambda: supabase.table("organization_members")
            .select("role")
            .eq("user_id", user_id)
            .eq("organization_id", org_id)
            .eq("is_active", "true")
            .limit(1)
            .execute()
        )
        if existing.data:
            return existing.data[0].get("role") or fallback_role

        # No row yet — create it (idempotent via UNIQUE constraint)
        await asyncio.to_thread(
            lambda: supabase.table("organization_members").insert(
                {
                    "user_id": user_id,
                    "organization_id": org_id,
                    "role": fallback_role,
                    "is_active": True,
                }
            ).execute()
        )
        return fallback_role

    except Exception as e:
        logger.debug(f"_resolve_org_member_role({user_id}): {e}")
        return fallback_role


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
            raise HTTPException(
                status_code=400, detail="Registration failed — please try again"
            )

    except HTTPException:
        raise
    except Exception as e:
        err_msg = str(e)
        logger.error(f"Admin create_user failed for {body.email}: {err_msg}")
        if (
            "already registered" in err_msg.lower()
            or "already been registered" in err_msg.lower()
            or "already exists" in err_msg.lower()
        ):
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
            logger.warning(
                "Could not send verification email for %s: %s", body.email, exc
            )

    return {
        "message": "Account created successfully. Verify your email before signing in.",
        "user_id": str(auth_user.id),
        "account_type": body.account_type,
        "role": role,
        "email_confirmed": settings.auth_auto_confirm_email,
    }


def _serialize_supabase_session(session) -> dict | None:
    """Expose Supabase Auth tokens for client-side Realtime (RLS uses auth.uid())."""
    if not session:
        return None
    access = getattr(session, "access_token", None) or (session.get("access_token") if isinstance(session, dict) else None)
    refresh = getattr(session, "refresh_token", None) or (session.get("refresh_token") if isinstance(session, dict) else None)
    if not access or not refresh:
        return None
    expires_at = getattr(session, "expires_at", None) or (session.get("expires_at") if isinstance(session, dict) else None)
    return {
        "access_token": str(access),
        "refresh_token": str(refresh),
        "expires_at": int(expires_at) if expires_at is not None else None,
    }


async def _finalize_login_response(
    *,
    auth_user,
    profile: dict,
    role: str,
    account_type: str,
    organization_id,
    remember_device: bool,
    request: Request,
    device_id: str | None,
    background_tasks: BackgroundTasks,
    supabase_session=None,
) -> dict:
    onboarding_complete = profile.get("onboarding_complete")
    if onboarding_complete is None:
        onboarding_complete = True
    full_name = profile.get("full_name") or (
        auth_user.user_metadata.get("full_name", "") if auth_user.user_metadata else ""
    )
    email_verified = _is_auth_user_email_verified(auth_user)
    if not email_verified:
        email_verified = (
            bool(profile.get("email_verified")) and settings.auth_auto_confirm_email
        )

    session_jti = str(uuid.uuid4())
    token_expiry = (
        timedelta(days=_REMEMBER_DEVICE_DAYS)
        if remember_device
        else timedelta(minutes=settings.access_token_expire_minutes)
    )
    token = create_access_token(
        {
            "sub": str(auth_user.id),
            "email": str(auth_user.email),
            "role": role,
            "account_type": account_type,
            "organization_id": organization_id,
            "jti": session_jti,
        },
        expires_delta=token_expiry,
    )

    user_agent = request.headers.get("user-agent")
    client_ip = request.client.host if request.client else "unknown"
    user_id = str(auth_user.id)
    city, country = await dss.record_login_event(
        user_id,
        email=str(auth_user.email),
        device_id=device_id,
        user_agent=user_agent,
        ip_address=client_ip,
        background_tasks=background_tasks,
    )

    email_verified_update = (
        email_verified if email_verified != bool(profile.get("email_verified")) else None
    )
    await asyncio.gather(
        _mark_successful_login(user_id, email_verified=email_verified_update),
        asyncio.to_thread(
            dss.create_session,
            user_id,
            session_jti,
            device_id=device_id,
            user_agent=user_agent,
            ip_address=client_ip,
            city=city,
            country=country,
        ),
    )
    if device_id and remember_device:
        device_name, os_name = dss.parse_user_agent(user_agent)
        background_tasks.add_task(
            dss.trust_device,
            user_id,
            device_id,
            device_name=device_name,
            os_name=os_name,
            user_agent=user_agent,
        )

    response: dict = {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(auth_user.id),
            "email": str(auth_user.email),
            "full_name": full_name,
            "role": role,
            "account_type": account_type,
            "organization_id": organization_id,
            "onboarding_complete": bool(onboarding_complete),
            "email_verified": email_verified,
            "profile_completed": bool(profile.get("profile_completed")),
            "onboarding_completed": bool(
                profile.get("onboarding_completed") or onboarding_complete
            ),
            "role_specific_profile_completed": bool(
                profile.get("role_specific_profile_completed")
            ),
            "profile_photo_url": profile.get("profile_photo_url"),
        },
    }
    supabase_payload = _serialize_supabase_session(supabase_session)
    if supabase_payload:
        response["supabase_session"] = supabase_payload
    return response


@router.post("/login")
async def login(body: LoginRequest, request: Request, background_tasks: BackgroundTasks):
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)

    login_email = await _resolve_login_email(body.resolved_identifier())
    await _check_account_lockout(login_email)

    supabase = get_supabase()
    try:
        result = await asyncio.to_thread(
            supabase.auth.sign_in_with_password,
            {
                "email": login_email,
                "password": body.password,
            },
        )
        auth_user = result.user
        if not auth_user or not result.session:
            await _record_failed_login(login_email, background_tasks)
            raise HTTPException(status_code=401, detail="Incorrect email or password")
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
            logger.error(
                "Authentication provider unreachable for %s: %s", login_email, e
            )
            raise HTTPException(
                status_code=503,
                detail=(
                    "Authentication provider is unreachable. Check Docker internet/DNS "
                    "and Supabase configuration, then try again."
                ),
            )
        logger.warning("Login failed for %s: %s", login_email, e)
        await _record_failed_login(login_email, background_tasks)
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    profile, mfa_settings = await asyncio.gather(
        _get_user_profile(str(auth_user.id)),
        asyncio.to_thread(dss.get_mfa_settings, str(auth_user.id)),
    )
    role = profile.get("role") or "support_worker"
    full_name = profile.get("full_name") or (
        auth_user.user_metadata.get("full_name", "") if auth_user.user_metadata else ""
    )
    account_type = profile.get("account_type") or "independent_worker"
    organization_id = profile.get("organization_id")
    email_verified = _is_auth_user_email_verified(auth_user)
    if not email_verified:
        email_verified = (
            bool(profile.get("email_verified")) and settings.auth_auto_confirm_email
        )

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

    # T001: Resolve authoritative role from organization_members.
    # If the user belongs to an org, their membership row is the source of truth
    # (an admin may have changed their role in the Team panel since last login).
    # This also seeds the membership row on first login after onboarding.
    if organization_id:
        role = await _resolve_org_member_role(str(auth_user.id), organization_id, role)

    device_id = (body.device_id or request.headers.get("x-device-id") or "").strip() or None
    if mfa_settings.get("mfa_enabled") and not dss.is_device_trusted(str(auth_user.id), device_id):
        challenge_payload: dict = {
            "sub": str(auth_user.id),
            "email": str(auth_user.email),
            "type": "mfa_challenge",
            "role": role,
            "account_type": account_type,
            "organization_id": organization_id,
            "remember_device": body.remember_device,
            "device_id": device_id,
        }
        supabase_for_mfa = _serialize_supabase_session(result.session)
        if supabase_for_mfa:
            challenge_payload["supabase_refresh"] = supabase_for_mfa["refresh_token"]
        challenge = create_access_token(
            challenge_payload,
            expires_delta=timedelta(minutes=5),
        )
        return {
            "mfa_required": True,
            "mfa_challenge_token": challenge,
            "mfa_method": mfa_settings.get("mfa_method") or "totp",
        }

    return await _finalize_login_response(
        auth_user=auth_user,
        profile=profile,
        role=role,
        account_type=account_type,
        organization_id=organization_id,
        remember_device=body.remember_device,
        request=request,
        device_id=device_id,
        background_tasks=background_tasks,
        supabase_session=result.session,
    )


@router.post("/login/mfa")
async def login_mfa(body: MfaLoginRequest, request: Request, background_tasks: BackgroundTasks):
    payload = decode_access_token(body.mfa_challenge_token)
    if not payload or payload.get("type") != "mfa_challenge":
        raise HTTPException(status_code=401, detail="MFA challenge expired. Sign in again.")

    user_id = payload.get("sub")
    if not user_id or not dss.verify_mfa_login(str(user_id), body.code):
        raise HTTPException(status_code=401, detail="Invalid verification code.")

    profile = await _get_user_profile(str(user_id))
    role = payload.get("role") or profile.get("role") or "support_worker"
    account_type = payload.get("account_type") or profile.get("account_type") or "independent_worker"
    organization_id = payload.get("organization_id") or profile.get("organization_id")
    device_id = (body.device_id or payload.get("device_id") or request.headers.get("x-device-id") or "").strip() or None
    remember_device = bool(payload.get("remember_device"))

    class _AuthUserShim:
        id = str(user_id)
        email = payload.get("email") or profile.get("email")
        user_metadata = {"full_name": profile.get("full_name") or ""}
        email_confirmed_at = None

    supabase_session = None
    refresh_token = payload.get("supabase_refresh")
    if refresh_token:
        try:
            refreshed = await asyncio.to_thread(
                get_supabase().auth.refresh_session,
                str(refresh_token),
            )
            supabase_session = refreshed.session
        except Exception as exc:
            logger.debug("Could not refresh Supabase session after MFA: %s", exc)

    response = await _finalize_login_response(
        auth_user=_AuthUserShim(),
        profile=profile,
        role=role,
        account_type=account_type,
        organization_id=organization_id,
        remember_device=remember_device,
        request=request,
        device_id=device_id,
        background_tasks=background_tasks,
        supabase_session=supabase_session,
    )
    if body.trust_device and device_id:
        device_name, os_name = dss.parse_user_agent(request.headers.get("user-agent"))
        dss.trust_device(
            str(user_id),
            device_id,
            device_name=device_name,
            os_name=os_name,
            user_agent=request.headers.get("user-agent"),
        )
    return response


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
    # Support workers still have a dedicated /worker-onboarding checklist to
    # complete (and must not be rosterable until they finish it), so this
    # generic step should only mark profile_completed here, not the
    # role-specific/overall onboarding flags.
    is_support_worker = current_user.get("role") == "support_worker"
    update_payload: dict = {
        "account_type": body.account_type,
        "onboarding_data": body.onboarding_data,
        "profile_completed": True,
        "onboarding_complete": not is_support_worker,
        "role_specific_profile_completed": not is_support_worker,
        "onboarding_completed": not is_support_worker,
    }

    # For small providers: create an organisation only when the user is not
    # already linked (e.g. joining via invitation must not spawn a second org).
    existing_org_id = current_user.get("organization_id")
    if not existing_org_id:
        try:
            profile = (
                supabase.table("users")
                .select("organization_id")
                .eq("id", user_id)
                .limit(1)
                .execute()
            )
            if profile.data:
                existing_org_id = profile.data[0].get("organization_id")
        except Exception as e:
            logger.debug("Could not load existing organization_id for %s: %s", user_id, e)

    if (
        body.account_type == "small_provider"
        and body.organization_name
        and not existing_org_id
    ):
        try:
            org_address = (body.org_address or body.address or "").strip() or None
            org_payload = {
                "owner_user_id": user_id,
                "organization_name": body.organization_name,
                "provider_type": body.provider_type,
                "registration_status": body.registration_status,
                "team_size": body.team_size,
                "participant_volume": body.participant_volume,
                "contact_number": body.contact_number,
                "org_address": org_address,
            }
            org_payload = {k: v for k, v in org_payload.items() if v is not None}
            org_result = supabase.table("organizations").insert(org_payload).execute()
            if org_result.data:
                row = org_result.data[0]
                update_payload["organization_id"] = (
                    row.get("organization_id") or row.get("id")
                )
        except Exception as e:
            logger.warning(f"Could not create organisation for {user_id}: {e}")
    elif existing_org_id:
        update_payload["organization_id"] = existing_org_id
        if body.organization_name or body.provider_type or body.team_size or body.address or body.org_address:
            update_payload["onboarding_data"] = {
                **(body.onboarding_data or {}),
                "organization_name": body.organization_name,
                "provider_type": body.provider_type,
                "registration_status": body.registration_status,
                "team_size": body.team_size,
                "participant_volume": body.participant_volume,
                "contact_number": body.contact_number,
                "address": body.address or body.org_address,
            }

    # Two-pass update: with new columns, then fallback
    try:
        supabase.table("users").update(update_payload).eq("id", user_id).execute()
    except Exception as e:
        err = str(e)
        if "42703" in err or "does not exist" in err:
            logger.warning(
                f"Onboarding columns missing — skipping extended update for {user_id}"
            )
            # At minimum record that onboarding happened (if base column exists)
        else:
            logger.error(f"Could not complete onboarding for {user_id}: {e}")
            raise HTTPException(
                status_code=500, detail="Could not save your profile. Please try again."
            )

    return {
        "success": True,
        "message": "Onboarding complete.",
        "organization_id": update_payload.get("organization_id")
        or current_user.get("organization_id"),
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
    if len(password) < 10:
        raise HTTPException(
            status_code=422, detail="Password must be at least 10 characters."
        )
    if not token and token_hash:
        verify_result = _supabase_auth_request(
            "verify",
            {"type": "recovery", "token_hash": token_hash},
            method="POST",
        )
        token = verify_result.get("access_token") or verify_result.get(
            "session", {}
        ).get("access_token", "")
    if not token:
        raise HTTPException(
            status_code=422, detail="Reset token is missing or expired."
        )

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


class SupabaseRefreshBody(BaseModel):
    refresh_token: str = Field(min_length=10)


@router.post("/supabase-refresh")
async def refresh_supabase_session(
    body: SupabaseRefreshBody,
    current_user: dict = Depends(get_current_user),
):
    """Refresh Supabase Auth session for client-side Realtime subscriptions."""
    try:
        result = await asyncio.to_thread(
            get_supabase().auth.refresh_session,
            body.refresh_token,
        )
    except Exception as exc:
        logger.debug("Supabase refresh failed for %s: %s", current_user.get("sub"), exc)
        raise HTTPException(status_code=401, detail="Supabase session expired. Sign in again.")

    session_payload = _serialize_supabase_session(result.session)
    if not session_payload:
        raise HTTPException(status_code=401, detail="Supabase session unavailable.")
    return {"supabase_session": session_payload}


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
    full_name = (profile.get("full_name") or "").strip() or None
    return {
        "user": {
            "id": user_id,
            "email": current_user.get("email"),
            "full_name": full_name,
            "role": profile.get("role") or current_user.get("role", "support_worker"),
            "account_type": current_user.get("account_type")
            or profile.get("account_type")
            or "independent_worker",
            "organization_id": profile.get("organization_id")
            or current_user.get("organization_id"),
            "onboarding_complete": bool(onboarding_complete),
            "email_verified": bool(profile.get("email_verified")),
            "profile_completed": bool(profile.get("profile_completed")),
            "onboarding_completed": bool(
                profile.get("onboarding_completed") or onboarding_complete
            ),
            "role_specific_profile_completed": bool(
                profile.get("role_specific_profile_completed")
            ),
            "profile_photo_url": profile.get("profile_photo_url"),
        }
    }
