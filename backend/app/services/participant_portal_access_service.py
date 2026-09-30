"""Participants Portal access — who may log in to see which participant.

One participant_portal_access row = one person's access to one participant
(see 230_participant_portal_access.sql). The MD grants a row and an invite
goes out; the invitee passes an identity check against something already on
file, sets a password, and the row becomes active. Every portal request is
then checked against an active row (assert_active_access) — never against a
participant id carried in the login token.

Every grant, invite, identity attempt, acceptance and revocation is written
to audit_logs, so "who could see this participant, and on whose authority"
is always answerable.
"""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException

from ..core.config import settings
from . import audit_service, email_service
from .password_policy import validate_password_policy
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

TABLE = "participant_portal_access"

RELATIONSHIPS = (
    "self", "plan_nominee", "correspondence_nominee", "guardian",
    "power_of_attorney", "registered_supporter", "parent", "consented_family",
)
RELATIONSHIP_LABELS = {
    "self": "Participant (self)",
    "plan_nominee": "NDIS plan nominee",
    "correspondence_nominee": "NDIS correspondence nominee",
    "guardian": "Guardian",
    "power_of_attorney": "Power of attorney",
    "registered_supporter": "Registered supporter",
    "parent": "Parent of a minor",
    "consented_family": "Family (participant consent)",
}
CONSENT_METHODS = ("written", "verbal")
IDENTITY_METHODS = ("participant_dob", "ndis_number", "code")
NOT_USING_REASONS = ("declined", "unable_no_representative", "no_email_or_device", "other")

INVITE_TTL = timedelta(days=7)
MAX_IDENTITY_ATTEMPTS = 5
# Passing the identity check unlocks set-password for this long only.
IDENTITY_VERIFIED_TTL = timedelta(minutes=30)

