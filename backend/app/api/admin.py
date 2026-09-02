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

from fastapi import APIRouter, Depends, HTTPException

from ..core.access import is_super_admin
from ..core.security import get_current_user
from ..services import device_security_service as dss
from ..services.supabase_client import get_supabase_admin

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_super_admin(user: dict) -> None:
    if not is_super_admin(user):
        raise HTTPException(status_code=403, detail="Super admin access required.")


@router.get("/organizations")
async def list_organizations(current_user: dict = Depends(get_current_user)):
    """Every provider org on the platform, for the portal's list view."""
    _require_super_admin(current_user)
    supabase = get_supabase_admin()
    try:
        orgs_result = (
            supabase.table("organizations")
            .select(
                "organization_id, organization_name, name, provider_type, status, "
                "plan_tier, team_size, participant_volume, created_at, "
                "stripe_customer_id, stripe_subscription_id"
            )
            .order("created_at", desc=True)
            .execute()
        )
        orgs = orgs_result.data or []

        org_ids = [o["organization_id"] for o in orgs if o.get("organization_id")]
        counts_by_org: dict[str, int] = {}
        if org_ids:
            users_result = (
                supabase.table("users")
                .select("organization_id")
                .in_("organization_id", org_ids)
                .execute()
            )
            for row in users_result.data or []:
                oid = row.get("organization_id")
                if oid:
                    counts_by_org[oid] = counts_by_org.get(oid, 0) + 1

        return [
            {
                **o,
                "display_name": o.get("organization_name") or o.get("name") or "Unnamed organisation",
                "status": o.get("status") or "active",
                "user_count": counts_by_org.get(o.get("organization_id"), 0),
            }
            for o in orgs
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load organisations: {exc}")


@router.get("/organizations/{organization_id}")
async def get_organization(organization_id: str, current_user: dict = Depends(get_current_user)):
    """One provider's full detail — org fields plus its users — for the portal's detail view."""
    _require_super_admin(current_user)
    supabase = get_supabase_admin()
    try:
        org_result = (
            supabase.table("organizations")
            .select("*")
            .eq("organization_id", organization_id)
            .maybe_single()
            .execute()
        )
        org = org_result.data if org_result else None
        if not org:
            raise HTTPException(status_code=404, detail="Organisation not found.")

        users_result = (
            supabase.table("users")
            .select("id, full_name, email, role, is_active, created_at, last_login")
            .eq("organization_id", organization_id)
            .order("created_at")
            .execute()
        )
        return {
            **org,
            "display_name": org.get("organization_name") or org.get("name") or "Unnamed organisation",
            "status": org.get("status") or "active",
            "users": users_result.data or [],
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load organisation: {exc}")


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
        return {"ok": True, "status": "suspended", "sessions_revoked": revoked_count}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not suspend organisation: {exc}")


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
        return {"ok": True, "status": "active"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not activate organisation: {exc}")
