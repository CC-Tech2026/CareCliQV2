"""Service agreements: the signed document is the source of record for a
participant's plan management type, negotiated (override) rates, and the
price-adjustment/GST clauses — not separately-set flags with no link back to
what was actually signed. Schema: migration 217.

NF2F, Provider Travel, and short-notice-cancellation claim generation stay
out of scope here — see markdown/NDIS_CLAIM_TYPES_BACKLOG.md item 1 for why
that's still correctly dormant. This module only captures agreement data and
wires negotiated rates to ndis_price_items overrides; it does not generate
any of those claim types.
"""

from __future__ import annotations

from datetime import date
import logging
from typing import Any, Optional

from fastapi import HTTPException

from ..models.billing_period import VALID_PLAN_MANAGEMENT_TYPES
from . import audit_service
from . import ndis_pricing_service
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

VALID_STATUSES = {"draft", "pending_signature", "active", "expired", "ended"}
VALID_FREQUENCIES = {"weekly", "fortnightly", "monthly", "as_scheduled"}
VALID_LOCATIONS = {"home", "school", "preschool", "clinic", "other"}


async def create_service_agreement(
    participant_id: str,
    organization_id: str,
    user_id: str,
    data: dict[str, Any],
) -> dict[str, Any]:
    plan_management_type = data.get("plan_management_type")
    if plan_management_type not in VALID_PLAN_MANAGEMENT_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"plan_management_type must be one of {sorted(VALID_PLAN_MANAGEMENT_TYPES)}.",
        )
    start_date = data.get("start_date")
    if not start_date:
        raise HTTPException(status_code=422, detail="start_date is required.")
    status_value = data.get("status") or "draft"
    if status_value not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {sorted(VALID_STATUSES)}.")

    supabase = get_supabase_admin()
    payload = {
        "organization_id": organization_id,
        "participant_id": participant_id,
        "plan_management_type": plan_management_type,
        "plan_manager_name": data.get("plan_manager_name"),
        "plan_manager_email": data.get("plan_manager_email"),
        "start_date": start_date,
        "end_date": data.get("end_date"),
        "includes_price_adjustment_clause": bool(data.get("includes_price_adjustment_clause", False)),
        "gst_treatment_basis": data.get("gst_treatment_basis"),
        "cancellation_notice_hours": data.get("cancellation_notice_hours"),
        "cancellation_fee_percentage": data.get("cancellation_fee_percentage"),
        "status": status_value,
        "signed_by": data.get("signed_by"),
        "signed_date": data.get("signed_date"),
        "source_document_id": data.get("source_document_id"),
        "created_by": user_id,
    }
    result = supabase.table("service_agreements").insert(payload).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Could not create service agreement.")
    agreement = result.data[0]

    await audit_service.log_action(
        action_type="service_agreement.created",
        entity_type="service_agreement",
        entity_id=agreement["id"],
        user_id=user_id,
        organization_id=organization_id,
        after_state={
            "participant_id": participant_id,
            "plan_management_type": plan_management_type,
            "status": status_value,
            "start_date": start_date,
        },
    )
    return agreement


def list_service_agreements(participant_id: str, organization_id: str) -> list[dict[str, Any]]:
    supabase = get_supabase_admin()
    result = (
        supabase.table("service_agreements")
        .select("*, service_agreement_supports(*)")
        .eq("organization_id", organization_id)
        .eq("participant_id", participant_id)
        .order("start_date", desc=True)
        .execute()
    )
    return result.data or []


def get_active_service_agreement(
    participant_id: str, organization_id: str, *, as_of: Optional[date] = None
) -> Optional[dict[str, Any]]:
    """The agreement in effect for a participant as of a date (default
    today): the most recent by start_date whose window covers as_of and
    whose status is 'active'. Sync, no auth check — for internal callers
    (e.g. billing_period_service), not exposed as its own endpoint.

    Deliberately fails soft (returns None) rather than raising: this is
    called from resolve_participant_plan_management_type() on every billing
    period lookup org-wide, which already treats "no active agreement" as
    "fall back to patients.plan_management_type" — any lookup failure
    (table not yet migrated, transient error) should degrade to that same
    safe fallback, not take down billing for every participant."""
    as_of = as_of or date.today()
    try:
        supabase = get_supabase_admin()
        result = (
            supabase.table("service_agreements")
            .select("*")
            .eq("organization_id", str(organization_id))
            .eq("participant_id", str(participant_id))
            .eq("status", "active")
            .lte("start_date", as_of.isoformat())
            .order("start_date", desc=True)
            .limit(20)
            .execute()
        )
    except Exception:
        logger.warning(
            "Could not look up active service agreement for participant %s — "
            "falling back to patients.plan_management_type",
            participant_id,
            exc_info=True,
        )
        return None
    for row in result.data or []:
        end_date = row.get("end_date")
        if end_date is None or str(end_date) >= as_of.isoformat():
            return row
    return None


async def add_service_agreement_support(
    service_agreement_id: str,
    organization_id: str,
    user: dict[str, Any],
    data: dict[str, Any],
) -> dict[str, Any]:
    supabase = get_supabase_admin()
    agreement_result = (
        supabase.table("service_agreements")
        .select("id, organization_id, start_date")
        .eq("id", service_agreement_id)
        .limit(1)
        .execute()
    )
    agreement = (agreement_result.data or [None])[0]
    if not agreement or str(agreement.get("organization_id")) != str(organization_id):
        raise HTTPException(status_code=404, detail="Service agreement not found.")

    support_item_code = data.get("support_item_code")
    if not support_item_code:
        raise HTTPException(status_code=422, detail="support_item_code is required.")
    frequency = data.get("frequency")
    if frequency is not None and frequency not in VALID_FREQUENCIES:
        raise HTTPException(status_code=422, detail=f"frequency must be one of {sorted(VALID_FREQUENCIES)}.")
    location = data.get("location")
    if location is not None and location not in VALID_LOCATIONS:
        raise HTTPException(status_code=422, detail=f"location must be one of {sorted(VALID_LOCATIONS)}.")

    negotiated_rate = data.get("negotiated_rate")
    if negotiated_rate is not None:
        # The real mechanism for is_override going forward: a negotiated
        # rate tied to a real signed document, applied through the same
        # effective-dated path a manual price edit uses (so it gets the same
        # backdate-vs-invoiced-period protection edit_item_price() already
        # has, instead of a second, parallel price-writing path). Raises —
        # and nothing gets written to service_agreement_supports — if the
        # item code doesn't exist in this org's catalogue.
        await ndis_pricing_service.edit_item_price(
            user,
            item_code=support_item_code,
            price_national=float(negotiated_rate),
            effective_date=agreement.get("start_date"),
            reason=f"Negotiated rate per service agreement {service_agreement_id}",
        )

    payload = {
        "service_agreement_id": service_agreement_id,
        "support_item_code": support_item_code,
        "negotiated_rate": negotiated_rate,
        "frequency": frequency,
        "total_hours_allocated": data.get("total_hours_allocated"),
        "total_funding": data.get("total_funding"),
        "travel_rate_per_hour": data.get("travel_rate_per_hour"),
        "travel_minutes_cap": data.get("travel_minutes_cap"),
        "location": location,
    }
    result = supabase.table("service_agreement_supports").insert(payload).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Could not add support line.")
    return result.data[0]
