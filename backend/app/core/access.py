"""Strict, server-side access helpers for CareScribe records."""

from __future__ import annotations

from typing import Iterable, Optional

from fastapi import HTTPException, Request, status


COORDINATOR_ROLES = {"support_coordinator"}
SCOPED_ROLES = {"support_worker", "allied_health"}
EXECUTIVE_ROLES = {"managing_director"}
VALID_ROLES = COORDINATOR_ROLES | SCOPED_ROLES | EXECUTIVE_ROLES

SUPPORT_WORKER_PARTICIPANT_FIELDS = (
    "assigned_worker_id",
    "support_worker_id",
)
ALLIED_HEALTH_PARTICIPANT_FIELDS = (
    "allied_health_id",
    "clinician_id",
)
COMMON_PARTICIPANT_FIELDS = (
    "owner_user_id",
    "created_by",
)

SUPPORT_WORKER_SESSION_FIELDS = (
    "worker_id",
    "support_worker_id",
)
ALLIED_HEALTH_SESSION_FIELDS = (
    "practitioner_id",
    "allied_health_id",
    "clinician_id",
)
COMMON_SESSION_FIELDS = (
    "owner_user_id",
    "created_by",
    "user_id",
)

ACCESS_METADATA_FIELDS = (
    "organization_id",
    "assigned_worker_id",
    "support_worker_id",
    "allied_health_id",
    "clinician_id",
    "worker_id",
    "practitioner_id",
    "created_by",
    "owner_user_id",
    "user_id",
)


def _as_str(value: object) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _row_value(row: dict, *keys: str) -> Optional[str]:
    for key in keys:
        value = _as_str(row.get(key))
        if value:
            return value
    return None


def _iter_row_values(row: dict, fields: Iterable[str]) -> Iterable[str]:
    for field in fields:
        value = row.get(field)
        if isinstance(value, (list, tuple, set)):
            for item in value:
                text = _as_str(item)
                if text:
                    yield text
        else:
            text = _as_str(value)
            if text:
                yield text


def get_user_id(user: Optional[dict]) -> Optional[str]:
    if not user:
        return None
    return _as_str(user.get("id") or user.get("sub") or user.get("user_id"))


def get_user_role(user: Optional[dict]) -> Optional[str]:
    if not user:
        return None
    role = _as_str(user.get("role"))
    return role if role in VALID_ROLES else role


def get_user_organization_id(user: Optional[dict]) -> Optional[str]:
    if not user:
        return None
    return _as_str(user.get("organization_id") or user.get("organizationId"))


def is_coordinator_role(user: Optional[dict]) -> bool:
    return get_user_role(user) in COORDINATOR_ROLES


def has_org_wide_access(user: Optional[dict]) -> bool:
    """True for any role with organisation-wide read access (coordinator + MD)."""
    return get_user_role(user) in COORDINATOR_ROLES | EXECUTIVE_ROLES


def is_support_worker(user: Optional[dict]) -> bool:
    return get_user_role(user) == "support_worker"


def is_allied_health(user: Optional[dict]) -> bool:
    return get_user_role(user) == "allied_health"


def is_managing_director(user: Optional[dict]) -> bool:
    return get_user_role(user) == "managing_director"


def record_belongs_to_user_org(row: dict, user: Optional[dict]) -> bool:
    user_org = get_user_organization_id(user)
    record_org = _row_value(row, "organization_id", "_access_organization_id", "_assignment_org_id")
    return bool(user_org and record_org and user_org == record_org)


def _direct_assignment_fields_for_user(user: Optional[dict], is_session: bool) -> tuple[str, ...]:
    if is_support_worker(user):
        return (
            *(SUPPORT_WORKER_SESSION_FIELDS if is_session else SUPPORT_WORKER_PARTICIPANT_FIELDS),
            *(COMMON_SESSION_FIELDS if is_session else COMMON_PARTICIPANT_FIELDS),
        )
    if is_allied_health(user):
        return (
            *(ALLIED_HEALTH_SESSION_FIELDS if is_session else ALLIED_HEALTH_PARTICIPANT_FIELDS),
            *(COMMON_SESSION_FIELDS if is_session else COMMON_PARTICIPANT_FIELDS),
        )
    return ()


def record_assigned_to_user(row: dict, user: Optional[dict], *, is_session: bool = False) -> bool:
    uid = get_user_id(user)
    if not uid:
        return False

    direct_fields = _direct_assignment_fields_for_user(user, is_session)
    direct_assignment_matches = uid in set(_iter_row_values(row, direct_fields))
    if direct_assignment_matches:
        return direct_assignment_matches

    if is_support_worker(user):
        assignment_fields = (
            "_support_assignment_user_ids",
            "_assignment_user_ids",
            "_assigned_user_ids",
        )
        return uid in set(_iter_row_values(row, assignment_fields))

    if is_allied_health(user):
        clinical_fields = (
            "_clinical_assignment_user_ids",
            "_assignment_user_ids",
            "_assigned_user_ids",
        )
        return uid in set(_iter_row_values(row, clinical_fields))

    return False


def can_access_participant(row: dict, user: Optional[dict]) -> bool:
    if not user or not row:
        return False
    if not get_user_id(user) or get_user_role(user) not in VALID_ROLES:
        return False
    if not record_belongs_to_user_org(row, user):
        return False
    if has_org_wide_access(user):
        return record_belongs_to_user_org(row, user)
    if is_support_worker(user) or is_allied_health(user):
        return record_assigned_to_user(row, user)
    return False


