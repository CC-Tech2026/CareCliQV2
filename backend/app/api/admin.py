"""Super Admin Portal — CareCliQ's own vendor-side view across every
provider organisation. Every endpoint here is the one deliberate place in
the whole backend allowed to read/act across tenants; everywhere else in
the app scopes by the caller's own organization_id.

HARD BOUNDARY — B2B account data only, never clinical/participant data:

  ALLOWED   — organizations, users (a provider's own staff/business
              accounts: name, email, role, login activity), plan/status,
              billing (Stripe ids), aggregate usage buckets (team_size,
              participant_volume — coarse strings the provider chose at
              signup, not a live participant list).

  FORBIDDEN — patients, sessions, ndis_plans, incidents, credentials,
              shifts, or any other table holding an actual participant's
              name, NDIS number, goals, notes, or health information.
              CareCliQ staff manage the business relationship, not the
              provider's clients — a support engineer debugging an error
              should see "Error 500, Org abc-123", never the participant
              record that error happened to touch.

  Before adding a new query here, ask: does this touch a provider's own
  clients rather than the provider's account? If yes, it doesn't belong
  in this file — full stop, no exceptions for "just this one field"."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ..core.errors import internal_error_detail
from ..core.access import PARTICIPANT_ROLES, get_user_id, is_super_admin
from ..core.security import get_current_user
from ..services import admin_console_service as console
from ..services import bug_report_service
from ..services import data_import_service as import_svc
from ..services import stripe_service
from ..services import subscription_access
from ..services.audit_service import log_action
from ..services import device_security_service as dss
from ..services import jira_service
from ..services.object_storage import get_evidence_storage_backend
from ..services.supabase_client import get_supabase_admin
from ..core.config import settings
from ..services.email_service import queue_email_job, send_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_super_admin(user: dict) -> None:
    if not is_super_admin(user):
        raise HTTPException(status_code=403, detail="Super admin access required.")


class ProviderAccountCreate(BaseModel):
    organization_name: str = Field(min_length=1, max_length=200, pattern=r"\S")
    email: str = Field(max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _send_provider_setup(invite: dict, organization_name: str) -> dict:
    url = f"{settings.frontend_base_url.rstrip('/')}/accept-invite?token={invite['token']}"
    delivery = queue_email_job(
        label=f"provider-setup:{invite['id']}",
        send=lambda: send_email(
            to_email=invite["email"],
            subject=f"Set up your CareCliQ account for {organization_name}",
            text_body=(f"The CareCliQ team has prepared an account for {organization_name}.\n\n"
                       f"Choose your password and complete your organisation details here:\n{url}\n\n"
                       "This secure link expires in 7 days. Contact the CareCliQ team if you need help."),
        ),
    )
    return {"invite_url": url, "email_delivery": delivery}


@router.get("/provider-invitations")
async def list_provider_invitations(current_user: dict = Depends(get_current_user)):
    _require_super_admin(current_user)
    supabase = get_supabase_admin()
    try:
        rows = supabase.table("invitations").select(
            "id, organization_id, email, expires_at, accepted_at, created_at"
        ).eq("role", "managing_director").order("created_at", desc=True).execute().data or []
        orgs = supabase.table("organizations").select("organization_id, organization_name, name").execute().data or []
        names = {o["organization_id"]: o.get("organization_name") or o.get("name") for o in orgs}
        return [{**r, "organization_name": names.get(r["organization_id"], "Provider")} for r in rows]
    except Exception as exc:
        raise HTTPException(500, internal_error_detail("Could not load provider invitations", exc))


@router.post("/provider-invitations", status_code=201)
async def create_provider_account(body: ProviderAccountCreate, current_user: dict = Depends(get_current_user)):
    _require_super_admin(current_user)
    from .invitations import _generate_short_code
    supabase = get_supabase_admin()
    email = str(body.email).lower()
    try:
        if supabase.table("users").select("id").eq("email", email).limit(1).execute().data:
            raise HTTPException(409, "This email already has an account. Manage their existing provider instead.")
        if supabase.table("invitations").select("id").eq("email", email).eq("role", "managing_director").is_("accepted_at", "null").limit(1).execute().data:
            raise HTTPException(409, "A provider invitation already exists for this email. Resend it below.")
        name = body.organization_name.strip()
        org = supabase.table("organizations").insert({
            "name": name, "organization_name": name, "email": email, "status": "active",
        }).execute().data[0]
        try:
            invite = supabase.table("invitations").insert({
                "organization_id": org["organization_id"], "email": email,
                "role": "managing_director", "invited_by": None,
                "token": secrets.token_hex(32), "short_code": _generate_short_code(supabase),
                "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
            }).execute().data[0]
        except Exception:
            supabase.table("organizations").delete().eq("organization_id", org["organization_id"]).execute()
            raise
        return {"organization_id": org["organization_id"], **_send_provider_setup(invite, name)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, internal_error_detail("Could not create provider account", exc))


@router.post("/provider-invitations/{invitation_id}/resend")
async def resend_provider_invitation(invitation_id: str, current_user: dict = Depends(get_current_user)):
    _require_super_admin(current_user)
    supabase = get_supabase_admin()
    try:
        rows = supabase.table("invitations").select("*").eq("id", invitation_id).eq("role", "managing_director").execute().data
        if not rows:
            raise HTTPException(404, "Provider invitation not found.")
        invite = rows[0]
        if invite.get("accepted_at"):
            raise HTTPException(409, "This account has already been set up.")
        orgs = supabase.table("organizations").select("organization_name, name, status").eq("organization_id", invite["organization_id"]).execute().data
        if not orgs or orgs[0].get("status") in {"suspended", "offboarded"}:
            raise HTTPException(409, "Activate this provider before sending a setup invitation.")
        # Keep the same token so a previously delivered email remains usable.
        supabase.table("invitations").update({
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        }).eq("id", invitation_id).is_("accepted_at", "null").execute()
        return _send_provider_setup(invite, orgs[0].get("organization_name") or orgs[0].get("name") or "your organisation")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, internal_error_detail("Could not resend provider invitation", exc))


def _load_orgs(organization_id: str | None = None) -> list[dict]:
    # select("*") so optional columns from later migrations (org_type 189,
    # subscription_lapsed_at 246, access_override_until 273) are simply
    # absent on a database that doesn't have them yet, instead of failing.
    query = get_supabase_admin().table("organizations").select("*")
    if organization_id:
        query = query.eq("organization_id", organization_id)
    return query.order("created_at", desc=True).execute().data or []


@router.get("/organizations")
async def list_organizations(current_user: dict = Depends(get_current_user)):
    """Every provider org on the platform with account health and what needs
    attention (admin_console_service), for the dashboard and list view."""
    _require_super_admin(current_user)
    try:
        return console.snapshots(_load_orgs())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=internal_error_detail("Could not load organisations", exc))


def _admin_activity(organization_id: str, limit: int = 25) -> list[dict]:
    """What CareCliQ staff have done to this account, newest first."""
    try:
        rows = (
            get_supabase_admin().table("audit_logs")
            .select("action_type, user_id, after_state, details, created_at")
            .eq("organization_id", organization_id)
            .like("action_type", "admin.%")
            .order("created_at", desc=True)
            .limit(limit)
            .execute().data or []
        )
    except Exception as exc:
        logger.warning("admin activity read failed for %s: %s", organization_id, exc)
        return []
    actor_ids = sorted({r["user_id"] for r in rows if r.get("user_id")})
    names: dict[str, str] = {}
    if actor_ids:
        try:
            for u in get_supabase_admin().table("users").select("id, full_name, email").in_("id", actor_ids).execute().data or []:
                names[str(u["id"])] = u.get("full_name") or u.get("email") or "CareCliQ"
        except Exception:
            pass
    return [{**r, "actor_name": names.get(str(r.get("user_id")), "CareCliQ")} for r in rows]


@router.get("/organizations/{organization_id}")
async def get_organization(organization_id: str, current_user: dict = Depends(get_current_user)):
    """One provider's account: health, subscription, staff accounts, pending
    and held invitations, and what CareCliQ has done on it."""
    _require_super_admin(current_user)
    supabase = get_supabase_admin()
    try:
        orgs = _load_orgs(organization_id)
        if not orgs:
            raise HTTPException(status_code=404, detail="Organisation not found.")
        org = console.snapshots(orgs)[0]

        users = (
            supabase.table("users")
            .select("id, full_name, email, role, is_active, deactivation_reason, created_at, last_login")
            .eq("organization_id", organization_id)
            .order("created_at")
            .execute().data or []
        )
        # The provider's team only: participant portal logins are their
        # clients, which this portal never shows (see the module docstring).
        users = [u for u in users if u.get("role") not in PARTICIPANT_ROLES]
        now = datetime.now(timezone.utc).isoformat()
        try:
            invites = (
                supabase.table("invitations")
                .select("id, email, role, created_at, expires_at")
                .eq("organization_id", organization_id)
                .is_("accepted_at", "null")
                .gt("expires_at", now)
                .order("created_at", desc=True)
                .execute().data or []
            )
        except Exception:
            invites = []
        return {
            **org,
            "users": users,
            "pending_invitations": invites,
            "held_staff": import_svc.list_held_staff(organization_id),
            "admin_activity": _admin_activity(organization_id),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=internal_error_detail("Could not load organisation", exc))


async def _log_admin(action: str, organization_id: str, current_user: dict, *,
                     entity_type: str = "organization", entity_id: str | None = None,
                     before: dict | None = None, after: dict | None = None, reason: str | None = None) -> None:
    await log_action(
        action_type=f"admin.{action}", entity_type=entity_type, entity_id=entity_id or organization_id,
        user_id=get_user_id(current_user), organization_id=organization_id,
        before_state=before, after_state=after, details={"reason": reason} if reason else None,
    )


def _require_org(organization_id: str) -> dict:
    orgs = _load_orgs(organization_id)
    if not orgs:
        raise HTTPException(status_code=404, detail="Organisation not found.")
    return orgs[0]


# -- Subscription --------------------------------------------------------------
# CareCliQ-side only, by decision (2026-11-27): plan tier, free access until a
# date, and extending a Stripe trial. Prices, refunds and cancellations stay in
# the Stripe dashboard.

class SubscriptionUpdate(BaseModel):
    # Only the plans on sale (platform_billing.ON_SALE_TIERS); organisations
    # already on Micro keep it until moved.
    plan_tier: Literal["small", "medium"] | None = None
    # ISO date or datetime; an empty string ends free access now.
    access_override_until: str | None = None
    access_override_reason: str | None = Field(default=None, max_length=300)
    reason: str = Field(min_length=3, max_length=300)


@router.patch("/organizations/{organization_id}/subscription")
async def update_subscription(
    organization_id: str, body: SubscriptionUpdate, current_user: dict = Depends(get_current_user)
):
    _require_super_admin(current_user)
    org = _require_org(organization_id)
    update: dict = {}
    if body.plan_tier is not None:
        update["plan_tier"] = body.plan_tier
    if body.access_override_until is not None:
        if body.access_override_until.strip() == "":
            update["access_override_until"] = None
            update["access_override_reason"] = None
        else:
            until = console._parse(body.access_override_until.strip())
            now = datetime.now(timezone.utc)
            if not until:
                raise HTTPException(status_code=422, detail="Free access needs a valid date.")
            if until <= now:
                raise HTTPException(status_code=422, detail="Free access has to end in the future.")
            if until > now + timedelta(days=366):
                raise HTTPException(status_code=422, detail="Free access can run for up to a year at a time.")
            update["access_override_until"] = until.isoformat()
            update["access_override_reason"] = (body.access_override_reason or body.reason).strip()
    if not update:
        raise HTTPException(status_code=422, detail="Nothing to change.")
    try:
        get_supabase_admin().table("organizations").update(update).eq("organization_id", organization_id).execute()
    except Exception as exc:
        if "access_override" in str(exc):
            raise HTTPException(status_code=409, detail="Free access needs database migration 273 first.")
        raise HTTPException(status_code=500, detail=internal_error_detail("Could not update subscription", exc))
    subscription_access.forget(organization_id)
    await _log_admin("subscription.updated", organization_id, current_user,
                     before={k: org.get(k) for k in update}, after=update, reason=body.reason)
    return {"ok": True, **update}


class TrialExtension(BaseModel):
    days: int = Field(ge=1, le=60)
    reason: str = Field(min_length=3, max_length=300)


@router.post("/organizations/{organization_id}/extend-trial")
async def extend_trial(organization_id: str, body: TrialExtension, current_user: dict = Depends(get_current_user)):
    """Pushes the Stripe trial end out, so their card isn't charged until
    then, and records the new date here. Only while they're still trialling."""
    _require_super_admin(current_user)
    org = _require_org(organization_id)
    sub_id = org.get("stripe_subscription_id")
    if not sub_id or org.get("subscription_status") != "trialing":
        raise HTTPException(
            status_code=409,
            detail="Only a Stripe trial that's still running can be extended. Give free access instead.",
        )
    now = datetime.now(timezone.utc)
    current_end = console._parse(org.get("trial_ends_at")) or now
    new_end = max(current_end, now) + timedelta(days=body.days)
    try:
        stripe_service.extend_trial(sub_id, new_end)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=internal_error_detail("Stripe didn't accept the new trial date", exc))
    get_supabase_admin().table("organizations").update(
        {"trial_ends_at": new_end.isoformat()}
    ).eq("organization_id", organization_id).execute()
    subscription_access.forget(organization_id)
    await _log_admin("trial.extended", organization_id, current_user,
                     before={"trial_ends_at": org.get("trial_ends_at")},
                     after={"trial_ends_at": new_end.isoformat(), "days": body.days}, reason=body.reason)
    return {"ok": True, "trial_ends_at": new_end.isoformat()}


