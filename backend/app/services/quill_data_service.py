"""Service-role reads behind Quill's newer tools (open incidents, complaints,
unpaid invoices, unfilled shifts, one worker's overview).

Kept out of chatbox/tools.py on purpose: that module must never import the
admin client (test_chatbox_db_role guards it). Every function here takes the
organisation id from the signed-in user, captured by the tool's closure,
never from the model, and filters on it in the query itself.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

_OPEN_INCIDENT = ("reported", "under_investigation", "open", "in_progress", "pending")
_UNPAID_INVOICE = ("finalized", "sent", "overdue")


def participant_names(org_id: str, ids: set[str]) -> dict[str, str]:
    if not ids:
        return {}
    rows = (
        get_supabase_admin().table("participants").select("id, full_name, preferred_name")
        .eq("organization_id", org_id).in_("id", list(ids)[:500]).execute()
    ).data or []
    return {str(r["id"]): (r.get("preferred_name") or r.get("full_name") or "Participant") for r in rows}


def open_incidents(org_id: str, participant_ids: Optional[set[str]] = None) -> list[dict[str, Any]]:
    """Incidents not yet resolved or closed, newest first."""
    rows = (
        get_supabase_admin().table("incidents")
        .select(
            "id, reference_number, participant_id, title, incident_type, severity, status, "
            "incident_date, reported_date, ndis_reportable, ndis_reportable_override, ndis_reported_at, "
            "follow_up_required, follow_up_date, assigned_investigator_id"
        )
        .eq("organization_id", org_id)
        .in_("status", list(_OPEN_INCIDENT))
        .order("incident_date", desc=True)
        .limit(200)
        .execute()
    ).data or []
    if participant_ids is not None:
        rows = [r for r in rows if r.get("participant_id") is None or str(r["participant_id"]) in participant_ids]
    return rows


def complaints(org_id: str, participant_ids: Optional[set[str]] = None) -> list[dict[str, Any]]:
    try:
        rows = (
            get_supabase_admin().table("participant_complaints")
            .select("id, participant_id, participant_name, raised_by, subject, status, filed_at, responded_at")
            .eq("organization_id", org_id)
            .order("filed_at", desc=True)
            .limit(300)
            .execute()
        ).data or []
    except Exception as exc:
        logger.warning("Quill could not read complaints for org %s: %s", org_id, exc)
        return []
    if participant_ids is not None:
        rows = [r for r in rows if r.get("participant_id") is None or str(r["participant_id"]) in participant_ids]
    return rows


def unpaid_invoices(org_id: str) -> list[dict[str, Any]]:
    return (
        get_supabase_admin().table("invoices")
        .select(
            "id, invoice_number, participant_id, recipient_name, total_cents, status, due_date, "
            "issued_at, xero_amount_due_cents"
        )
        .eq("organization_id", org_id)
        .in_("status", list(_UNPAID_INVOICE))
        .is_("paid_at", "null")
        .order("due_date")
        .limit(300)
        .execute()
    ).data or []


def unfilled_shifts(org_id: str, start_utc: str, end_utc: str) -> list[dict[str, Any]]:
    return (
        get_supabase_admin().table("shifts")
        .select("id, participant_id, participant_name, scheduled_start, scheduled_end, support_category, status")
        .eq("organization_id", org_id)
        .is_("worker_id", "null")
        .neq("status", "cancelled")
        .gte("scheduled_start", start_utc)
        .lt("scheduled_start", end_utc)
        .order("scheduled_start")
        .limit(200)
        .execute()
    ).data or []


def worker_shift_counts(org_id: str, worker_id: str) -> dict[str, int]:
    now = datetime.now(timezone.utc)
    sb = get_supabase_admin()
    upcoming = (
        sb.table("shifts").select("id", count="exact")
        .eq("organization_id", org_id).eq("worker_id", worker_id)
        .neq("status", "cancelled")
        .gte("scheduled_start", now.isoformat())
        .lt("scheduled_start", (now + timedelta(days=14)).isoformat())
        .limit(1).execute()
    )
    done = (
        sb.table("shifts").select("id", count="exact")
        .eq("organization_id", org_id).eq("worker_id", worker_id)
        .eq("status", "completed")
        .gte("scheduled_start", (now - timedelta(days=30)).isoformat())
        .limit(1).execute()
    )
    return {"next_14_days": upcoming.count or 0, "completed_last_30_days": done.count or 0}


def worker_performance(org_id: str, worker_id: str) -> dict[str, Any]:
    from .worker_performance_dashboard_service import get_performance_dashboard

    try:
        return get_performance_dashboard(worker_id, org_id)
    except Exception as exc:
        logger.warning("Quill could not read performance for worker %s: %s", worker_id, exc)
        return {}
