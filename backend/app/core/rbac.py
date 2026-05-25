"""
Role-Based Access Control (RBAC) for CareScribe.

Three roles:
  - support_coordinator: Business owner/team lead. Full visibility & team management.
  - support_worker: Field-based worker. Own clients & sessions only.
  - allied_health_pro: Clinical professional (OT, physio, speech). Own caseload + clinical tools.

Each role has specific capabilities that are enforced by this module.
"""

from typing import Callable, Optional
from fastapi import Depends, HTTPException, status
from .security import get_current_user

# Role definitions
SUPPORT_COORDINATOR = "support_coordinator"
SUPPORT_WORKER = "support_worker"
ALLIED_HEALTH_PRO = "allied_health_pro"

ALL_ROLES = {SUPPORT_COORDINATOR, SUPPORT_WORKER, ALLIED_HEALTH_PRO}

# Capability matrix: What can each role do?
# Format: {role: {capability: True/False}}
ROLE_CAPABILITIES = {
    SUPPORT_COORDINATOR: {
        "view_all_clients": True,
        "view_all_sessions": True,
        "view_all_workers": True,
        "view_all_notes": True,
        "view_all_compliance": True,
        "view_all_incidents": True,
        "manage_workers": True,
        "manage_billing": True,
        "manage_invoices": True,
        "create_invoices": True,
        "manage_ndis_plans": True,
        "write_notes": True,
        "manage_credentials": True,
        "create_reports": True,
        "body_map_coding": False,
        "allied_health_reports": False,
        "multilingual_input": True,
        "toolkit_management": True,
    },
    SUPPORT_WORKER: {
        "view_all_clients": False,
        "view_all_sessions": False,
        "view_all_workers": False,
        "view_all_notes": False,
        "view_all_compliance": False,
        "view_all_incidents": False,
        "manage_workers": False,
        "manage_billing": False,
        "manage_invoices": False,
        "create_invoices": False,
        "manage_ndis_plans": False,
        "write_notes": True,
        "manage_credentials": True,
        "create_reports": False,
        "body_map_coding": False,
        "allied_health_reports": False,
        "multilingual_input": True,
        "toolkit_management": False,
    },
    ALLIED_HEALTH_PRO: {
        "view_all_clients": False,
        "view_all_sessions": False,
        "view_all_workers": False,
        "view_all_notes": False,
        "view_all_compliance": False,
        "view_all_incidents": False,
        "manage_workers": False,
        "manage_billing": True,  # Own billing
        "manage_invoices": True,  # Own invoices
        "create_invoices": True,
        "manage_ndis_plans": False,
        "write_notes": True,
        "manage_credentials": True,
        "create_reports": True,
        "body_map_coding": True,  # Pro exclusive
        "allied_health_reports": True,  # FCA, Therapy, AT
        "multilingual_input": True,
        "toolkit_management": True,  # Clinical supplies
    },
}

# Role hierarchy for inheritance (not used here, but useful for reference)
# ROLE_HIERARCHY = {
#     SUPPORT_COORDINATOR: {SUPPORT_WORKER, ALLIED_HEALTH_PRO},
#     SUPPORT_WORKER: set(),
#     ALLIED_HEALTH_PRO: set(),
# }


def has_capability(user: dict, capability: str) -> bool:
    """Check if a user's role has a specific capability."""
    role = user.get("role")
    if role not in ROLE_CAPABILITIES:
        return False
    return ROLE_CAPABILITIES[role].get(capability, False)


def require_role(*allowed_roles: str):
    """
    Dependency factory for role-based access control.
    
    Usage:
        @router.get("/admin-only")
        async def admin_endpoint(user=Depends(require_role("support_coordinator"))):
            ...
    
    Args:
        allowed_roles: One or more role names (e.g., SUPPORT_COORDINATOR, SUPPORT_WORKER)
    
    Raises:
        HTTPException 403 if user's role is not in allowed_roles
    """
    def dependency(user: dict = Depends(get_current_user)) -> dict:
        role = user.get("role")
        if role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This action requires one of these roles: {', '.join(allowed_roles)}. You have: {role}",
            )
        return user
    return dependency


