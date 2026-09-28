"""Supabase-native MFA (TOTP) support.

This is the NEW, Supabase-native MFA implementation, built alongside the
older custom pyotp-based one in `device_security_service.py` /
`api/security.py`. It does not touch that code at all.

Key architectural point (see investigation notes in auth.py /
`_serialize_supabase_session`): our app's own JWT (issued by
`core.security.create_access_token`) never carries a Supabase access/refresh
token. Those live separately -- the login response's `supabase_session` field,
which the frontend stores in its own localStorage/sessionStorage slot
(`ccq_supabase_session`, see `artifacts/frontend/src/lib/auth-session.ts`)
purely for client-side Supabase Realtime.

Supabase's native `auth.mfa` API must be called as the authenticated user
(never with the service-role/admin client), which means every endpoint here
needs that user's live Supabase access_token + refresh_token passed up from
the frontend on each call. We reconstruct a short-lived, per-request
supabase-py client via `auth.set_session(...)` and use it only for the
duration of that request; nothing is cached or persisted server-side.
"""

from __future__ import annotations

import logging

from supabase import Client, create_client

from ..core.config import settings

logger = logging.getLogger(__name__)

# Friendly issuer name embedded in the TOTP URI / shown in authenticator apps.
MFA_ISSUER = "CareCliQ"


def user_scoped_client(access_token: str, refresh_token: str) -> Client:
    """Build a fresh supabase-py client authenticated as the current user.

    Uses the anon key (never the service-role key) plus `auth.set_session`,
    matching how Supabase expects MFA enroll/challenge/verify/unenroll calls
    to be scoped -- RLS and the MFA endpoints act on whichever user this
    session belongs to.
    """
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    client.auth.set_session(access_token, refresh_token)
    return client


def enroll_totp(access_token: str, refresh_token: str, *, friendly_name: str = "Authenticator app") -> dict:
    """Start enrollment of a new TOTP factor. Returns QR/secret/uri + factor id."""
    client = user_scoped_client(access_token, refresh_token)
    result = client.auth.mfa.enroll(
        {
            "factor_type": "totp",
            "issuer": MFA_ISSUER,
            "friendly_name": friendly_name,
        }
    )
    totp = result.totp
    return {
        "factor_id": result.id,
        "qr_code": totp.qr_code if totp else None,
        "secret": totp.secret if totp else None,
        "uri": totp.uri if totp else None,
    }


def verify_enrollment(access_token: str, refresh_token: str, *, factor_id: str, code: str) -> dict:
    """Confirm a just-enrolled TOTP factor with a 6-digit code.

    On success this both activates the factor AND elevates the session to
    aal2 -- Supabase returns a brand-new access/refresh token pair reflecting
    that, which callers should persist as the client's Supabase session.
    """
    client = user_scoped_client(access_token, refresh_token)
    result = client.auth.mfa.challenge_and_verify({"factor_id": factor_id, "code": code})
    return {
        "verified": True,
        "access_token": result.access_token,
        "refresh_token": result.refresh_token,
        "expires_in": result.expires_in,
    }


def list_factors_and_aal(access_token: str, refresh_token: str) -> dict:
    """Status used by the settings UI: is there a verified TOTP factor."""
    client = user_scoped_client(access_token, refresh_token)
    factors = client.auth.mfa.list_factors()
    aal = client.auth.mfa.get_authenticator_assurance_level()
    verified_totp = [f for f in factors.totp if getattr(f, "status", None) == "verified"]
    return {
        "enabled": bool(verified_totp),
        "factor_id": verified_totp[0].id if verified_totp else None,
        "current_level": aal.current_level,
        "next_level": aal.next_level,
    }


def unenroll_totp(access_token: str, refresh_token: str, *, factor_id: str) -> dict:
    client = user_scoped_client(access_token, refresh_token)
    result = client.auth.mfa.unenroll({"factor_id": factor_id})
    return {"unenrolled": True, "factor_id": result.id}


def get_authenticator_assurance_level(access_token: str, refresh_token: str) -> dict:
    client = user_scoped_client(access_token, refresh_token)
    aal = client.auth.mfa.get_authenticator_assurance_level()
    return {"current_level": aal.current_level, "next_level": aal.next_level}


def challenge_and_verify_login(access_token: str, refresh_token: str, *, factor_id: str, code: str) -> dict:
    """Step-up an aal1 session to aal2 during login, using the user's code.

    Same underlying call as `verify_enrollment` -- kept as a separate,
    clearly-named entry point for the login flow for readability at the
    call sites in `api/auth.py` / `api/auth_mfa.py`.
    """
    client = user_scoped_client(access_token, refresh_token)
    result = client.auth.mfa.challenge_and_verify({"factor_id": factor_id, "code": code})
    return {
        "access_token": result.access_token,
        "refresh_token": result.refresh_token,
        "expires_in": result.expires_in,
        "user": result.user,
    }
