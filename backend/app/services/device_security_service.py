from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import pyotp

from ..core.config import settings
from .email_service import send_suspicious_login_email_safe
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

TRUSTED_DEVICE_DAYS = 30
RECOVERY_CODE_COUNT = 8
LOGIN_HISTORY_LIMIT = 20


def parse_user_agent(user_agent: str | None) -> tuple[str, str]:
    ua = user_agent or "Unknown device"
    os_name = "Unknown OS"
    device_name = "Unknown device"
    if "iPhone" in ua or "iPad" in ua:
        device_name = "iPhone/iPad"
        os_name = "iOS"
    elif "Android" in ua:
        device_name = "Android device"
        os_name = "Android"
    elif "Windows" in ua:
        device_name = "Windows PC"
        os_name = "Windows"
    elif "Macintosh" in ua or "Mac OS" in ua:
        device_name = "Mac"
        os_name = "macOS"
    elif "Linux" in ua:
        device_name = "Linux device"
        os_name = "Linux"
    browser = "Browser"
    if "Chrome" in ua and "Edg" not in ua:
        browser = "Chrome"
    elif "Firefox" in ua:
        browser = "Firefox"
    elif "Safari" in ua and "Chrome" not in ua:
        browser = "Safari"
    elif "Edg" in ua:
        browser = "Edge"
    return f"{device_name} · {browser}", os_name


async def lookup_geo(ip_address: str | None) -> tuple[str, str]:
    if not ip_address or ip_address in {"unknown", "127.0.0.1", "::1"}:
        return "Unknown city", "Unknown"
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            resp = await client.get(f"http://ip-api.com/json/{ip_address}?fields=status,country,city")
            data = resp.json()
            if data.get("status") == "success":
                return data.get("city") or "Unknown city", data.get("country") or "Unknown"
    except Exception as exc:
        logger.debug("Geo lookup failed for %s: %s", ip_address, exc)
    return "Unknown city", "Unknown"