def require_capability(capability: str):
    """
    Dependency factory for capability-based access control.
    
    Usage:
        @router.delete("/user/{id}")
        async def delete_user(id: str, user=Depends(require_capability("manage_workers"))):
            ...
    
    Args:
        capability: Capability name (e.g., "manage_workers", "body_map_coding")
    
    Raises:
        HTTPException 403 if user doesn't have the capability
    """
    def dependency(user: dict = Depends(get_current_user)) -> dict:
        if not has_capability(user, capability):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This action requires the '{capability}' capability, which your role ({user.get('role')}) does not have.",
            )
        return user
    return dependency


def get_user_role(user: dict) -> str:
    """Extract and validate user role."""
    role = user.get("role", SUPPORT_WORKER)
    if role not in ALL_ROLES:
        return SUPPORT_WORKER  # Default fallback
    return role


def is_coordinator(user: dict) -> bool:
    """Check if user is a support coordinator (admin/manager)."""
    return get_user_role(user) == SUPPORT_COORDINATOR


def is_support_worker(user: dict) -> bool:
    """Check if user is a support worker."""
    return get_user_role(user) == SUPPORT_WORKER


def is_allied_health(user: dict) -> bool:
    """Check if user is an allied health professional."""
    return get_user_role(user) == ALLIED_HEALTH_PRO


# ============================================================================
# Data visibility filters
# ============================================================================

def can_view_session(user: dict, session_user_id: str) -> bool:
    """Determine if user can view a specific session."""
    if is_coordinator(user):
        # Coordinators see all sessions
        return True
    if is_support_worker(user) or is_allied_health(user):
        # Support workers and allied health pros see only their own sessions
        return user.get("sub") == session_user_id
    return False


def can_view_participant(user: dict, participant_coordinator_id: str) -> bool:
    """Determine if user can view a specific participant's data."""
    if is_coordinator(user):
        # Coordinators see all participants
        return True
    # Support workers and allied health pros can only view their own participants
    # (This would need to be checked against the participant's assigned workers)
    return False


def can_edit_compliance(user: dict, compliance_user_id: str) -> bool:
    """Determine if user can edit compliance data."""
    if is_coordinator(user):
        return True
    # Support workers can edit their own compliance data
    if is_support_worker(user):
        return user.get("sub") == compliance_user_id
    # Allied health pros can edit their own compliance data
    if is_allied_health(user):
        return user.get("sub") == compliance_user_id
    return False


def can_manage_team(user: dict) -> bool:
    """Determine if user can manage team members."""
    return is_coordinator(user)


def can_manage_billing(user: dict) -> bool:
    """Determine if user can manage billing/invoicing."""
    if is_coordinator(user):
        return True
    if is_allied_health(user):
        # Allied health pros can manage their own billing
        return True
    return False


def get_role_display_name(role: str) -> str:
    """Get a human-readable name for a role."""
    role_names = {
        SUPPORT_COORDINATOR: "Support Coordinator",
        SUPPORT_WORKER: "Support Worker",
        ALLIED_HEALTH_PRO: "Allied Health Professional",
    }
    return role_names.get(role, role)


def get_role_description(role: str) -> str:
    """Get a description of what a role can do."""
    descriptions = {
        SUPPORT_COORDINATOR: "Business owner/team lead. Full visibility and management of all workers, clients, invoicing, and compliance.",
        SUPPORT_WORKER: "Field-based worker. Sees only own clients and sessions. Writes notes and manages own credentials.",
        ALLIED_HEALTH_PRO: "Clinical professional (OT, physio, speech therapist). Manages own caseload with full clinical toolset including body map coding and report generation.",
    }
    return descriptions.get(role, "")
