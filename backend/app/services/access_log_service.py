"""Need-to-Know Audit Trail — NDIS Act Section 66 (Secrecy Provisions).

Every READ of a participant record must be logged with:
  accessor_id, ip_address, purpose_of_access, timestamp

Security Events — Privacy Act 2026 Eligible Data Breach reporting.
Unauthorised access attempts are stored in security_events and can be
exported for the 72-hour statutory notification window.
"""
from __future__ import annotations

import logging
from typing import Optional

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)


async def log_participant_reads_bulk(
    participant_ids: list[str],
    *,
    user_id: Optional[str] = None,
    ip_address: Optional[str] = None,
    purpose: str = "Provision of NDIS Supports",
    action: str = "READ",
    organization_id: Optional[str] = None,
) -> None:
    """Append access log rows for a participant list view (single insert)."""
    ids = [str(pid) for pid in participant_ids if pid]
    if not ids:
        return
    try:
        supabase = get_supabase_admin()
        rows: list[dict] = []
        for participant_id in ids:
            row: dict = {
                "participant_id": participant_id,
                "action": action,
                "purpose": purpose,
            }
            if user_id:
                row["user_id"] = user_id
            if ip_address:
                row["ip_address"] = ip_address
            if organization_id:
                row["organization_id"] = organization_id
            rows.append(row)
        supabase.table("access_logs").insert(rows).execute()
    except Exception as exc:
        logger.warning("access_log_service.log_participant_reads_bulk failed (non-fatal): %s", exc)


async def log_participant_read(
    participant_id: str,
    *,
    user_id: Optional[str] = None,
    ip_address: Optional[str] = None,
    purpose: str = "Provision of NDIS Supports",
    action: str = "READ",
    organization_id: Optional[str] = None,
) -> None:
    """Append a single access log row for a participant record read.

    NDIS Act s.66 — every access must be traceable.
    Failures are swallowed so they never abort the primary request.
    """
    try:
        supabase = get_supabase_admin()
        row: dict = {
            "participant_id": participant_id,
            "action": action,
            "purpose": purpose,
        }
        if user_id:
            row["user_id"] = user_id
        if ip_address:
            row["ip_address"] = ip_address
        if organization_id:
            row["organization_id"] = organization_id
        supabase.table("access_logs").insert(row).execute()
    except Exception as exc:
        logger.warning("access_log_service.log_participant_read failed (non-fatal): %s", exc)


async def log_security_event(
    event_type: str,
    description: str,
    *,
    accessor_id: Optional[str] = None,
    participant_id: Optional[str] = None,
    ip_address: Optional[str] = None,
    severity: str = "medium",
    organization_id: Optional[str] = None,
) -> None:
    """Record a security event for Eligible Data Breach reporting.

    Privacy Act 2026 — breaches must be reported within 72 hours of
    becoming aware.  This table feeds breach-detection dashboards.

    Parameters
    ----------
    event_type:
        Short code, e.g. ``"unauthorized_access"``, ``"brute_force"``,
        ``"bulk_export"``, ``"purge_attempt"``.
    severity:
        ``"low"`` | ``"medium"`` | ``"high"`` | ``"critical"``
    """
    try:
        supabase = get_supabase_admin()
        row: dict = {
            "event_type": event_type,
            "description": description,
            "severity": severity,
        }
        if accessor_id:
            row["accessor_id"] = accessor_id
        if participant_id:
            row["participant_id"] = participant_id
        if ip_address:
            row["ip_address"] = ip_address
        if organization_id:
            row["organization_id"] = organization_id
        supabase.table("security_events").insert(row).execute()
    except Exception as exc:
        logger.warning("access_log_service.log_security_event failed (non-fatal): %s", exc)