def can_access_session(
    row: dict,
    user: Optional[dict],
    participant: Optional[dict] = None,
) -> bool:
    if not user or not row:
        return False
    if not get_user_id(user) or get_user_role(user) not in VALID_ROLES:
        return False

    org_match = record_belongs_to_user_org(row, user)
    if not org_match and participant:
        org_match = record_belongs_to_user_org(participant, user)
    if not org_match:
        return False

    if has_org_wide_access(user):
        return org_match

    session_assigned = record_assigned_to_user(row, user, is_session=True)
    if session_assigned:
        return session_assigned

    # Support workers can view their assigned participant profile, but session
    # notes remain worker-owned. Assignment to the same participant must not
    # expose another worker's session record.
    if is_support_worker(user):
        return False

    if participant:
        session_participant_id = _row_value(row, "patient_id", "participant_id")
        participant_id = _row_value(participant, "id", "patient_id", "participant_id")
        if session_participant_id and participant_id and session_participant_id == participant_id:
            return can_access_participant(participant, user)

    return False


def assert_can_access_participant(
    row: dict,
    user: Optional[dict],
    *,
    hide_existence: bool = True,
) -> None:
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    if not can_access_participant(row, user):
        status_code = status.HTTP_404_NOT_FOUND if hide_existence else status.HTTP_403_FORBIDDEN
        raise HTTPException(status_code=status_code, detail="Participant not found")


def assert_can_access_session(
    row: dict,
    user: Optional[dict],
    participant: Optional[dict] = None,
    *,
    hide_existence: bool = True,
) -> None:
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    if not can_access_session(row, user, participant):
        status_code = status.HTTP_404_NOT_FOUND if hide_existence else status.HTTP_403_FORBIDDEN
        raise HTTPException(status_code=status_code, detail="Session not found")


def owner_payload(user: Optional[dict]) -> dict:
    uid = get_user_id(user)
    org_id = get_user_organization_id(user)
    payload: dict = {}
    if uid:
        payload["created_by"] = uid
        payload["owner_user_id"] = uid
    if org_id:
        payload["organization_id"] = org_id
    if is_support_worker(user) and uid:
        payload["assigned_worker_id"] = uid
        payload["worker_id"] = uid
    if is_allied_health(user) and uid:
        payload["allied_health_id"] = uid
        payload["clinician_id"] = uid
        payload["practitioner_id"] = uid
    return payload


def get_coordinator_team_ids(coordinator_user: dict, supabase) -> list[str]:
    """Return IDs of support workers whose coordinator_id matches this coordinator.

    Fallback behaviour (backward-compatible rollout):
    - If ANY worker in the org already has coordinator_id set, the feature is
      considered "rolled out". A coordinator with no linked workers gets an
      empty list — they truly have no team yet.
    - If NO worker in the org has coordinator_id set at all, the FK column has
      just been migrated and no assignments exist yet. In this case we fall back
      to returning all org support_workers so existing coordinator features
      (dashboard, session review, credential alerts) continue working unchanged.

    Args:
        coordinator_user: The authenticated coordinator user dict.
        supabase: A Supabase admin client instance.

    Returns:
        List of user ID strings (never raises — returns [] on error).
    """
    coordinator_id = get_user_id(coordinator_user)
    org_id = get_user_organization_id(coordinator_user)
    if not coordinator_id or not org_id:
        return []

    try:
        linked = (
            supabase.table("users")
            .select("id")
            .eq("coordinator_id", coordinator_id)
            .eq("organization_id", org_id)
            .execute()
        )
        ids = [str(row["id"]) for row in (linked.data or []) if row.get("id")]
    except Exception:
        ids = []

    if ids:
        return ids

    # Check whether coordinator_id has been assigned to anyone in this org yet.
    # If some workers have it set (but none for this coordinator), this
    # coordinator genuinely has no team — return empty to avoid cross-team leak.
    try:
        any_linked = (
            supabase.table("users")
            .select("id")
            .eq("organization_id", org_id)
            .eq("role", "support_worker")
            .not_.is_("coordinator_id", "null")
            .limit(1)
            .execute()
        )
        rollout_started = bool(any_linked.data)
    except Exception:
        rollout_started = False

    if rollout_started:
        return []

    # Global initial state: no worker has coordinator_id set yet. Fall back to
    # all org support_workers so the coordinator dashboard keeps working.
    try:
        all_workers = (
            supabase.table("users")
            .select("id")
            .eq("organization_id", org_id)
            .eq("role", "support_worker")
            .execute()
        )
        return [str(row["id"]) for row in (all_workers.data or []) if row.get("id")]
    except Exception:
        return []


def get_org_id(request: Request) -> str:
    """FastAPI Depends() that returns the organisation_id from request state.

    Raises HTTP 403 if the middleware did not inject an org claim (i.e. the
    request is authenticated but the JWT has no organisation_id — this means
    the user was created before the CCQ-110 hook went live or their account
    is misconfigured).
    """
    org_id: Optional[str] = getattr(request.state, "organisation_id", None)
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organisation not found. Contact your administrator.",
        )
    return org_id


# Backward-compatible aliases used by existing services.
user_id = get_user_id
organization_id = get_user_organization_id
role = lambda user: get_user_role(user) or ""
is_coordinator = is_coordinator_role
is_field_role = lambda user: get_user_role(user) in SCOPED_ROLES
record_matches_org = record_belongs_to_user_org
record_matches_user = lambda row, user, fields: (
    bool(get_user_id(user) and get_user_id(user) in set(_iter_row_values(row, fields)))
)