# Returned to the MD and never includes the token/code hashes.
_PUBLIC_FIELDS = (
    "id, organization_id, participant_id, user_id, email, full_name, relationship, "
    "authority_notes, consent_method, status, invite_expires_at, invite_sent_at, "
    "identity_method, identity_locked_at, granted_by, granted_at, accepted_at, "
    "revoked_by, revoked_at, revoked_reason"
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _normalise_email(email: str) -> str:
    return (email or "").strip().lower()


def _digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def _organization_name(org_id: str) -> str:
    try:
        from . import organization_branding_service

        branding = organization_branding_service.get_branding(org_id)
        return branding.get("display_name") or branding.get("organization_name") or "your care provider"
    except Exception as exc:
        logger.debug("Could not load organisation branding for portal invite: %s", exc)
        return "your care provider"


def _get_participant(participant_id: str, org_id: str, fields: str = "id, full_name, organization_id") -> dict[str, Any]:
    result = (
        get_supabase_admin()
        .table("participants")
        .select(fields)
        .eq("id", participant_id)
        .eq("organization_id", org_id)
        .maybe_single()
        .execute()
    )
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Participant not found.")
    return result.data


def _get_access_row(access_id: str, org_id: str) -> dict[str, Any]:
    result = (
        get_supabase_admin()
        .table(TABLE)
        .select("*")
        .eq("id", access_id)
        .eq("organization_id", org_id)
        .maybe_single()
        .execute()
    )
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Portal access not found.")
    return result.data


def _public_row(row: dict[str, Any]) -> dict[str, Any]:
    keys = [k.strip() for k in _PUBLIC_FIELDS.split(",")]
    out = {k: row.get(k) for k in keys}
    out["relationship_label"] = RELATIONSHIP_LABELS.get(row.get("relationship"), row.get("relationship"))
    out["invite_expired"] = bool(
        row.get("status") == "pending"
        and row.get("invite_expires_at")
        and _parse_iso(row["invite_expires_at"]) < _now()
    )
    return out


def _new_invite_fields(identity_method: str) -> tuple[dict[str, Any], str, Optional[str]]:
    """Fresh single-use token (+ one-off code for the "code" method).
    Returns (columns to store, raw token, raw code) — the raw values are only
    ever emailed / shown to the MD once, never stored."""
    token = secrets.token_urlsafe(32)
    code = f"{secrets.randbelow(1_000_000):06d}" if identity_method == "code" else None
    fields = {
        "invite_token_hash": _hash(token),
        "invite_expires_at": _iso(_now() + INVITE_TTL),
        "invite_sent_at": _iso(_now()),
        "identity_method": identity_method,
        "identity_code_hash": _hash(code) if code else None,
        "identity_failed_attempts": 0,
        "identity_locked_at": None,
        "identity_verified_at": None,
    }
    return fields, token, code


def _invite_path(token: str) -> str:
    return f"/participant-invite?token={token}"


def _send_invite_email(*, row: dict[str, Any], participant_name: str, token: str) -> dict[str, str]:
    org_name = _organization_name(row["organization_id"])
    url = f"{settings.frontend_base_url.rstrip('/')}{_invite_path(token)}"
    # No personal or health details in the email body — only who invited
    # them and the link. The participant's name is included only when the
    # invitee is someone other than the participant themselves.
    about = "" if row["relationship"] == "self" else f" so you can view {participant_name.split(' ')[0]}'s information"
    return email_service.queue_worker_notification_email(
        to_email=row["email"],
        subject=f"Set up your {org_name} portal account",
        title="You've been invited to the Participants Portal",
        message=(
            f"Hi {row['full_name'].split(' ')[0]},\n\n"
            f"{org_name} has invited you to their Participants Portal{about}.\n\n"
            "You'll be asked to confirm your identity, then set a password. "
            "You'll sign in with this email address.\n\n"
            "This link can be used once and expires in 7 days. "
            f"If you weren't expecting this, please contact {org_name}."
        ),
        action_url=url,
        cta_label="Set up your account",
    )


def _send_access_added_email(*, row: dict[str, Any], participant_name: str) -> dict[str, str]:
    org_name = _organization_name(row["organization_id"])
    url = f"{settings.frontend_base_url.rstrip('/')}/portal/login"
    return email_service.queue_worker_notification_email(
        to_email=row["email"],
        subject=f"You now have portal access to {participant_name.split(' ')[0]}",
        title="New portal access",
        message=(
            f"Hi {row['full_name'].split(' ')[0]},\n\n"
            f"{org_name} has given your existing portal account access to "
            f"{participant_name.split(' ')[0]}'s information. Sign in as usual and "
            "choose who to view.\n\n"
            f"If you weren't expecting this, please contact {org_name}."
        ),
        action_url=url,
        cta_label="Sign in",
    )


def _existing_user_by_email(email: str) -> Optional[dict[str, Any]]:
    result = (
        get_supabase_admin()
        .table("users")
        .select("id, role, organization_id, is_active")
        .ilike("email", email)
        .limit(1)
        .execute()
    )
    return (result.data or [None])[0]


# ── MD-facing ────────────────────────────────────────────────────────────


def portal_summary(participant_id: str, org_id: str) -> dict[str, Any]:
    """Everything the Portal access card shows: the derived status, every
    grant (including revoked ones, for history) and the not-using decision."""
    participant = _get_participant(
        participant_id,
        org_id,
        "id, full_name, email, portal_not_using_reason, portal_not_using_note, portal_review_date, "
        "portal_not_using_recorded_by, portal_not_using_recorded_at",
    )
    rows = (
        get_supabase_admin()
        .table(TABLE)
        .select(_PUBLIC_FIELDS)
        .eq("participant_id", participant_id)
        .eq("organization_id", org_id)
        .order("granted_at", desc=True)
        .execute()
    ).data or []
    access = [_public_row(r) for r in rows]
    live = [a for a in access if a["status"] != "revoked"]
    if any(a["status"] == "active" for a in live):
        status = "active"
    elif live:
        status = "pending"
    elif participant.get("portal_not_using_reason"):
        status = "not_using"
    else:
        status = "not_set"
    return {
        "participant_id": participant_id,
        "participant_name": participant.get("full_name"),
        "participant_email": participant.get("email"),
        "status": status,
        "not_using": {
            "reason": participant.get("portal_not_using_reason"),
            "note": participant.get("portal_not_using_note"),
            "review_date": participant.get("portal_review_date"),
            "recorded_by": participant.get("portal_not_using_recorded_by"),
            "recorded_at": participant.get("portal_not_using_recorded_at"),
        }
        if participant.get("portal_not_using_reason")
        else None,
        "access": access,
    }


async def grant_access(
    *,
    participant_id: str,
    org_id: str,
    actor_id: str,
    email: str,
    full_name: str,
    relationship: str,
    identity_method: str,
    authority_notes: Optional[str] = None,
    consent_method: Optional[str] = None,
) -> dict[str, Any]:
    email = _normalise_email(email)
    full_name = (full_name or "").strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=422, detail="A valid email address is required.")
    if not full_name:
        raise HTTPException(status_code=422, detail="Full name is required.")
    if relationship not in RELATIONSHIPS:
        raise HTTPException(status_code=422, detail="Invalid relationship.")
    if identity_method not in IDENTITY_METHODS:
        raise HTTPException(status_code=422, detail="Invalid identity check method.")
    if consent_method is not None and consent_method not in CONSENT_METHODS:
        raise HTTPException(status_code=422, detail="Invalid consent method.")
    # Anyone other than the participant needs a recorded basis for seeing
    # their information — a legal authority, or the participant's consent.
    if relationship != "self" and not (authority_notes or "").strip():
        raise HTTPException(
            status_code=422,
            detail="Record the authority or consent for this person (e.g. NDIA nominee letter, guardianship order).",
        )
    if relationship == "consented_family" and not consent_method:
        raise HTTPException(status_code=422, detail="Record how the participant gave consent (written or verbal).")

    participant = _get_participant(participant_id, org_id, "id, full_name, date_of_birth, ndis_number")
    if identity_method == "participant_dob" and not participant.get("date_of_birth"):
        raise HTTPException(status_code=422, detail="This participant has no date of birth on file — choose another identity check.")
    if identity_method == "ndis_number" and not _digits(participant.get("ndis_number")):
        raise HTTPException(status_code=422, detail="This participant has no NDIS number on file — choose another identity check.")

    supabase = get_supabase_admin()
    live = (
        supabase.table(TABLE)
        .select("id")
        .eq("participant_id", participant_id)
        .ilike("email", email)
        .neq("status", "revoked")
        .limit(1)
        .execute()
    ).data
    if live:
        raise HTTPException(status_code=409, detail="This person already has access or a pending invite for this participant.")

    existing_user = _existing_user_by_email(email)
    if existing_user and (
        existing_user.get("role") != "participant"
        or str(existing_user.get("organization_id")) != str(org_id)
    ):
        raise HTTPException(
            status_code=409,
            detail="This email is already used by another CareCliQ account and can't be used for portal access.",
        )

    row: dict[str, Any] = {
        "organization_id": org_id,
        "participant_id": participant_id,
        "email": email,
        "full_name": full_name,
        "relationship": relationship,
        "authority_notes": (authority_notes or "").strip() or None,
        "consent_method": consent_method,
        "granted_by": actor_id,
        "granted_at": _iso(_now()),
    }
    token: Optional[str] = None
    code: Optional[str] = None
    if existing_user:
        # Already has a portal login in this org (e.g. a parent getting
        # access to a second child) — attach to it, no new account or invite.
        row.update({"status": "active", "user_id": existing_user["id"], "accepted_at": _iso(_now())})
    else:
        invite_fields, token, code = _new_invite_fields(identity_method)
        row.update({"status": "pending", **invite_fields})

    inserted = supabase.table(TABLE).insert(row).execute()
    saved = (inserted.data or [row])[0]

    # Granting access supersedes an earlier "not using portal" decision.
    supabase.table("participants").update({
        "portal_not_using_reason": None,
        "portal_not_using_note": None,
        "portal_review_date": None,
        "portal_not_using_recorded_by": None,
        "portal_not_using_recorded_at": None,
    }).eq("id", participant_id).eq("organization_id", org_id).execute()

    if token:
        email_delivery = _send_invite_email(row=saved, participant_name=participant["full_name"], token=token)
    else:
        email_delivery = _send_access_added_email(row=saved, participant_name=participant["full_name"])

    await audit_service.log_action(
        action_type="participant_portal.access_granted",
        entity_type="participant",
        entity_id=participant_id,
        user_id=actor_id,
        organization_id=org_id,
        after_state=_public_row(saved),
        details={
            "access_id": saved.get("id"),
            "relationship": relationship,
            "linked_existing_login": bool(existing_user),
            "email_status": email_delivery.get("status"),
        },
    )
    return {
        "access": _public_row(saved),
        "invite_url": _invite_path(token) if token else None,
        # Shown to the MD once, to pass on by phone or in person.
        "identity_code": code,
        "email_delivery": email_delivery,
    }


