"""Application-level RBAC helpers.

These checks run before service-role Supabase calls. RLS remains useful as
defence-in-depth, but service-role queries must never be treated as permission.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException, status

from .security import get_current_user
from ..services.supabase_client import get_supabase_admin

ROLE_SUPPORT_COORDINATOR = "support_coordinator"
ROLE_SUPPORT_WORKER = "support_worker"
ROLE_ALLIED_HEALTH = "allied_health"
ROLE_ADMIN = "admin"

COORDINATOR_ROLES = frozenset({ROLE_SUPPORT_COORDINATOR, ROLE_ADMIN})
ASSIGNED_ACCESS_ROLES = frozenset({ROLE_SUPPORT_WORKER, ROLE_ALLIED_HEALTH})
CANONICAL_ROLES = frozenset({
    ROLE_SUPPORT_COORDINATOR,
    ROLE_SUPPORT_WORKER,
    ROLE_ALLIED_HEALTH,
    ROLE_ADMIN,
})


def canonical_role(user: Optional[dict]) -> str:
    role = (user or {}).get("role") or ""
    return role if role in CANONICAL_ROLES else ""


def user_id(user: Optional[dict]) -> Optional[str]:
    value = (user or {}).get("sub")
    return str(value) if value else None


def organization_id(user: Optional[dict]) -> Optional[str]:
    value = (user or {}).get("organization_id")
    return str(value) if value else None


def is_coordinator(user: Optional[dict]) -> bool:
    return canonical_role(user) in COORDINATOR_ROLES


def is_support_worker(user: Optional[dict]) -> bool:
    return canonical_role(user) == ROLE_SUPPORT_WORKER


def is_allied_health(user: Optional[dict]) -> bool:
    return canonical_role(user) == ROLE_ALLIED_HEALTH


def can_manage_team(user: Optional[dict]) -> bool:
    return is_coordinator(user)


def can_view_org_wide(user: Optional[dict]) -> bool:
    return is_coordinator(user)


def can_access_organisation(user: Optional[dict], org_id: Optional[str]) -> bool:
    org = organization_id(user)
    return bool(org and org_id and org == str(org_id) and canonical_role(user))


def require_auth(user: dict = Depends(get_current_user)) -> dict:
    return user


def require_role(*allowed_roles: str):
    allowed = set(allowed_roles)

    def dependency(user: dict = Depends(get_current_user)) -> dict:
        role = canonical_role(user)
        if role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied",
            )
        return user

    return dependency


def require_coordinator(user: dict = Depends(get_current_user)) -> dict:
    if not is_coordinator(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return user


async def require_organisation_access(user: dict, org_id: Optional[str]) -> str:
    if not can_access_organisation(user, org_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return str(org_id)


def _same_org(user: dict, record: dict) -> bool:
    org = organization_id(user)
    record_org = record.get("organization_id") or record.get("organisation_id")
    return bool(org and record_org and str(record_org) == org)


async def has_active_participant_assignment(user: dict, participant_id: str) -> bool:
    uid = user_id(user)
    org = organization_id(user)
    role = canonical_role(user)
    if not uid or not org or role not in ASSIGNED_ACCESS_ROLES:
        return False

    supabase = get_supabase_admin()
    try:
        result = (
            supabase.table("practitioner_allocations")
            .select("id")
            .eq("patient_id", participant_id)
            .eq("user_id", uid)
            .eq("organization_id", org)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
    except Exception:
        return False
    return bool(result.data)


async def can_access_participant(user: dict, participant: Optional[dict]) -> bool:
    if not participant:
        return False
    if is_coordinator(user):
        return _same_org(user, participant)
    if canonical_role(user) in ASSIGNED_ACCESS_ROLES:
        participant_org = participant.get("organization_id") or participant.get("organisation_id")
        if not organization_id(user) or str(participant_org) != organization_id(user):
            return False
        return await has_active_participant_assignment(user, str(participant["id"]))
    return False


async def require_participant_access(user: dict, participant: Optional[dict]) -> dict:
    if not participant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Participant not found")
    if not await can_access_participant(user, participant):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return participant


async def can_access_session(user: dict, session: Optional[dict]) -> bool:
    if not session:
        return False
    if is_coordinator(user):
        return _same_org(user, session)
    participant_id = session.get("participant_id") or session.get("patient_id")
    if not participant_id:
        return False
    if organization_id(user) and session.get("organization_id") and str(session["organization_id"]) != organization_id(user):
        return False
    return await has_active_participant_assignment(user, str(participant_id))


async def require_session_access(user: dict, session: Optional[dict]) -> dict:
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if not await can_access_session(user, session):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return session


async def can_access_incident(user: dict, incident: Optional[dict]) -> bool:
    if not incident:
        return False
    if is_coordinator(user):
        return _same_org(user, incident)
    participant_id = incident.get("participant_id") or incident.get("patient_id")
    if not participant_id:
        return False
    if organization_id(user) and incident.get("organization_id") and str(incident["organization_id"]) != organization_id(user):
        return False
    return await has_active_participant_assignment(user, str(participant_id))


async def require_incident_access(user: dict, incident: Optional[dict]) -> dict:
    if not incident:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")
    if not await can_access_incident(user, incident):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return incident
