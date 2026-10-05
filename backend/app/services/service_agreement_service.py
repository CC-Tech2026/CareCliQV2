"""Service agreements: the signed document is the source of record for a
participant's plan management type, negotiated rates, and the
price-adjustment/GST clauses — not separately-set flags with no link back to
what was actually signed. Schema: migration 217.

NF2F, Provider Travel, and short-notice-cancellation claim generation stay
out of scope here — see markdown/NDIS_CLAIM_TYPES_BACKLOG.md item 1 for why
that's still correctly dormant. This module only captures agreement data; a
line's negotiated rate stays on the line (never in the organisation's price
list) and doesn't generate any of those claim types.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
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


def list_service_agreements(
    participant_id: Optional[str], organization_id: str, *, intake_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """A participant's agreements, or with intake_id the ones built during
    that onboarding (before the participant exists)."""
    supabase = get_supabase_admin()
    query = (
        supabase.table("service_agreements")
        .select("*, service_agreement_supports(*)")
        .eq("organization_id", organization_id)
    )
    query = query.eq("intake_id", intake_id) if intake_id else query.eq("participant_id", participant_id)
    result = query.order("start_date", desc=True).execute()
    return result.data or []


SIGNED_DOCUMENT_URL_SECONDS = 60 * 60


_ESIGN_SECRETS = ("sign_token_hash", "signing_code_hash", "signing_code_expires_at", "signing_code_sent_at", "signing_code_attempts")


def _esign_summary(agreement: dict[str, Any]) -> None:
    """Replace the e-sign columns with what the profile shows. The link and
    code hashes never leave the server."""
    has_link = bool(agreement.get("sign_token_hash"))
    for key in _ESIGN_SECRETS:
        agreement.pop(key, None)
    email = agreement.pop("signer_email", None)
    agreement["esign"] = None
    if not email or not has_link or agreement.get("status") != "pending_signature":
        return
    from .service_agreement_esign_service import mask_email

    expires = agreement.get("sign_token_expires_at")
    try:
        expired = bool(expires) and datetime.fromisoformat(str(expires).replace("Z", "+00:00")) < datetime.now(timezone.utc)
    except ValueError:
        expired = False
    agreement["esign"] = {
        "signer_name": agreement.get("signer_name"),
        "signer_email": mask_email(email),
        "relationship": agreement.get("signer_relationship"),
        "expires_at": expires,
        "expired": expired,
        "email_verified": bool(agreement.get("signing_email_verified_at")),
    }


def list_service_agreements_for_profile(
    participant_id: Optional[str], organization_id: str, *, intake_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """list_service_agreements() plus what the participant profile shows:
    each support line's NDIS item name, unit and standard (platform) rate,
    and — on the most recent agreement — the signed Service Agreement PDF
    from the participant's onboarding record, with who signed it and when.
    With intake_id, the agreements built during that onboarding instead.
    Enrichment is best-effort: a lookup failure leaves the field None rather
    than failing the whole list."""
    agreements = list_service_agreements(participant_id, organization_id, intake_id=intake_id)
    if not agreements:
        return agreements
    supabase = get_supabase_admin()

    codes = sorted({
        str(s["support_item_code"])
        for a in agreements
        for s in (a.get("service_agreement_supports") or [])
        if s.get("support_item_code")
    })
    items: dict[str, dict[str, Any]] = {}
    if codes:
        try:
            rows = (
                supabase.table("platform_ndis_price_items")
                .select("item_code, name, unit, price_national, valid_from")
                .in_("item_code", codes)
                .order("valid_from", desc=True)
                .execute()
                .data
                or []
            )
            for row in rows:
                items.setdefault(str(row["item_code"]), row)  # newest price first
        except Exception:
            logger.warning("Support item lookup failed for participant %s", participant_id, exc_info=True)
    for agreement in agreements:
        agreement["service_agreement_supports"] = sorted(
            agreement.get("service_agreement_supports") or [], key=lambda sup: sup.get("sort_order") or 0,
        )
        for support in agreement["service_agreement_supports"]:
            item = items.get(str(support.get("support_item_code")))
            # Lines built in CareCliQ keep the name/unit printed on the document.
            support["item_name"] = support.get("item_name") or (item.get("name") if item else None)
            support["unit"] = support.get("unit") or (item.get("unit") if item else None)
            support["standard_rate"] = item.get("price_national") if item else None

    signed_document = None
    # The PDF signed on the onboarding board, for agreements recorded
    # before onboarding built the agreement itself.
    if participant_id and not intake_id:
        try:
            from .participant_intake_service import BUCKET as INTAKE_BUCKET

            intake = (
                supabase.table("participant_intakes")
                .select(
                    "service_agreement_document_path, service_agreement_document_name, provider_signed_name, provider_signed_at, "
                    "family_signed_name, family_signed_at"
                )
                .eq("organization_id", organization_id)
                .eq("participant_id", participant_id)
                .order("updated_at", desc=True)
                .limit(1)
                .execute()
                .data
                or []
            )
            if intake and intake[0].get("service_agreement_document_path"):
                row = intake[0]
                signed = supabase.storage.from_(INTAKE_BUCKET).create_signed_url(
                    row["service_agreement_document_path"], SIGNED_DOCUMENT_URL_SECONDS
                )
                signed_document = {
                    "name": row.get("service_agreement_document_name"),
                    "url": signed.get("signedURL") or signed.get("signed_url"),
                    "provider_signed_name": row.get("provider_signed_name"),
                    "provider_signed_at": row.get("provider_signed_at"),
                    "family_signed_name": row.get("family_signed_name"),
                    "family_signed_at": row.get("family_signed_at"),
                }
        except Exception:
            logger.warning("Signed agreement lookup failed for participant %s", participant_id, exc_info=True)

    from .service_agreement_document_service import effective_status

    # list_service_agreements() orders newest start_date first. An agreement
    # with its own stored document (signed in CareCliQ, or recorded from
    # onboarding) links to that; the intake PDF remains the fallback for
    # the latest agreement.
    for index, agreement in enumerate(agreements):
        agreement["status"] = effective_status(agreement)
        agreement.pop("provider_signature_png", None)
        agreement.pop("participant_signature_png", None)
        _esign_summary(agreement)
        own = _own_document(agreement)
        agreement["signed_document"] = own or (signed_document if index == 0 else None)
    return agreements


def _own_document(agreement: dict[str, Any]) -> Optional[dict[str, Any]]:
    bucket, path = agreement.get("document_bucket"), agreement.get("document_path")
    if not (bucket and path):
        return None
    try:
        signed = get_supabase_admin().storage.from_(bucket).create_signed_url(path, SIGNED_DOCUMENT_URL_SECONDS)
        url = signed.get("signedURL") or signed.get("signed_url")
    except Exception:
        url = None
    return {
        "name": f"service-agreement-{agreement.get('agreement_number') or agreement['id'][:8]}.pdf",
        "url": url,
        "provider_signed_name": agreement.get("provider_signed_name"),
        "provider_signed_at": agreement.get("provider_signed_at"),
        "family_signed_name": agreement.get("participant_signed_name"),
        "family_signed_at": agreement.get("participant_signed_at"),
    }


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
    "fall back to participants.plan_management_type" (patients, pre-
    migration 218's rename) — any lookup failure (table not yet migrated,
    transient error) should degrade to that same safe fallback, not take
    down billing for every participant."""
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
            "falling back to participants.plan_management_type",
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
        # One participant's agreed rate belongs on their agreement line only.
        # It used to be written into the organisation's price list (an
        # is_override row), which changed the price for every participant.
        # It's checked against the NDIS price limit on the agreement's start date.
        rate = float(negotiated_rate)
        if rate < 0:
            raise HTTPException(status_code=422, detail="The agreed rate can't be negative.")
        limit_cents = ndis_pricing_service.price_limit_cents(
            ndis_pricing_service.load_price_limit_rows([support_item_code]),
            support_item_code, agreement.get("start_date") or date.today(),
        )
        if limit_cents is not None and round(rate * 100) > limit_cents:
            raise HTTPException(
                status_code=422,
                detail=f"${rate:,.2f} is above the NDIS price limit of ${limit_cents / 100:,.2f} for {support_item_code}.",
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