async def resend_invite(*, access_id: str, org_id: str, actor_id: str) -> dict[str, Any]:
    row = _get_access_row(access_id, org_id)
    if row["status"] != "pending":
        raise HTTPException(status_code=409, detail="Only a pending invite can be resent.")
    participant = _get_participant(row["participant_id"], org_id)
    invite_fields, token, code = _new_invite_fields(row.get("identity_method") or "participant_dob")
    updated = (
        get_supabase_admin()
        .table(TABLE)
        .update({**invite_fields, "updated_at": _iso(_now())})
        .eq("id", access_id)
        .eq("organization_id", org_id)
        .execute()
    )
    saved = (updated.data or [{**row, **invite_fields}])[0]
    email_delivery = _send_invite_email(row=saved, participant_name=participant["full_name"], token=token)
    await audit_service.log_action(
        action_type="participant_portal.invite_resent",
        entity_type="participant",
        entity_id=row["participant_id"],
        user_id=actor_id,
        organization_id=org_id,
        details={"access_id": access_id, "email_status": email_delivery.get("status")},
    )
    return {
        "access": _public_row(saved),
        "invite_url": _invite_path(token),
        "identity_code": code,
        "email_delivery": email_delivery,
    }


async def revoke_access(*, access_id: str, org_id: str, actor_id: str, reason: str) -> dict[str, Any]:
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="A reason is required to revoke access.")
    row = _get_access_row(access_id, org_id)
    if row["status"] == "revoked":
        raise HTTPException(status_code=409, detail="This access is already revoked.")
    update = {
        "status": "revoked",
        "revoked_by": actor_id,
        "revoked_at": _iso(_now()),
        "revoked_reason": reason,
        # Kill any outstanding invite link.
        "invite_token_hash": None,
        "identity_code_hash": None,
        "updated_at": _iso(_now()),
    }
    updated = (
        get_supabase_admin()
        .table(TABLE)
        .update(update)
        .eq("id", access_id)
        .eq("organization_id", org_id)
        .execute()
    )
    saved = (updated.data or [{**row, **update}])[0]
    await audit_service.log_action(
        action_type="participant_portal.access_revoked",
        entity_type="participant",
        entity_id=row["participant_id"],
        user_id=actor_id,
        organization_id=org_id,
        before_state=_public_row(row),
        after_state=_public_row(saved),
        details={"access_id": access_id, "reason": reason},
    )
    return _public_row(saved)