# -- Staff accounts ------------------------------------------------------------

ADMIN_ASSIGNABLE_ROLES = ("support_worker", "support_coordinator")


def _require_org_user(organization_id: str, user_id: str) -> dict:
    rows = (
        get_supabase_admin().table("users")
        .select("id, email, full_name, role, is_active")
        .eq("id", user_id).eq("organization_id", organization_id)
        .limit(1).execute().data or []
    )
    if not rows or rows[0].get("role") in PARTICIPANT_ROLES:
        raise HTTPException(status_code=404, detail="That person isn't on this organisation's team.")
    return rows[0]


class UserAction(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


@router.post("/organizations/{organization_id}/users/{user_id}/deactivate")
async def deactivate_user(organization_id: str, user_id: str, body: UserAction,
                          current_user: dict = Depends(get_current_user)):
    """Signs them out everywhere and locks the account (reversible)."""
    _require_super_admin(current_user)
    target = _require_org_user(organization_id, user_id)
    db = get_supabase_admin()
    if target.get("role") == "managing_director":
        directors = (
            db.table("users").select("id, is_active")
            .eq("organization_id", organization_id).eq("role", "managing_director").execute().data or []
        )
        if not [u for u in directors if u["id"] != user_id and u.get("is_active") is not False]:
            raise HTTPException(status_code=409, detail="This is their only managing director. Suspend the organisation instead.")
    db.table("users").update({
        "is_active": False,
        "deactivated_at": datetime.now(timezone.utc).isoformat(),
        "deactivated_by": get_user_id(current_user),
        "deactivation_reason": "manual",
        "deactivation_note": body.reason,
    }).eq("id", user_id).eq("organization_id", organization_id).execute()
    db.table("organization_members").update({"is_active": False}).eq("user_id", user_id).eq("organization_id", organization_id).execute()
    dss.revoke_all_sessions(user_id)
    await _log_admin("user.deactivated", organization_id, current_user, entity_type="user", entity_id=user_id,
                     before={"is_active": True}, after={"is_active": False, "email": target.get("email")}, reason=body.reason)
    return {"ok": True}


@router.post("/organizations/{organization_id}/users/{user_id}/reactivate")
async def reactivate_user(organization_id: str, user_id: str, body: UserAction,
                          current_user: dict = Depends(get_current_user)):
    _require_super_admin(current_user)
    target = _require_org_user(organization_id, user_id)
    db = get_supabase_admin()
    db.table("users").update({
        "is_active": True, "deactivated_at": None, "deactivated_by": None,
        "deactivation_reason": None, "deactivation_note": None,
    }).eq("id", user_id).eq("organization_id", organization_id).execute()
    db.table("organization_members").update({"is_active": True}).eq("user_id", user_id).eq("organization_id", organization_id).execute()
    await _log_admin("user.reactivated", organization_id, current_user, entity_type="user", entity_id=user_id,
                     before={"is_active": False}, after={"is_active": True, "email": target.get("email")}, reason=body.reason)
    return {"ok": True}


@router.post("/organizations/{organization_id}/users/{user_id}/password-reset")
async def send_password_reset(organization_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    """Emails them the normal reset link. We never see or set the password."""
    _require_super_admin(current_user)
    target = _require_org_user(organization_id, user_id)
    from .auth import PasswordResetRequest, request_password_reset
    await request_password_reset(PasswordResetRequest(email=target["email"]))
    await _log_admin("user.password_reset_sent", organization_id, current_user, entity_type="user", entity_id=user_id,
                     after={"email": target.get("email")})
    return {"ok": True}


class RoleUpdate(BaseModel):
    role: Literal["support_worker", "support_coordinator"]
    reason: str = Field(min_length=3, max_length=300)


@router.patch("/organizations/{organization_id}/users/{user_id}/role")
async def change_user_role(organization_id: str, user_id: str, body: RoleUpdate,
                           current_user: dict = Depends(get_current_user)):
    """Worker <-> coordinator only. Managing directors are never changed here."""
    _require_super_admin(current_user)
    target = _require_org_user(organization_id, user_id)
    if target.get("role") not in ADMIN_ASSIGNABLE_ROLES:
        raise HTTPException(status_code=409, detail="Only support workers and coordinators can be changed here.")
    if target.get("role") == body.role:
        return {"ok": True, "role": body.role}
    db = get_supabase_admin()
    db.table("users").update({"role": body.role}).eq("id", user_id).eq("organization_id", organization_id).execute()
    db.table("organization_members").update({"role": body.role}).eq("user_id", user_id).eq("organization_id", organization_id).execute()
    dss.revoke_all_sessions(user_id)  # the new permissions apply from their next sign-in
    await _log_admin("user.role_changed", organization_id, current_user, entity_type="user", entity_id=user_id,
                     before={"role": target.get("role")}, after={"role": body.role, "email": target.get("email")},
                     reason=body.reason)
    return {"ok": True, "role": body.role}


# -- Importing records for a provider ------------------------------------------
# The one place a super admin writes participant data, and only data the
# provider handed us to bring across. Write-only: previews flag duplicates
# against existing records but never return them. Staff are held for the
# provider's MD to send (decision 2026-11-27), see data_import_service.

class AdminImportBody(BaseModel):
    records: list[dict] = Field(default_factory=list)
    source_system: str = "spreadsheet"


@router.post("/organizations/{organization_id}/import/parse")
async def admin_import_parse(
    organization_id: str,
    kind: str = Form(...),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    _require_super_admin(current_user)
    _require_org(organization_id)
    raw = await file.read(import_svc.MAX_FILE_BYTES + 1)
    try:
        return import_svc.parse_csv(raw, kind)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/organizations/{organization_id}/import/{kind}/preview")
async def admin_import_preview(organization_id: str, kind: Literal["participants", "staff"], body: AdminImportBody,
                               current_user: dict = Depends(get_current_user)):
    _require_super_admin(current_user)
    _require_org(organization_id)
    try:
        if kind == "participants":
            return {"results": import_svc.preview_participants(organization_id, body.records)}
        return {"results": import_svc.preview_staff(organization_id, body.records)}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/organizations/{organization_id}/import/{kind}")
async def admin_import(organization_id: str, kind: Literal["participants", "staff"], body: AdminImportBody,
                       current_user: dict = Depends(get_current_user)):
    _require_super_admin(current_user)
    _require_org(organization_id)
    actor = get_user_id(current_user)
    try:
        if kind == "participants":
            result = import_svc.import_participants(organization_id, actor, body.records, body.source_system)
        else:
            result = import_svc.hold_staff(organization_id, actor, body.records, body.source_system)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        if "held_staff_invitations" in str(exc):
            raise HTTPException(status_code=409, detail="Importing staff needs database migration 273 first.")
        raise HTTPException(status_code=500, detail=internal_error_detail("The import didn't finish", exc))
    await _log_admin(f"import.{kind}", organization_id, current_user,
                     after={"imported": result["imported"], "skipped": result["skipped"], "source_system": body.source_system})
    return result


@router.post("/organizations/{organization_id}/held-staff/discard")
async def admin_discard_held_staff(organization_id: str, current_user: dict = Depends(get_current_user)):
    """Takes back staff we prepared (e.g. the wrong file was imported)."""
    _require_super_admin(current_user)
    _require_org(organization_id)
    removed = import_svc.discard_held_staff(organization_id)
    await _log_admin("held_staff.discarded", organization_id, current_user, after={"discarded": removed})
    return {"discarded": removed}


class OrganizationTypeUpdate(BaseModel):
    org_type: Literal["aged_care", "disability", "aged_care_disability"]


@router.patch("/organizations/{organization_id}/org-type")
async def update_organization_type(
    organization_id: str, body: OrganizationTypeUpdate, current_user: dict = Depends(get_current_user)
):
    """Sets which service(s) a provider delivers — see 189_organization_org_type.sql
    for why this is a separate field from provider_type."""
    _require_super_admin(current_user)
    try:
        result = (
            get_supabase_admin()
            .table("organizations")
            .update({"org_type": body.org_type})
            .eq("organization_id", organization_id)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Organisation not found.")
        return {"ok": True, "org_type": body.org_type}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=internal_error_detail("Could not update organisation", exc))


@router.post("/organizations/{organization_id}/suspend")
async def suspend_organization(organization_id: str, current_user: dict = Depends(get_current_user)):
    """Locks the provider out immediately — sets status and revokes every
    live session for that org's users in the same action, so it takes
    effect on their very next request, not just their next login."""
    _require_super_admin(current_user)
    supabase = get_supabase_admin()
    try:
        result = (
            supabase.table("organizations")
            .update({"status": "suspended"})
            .eq("organization_id", organization_id)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Organisation not found.")
        revoked_count = dss.revoke_all_sessions_for_org(organization_id)
        await _log_admin("organization.suspended", organization_id, current_user,
                         after={"status": "suspended", "sessions_revoked": revoked_count})
        return {"ok": True, "status": "suspended", "sessions_revoked": revoked_count}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=internal_error_detail("Could not suspend organisation", exc))


@router.post("/organizations/{organization_id}/activate")
async def activate_organization(organization_id: str, current_user: dict = Depends(get_current_user)):
    """Restores access — the org's users will need to log in again since
    suspension already revoked their sessions, which is expected."""
    _require_super_admin(current_user)
    supabase = get_supabase_admin()
    try:
        result = (
            supabase.table("organizations")
            .update({"status": "active"})
            .eq("organization_id", organization_id)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Organisation not found.")
        await _log_admin("organization.reactivated", organization_id, current_user, after={"status": "active"})
        return {"ok": True, "status": "active"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=internal_error_detail("Could not activate organisation", exc))


# Bug reports & Improvements/Feedback — staff-submitted, via
# /api/bug-reports and /api/improvement-feedback respectively (see
# bug_reports.py and improvement_feedback.py). Cross-org listing/triage for
# both lives here, same as everything else in this file: a provider's own
# coordinators/MD never see these, only CareCliQ. The two tables share an
# identical shape (org, submitter, description, status), so the query and
# status-update logic is factored into shared helpers below rather than
# duplicated per feature. Bug reports alone carry Jira sync (create,
# outbound/inbound status sync) — feedback is a plain internal list with no
# external integration, so its two endpoints below opt the shared helpers
# out of any Jira behaviour (include_jira=False, sync_jira=False). Bug
# reports also never surface who reported them (include_reporter=False) —
# a report is identified by which org hit it, not which staff member did.

_FEEDBACK_STATUSES = {"open", "in_progress", "resolved"}


class BugReportStatusUpdate(BaseModel):
    status: str


class ImprovementFeedbackStatusUpdate(BaseModel):
    status: str


def _list_cross_org_feedback(
    table: str,
    submitter_column: str,
    select_columns: str,
    include_jira: bool = True,
    include_reporter: bool = True,
) -> list[dict]:
    supabase = get_supabase_admin()
    rows = (
        supabase.table(table).select(select_columns).order("created_at", desc=True).execute()
    ).data or []

    org_ids = list({r["organization_id"] for r in rows if r.get("organization_id")})
    orgs_by_id: dict[str, str] = {}
    if org_ids:
        orgs_result = (
            supabase.table("organizations")
            .select("organization_id, organization_name, name")
            .in_("organization_id", org_ids)
            .execute()
        )
        orgs_by_id = {
            o["organization_id"]: o.get("organization_name") or o.get("name") or "Unnamed organisation"
            for o in (orgs_result.data or [])
        }

    def _org_name(row: dict) -> str:
        # A null organization_id only ever occurs on bug_reports — a Super
        # Admin filed it as "Internal", not on behalf of any provider (see
        # 190_bug_reports_nullable_org.sql and bug_report_service's matching
        # _organization_display_name). improvement_feedback's organization_id
        # is still NOT NULL, so this branch never fires for that table.
        if row.get("organization_id") is None:
            return "Internal — Master Portal"
        return orgs_by_id.get(row["organization_id"], "Unknown organisation")

    # Skipped entirely for bug reports (include_reporter=False) — the Bug
    # Reports view identifies a report by which org hit it, never by which
    # staff member did (that's the individual's private info, not the
    # org's — see bug-reports.tsx's card footer). Not querying "users" at
    # all here, rather than just hiding the name client-side, means that
    # info never leaves the backend for this endpoint in the first place.
    names_by_id: dict[str, str] = {}
    if include_reporter:
        submitter_ids = list({r[submitter_column] for r in rows if r.get(submitter_column)})
        if submitter_ids:
            users_result = supabase.table("users").select("id, full_name, email").in_("id", submitter_ids).execute()
            names_by_id = {
                u["id"]: u.get("full_name") or u.get("email") or "Staff member" for u in (users_result.data or [])
            }

    return [
        {
            **r,
            "organization_name": _org_name(r),
            **(
                {"reporter_name": names_by_id.get(r.get(submitter_column), "Staff member")}
                if include_reporter
                else {}
            ),
            # Built server-side so the frontend never needs to know the
            # Jira site URL itself. Feedback has no Jira integration (see
            # improvement_feedback_service.py) — include_jira=False keeps
            # its rows from claiming a link they don't have.
            "jira_url": (
                jira_service.issue_url(r["jira_issue_key"]) if include_jira and r.get("jira_issue_key") else None
            ),
        }
        for r in rows
    ]


async def _update_feedback_status(
    table: str, record_id: str, new_status: str, not_found_label: str, sync_jira: bool = True
) -> dict:
    if new_status not in _FEEDBACK_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status.")
    result = (
        get_supabase_admin()
        .table(table)
        .update({"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", record_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail=f"{not_found_label} not found.")

    # Best-effort — keep the linked Jira issue's status in sync. Never lets
    # a Jira outage block the status update already saved above. Skipped
    # entirely for feedback (sync_jira=False) — it has no Jira integration.
    if sync_jira:
        issue_key = result.data[0].get("jira_issue_key")
        if issue_key:
            await jira_service.transition_issue(issue_key, new_status)

    return {"ok": True, "status": new_status}


class AdminBugReportAttachment(BaseModel):
    mime_type: str
    data: str = Field(description="Base64-encoded file content, optionally with a data: URL prefix.")


class AdminBugReportCreate(BaseModel):
    description: str = Field(min_length=1, max_length=5000)
    page_url: str | None = Field(default=None, max_length=500)
    attachments: list[AdminBugReportAttachment] = Field(default_factory=list)
    severity: str = "low"
    # None files this as "Internal" — about CareCliQ itself, not on behalf
    # of any provider (see 190_bug_reports_nullable_org.sql). A real staff
    # member never sends this field at all — see POST /bug-reports, which
    # always derives organization_id from their own session instead.
    organization_id: str | None = None


@router.post("/bug-reports")
async def create_bug_report(body: AdminBugReportCreate, current_user: dict = Depends(get_current_user)):
    """Lets a Super Admin file a bug report from inside the Master Portal
    itself (ReportBugPanel.tsx) — either "Internal" (organization_id=None)
    or on behalf of a specific provider they pick, unlike POST /bug-reports
    which always scopes to the reporter's own org and requires one to exist."""
    _require_super_admin(current_user)
    reporter_id = get_user_id(current_user)
    if not reporter_id:
        raise HTTPException(status_code=400, detail="User id required.")
    try:
        row = await bug_report_service.create_bug_report(
            body.organization_id,
            reporter_id,
            body.description,
            body.page_url,
            [a.model_dump() for a in body.attachments],
            body.severity,
        )
        return {"id": row["id"], "status": row["status"]}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=internal_error_detail("Could not file bug report", exc))


@router.get("/bug-reports")
async def list_bug_reports(current_user: dict = Depends(get_current_user)):
    """Every bug report across every provider, for the portal's Bug Reports view."""
    _require_super_admin(current_user)
    try:
        reports = _list_cross_org_feedback(
            "bug_reports",
            "reporter_id",
            "id, organization_id, page_url, description, status, severity, jira_issue_key, attachments, created_at, updated_at",
            include_reporter=False,
        )
        # Attachment URLs are signed and expire — generated fresh on every
        # read rather than stored, so a report opened weeks later still
        # has working links (see 183_bug_report_attachments.sql). Only
        # touches storage when at least one report actually has an
        # attachment, so the common no-attachments case skips it entirely.
        if any(r.get("attachments") for r in reports):
            backend = get_evidence_storage_backend()
            for report in reports:
                for attachment in report.get("attachments") or []:
                    attachment["url"] = backend.signed_url(attachment["storage_path"])
        return reports
    except Exception as exc:
        raise HTTPException(status_code=500, detail=internal_error_detail("Could not load bug reports", exc))


@router.patch("/bug-reports/{report_id}/status")
async def update_bug_report_status(
    report_id: str, body: BugReportStatusUpdate, current_user: dict = Depends(get_current_user)
):
    """Moves a report through Open -> In Progress -> Resolved."""
    _require_super_admin(current_user)
    try:
        return await _update_feedback_status("bug_reports", report_id, body.status, "Bug report")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=internal_error_detail("Could not update bug report", exc))


@router.get("/improvement-feedback")
async def list_improvement_feedback(current_user: dict = Depends(get_current_user)):
    """Every improvement/feature-request submission across every provider,
    for the portal's Improvements & Feedback view."""
    _require_super_admin(current_user)
    try:
        return _list_cross_org_feedback(
            "improvement_feedback",
            "submitted_by",
            "id, organization_id, submitted_by, description, status, created_at, updated_at",
            include_jira=False,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=internal_error_detail("Could not load improvement feedback", exc))


@router.patch("/improvement-feedback/{feedback_id}/status")
async def update_improvement_feedback_status(
    feedback_id: str, body: ImprovementFeedbackStatusUpdate, current_user: dict = Depends(get_current_user)
):
    """Moves a submission through Open -> In Progress -> Resolved."""
    _require_super_admin(current_user)
    try:
        return await _update_feedback_status(
            "improvement_feedback", feedback_id, body.status, "Feedback", sync_jira=False
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=internal_error_detail("Could not update improvement feedback", exc))
