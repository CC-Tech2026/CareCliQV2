"""Append-only audit log writer — compliant with NDIS audit requirements.

Rules:
- Every insert is immutable: no updates, no deletes are ever issued here.
- Failures are non-fatal: a write error is logged but never raises so the
  caller's primary operation is never aborted.
- All sensitive mutations (create / update / delete / export) should be logged.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)


async def log_action(
    *,
    action_type: str,
    entity_type: str,
    entity_id: str,
    user_id: Optional[str] = None,
    organization_id: Optional[str] = None,
    before_state: Optional[dict] = None,
    after_state: Optional[dict] = None,
    details: Optional[dict] = None,
    ip_address: Optional[str] = None,
) -> None:
    """Write a single immutable audit log row.

    Parameters
    ----------
    action_type:
        Dot-namespaced verb, e.g. ``"participant.created"``,
        ``"session.notes_updated"``, ``"export.pdf_generated"``.
    entity_type:
        The domain entity kind: ``"participant"``, ``"session"``,
        ``"incident"``, ``"export"``, etc.
    entity_id:
        The UUID (or any stable identifier) of the affected record.
    user_id:
        The ``sub`` claim from the caller's JWT (Supabase Auth UID).
    organization_id:
        The org the action belongs to — used for tenant-scoped audit queries.
    before_state:
        Snapshot of the record *before* the mutation (for update / delete).
        Keep lightweight — omit large blobs.
    after_state:
        Snapshot of the record *after* the mutation (for create / update).
    details:
        Any extra structured metadata that doesn't fit the above.
    ip_address:
        Optional — caller IP for security events (login, export, etc.).
    """
    try:
        supabase = get_supabase_admin()
        row: dict[str, Any] = {
            "action_type": action_type,
            "action": action_type,        # legacy column alias
            "entity_type": entity_type,
            "resource_type": entity_type, # legacy column alias
            "entity_id": entity_id,
            "resource_id": entity_id,    # legacy column alias
        }
        if user_id:
            row["user_id"] = user_id
        if organization_id:
            row["organization_id"] = organization_id
        if before_state is not None:
            row["before_state"] = before_state
        if after_state is not None:
            row["after_state"] = after_state
        if details:
            row["details"] = details
        if ip_address:
            row["ip_address"] = ip_address

        supabase.table("audit_logs").insert(row).execute()
    except Exception as exc:
        logger.warning("audit_service.log_action failed (non-fatal): %s", exc)


async def get_entity_audit_trail(
    entity_type: str,
    entity_id: str,
    organization_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Read-only: the immutable audit trail for one entity, newest first.

    Actor display names are resolved from `users` in a single batch lookup;
    entries with no `user_id` (system-originated) are labelled "System".
    """
    try:
        supabase = get_supabase_admin()
        query = (
            supabase.table("audit_logs")
            .select("id, action_type, action, user_id, before_state, after_state, details, created_at")
            .eq("entity_type", entity_type)
            .eq("entity_id", entity_id)
        )
        if organization_id:
            query = query.eq("organization_id", organization_id)
        rows = (query.order("created_at", desc=True).execute().data) or []
    except Exception as exc:
        logger.warning("audit_service.get_entity_audit_trail failed (non-fatal): %s", exc)
        return []

    user_ids = sorted({r["user_id"] for r in rows if r.get("user_id")})
    names: dict[str, str] = {}
    if user_ids:
        try:
            users = (
                get_supabase_admin()
                .table("users")
                .select("id, full_name, email")
                .in_("id", user_ids)
                .execute()
                .data
            ) or []
            names = {u["id"]: (u.get("full_name") or u.get("email") or u["id"]) for u in users}
        except Exception as exc:
            logger.warning("audit_service.get_entity_audit_trail user lookup failed (non-fatal): %s", exc)

    return [
        {
            "id": r.get("id"),
            "action_type": r.get("action_type") or r.get("action"),
            "actor_name": names.get(r.get("user_id") or "", r.get("user_id")) if r.get("user_id") else "System",
            "before_state": r.get("before_state"),
            "after_state": r.get("after_state"),
            "details": r.get("details"),
            "created_at": r.get("created_at"),
        }
        for r in rows
    ]