async def set_not_using(
    *,
    participant_id: str,
    org_id: str,
    actor_id: str,
    reason: str,
    note: Optional[str],
    review_date: Optional[date],
) -> dict[str, Any]:
    if reason not in NOT_USING_REASONS:
        raise HTTPException(status_code=422, detail="Invalid reason.")
    if reason == "other" and not (note or "").strip():
        raise HTTPException(status_code=422, detail="Please describe the reason.")
    if not review_date:
        raise HTTPException(status_code=422, detail="A review date is required.")
    _get_participant(participant_id, org_id)
    live = (
        get_supabase_admin()
        .table(TABLE)
        .select("id")
        .eq("participant_id", participant_id)
        .eq("organization_id", org_id)
        .neq("status", "revoked")
        .limit(1)
        .execute()
    ).data
    if live:
        raise HTTPException(status_code=409, detail="Revoke existing portal access and invites first.")
    update = {
        "portal_not_using_reason": reason,
        "portal_not_using_note": (note or "").strip() or None,
        "portal_review_date": review_date.isoformat(),
        "portal_not_using_recorded_by": actor_id,
        "portal_not_using_recorded_at": _iso(_now()),
    }
    get_supabase_admin().table("participants").update(update).eq("id", participant_id).eq(
        "organization_id", org_id
    ).execute()
    await audit_service.log_action(
        action_type="participant_portal.not_using_recorded",
        entity_type="participant",
        entity_id=participant_id,
        user_id=actor_id,
        organization_id=org_id,
        after_state=update,
    )
    return portal_summary(participant_id, org_id)


# ── Public invite flow ───────────────────────────────────────────────────


def _get_invite_row(token: str) -> dict[str, Any]:
    if not token:
        raise HTTPException(status_code=404, detail="Invitation not found.")
    result = (
        get_supabase_admin()
        .table(TABLE)
        .select("*")
        .eq("invite_token_hash", _hash(token))
        .limit(1)
        .execute()
    )
    row = (result.data or [None])[0]
    if not row or row.get("status") == "revoked":
        raise HTTPException(status_code=404, detail="Invitation not found.")
    if row.get("status") == "active":
        raise HTTPException(status_code=410, detail="This invitation has already been used. Please sign in.")
    if not row.get("invite_expires_at") or _parse_iso(row["invite_expires_at"]) < _now():
        raise HTTPException(status_code=410, detail="This invitation has expired. Please ask your provider to resend it.")
    if row.get("identity_locked_at"):
        raise HTTPException(
            status_code=423,
            detail="Too many incorrect attempts. Please contact your provider to resend the invitation.",
        )
    return row


