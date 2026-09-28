"""Org abbreviation for the employee ID scheme (205_employee_id_scheme.sql).

New orgs set this at signup (auth.py complete_onboarding, stripe_service.py
signup checkout). This router is the retrofit path for orgs that existed
before the scheme did — their MD sets it once here, which also backfills
employee_id for any existing managing_director/support_coordinator/
support_worker staff who don't have one yet."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.access import has_active_grant
from ..core.security import get_current_user
from ..services.employee_id_service import is_org_abbrev_available, set_org_abbrev_and_backfill
from ..services.supabase_client import get_supabase_admin

router = APIRouter(prefix="/organization/abbrev", tags=["organization-abbrev"])


def _require_md(current_user: dict) -> str:
    if current_user.get("role") != "managing_director" and not has_active_grant(
        current_user, "org_abbrev", get_supabase_admin()
    ):
        raise HTTPException(status_code=403, detail="Only a managing director can set the organisation's abbreviation.")
    org_id = current_user.get("organization_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="Organization membership required.")
    return org_id


@router.get("")
async def get_org_abbrev_status(current_user: dict = Depends(get_current_user)):
    """Whether the caller's org has an abbreviation yet — powers the
    'set your org abbreviation' prompt for pre-existing orgs."""
    org_id = current_user.get("organization_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="Organization membership required.")
    resp = (
        get_supabase_admin()
        .table("organizations")
        .select("org_abbrev")
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Organisation not found.")
    return {"org_abbrev": rows[0].get("org_abbrev")}


@router.get("/check")
async def check_org_abbrev(value: str, current_user: dict = Depends(get_current_user)):
    """Live availability check while the MD is typing a candidate value."""
    org_id = current_user.get("organization_id")
    return {"available": is_org_abbrev_available(get_supabase_admin(), value, exclude_organization_id=org_id)}


class SetOrgAbbrevBody(BaseModel):
    org_abbrev: str


@router.post("")
async def set_org_abbrev(body: SetOrgAbbrevBody, current_user: dict = Depends(get_current_user)):
    org_id = _require_md(current_user)
    return set_org_abbrev_and_backfill(get_supabase_admin(), org_id, body.org_abbrev)
