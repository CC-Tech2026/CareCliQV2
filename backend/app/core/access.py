"""Role-aware access helpers for CareScribe records."""

from __future__ import annotations

from typing import Iterable, Optional


COORDINATOR_ROLES = {"admin", "support_coordinator"}
FIELD_WORKER_ROLES = {"support_worker", "allied_health"}

PARTICIPANT_OWNER_FIELDS = (
    "assigned_worker_id",
    "allied_health_id",
    "clinician_id",
    "created_by",
    "owner_user_id",
)
SESSION_OWNER_FIELDS = (
    "worker_id",
    "practitioner_id",
    "created_by",
    "user_id",
    "owner_user_id",
)
ACCESS_METADATA_FIELDS = (
    "organization_id",
    "assigned_worker_id",
    "allied_health_id",
    "clinician_id",
    "worker_id",
    "practitioner_id",
    "created_by",
    "owner_user_id",
    "user_id",
)


def user_id(user: Optional[dict]) -> Optional[str]:
    return str(user.get("sub")) if user and user.get("sub") else None


def organization_id(user: Optional[dict]) -> Optional[str]:
    return (
        str(user.get("organization_id"))
        if user and user.get("organization_id")
        else None
    )


def role(user: Optional[dict]) -> str:
    return str((user or {}).get("role") or "support_worker")


def is_coordinator(user: Optional[dict]) -> bool:
    return role(user) in COORDINATOR_ROLES


def is_field_role(user: Optional[dict]) -> bool:
    return role(user) in FIELD_WORKER_ROLES


def record_matches_user(row: dict, user: Optional[dict], fields: Iterable[str]) -> bool:
    uid = user_id(user)
    if not uid:
        return False
    return any(str(row.get(field)) == uid for field in fields if row.get(field))


def record_matches_org(row: dict, user: Optional[dict]) -> bool:
    org_id = organization_id(user)
    return bool(
        org_id
        and row.get("organization_id")
        and str(row.get("organization_id")) == org_id
    )


def has_access_metadata(row: dict, fields: Iterable[str]) -> bool:
    return any(row.get(field) for field in fields)


def can_access_participant(row: dict, user: Optional[dict]) -> bool:
    if not user:
        return False
    if is_coordinator(user):
        org_id = organization_id(user)
        return (
            not org_id
            or not row.get("organization_id")
            or record_matches_org(row, user)
        )
    if record_matches_user(row, user, PARTICIPANT_OWNER_FIELDS):
        return True
    # Legacy rows created before RBAC columns existed are still visible so old
    # demo data does not disappear immediately after the migration lands.
    return not has_access_metadata(row, (*PARTICIPANT_OWNER_FIELDS, "organization_id"))


def can_access_session(
    row: dict, user: Optional[dict], participant: Optional[dict] = None
) -> bool:
    if not user:
        return False
    if is_coordinator(user):
        org_id = organization_id(user)
        return (
            not org_id
            or not row.get("organization_id")
            or record_matches_org(row, user)
        )
    if record_matches_user(row, user, SESSION_OWNER_FIELDS):
        return True
    if participant and can_access_participant(participant, user):
        return True
    return not has_access_metadata(row, (*SESSION_OWNER_FIELDS, "organization_id"))


def owner_payload(user: Optional[dict]) -> dict:
    uid = user_id(user)
    org_id = organization_id(user)
    payload: dict = {}
    if uid:
        payload["created_by"] = uid
    if org_id:
        payload["organization_id"] = org_id
    if role(user) == "support_worker" and uid:
        payload["assigned_worker_id"] = uid
        payload["worker_id"] = uid
    if role(user) == "allied_health" and uid:
        payload["allied_health_id"] = uid
        payload["clinician_id"] = uid
        payload["practitioner_id"] = uid
    return payload