def invite_summary(token: str) -> dict[str, Any]:
    """What the set-up page shows before identity is confirmed — deliberately
    minimal: no participant details beyond a first name."""
    row = _get_invite_row(token)
    participant = _get_participant(row["participant_id"], row["organization_id"])
    return {
        "organization_name": _organization_name(row["organization_id"]),
        "invitee_first_name": row["full_name"].split(" ")[0],
        "email": row["email"],
        "relationship": row["relationship"],
        "participant_first_name": (participant.get("full_name") or "").split(" ")[0],
        "identity_method": row.get("identity_method"),
        "identity_verified": _identity_still_verified(row),
    }


def _identity_still_verified(row: dict[str, Any]) -> bool:
    verified_at = row.get("identity_verified_at")
    return bool(verified_at and _parse_iso(verified_at) + IDENTITY_VERIFIED_TTL > _now())


def _identity_matches(row: dict[str, Any], answer: str) -> bool:
    method = row.get("identity_method")
    answer = (answer or "").strip()
    if not answer:
        return False
    if method == "code":
        return bool(row.get("identity_code_hash")) and secrets.compare_digest(_hash(_digits(answer)), row["identity_code_hash"])
    participant = _get_participant(
        row["participant_id"], row["organization_id"], "id, full_name, date_of_birth, ndis_number"
    )
    if method == "participant_dob":
        stored = str(participant.get("date_of_birth") or "")[:10]
        return bool(stored) and secrets.compare_digest(answer[:10], stored)
    if method == "ndis_number":
        stored = _digits(participant.get("ndis_number"))
        return bool(stored) and secrets.compare_digest(_digits(answer), stored)
    return False


async def verify_identity(*, token: str, answer: str, ip_address: Optional[str]) -> dict[str, Any]:
    row = _get_invite_row(token)
    supabase = get_supabase_admin()
    if _identity_matches(row, answer):
        supabase.table(TABLE).update({
            "identity_verified_at": _iso(_now()),
            "identity_failed_attempts": 0,
            "updated_at": _iso(_now()),
        }).eq("id", row["id"]).execute()
        await audit_service.log_action(
            action_type="participant_portal.identity_verified",
            entity_type="participant",
            entity_id=row["participant_id"],
            organization_id=row["organization_id"],
            details={"access_id": row["id"], "method": row.get("identity_method")},
            ip_address=ip_address,
        )
        return {"verified": True}

    attempts = int(row.get("identity_failed_attempts") or 0) + 1
    update: dict[str, Any] = {"identity_failed_attempts": attempts, "updated_at": _iso(_now())}
    locked = attempts >= MAX_IDENTITY_ATTEMPTS
    if locked:
        update["identity_locked_at"] = _iso(_now())
    supabase.table(TABLE).update(update).eq("id", row["id"]).execute()
    await audit_service.log_action(
        action_type="participant_portal.identity_failed",
        entity_type="participant",
        entity_id=row["participant_id"],
        organization_id=row["organization_id"],
        details={"access_id": row["id"], "attempts": attempts, "locked": locked},
        ip_address=ip_address,
    )
    if locked:
        raise HTTPException(
            status_code=423,
            detail="Too many incorrect attempts. Please contact your provider to resend the invitation.",
        )
    remaining = MAX_IDENTITY_ATTEMPTS - attempts
    raise HTTPException(
        status_code=400,
        detail=f"That doesn't match our records. {remaining} attempt{'s' if remaining != 1 else ''} left.",
    )


