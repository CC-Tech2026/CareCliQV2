"""Auto-generated staff IDs: <ROLE prefix><3-digit seq><org abbreviation>,
e.g. SW003HARV. Covers managing_director / support_coordinator /
support_worker only — allied_health, super_admin, and participants are
deliberately out of scope.

Relies on 205_employee_id_scheme.sql: organizations.org_abbrev (MD-chosen,
globally unique, 4 uppercase letters) and the next_employee_seq() Postgres
function (an atomic per-(org, role) counter, never reused).

Uses organization_id as the lookup column against `organizations` throughout
— see organization_branding_service.py for why `id` is unreliable via
PostgREST in this deployment.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

from fastapi import HTTPException

logger = logging.getLogger(__name__)

ROLE_PREFIXES: dict[str, str] = {
    "managing_director": "MD",
    "support_coordinator": "SC",
    "support_worker": "SW",
}

_ABBREV_RE = re.compile(r"^[A-Z]{4}$")


def normalize_org_abbrev(value: str) -> str:
    """Uppercases and validates shape; raises 422 on anything else. Callers
    that only want a bool (e.g. a live availability check) should catch
    HTTPException rather than duplicate this validation."""
    candidate = (value or "").strip().upper()
    if not _ABBREV_RE.match(candidate):
        raise HTTPException(
            status_code=422,
            detail="Organisation abbreviation must be exactly 4 letters (A-Z).",
        )
    return candidate


def is_org_abbrev_available(supabase: Any, value: str, *, exclude_organization_id: Optional[str] = None) -> bool:
    """True if `value` is a validly-shaped abbreviation nobody else has
    taken. Does not raise on bad shape — returns False, since this backs a
    live "is this available" check where a shape error just means "no"."""
    try:
        candidate = normalize_org_abbrev(value)
    except HTTPException:
        return False

    query = (
        supabase.table("organizations")
        .select("organization_id")
        .eq("org_abbrev", candidate)
    )
    if exclude_organization_id:
        query = query.neq("organization_id", exclude_organization_id)
    resp = query.limit(1).execute()
    return not (resp.data or [])


def generate_employee_id(supabase: Any, organization_id: str, role: str) -> Optional[str]:
    """Best-effort: returns the next employee_id for this org+role, or None
    if the role isn't covered by the scheme or the org has no org_abbrev
    yet. Never raises — callers treat a missing employee_id as fine (it
    stays NULL until the org sets an abbreviation; see set_org_abbrev_and_backfill)."""
    prefix = ROLE_PREFIXES.get(role)
    if not prefix:
        return None

    try:
        org_resp = (
            supabase.table("organizations")
            .select("org_abbrev")
            .eq("organization_id", organization_id)
            .limit(1)
            .execute()
        )
        org_abbrev = (org_resp.data or [{}])[0].get("org_abbrev") if org_resp.data else None
        if not org_abbrev:
            return None

        seq_resp = supabase.rpc(
            "next_employee_seq", {"p_organization_id": organization_id, "p_role": role}
        ).execute()
        seq = int(seq_resp.data)
        return f"{prefix}{seq:03d}{org_abbrev}"
    except Exception as exc:
        logger.warning("generate_employee_id failed for org=%s role=%s: %s", organization_id, role, exc)
        return None


def set_org_abbrev_and_backfill(supabase: Any, organization_id: str, org_abbrev: str) -> dict[str, Any]:
    """Sets an org's abbreviation (must not already have one) and, in the
    same call, backfills employee_id for its existing MD/SC/SW staff that
    don't have one yet — oldest joined_at first, so backfilled IDs read as
    a hire-order history. New orgs have no members yet at this point, so
    the backfill loop is a no-op for them; this only does real work when an
    existing org sets its abbreviation for the first time."""
    candidate = normalize_org_abbrev(org_abbrev)

    existing = (
        supabase.table("organizations")
        .select("org_abbrev")
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    )
    rows = existing.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Organisation not found.")
    if rows[0].get("org_abbrev"):
        raise HTTPException(status_code=409, detail="This organisation already has an abbreviation set.")

    if not is_org_abbrev_available(supabase, candidate):
        raise HTTPException(status_code=409, detail=f'"{candidate}" is already taken by another organisation.')

    update_resp = (
        supabase.table("organizations")
        .update({"org_abbrev": candidate})
        .eq("organization_id", organization_id)
        .execute()
    )
    if not update_resp.data:
        raise HTTPException(status_code=409, detail=f'"{candidate}" is already taken by another organisation.')

    members = (
        supabase.table("organization_members")
        .select("id, role")
        .eq("organization_id", organization_id)
        .in_("role", list(ROLE_PREFIXES.keys()))
        .is_("employee_id", "null")
        .order("joined_at")
        .execute()
    )

    backfilled = 0
    for member in members.data or []:
        prefix = ROLE_PREFIXES.get(member.get("role"))
        if not prefix:
            continue
        seq_resp = supabase.rpc(
            "next_employee_seq", {"p_organization_id": organization_id, "p_role": member["role"]}
        ).execute()
        seq = int(seq_resp.data)
        employee_id = f"{prefix}{seq:03d}{candidate}"
        supabase.table("organization_members").update({"employee_id": employee_id}).eq("id", member["id"]).execute()
        backfilled += 1

    return {"org_abbrev": candidate, "backfilled_count": backfilled}