def _admin():
    return get_supabase_admin()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash_code(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def get_mfa_settings(user_id: str) -> dict:
    result = (
        _admin()
        .table("users")
        .select("mfa_enabled, mfa_method, mfa_phone")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    return result.data if result and result.data else {}


def is_device_trusted(user_id: str, device_id: str | None) -> bool:
    if not device_id:
        return False
    try:
        result = (
            _admin()
            .table("user_trusted_devices")
            .select("id, trusted_until")
            .eq("user_id", user_id)
            .eq("device_id", device_id)
            .maybe_single()
            .execute()
        )
        if not result or not result.data:
            return False
        trusted_until = result.data.get("trusted_until")
        if not trusted_until:
            return False
        until = datetime.fromisoformat(str(trusted_until).replace("Z", "+00:00"))
        return until > _now()
    except Exception:
        return False


def trust_device(
    user_id: str,
    device_id: str,
    *,
    device_name: str,
    os_name: str,
    user_agent: str | None,
) -> None:
    trusted_until = (_now() + timedelta(days=TRUSTED_DEVICE_DAYS)).isoformat()
    _admin().table("user_trusted_devices").upsert(
        {
            "user_id": user_id,
            "device_id": device_id,
            "device_name": device_name,
            "os_name": os_name,
            "user_agent": user_agent,
            "trusted_until": trusted_until,
            "last_active_at": _now().isoformat(),
        },
        on_conflict="user_id,device_id",
    ).execute()


def start_totp_enrollment(user_id: str, email: str) -> dict:
    secret = pyotp.random_base32()
    _admin().table("users").update({"mfa_pending_secret": secret}).eq("id", user_id).execute()
    issuer = "CareCliQ"
    otpauth_url = pyotp.totp.TOTP(secret).provisioning_uri(name=email, issuer_name=issuer)
    return {"secret": secret, "otpauth_url": otpauth_url, "issuer": issuer}


def verify_totp_code(secret: str, code: str) -> bool:
    if not secret or not code:
        return False
    normalized = re.sub(r"\D", "", code)
    if len(normalized) != 6:
        return False
    totp = pyotp.TOTP(secret)
    return totp.verify(normalized, valid_window=1)


def _generate_recovery_codes(user_id: str) -> list[str]:
    _admin().table("user_mfa_recovery_codes").delete().eq("user_id", user_id).execute()
    codes = [secrets.token_hex(4).upper() for _ in range(RECOVERY_CODE_COUNT)]
    rows = [{"user_id": user_id, "code_hash": _hash_code(code)} for code in codes]
    _admin().table("user_mfa_recovery_codes").insert(rows).execute()
    return codes


def _consume_recovery_code(user_id: str, code: str) -> bool:
    normalized = code.strip().upper()
    if not normalized:
        return False
    digest = _hash_code(normalized)
    result = (
        _admin()
        .table("user_mfa_recovery_codes")
        .select("id, used_at")
        .eq("user_id", user_id)
        .eq("code_hash", digest)
        .maybe_single()
        .execute()
    )
    if not result or not result.data or result.data.get("used_at"):
        return False
    _admin().table("user_mfa_recovery_codes").update({"used_at": _now().isoformat()}).eq(
        "id", result.data["id"]
    ).execute()
    return True


def complete_totp_enrollment(user_id: str, code: str) -> list[str]:
    profile = (
        _admin()
        .table("users")
        .select("mfa_pending_secret")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    secret = profile.data.get("mfa_pending_secret") if profile and profile.data else None
    if not secret or not verify_totp_code(secret, code):
        raise ValueError("Invalid verification code.")
    _admin().table("users").update(
        {
            "mfa_enabled": True,
            "mfa_method": "totp",
            "mfa_totp_secret": secret,
            "mfa_pending_secret": None,
        }
    ).eq("id", user_id).execute()
    return _generate_recovery_codes(user_id)


def verify_mfa_login(user_id: str, code: str) -> bool:
    settings_row = get_mfa_settings(user_id)
    if not settings_row.get("mfa_enabled"):
        return True
    method = settings_row.get("mfa_method")
    if method == "totp":
        row = (
            _admin()
            .table("users")
            .select("mfa_totp_secret")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        secret = row.data.get("mfa_totp_secret") if row and row.data else None
        if secret and verify_totp_code(secret, code):
            return True
    if _consume_recovery_code(user_id, code):
        return True
    return False


def disable_mfa(user_id: str) -> None:
    _admin().table("users").update(
        {
            "mfa_enabled": False,
            "mfa_method": None,
            "mfa_totp_secret": None,
            "mfa_pending_secret": None,
            "mfa_phone": None,
        }
    ).eq("id", user_id).execute()
    _admin().table("user_mfa_recovery_codes").delete().eq("user_id", user_id).execute()


def create_session(
    user_id: str,
    session_jti: str,
    *,
    device_id: str | None,
    user_agent: str | None,
    ip_address: str | None,
    city: str,
    country: str,
) -> None:
    device_name, os_name = parse_user_agent(user_agent)
    _admin().table("user_sessions").insert(
        {
            "user_id": user_id,
            "session_jti": session_jti,
            "device_id": device_id,
            "device_name": device_name,
            "os_name": os_name,
            "user_agent": user_agent,
            "ip_address": ip_address,
            "city": city,
            "country": country,
            "last_active_at": _now().isoformat(),
        }
    ).execute()


def is_session_active(session_jti: str | None) -> bool:
    if not session_jti:
        return True
    try:
        result = (
            _admin()
            .table("user_sessions")
            .select("revoked_at")
            .eq("session_jti", session_jti)
            .maybe_single()
            .execute()
        )
        if not result or not result.data:
            return True
        return result.data.get("revoked_at") is None
    except Exception:
        return True


def touch_session(session_jti: str | None) -> None:
    if not session_jti:
        return
    try:
        _admin().table("user_sessions").update({"last_active_at": _now().isoformat()}).eq(
            "session_jti", session_jti
        ).execute()
    except Exception:
        pass


def list_sessions(user_id: str, current_jti: str | None) -> list[dict]:
    result = (
        _admin()
        .table("user_sessions")
        .select("*")
        .eq("user_id", user_id)
        .is_("revoked_at", "null")
        .order("last_active_at", desc=True)
        .execute()
    )
    rows = result.data or []
    output = []
    for row in rows:
        output.append(
            {
                "id": row.get("id"),
                "session_jti": row.get("session_jti"),
                "device_id": row.get("device_id"),
                "device_name": row.get("custom_name") or row.get("device_name"),
                "os_name": row.get("os_name"),
                "ip_address": row.get("ip_address"),
                "city": row.get("city"),
                "country": row.get("country"),
                "last_active_at": row.get("last_active_at"),
                "is_current": row.get("session_jti") == current_jti,
            }
        )
    return output


def rename_session(user_id: str, session_id: str, custom_name: str) -> None:
    _admin().table("user_sessions").update({"custom_name": custom_name.strip()}).eq(
        "id", session_id
    ).eq("user_id", user_id).execute()


def list_trusted_devices(user_id: str, current_device_id: str | None) -> list[dict]:
    result = (
        _admin()
        .table("user_trusted_devices")
        .select("*")
        .eq("user_id", user_id)
        .order("last_active_at", desc=True)
        .execute()
    )
    devices = []
    for row in result.data or []:
        devices.append(
            {
                "id": row.get("id"),
                "device_id": row.get("device_id"),
                "device_name": row.get("custom_name") or row.get("device_name"),
                "os_name": row.get("os_name"),
                "trusted_until": row.get("trusted_until"),
                "last_active_at": row.get("last_active_at"),
                "is_current": row.get("device_id") == current_device_id,
            }
        )
    return devices


def rename_trusted_device(user_id: str, device_row_id: str, custom_name: str) -> None:
    _admin().table("user_trusted_devices").update({"custom_name": custom_name.strip()}).eq(
        "id", device_row_id
    ).eq("user_id", user_id).execute()


def revoke_trusted_device(user_id: str, device_row_id: str) -> None:
    _admin().table("user_trusted_devices").delete().eq("id", device_row_id).eq(
        "user_id", user_id
    ).execute()


def revoke_other_sessions(user_id: str, current_jti: str | None) -> int:
    query = _admin().table("user_sessions").update({"revoked_at": _now().isoformat()}).eq(
        "user_id", user_id
    ).is_("revoked_at", "null")
    if current_jti:
        query = query.neq("session_jti", current_jti)
    result = query.execute()
    return len(result.data or [])


def revoke_all_sessions(user_id: str) -> None:
    _admin().table("user_sessions").update({"revoked_at": _now().isoformat()}).eq(
        "user_id", user_id
    ).is_("revoked_at", "null").execute()
    _admin().table("user_trusted_devices").delete().eq("user_id", user_id).execute()


def revoke_all_sessions_for_org(organization_id: str) -> int:
    """Immediately logs out every user in a provider organisation — used when
    the Super Admin suspends it. Reuses the same revoked_at check every
    request already goes through (is_session_active above), so this takes
    effect on each user's very next request, not just their next login."""
    users_result = (
        _admin().table("users").select("id").eq("organization_id", organization_id).execute()
    )
    user_ids = [row["id"] for row in (users_result.data or []) if row.get("id")]
    if not user_ids:
        return 0
    _admin().table("user_sessions").update({"revoked_at": _now().isoformat()}).in_(
        "user_id", user_ids
    ).is_("revoked_at", "null").execute()
    return len(user_ids)


async def _persist_login_event(
    user_id: str,
    *,
    email: str,
    device_id: str | None,
    user_agent: str | None,
    ip_address: str | None,
) -> tuple[str, str]:
    device_name, os_name = parse_user_agent(user_agent)
    city, country = await lookup_geo(ip_address)
    suspicious = _is_suspicious_login(user_id, device_id, country)
    await asyncio.to_thread(
        lambda: _admin().table("user_login_events").insert(
            {
                "user_id": user_id,
                "device_id": device_id,
                "device_name": device_name,
                "os_name": os_name,
                "ip_address": ip_address,
                "city": city,
                "country": country,
                "is_suspicious": suspicious,
            }
        ).execute()
    )
    if suspicious:
        token = create_account_security_token(user_id)
        secure_url = f"{settings.frontend_base_url.rstrip('/')}/account/secure?token={token}"
        send_suspicious_login_email_safe(
            to_email=email,
            device_name=device_name,
            city=city,
            country=country,
            secure_url=secure_url,
        )
    return city, country


def schedule_login_event_record(
    background_tasks: Any,
    user_id: str,
    *,
    email: str,
    device_id: str | None,
    user_agent: str | None,
    ip_address: str | None,
) -> None:
    """Record login audit/geo off the critical login response path."""
    background_tasks.add_task(
        _persist_login_event,
        user_id,
        email=email,
        device_id=device_id,
        user_agent=user_agent,
        ip_address=ip_address,
    )


async def record_login_event(
    user_id: str,
    *,
    email: str,
    device_id: str | None,
    user_agent: str | None,
    ip_address: str | None,
    background_tasks: Any | None = None,
) -> tuple[str, str]:
    if background_tasks is not None:
        schedule_login_event_record(
            background_tasks,
            user_id,
            email=email,
            device_id=device_id,
            user_agent=user_agent,
            ip_address=ip_address,
        )
        return "Unknown city", "Unknown"
    return await _persist_login_event(
        user_id,
        email=email,
        device_id=device_id,
        user_agent=user_agent,
        ip_address=ip_address,
    )


def _is_suspicious_login(user_id: str, device_id: str | None, country: str) -> bool:
    if country in {"Unknown", ""}:
        return False
    history = (
        _admin()
        .table("user_login_events")
        .select("country, device_id")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(LOGIN_HISTORY_LIMIT)
        .execute()
    )
    rows = history.data or []
    if not rows:
        return False
    known_countries = {row.get("country") for row in rows if row.get("country")}
    known_devices = {row.get("device_id") for row in rows if row.get("device_id")}
    new_country = country not in known_countries
    new_device = bool(device_id) and device_id not in known_devices
    return new_country or new_device


def list_login_history(user_id: str) -> list[dict]:
    result = (
        _admin()
        .table("user_login_events")
        .select("id, device_name, os_name, city, country, is_suspicious, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(LOGIN_HISTORY_LIMIT)
        .execute()
    )
    rows = []
    for row in result.data or []:
        rows.append(
            {
                **row,
                "location_label": f"{row.get('city') or 'Unknown city'}, {row.get('country') or 'Unknown'} (approximate location)",
            }
        )
    return rows


def create_account_security_token(user_id: str) -> str:
    raw = secrets.token_urlsafe(32)
    digest = _hash_code(raw)
    expires = (_now() + timedelta(hours=24)).isoformat()
    _admin().table("account_security_tokens").insert(
        {"user_id": user_id, "token_hash": digest, "expires_at": expires}
    ).execute()
    return raw


def consume_account_security_token(raw_token: str) -> str | None:
    digest = _hash_code(raw_token.strip())
    result = (
        _admin()
        .table("account_security_tokens")
        .select("id, user_id, expires_at, used_at")
        .eq("token_hash", digest)
        .maybe_single()
        .execute()
    )
    if not result or not result.data or result.data.get("used_at"):
        return None
    expires = datetime.fromisoformat(str(result.data["expires_at"]).replace("Z", "+00:00"))
    if expires < _now():
        return None
    user_id = str(result.data["user_id"])
    _admin().table("account_security_tokens").update({"used_at": _now().isoformat()}).eq(
        "id", result.data["id"]
    ).execute()
    revoke_all_sessions(user_id)
    return user_id