async def accept_invite(*, token: str, password: str, ip_address: Optional[str]) -> dict[str, Any]:
    row = _get_invite_row(token)
    if not _identity_still_verified(row):
        raise HTTPException(status_code=403, detail="Please confirm your identity first.")
    policy_error = validate_password_policy(password or "")
    if policy_error:
        raise HTTPException(status_code=422, detail=policy_error)

    supabase = get_supabase_admin()
    email = row["email"]
    existing_user = _existing_user_by_email(email)
    if existing_user:
        # Accepted a second invite after already setting up a login from the
        # first one — link it rather than creating a duplicate account. The
        # password entered here is not applied; they keep their existing one.
        if existing_user.get("role") != "participant" or str(existing_user.get("organization_id")) != str(row["organization_id"]):
            raise HTTPException(status_code=409, detail="This email is already used by another account.")
        user_id = str(existing_user["id"])
        linked_existing = True
    else:
        try:
            created = supabase.auth.admin.create_user({
                "email": email,
                "password": password,
                "user_metadata": {"full_name": row["full_name"]},
                "email_confirm": True,
            })
            if not created.user:
                raise HTTPException(status_code=400, detail="Could not create your account — please try again.")
            user_id = str(created.user.id)
        except HTTPException:
            raise
        except Exception as exc:
            err = str(exc).lower()
            if "already" in err or "exists" in err:
                raise HTTPException(status_code=409, detail="An account with this email already exists. Please sign in.")
            logger.error("participant portal accept create_user error: %s", exc)
            raise HTTPException(status_code=400, detail="Could not create your account — please try again.")

        from ..api.auth import _upsert_user_record

        await _upsert_user_record(
            user_id=user_id,
            email=email,
            role="participant",
            full_name=row["full_name"],
            onboarding_complete=True,
            extra={
                "organization_id": row["organization_id"],
                "email_verified": True,
                "profile_completed": True,
                "onboarding_completed": True,
                "role_specific_profile_completed": True,
            },
        )
        linked_existing = False

    supabase.table(TABLE).update({
        "status": "active",
        "user_id": user_id,
        "accepted_at": _iso(_now()),
        # Single use: the link stops working the moment it's accepted.
        "invite_token_hash": None,
        "identity_code_hash": None,
        "updated_at": _iso(_now()),
    }).eq("id", row["id"]).execute()

    await audit_service.log_action(
        action_type="participant_portal.invite_accepted",
        entity_type="participant",
        entity_id=row["participant_id"],
        user_id=user_id,
        organization_id=row["organization_id"],
        details={"access_id": row["id"], "linked_existing_login": linked_existing},
        ip_address=ip_address,
    )

    org_name = _organization_name(row["organization_id"])
    email_service.queue_worker_notification_email(
        to_email=email,
        subject=f"Your {org_name} portal account is ready",
        title="Your portal account is ready",
        message=(
            f"Hi {row['full_name'].split(' ')[0]},\n\n"
            "Your Participants Portal account is set up. You sign in with this email address.\n\n"
            f"If you didn't do this, please contact {org_name} straight away."
        ),
        action_url=f"{settings.frontend_base_url.rstrip('/')}/portal/login",
        cta_label="Sign in",
    )
    return {"email": email, "linked_existing_login": linked_existing}


# ── Portal-side ──────────────────────────────────────────────────────────


def list_accessible_participants(user_id: str, org_id: Optional[str]) -> list[dict[str, Any]]:
    """The participants this login may view — drives the portal's picker."""
    query = (
        get_supabase_admin()
        .table(TABLE)
        .select("participant_id, relationship")
        .eq("user_id", user_id)
        .eq("status", "active")
    )
    if org_id:
        query = query.eq("organization_id", org_id)
    rows = query.execute().data or []
    if not rows:
        return []
    ids = list({str(r["participant_id"]) for r in rows})
    participants = (
        get_supabase_admin()
        .table("participants")
        .select("id, full_name, preferred_name, profile_photo_url")
        .in_("id", ids)
        .execute()
    ).data or []
    by_id = {str(p["id"]): p for p in participants}
    out = []
    for r in rows:
        p = by_id.get(str(r["participant_id"]))
        if not p:
            continue
        out.append({
            "participant_id": str(p["id"]),
            "full_name": p.get("full_name"),
            "preferred_name": p.get("preferred_name"),
            "profile_photo_url": p.get("profile_photo_url"),
            "relationship": r["relationship"],
            "relationship_label": RELATIONSHIP_LABELS.get(r["relationship"], r["relationship"]),
        })
    out.sort(key=lambda x: (x["relationship"] != "self", (x["full_name"] or "").lower()))
    return out


def assert_active_access(user_id: str, participant_id: str, org_id: Optional[str]) -> dict[str, Any]:
    """The Participants Portal's only access gate. 404 (not 403) so a probe
    can't tell "exists but not yours" from "doesn't exist"."""
    if not user_id or not participant_id:
        raise HTTPException(status_code=404, detail="Participant not found")
    query = (
        get_supabase_admin()
        .table(TABLE)
        .select("id, participant_id, relationship, organization_id")
        .eq("user_id", user_id)
        .eq("participant_id", participant_id)
        .eq("status", "active")
    )
    if org_id:
        query = query.eq("organization_id", org_id)
    rows = query.limit(1).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Participant not found")
    return rows[0]
