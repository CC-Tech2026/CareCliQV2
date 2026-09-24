"""Billing, subscription, and independent invoice persistence."""

from __future__ import annotations

import logging
from datetime import datetime, timezone, date
from decimal import Decimal, ROUND_HALF_UP
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status

from ..core.access import (
    can_access_participant,
    can_access_session,
    get_user_id,
    get_user_organization_id,
    get_user_role,
    is_managing_director,
)
from .supabase_client import get_supabase_admin, signed_storage_url
from .organization_branding_service import get_letterhead

logger = logging.getLogger(__name__)

INVOICE_FILES_BUCKET = "invoice-files"


def _with_signed_pdf_url(invoice: dict) -> dict:
    """invoice-files is a private bucket — never trust a stored pdf_url (it may be a
    stale public link from before the bucket was locked down, or simply expired);
    always regenerate a fresh signed URL from pdf_path on read."""
    invoice = dict(invoice)
    invoice["pdf_url"] = signed_storage_url(INVOICE_FILES_BUCKET, invoice.get("pdf_path"))
    return invoice
from . import audit_service
from . import billing_period_service
from . import invoice_service
from ..core.timezone import app_today, participant_timezone, shift_local_date


SUBSCRIPTION_STATUSES = {"trialing", "active", "past_due", "cancelled", "manual_review"}
SUBSCRIPTION_PLANS = {"starter", "team", "pro", "enterprise"}
INVOICE_STATUSES = {"draft", "finalized", "issued", "sent", "paid", "void", "overdue", "cancelled"}
BILLING_ROLES = {"support_coordinator", "managing_director"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _as_of_date_from_due(due_date: Any, participant_id: Any = None, org_id: Any = None) -> date:
    """Date an invoice is billed as-of: its due date, else today in the
    participant's branch zone."""
    if due_date:
        try:
            return date.fromisoformat(str(due_date)[:10])
        except ValueError:
            pass
    return app_today(participant_timezone(participant_id, organization_id=org_id))


def _money_to_cents(value: Any) -> int:
    amount = Decimal(str(value or "0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int(amount * 100)


def _fmt_dmy(val: Any) -> str:
    """Format a date value as DD/MM/YYYY (used in invoice template)."""
    if not val:
        return ""
    try:
        return datetime.fromisoformat(str(val)[:10]).strftime("%d/%m/%Y")
    except Exception:
        return str(val)[:10]


def _require_org(user: dict) -> str:
    org_id = get_user_organization_id(user)
    if not org_id:
        raise HTTPException(status_code=403, detail="Billing requires organization membership.")
    return org_id


def _require_billing_role(user: dict) -> None:
    if get_user_role(user) not in BILLING_ROLES:
        raise HTTPException(status_code=403, detail="Billing access is not available for this role.")


def _calculate_totals(line_items: list[dict]) -> tuple[list[dict], int, int, int]:
    """Calculate line totals without resolving NDIS prices (sync only)."""
    cleaned: list[dict] = []
    subtotal = 0
    for item in line_items or []:
        description = str(item.get("description") or "").strip()
        if not description:
            continue
        quantity = Decimal(str(item.get("quantity") or "1"))
        unit_amount_cents = int(item.get("unit_amount_cents") or _money_to_cents(item.get("unit_amount") or 0))
        line_total = int((quantity * Decimal(unit_amount_cents)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        subtotal += line_total
        cleaned.append({
            "description": description,
            "quantity": float(quantity),
            "unit_amount_cents": unit_amount_cents,
            "line_total_cents": line_total,
            "service_date": str(item["service_date"]) if item.get("service_date") else None,
            "location_type": item.get("location_type") or "national",
            "item_code": item.get("item_code"),  # Pass through, may be None
            "ndis_price_item_id": item.get("ndis_price_item_id"),
        })
    if not cleaned:
        raise HTTPException(status_code=422, detail="At least one invoice line item is required.")
    tax = 0
    return cleaned, subtotal, tax, subtotal + tax


async def _resolve_ndis_prices_for_invoice(
    line_items: list[dict],
    org_id: str,
) -> list[dict]:
    """
    Resolve NDIS item prices for line items that have item_code.
    Updates ndis_price_item_id and unit_amount_cents if item_code is provided.
    
    Returns updated line items.
    """
    from . import ndis_pricing_service

    for item in line_items:
        if not item.get("item_code"):
            # No item code, leave as-is (free-text manual line item)
            continue

        if not item.get("service_date"):
            raise HTTPException(status_code=422, detail="A service date is required for NDIS catalogue items.")
        try:
            # Resolve the catalogue version applicable on the service date.
            resolved = await ndis_pricing_service.resolve_price(
                item_code=item.get("item_code"),
                org_id=org_id,
                as_of_date=item.get("service_date"),
                location_type=item.get("location_type") or "national",
            )

            if not resolved:
                raise HTTPException(status_code=422, detail=f"No catalogue price found for NDIS item {item.get('item_code')} on the service date.")
            if resolved:
                # Lock this line to the resolved price item version
                item["ndis_price_item_id"] = resolved.get("id")
                catalogue_unit_amount_cents = _money_to_cents(resolved.get("effective_price", 0))
                # Use resolved price if no unit_amount_cents was explicitly provided
                if item.get("unit_amount_cents") is None and item.get("unit_amount") is None:
                    item["unit_amount_cents"] = catalogue_unit_amount_cents
                    # Recalculate line total with resolved price
                    quantity = Decimal(str(item.get("quantity") or "1"))
                    item["line_total_cents"] = int(
                        (quantity * Decimal(item["unit_amount_cents"])).quantize(
                            Decimal("1"), rounding=ROUND_HALF_UP
                        )
                    )
                else:
                    # Client supplied an explicit amount for a catalogue-linked
                    # item — respect it (don't silently override), but flag any
                    # divergence from the resolved catalogue price so it's
                    # visible on the invoice record rather than silently lost.
                    supplied_cents = (
                        item.get("unit_amount_cents")
                        if item.get("unit_amount_cents") is not None
                        else _money_to_cents(item.get("unit_amount") or 0)
                    )
                    if abs(int(supplied_cents) - catalogue_unit_amount_cents) > 1:
                        item["catalogue_price_mismatch"] = True
                        item["catalogue_unit_amount_cents"] = catalogue_unit_amount_cents
                        logger.warning(
                            "billing: invoice line item %s supplied amount %s cents diverges "
                            "from catalogue price %s cents for org %s",
                            item.get("item_code"), supplied_cents, catalogue_unit_amount_cents, org_id,
                        )
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=422, detail="NDIS catalogue lookup failed. Resolve the support item before creating the invoice.") from exc

    return line_items


async def get_subscription(user: dict) -> dict:
    if not is_managing_director(user):
        raise HTTPException(status_code=403, detail="Only managing directors can manage subscriptions.")
    org_id = _require_org(user)
    supabase = get_supabase_admin()
    result = (
        supabase.table("billing_subscriptions")
        .select("*")
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    )
    if result.data:
        return result.data[0]

    payload = {
        "organization_id": org_id,
        "plan_name": "starter",
        "status": "trialing",
        "seats": 1,
        "currency": "AUD",
        "payment_provider": "manual",
        "updated_by": get_user_id(user),
    }
    created = supabase.table("billing_subscriptions").insert(payload).execute()
    return created.data[0] if created.data else payload


async def upsert_subscription(user: dict, data: dict) -> dict:
    if not is_managing_director(user):
        raise HTTPException(status_code=403, detail="Only managing directors can manage subscriptions.")
    org_id = _require_org(user)
    plan_name = data.get("plan_name") or "starter"
    subscription_status = data.get("status") or "trialing"
    if plan_name not in SUBSCRIPTION_PLANS:
        raise HTTPException(status_code=422, detail="Invalid subscription plan.")
    if subscription_status not in SUBSCRIPTION_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid subscription status.")

    payload = {
        "organization_id": org_id,
        "plan_name": plan_name,
        "status": subscription_status,
        "billing_email": data.get("billing_email"),
        "seats": max(int(data.get("seats") or 1), 1),
        "price_cents": int(data.get("price_cents") or 0),
        "currency": data.get("currency") or "AUD",
        "renewal_date": data.get("renewal_date") or None,
        "payment_provider": data.get("payment_provider") or "manual",
        "external_customer_id": data.get("external_customer_id") or None,
        "external_subscription_id": data.get("external_subscription_id") or None,
        "notes": data.get("notes") or None,
        "updated_by": get_user_id(user),
        "updated_at": _now_iso(),
    }
    supabase = get_supabase_admin()
    result = (
        supabase.table("billing_subscriptions")
        .upsert(payload, on_conflict="organization_id")
        .execute()
    )
    return result.data[0] if result.data else payload


def _invoice_select_query(supabase, user: dict):
    org_id = _require_org(user)
    query = supabase.table("invoices").select("*").eq("organization_id", org_id)
    return query


async def _enrich_with_service_category(supabase, invoices: list[dict]) -> list[dict]:
    """Attach each invoice's participant.service_category (Aged Care/Disability) —
    the ledger's "Service Type" column — via a single batched lookup rather
    than one query per row."""
    participant_ids = list({str(inv["participant_id"]) for inv in invoices if inv.get("participant_id")})
    if not participant_ids:
        return invoices
    try:
        result = (
            supabase.table("patients")
            .select("id, service_category")
            .in_("id", participant_ids)
            .execute()
        )
        category_by_id = {str(r["id"]): r.get("service_category") for r in (result.data or [])}
    except Exception:
        category_by_id = {}
    for inv in invoices:
        pid = inv.get("participant_id")
        inv["service_category"] = category_by_id.get(str(pid)) if pid else None
        # Participant's branch zone — clients show the invoice date in it.
        inv["timezone"] = str(participant_timezone(inv, organization_id=inv.get("organization_id")))
    return invoices


async def list_invoices(user: dict, status_filter: str | None = None) -> list[dict]:
    _require_billing_role(user)
    supabase = get_supabase_admin()
    query = _invoice_select_query(supabase, user)
    if status_filter:
        if status_filter not in INVOICE_STATUSES:
            raise HTTPException(status_code=422, detail="Invalid invoice status.")
        query = query.eq("status", status_filter)
    result = query.order("created_at", desc=True).limit(200).execute()
    invoices = [_with_signed_pdf_url(row) for row in (result.data or [])]
    return await _enrich_with_service_category(supabase, invoices)


async def get_invoice(invoice_id: str, user: dict) -> dict:
    _require_billing_role(user)
    supabase = get_supabase_admin()
    result = _invoice_select_query(supabase, user).eq("id", invoice_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Invoice not found.")
    invoice = _with_signed_pdf_url(result.data[0])
    enriched = await _enrich_with_service_category(supabase, [invoice])
    return enriched[0]


async def _verify_invoice_scope(user: dict, data: dict) -> None:
    org_id = _require_org(user)
    supabase = get_supabase_admin()

    participant_id = data.get("participant_id")
    if participant_id:
        participant_result = (
            supabase.table("patients")
            .select("*")
            .eq("id", participant_id)
            .limit(1)
            .execute()
        )
        participant = participant_result.data[0] if participant_result.data else None
        if not participant or not can_access_participant(participant, user):
            raise HTTPException(status_code=404, detail="Participant not found.")

    session_id = data.get("session_id")
    if session_id:
        session_result = (
            supabase.table("sessions")
            .select("*")
            .eq("id", session_id)
            .limit(1)
            .execute()
        )
        session = session_result.data[0] if session_result.data else None
        participant = None
        if session and session.get("patient_id"):
            participant_result = (
                supabase.table("patients")
                .select("*")
                .eq("id", session["patient_id"])
                .limit(1)
                .execute()
            )
            participant = participant_result.data[0] if participant_result.data else None
        if not session or not can_access_session(session, user, participant):
            raise HTTPException(status_code=404, detail="Session not found.")
        if session.get("organization_id") and str(session["organization_id"]) != org_id:
            raise HTTPException(status_code=404, detail="Session not found.")


def _single_matching_participant(org_id: str, recipient_name: str) -> dict[str, Any] | None:
    """Exact, case-insensitive match against this org's participants — used only to catch a
    manual invoice whose recipient_name is really one specific participant's name typed in
    free text with no participant_id set, and refuse it. Never used to silently set
    participant_id from a text match; that would just be a different flavour of the same
    inference problem this exists to prevent."""
    text = (recipient_name or "").strip()
    if not text:
        return None
    try:
        resp = (
            get_supabase_admin()
            .table("patients")
            .select("id, full_name")
            .eq("organization_id", org_id)
            .ilike("full_name", text)
            .execute()
        )
    except Exception:
        return None
    rows = [r for r in (resp.data or []) if isinstance(r, dict) and r.get("id")]
    return rows[0] if len(rows) == 1 else None


async def create_invoice(user: dict, data: dict) -> dict:
    _require_billing_role(user)
    org_id = _require_org(user)
    await _verify_invoice_scope(user, data)
    line_items = await _resolve_ndis_prices_for_invoice(
        [dict(item) for item in (data.get("line_items") or [])], org_id
    )
    if data.get("generate_from_verified_tasks"):
        participant_id = data.get("participant_id")
        period_start = data.get("period_start")
        period_end = data.get("period_end")
        if not participant_id or not period_start or not period_end:
            raise HTTPException(
                status_code=422,
                detail="participant_id, period_start, and period_end are required when generating from verified tasks.",
            )
        try:
            preview_lines = invoice_service.get_completed_tasks_for_period(
                get_supabase_admin(),
                str(participant_id),
                org_id,
                date.fromisoformat(str(period_start)),
                date.fromisoformat(str(period_end)),
                status="verified",
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid period_start or period_end.") from exc

        if not preview_lines:
            raise HTTPException(status_code=422, detail="No verified task completions found for the selected period.")

        generated_line_items: list[dict[str, Any]] = []
        for item in invoice_service.aggregate_line_items(preview_lines).values():
            total_cents = _money_to_cents(item.get("total_price") or 0)
            quantity = Decimal(str(item.get("quantity") or "0"))
            unit_amount_cents = 0
            if quantity > 0:
                unit_amount_cents = int(
                    (Decimal(total_cents) / quantity).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
                )
            generated_line_items.append({
                "description": item.get("description") or "Verified support item",
                "quantity": float(quantity),
                "unit_amount_cents": unit_amount_cents,
                "line_total_cents": total_cents,
                "item_code": item.get("price_item_code"),
            })

        if line_items:
            generated_line_items.extend(line_items)
        line_items = generated_line_items

    line_items, subtotal, tax, total = _calculate_totals(line_items)
    
    # Verified task amounts retain their recorded prices; do not relabel them
    # with a catalogue version resolved at invoice creation time.
    
    # Recalculate totals in case prices were resolved
    total_cents = sum(item.get("line_total_cents", 0) for item in line_items)
    
    invoice_number = data.get("invoice_number") or f"CS-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{str(uuid4())[:8].upper()}"
    status_value = data.get("status") or "draft"
    if status_value not in INVOICE_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid invoice status.")
    if data.get("session_id"):
        existing = (
            get_supabase_admin()
            .table("invoices")
            .select("id, status")
            .eq("session_id", data["session_id"])
            .execute()
        )
        if any(row.get("status") not in {"void", "cancelled"} for row in (existing.data or [])):
            raise HTTPException(status_code=409, detail="This session already has an active invoice.")

    billing_period_id = None
    participant_id = data.get("participant_id")
    if participant_id:
        as_of = _as_of_date_from_due(data.get("due_date"), participant_id, org_id)
        supabase = get_supabase_admin()
        participant_result = (
            supabase.table("patients")
            .select(
                "id, organization_id, full_name, email, plan_management_type, plan_management, "
                "case_manager_name, case_manager_email, case_manager_phone"
            )
            .eq("id", str(participant_id))
            .limit(1)
            .execute()
        )
        participant_row = (participant_result.data or [None])[0]
        period = billing_period_service.get_or_open_billing_period(
            str(participant_id),
            org_id,
            as_of_date=as_of,
            participant=participant_row,
        )
        billing_period_id = period.get("id")
        locked_type = str(period.get("locked_plan_management_type") or "")
        if participant_row and locked_type and not str(data.get("recipient_name") or "").strip():
            name, email = billing_period_service.suggest_invoice_recipient(
                participant_row,
                locked_type,
            )
            data["recipient_name"] = name
            if not data.get("recipient_email") and email:
                data["recipient_email"] = email

    if not participant_id:
        # A null participant_id is legitimate for a genuinely organisation-level invoice
        # (e.g. billed straight to NDIA) — but if recipient_name was typed free text and
        # happens to be exactly one participant's name on file, this is not that; it's a
        # participant invoice that was never linked. Refuse rather than leave the gap for a
        # participant-scoped query to silently miss later.
        matched = _single_matching_participant(org_id, str(data.get("recipient_name") or ""))
        if matched:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"'{matched.get('full_name')}' is a participant on file. Select them in the "
                    "participant field instead of typing their name as the recipient, so this "
                    "invoice is correctly linked to their record."
                ),
            )

    payload = {
        "organization_id": org_id,
        "issued_by": get_user_id(user),
        "participant_id": data.get("participant_id") or None,
        "session_id": data.get("session_id") or None,
        "billing_period_id": billing_period_id,
        "invoice_number": invoice_number,
        "recipient_name": data.get("recipient_name") or "",
        "recipient_email": data.get("recipient_email") or None,
        "line_items": line_items,
        "subtotal_cents": total_cents,
        "tax_cents": 0,
        "total_cents": total_cents,
        "currency": data.get("currency") or "AUD",
        "status": status_value,
        "due_date": data.get("due_date") or None,
        "issued_at": _now_iso() if status_value in {"issued", "sent", "paid"} else data.get("issued_at"),
        "finalized_at": _now_iso() if status_value in {"finalized", "issued", "sent", "paid"} else None,
        "paid_at": _now_iso() if status_value == "paid" else None,
        "payment_date": data.get("payment_date") or None,
        "payment_reference": data.get("payment_reference") or None,
        "payment_method": data.get("payment_method") or None,
        "notes": data.get("notes") or None,
    }
    supabase = get_supabase_admin()
    result = supabase.table("invoices").insert(payload).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Invoice could not be created.")
    created = result.data[0]

    if data.get("generate_from_verified_tasks"):
        completion_ids = [
            row.get("id")
            for row in invoice_service.get_completed_tasks_for_period(
                get_supabase_admin(),
                str(data.get("participant_id")),
                org_id,
                date.fromisoformat(str(data.get("period_start"))),
                date.fromisoformat(str(data.get("period_end"))),
                status="verified",
            )
            if row.get("id")
        ]
        if completion_ids:
            get_supabase_admin().table("task_completions").update({
                "invoice_id": created.get("id"),
                "updated_at": _now_iso(),
            }).in_("id", completion_ids).execute()

    await audit_service.log_action(
        action_type="invoice.created",
        entity_type="invoice",
        entity_id=created.get("id", ""),
        user_id=get_user_id(user),
        organization_id=org_id,
        after_state={"status": created.get("status"), "total_cents": created.get("total_cents")},
    )
    return created


async def update_invoice(invoice_id: str, user: dict, data: dict) -> dict:
    existing = await get_invoice(invoice_id, user)
    status_value = data.get("status", existing.get("status"))
    if status_value not in INVOICE_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid invoice status.")
    # A PDF render failure falls back to a placeholder with no line items —
    # never let that be sent to a participant or plan manager looking like a
    # real invoice. Regenerating a successful PDF clears the flag (see
    # generate_invoice_pdf); this only blocks the transitions where the
    # stored document is actually about to be relied on.
    if (
        status_value in {"finalized", "issued", "sent", "paid"}
        and status_value != existing.get("status")
        and existing.get("pdf_generation_failed")
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "This invoice's PDF failed to render and only a placeholder is stored. "
                "Regenerate the PDF successfully before finalizing or sending this invoice."
            ),
        )
    payload: dict[str, Any] = {
        "recipient_name": data.get("recipient_name", existing.get("recipient_name")),
        "recipient_email": data.get("recipient_email", existing.get("recipient_email")),
        "status": status_value,
        "due_date": data.get("due_date", existing.get("due_date")),
        "payment_method": data.get("payment_method", existing.get("payment_method")),
        "notes": data.get("notes", existing.get("notes")),
        "updated_at": _now_iso(),
    }
    if "line_items" in data:
        resolved_items = await _resolve_ndis_prices_for_invoice(
            [dict(item) for item in (data.get("line_items") or [])], _require_org(user)
        )
        line_items, subtotal, tax, total = _calculate_totals(resolved_items)
        payload.update({
            "line_items": line_items,
            "subtotal_cents": subtotal,
            "tax_cents": tax,
            "total_cents": total,
        })
    if status_value in {"issued", "sent", "paid"} and not existing.get("issued_at"):
        payload["issued_at"] = _now_iso()
    if status_value in {"finalized", "issued", "sent", "paid"} and not existing.get("finalized_at"):
        payload["finalized_at"] = _now_iso()
    if status_value == "paid" and not existing.get("paid_at"):
        payload["paid_at"] = _now_iso()
        payload["payment_date"] = data.get("payment_date") or app_today().isoformat()
    if "payment_reference" in data:
        payload["payment_reference"] = data.get("payment_reference")

    supabase = get_supabase_admin()
    result = (
        supabase.table("invoices")
        .update(payload)
        .eq("id", invoice_id)
        .eq("organization_id", existing["organization_id"])
        .execute()
    )
    updated = result.data[0] if result.data else await get_invoice(invoice_id, user)
    if payload.get("status") != existing.get("status"):
        await audit_service.log_action(
            action_type="invoice.status_changed",
            entity_type="invoice",
            entity_id=invoice_id,
            user_id=get_user_id(user),
            organization_id=existing.get("organization_id"),
            before_state={"status": existing.get("status")},
            after_state={"status": updated.get("status")},
        )
    else:
        await audit_service.log_action(
            action_type="invoice.updated",
            entity_type="invoice",
            entity_id=invoice_id,
            user_id=get_user_id(user),
            organization_id=existing.get("organization_id"),
            after_state={"status": updated.get("status")},
        )
    return updated


async def mark_invoice_paid(invoice_id: str, user: dict) -> dict:
    return await update_invoice(invoice_id, user, {"status": "paid"})


async def finalize_invoice(invoice_id: str, user: dict) -> dict:
    return await update_invoice(invoice_id, user, {"status": "finalized"})


async def mark_invoice_sent(invoice_id: str, user: dict) -> dict:
    return await update_invoice(invoice_id, user, {"status": "sent"})


async def cancel_invoice(invoice_id: str, user: dict) -> dict:
    existing = await get_invoice(invoice_id, user)
    payload = {
        "status": "cancelled",
        "cancelled_at": _now_iso(),
        "cancelled_by": get_user_id(user),
        "updated_at": _now_iso(),
    }
    result = (
        get_supabase_admin()
        .table("invoices")
        .update(payload)
        .eq("id", invoice_id)
        .eq("organization_id", existing["organization_id"])
        .execute()
    )
    updated = result.data[0] if result.data else {**existing, **payload}
    await audit_service.log_action(
        action_type="invoice.cancelled",
        entity_type="invoice",
        entity_id=invoice_id,
        user_id=get_user_id(user),
        organization_id=existing.get("organization_id"),
        before_state={"status": existing.get("status")},
        after_state={"status": "cancelled"},
    )
    return updated


def _minimal_pdf_bytes(invoice: dict, *, render_error: str | None = None) -> bytes:
    lines = [
        "*** PDF GENERATION FAILED - THIS IS NOT THE REAL INVOICE ***" if render_error else "CareCliQ Invoice",
        f"Invoice: {invoice.get('invoice_number', '')}",
        f"Recipient: {invoice.get('recipient_name', '')}",
        f"Status: {invoice.get('status', '')}",
        f"Total: {(invoice.get('total_cents') or 0) / 100:.2f} {invoice.get('currency') or 'AUD'}",
    ]
    if render_error:
        lines.append("Contact support before sending this invoice - line items are not shown above.")
    text = "\\n".join(lines).replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 12 Tf 72 740 Td ({text}) Tj ET"
    pdf = (
        "%PDF-1.4\n"
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
        "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n"
        f"4 0 obj << /Length {len(stream)} >> stream\n{stream}\nendstream endobj\n"
        "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n"
        "xref\n0 6\n0000000000 65535 f \ntrailer << /Root 1 0 R /Size 6 >>\nstartxref\n0\n%%EOF\n"
    )
    return pdf.encode("utf-8")


def _build_template_data(invoice: dict, supabase: Any) -> dict:
    """Assemble the Jinja2 template context from a billing-service invoice row."""
    from datetime import timedelta

    org_id = invoice.get("organization_id", "")

    # ── Provider (organizations) ──────────────────────────────────────────
    letterhead = get_letterhead(org_id)

    # ── Participant ────────────────────────────────────────────────────────
    participant: dict = {}
    if invoice.get("participant_id"):
        try:
            r = supabase.table("patients").select(
                "full_name, ndis_number, date_of_birth, address, plan_management_type, "
                "case_manager_name, case_manager_email, case_manager_phone"
            ).eq("id", invoice["participant_id"]).limit(1).execute()
            participant = (r.data or [{}])[0]
        except Exception:
            pass

    # ── Care coordinator (informational only — never used for billed_to_*
    # or plan_manager_* above, which stay driven by case_manager_* alone).
    # Fetched as its own best-effort query, not folded into the participant
    # select above, so a not-yet-migrated deployment can't lose participant
    # name/NDIS number/plan-management fields over one missing column.
    care_coordinator_name = ""
    if invoice.get("participant_id"):
        try:
            cc = supabase.table("patients").select("care_coordinator_id").eq(
                "id", invoice["participant_id"]
            ).limit(1).execute()
            cc_id = (cc.data or [{}])[0].get("care_coordinator_id")
            if cc_id:
                user_r = supabase.table("users").select("full_name").eq("id", cc_id).limit(1).execute()
                care_coordinator_name = (user_r.data or [{}])[0].get("full_name") or ""
        except Exception:
            pass

    # ── Plan dates + reference from ndis_plans ─────────────────────────────
    plan_start_date = ""
    plan_end_date = ""
    plan_number = ""
    if invoice.get("participant_id"):
        try:
            r = supabase.table("ndis_plans").select(
                "plan_start, plan_end, plan_number"
            ).eq("patient_id", invoice["participant_id"]).order(
                "created_at", desc=True
            ).limit(1).execute()
            plan_row = (r.data or [{}])[0]
            if plan_row.get("plan_start"):
                plan_start_date = _fmt_dmy(plan_row["plan_start"])
            if plan_row.get("plan_end"):
                plan_end_date = _fmt_dmy(plan_row["plan_end"])
            plan_number = plan_row.get("plan_number") or ""
        except Exception:
            pass

    # ── Billing period ─────────────────────────────────────────────────────
    period_start_raw = ""
    period_end_raw = ""
    if invoice.get("billing_period_id"):
        try:
            r = supabase.table("billing_periods").select(
                "period_start, period_end"
            ).eq("id", invoice["billing_period_id"]).limit(1).execute()
            bp = (r.data or [{}])[0]
            period_start_raw = str(bp.get("period_start") or "")
            period_end_raw = str(bp.get("period_end") or "")
        except Exception:
            pass

    # ── Date helpers ───────────────────────────────────────────────────────
    def _fmt_long(val: Any) -> str:
        if not val:
            return ""
        try:
            return datetime.fromisoformat(str(val)[:10]).strftime("%d %B %Y")
        except Exception:
            return str(val)[:10]

    def _fmt_period_start(val: Any) -> str:
        """'1 June' — no leading zero, no year"""
        if not val:
            return ""
        try:
            return datetime.fromisoformat(str(val)[:10]).strftime("%d %B").lstrip("0")
        except Exception:
            return str(val)[:10]

    def _fmt_period_end(val: Any) -> str:
        """'30 June 2026' — no leading zero"""
        if not val:
            return ""
        try:
            return datetime.fromisoformat(str(val)[:10]).strftime("%d %B %Y").lstrip("0")
        except Exception:
            return str(val)[:10]

    # ── Invoice dates ──────────────────────────────────────────────────────
    invoice_date_raw = (
        invoice.get("issued_at")
        or invoice.get("created_at")
        or datetime.now(timezone.utc).isoformat()
    )
    date_issued = _fmt_long(invoice_date_raw)

    due_date_raw = invoice.get("due_date")
    if due_date_raw:
        due_date = _fmt_long(due_date_raw)
    else:
        try:
            due_date = (
                datetime.fromisoformat(str(invoice_date_raw)[:10]) + timedelta(days=30)
            ).strftime("%d %B %Y")
        except Exception:
            due_date = ""

    service_period_start = _fmt_period_start(period_start_raw)
    service_period_end = _fmt_period_end(period_end_raw)

    # ── Plan management ────────────────────────────────────────────────────
    pmt_full = participant.get("plan_management_type") or ""
    pmt_lower = pmt_full.lower()
    if "ndia" in pmt_lower:
        pmt_code = "NDIA"
        pmt_display = "NDIA Managed"
    elif "plan" in pmt_lower:
        pmt_code = "PLAN"
        pmt_display = "Plan Managed"
    elif "self" in pmt_lower:
        pmt_code = "SELF"
        pmt_display = "Self Managed"
    else:
        pmt_code = ""
        pmt_display = pmt_full or "—"

    # ── Bill To (recipient from invoice, augmented with case manager info) ─
    billed_to_name = invoice.get("recipient_name") or ""
    billed_to_email = invoice.get("recipient_email") or ""
    billed_to_phone = ""
    if pmt_code == "PLAN" and not billed_to_name:
        billed_to_name = participant.get("case_manager_name") or ""
        billed_to_email = billed_to_email or participant.get("case_manager_email") or ""
        billed_to_phone = participant.get("case_manager_phone") or ""

    plan_manager_name = participant.get("case_manager_name") or billed_to_name
    plan_manager_email = participant.get("case_manager_email") or billed_to_email

    # ── Support category (first line item) ────────────────────────────────
    raw_items: list[dict] = invoice.get("line_items") or []
    support_category = (raw_items[0].get("support_category") or "") if raw_items else ""

    # ── Line items → template format ──────────────────────────────────────
    template_items = []
    for item in raw_items:
        unit_price = int(item.get("unit_amount_cents") or 0) / 100
        line_total = int(item.get("line_total_cents") or 0) / 100
        template_items.append({
            "item_code": item.get("item_code") or "",
            "item_name": item.get("description") or "",
            "item_description": item.get("item_description") or "",
            "shift_date": item.get("service_date") or item.get("shift_date") or item.get("date") or "",
            "hours": float(item.get("quantity") or 0),
            "unit_price": unit_price,
            "gst_applicable": bool(item.get("gst_applicable", False)),
            "line_total": line_total,
        })

    # ── Totals ─────────────────────────────────────────────────────────────
    invoice_total = int(invoice.get("total_cents") or 0) / 100
    gst_total = int(invoice.get("tax_cents") or 0) / 100
    subtotal = invoice_total - gst_total

    # ── Generated timestamp ────────────────────────────────────────────────
    generated_at = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC")

    return {
        # Provider
        "provider_name": letterhead["provider_name"],
        "provider_address": letterhead["address"] or "",
        "provider_email": letterhead["email"] or "",
        "provider_phone": letterhead["phone"] or "",
        "provider_abn": letterhead["abn"] or "",
        "provider_ndis_registration": letterhead["ndis_provider_number"] or "",
        "logo_url": letterhead["logo_url"],
        "brand_accent_color": letterhead["brand_accent_color"],
        # Invoice meta
        "invoice_number": invoice.get("invoice_number") or "",
        "date_issued": date_issued,
        "service_period_start": service_period_start,
        "service_period_end": service_period_end,
        "due_date": due_date,
        "status": invoice.get("status") or "draft",
        # Bill To
        "billed_to_name": billed_to_name,
        "billed_to_address_line1": participant.get("address") or "",
        "billed_to_address_line2": "",
        "billed_to_email": billed_to_email,
        "billed_to_phone": billed_to_phone,
        "billed_to_abn": "",
        # Participant
        "participant_name": participant.get("full_name") or invoice.get("recipient_name") or "",
        "participant_ndis_number": participant.get("ndis_number") or "",
        "participant_dob": _fmt_dmy(participant.get("date_of_birth")),
        "plan_start_date": plan_start_date,
        "plan_end_date": plan_end_date,
        # Info strip
        "plan_management_type": pmt_display,
        "plan_management_code": pmt_code,
        "support_category": support_category,
        "service_agreement_ref": plan_number,
        "claim_reference": invoice.get("claim_reference") or "",
        # Line items
        "line_items": template_items,
        # Totals
        "subtotal": subtotal,
        "gst_total": gst_total,
        "travel_amount": 0.0,
        "invoice_total": invoice_total,
        # Bank details (no DB columns yet — leave blank, shown as placeholder)
        "bank_account_name": "",
        "bank_bsb": "",
        "bank_account_number": "",
        "payment_terms_days": 14,
        # Plan management routing
        "plan_manager_name": plan_manager_name,
        "plan_manager_email": plan_manager_email,
        "plan_management_instruction": "",
        # Care coordinator — informational only, never a billing recipient
        "care_coordinator_name": care_coordinator_name,
        # Note
        "invoice_notes": invoice.get("notes") or "",
        # Footer
        "ndis_price_guide_version": "NDIS support items - refer to item codes and service dates",
        "generated_at": generated_at,
    }


async def generate_invoice_pdf(invoice_id: str, user: dict) -> dict:
    invoice = await get_invoice(invoice_id, user)
    supabase = get_supabase_admin()

    render_error: str | None = None
    try:
        from . import invoice_service as _inv_svc
        template_data = _build_template_data(invoice, supabase)
        pdf_bytes = _inv_svc.render_invoice_pdf(template_data)
    except Exception as exc:
        # A provider must never be able to send a participant or plan
        # manager a five-line placeholder without knowing that's what
        # they're sending — log the real cause, and mark the invoice row
        # itself so finalize/send are blocked until it's regenerated
        # successfully (see update_invoice's pdf_generation_failed check).
        logger.exception(
            "Invoice PDF render failed for invoice %s (org %s) — falling back to placeholder PDF",
            invoice_id, invoice.get("organization_id"),
        )
        render_error = str(exc)[:500]
        pdf_bytes = _minimal_pdf_bytes(invoice, render_error=render_error)

    path = f"{invoice['organization_id']}/{invoice['id']}/{invoice['invoice_number']}.pdf"
    supabase = get_supabase_admin()
    try:
        supabase.storage.from_(INVOICE_FILES_BUCKET).upload(
            path,
            pdf_bytes,
            {"content-type": "application/pdf", "upsert": "true"},
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Invoice PDF storage is not configured: {exc}")
    result = (
        supabase.table("invoices")
        # pdf_url is intentionally not stored — invoice-files is a private bucket, so
        # the URL must be a freshly-signed one generated at read time (see
        # _with_signed_pdf_url), never a persisted link that can outlive its signature.
        .update({
            "pdf_path": path,
            "pdf_url": None,
            "updated_at": _now_iso(),
            "pdf_generation_failed": render_error is not None,
            "pdf_generation_error": render_error,
        })
        .eq("id", invoice_id)
        .eq("organization_id", invoice["organization_id"])
        .execute()
    )
    updated = result.data[0] if result.data else {**invoice, "pdf_path": path}
    await audit_service.log_action(
        action_type="invoice.pdf_generation_failed" if render_error else "invoice.pdf_generated",
        entity_type="invoice",
        entity_id=invoice_id,
        user_id=get_user_id(user),
        organization_id=invoice.get("organization_id"),
        after_state={"pdf_path": path, "pdf_generation_failed": render_error is not None, "pdf_generation_error": render_error},
    )
    if render_error:
        raise HTTPException(
            status_code=502,
            detail=(
                "The invoice PDF template failed to render, so a placeholder was stored instead "
                "of the real invoice. Contact support before sending this invoice. "
                f"Error: {render_error}"
            ),
        )
    return _with_signed_pdf_url(updated)


async def get_revenue_report(user: dict) -> dict:
    """Monthly revenue summary for the Support Coordinator."""
    _require_billing_role(user)
    org_id = _require_org(user)
    supabase = get_supabase_admin()

    try:
        result = supabase.table("invoices").select(
            "id, total_cents, currency, status, created_at, due_date, recipient_name"
        ).eq("organization_id", org_id).order("created_at", desc=True).execute()
        invoices = result.data or []
    except Exception:
        invoices = []

    from collections import defaultdict
    monthly: dict[str, dict] = defaultdict(lambda: {"billed": 0, "paid": 0, "outstanding": 0, "count": 0})

    total_billed = 0
    total_paid = 0
    total_outstanding = 0

    for inv in invoices:
        month_day = shift_local_date(inv.get("created_at"))
        month_key = month_day.isoformat()[:7] if month_day else str(inv.get("created_at") or "")[:7]
        amount = int(inv.get("total_cents") or 0)
        total_billed += amount
        monthly[month_key]["billed"] += amount
        monthly[month_key]["count"] += 1

        s = inv.get("status", "")
        if s == "paid":
            total_paid += amount
            monthly[month_key]["paid"] += amount
        elif s not in ("void", "cancelled"):
            total_outstanding += amount
            monthly[month_key]["outstanding"] += amount

    monthly_list = sorted(
        [{"month": k, **v} for k, v in monthly.items() if k],
        key=lambda x: x["month"],
        reverse=True,
    )

    # --- Real cost and margin figures from budget_usage records ---
    total_session_costs_cents: int | None = None
    session_count: int | None = None
    cost_per_session_cents: int | None = None
    gross_margin_pct: float | None = None
    # net_margin_pct is omitted until real overhead cost data is available

    try:
        # Step 1: get all session IDs for this org
        sessions_result = (
            supabase.table("sessions")
            .select("id")
            .eq("organization_id", org_id)
            .execute()
        )
        session_ids = [r["id"] for r in (sessions_result.data or []) if r.get("id")]
        session_count = len(session_ids)

        if session_ids:
            # Step 2: sum budget_usage.amount for those sessions
            # budget_usage.amount is stored in dollars; convert to cents
            usage_result = (
                supabase.table("budget_usage")
                .select("session_id, amount")
                .in_("session_id", session_ids)
                .execute()
            )
            usage_rows = usage_result.data or []

            raw_cost_sum = 0.0
            for row in usage_rows:
                raw_cost_sum += float(row.get("amount") or 0)

            total_session_costs_cents = int(raw_cost_sum * 100)

            # Cost-per-session: total budget_usage cost / total session count for org
            # (per task spec: total session cost from budget_usage / session count)
            if session_count > 0 and total_session_costs_cents > 0:
                cost_per_session_cents = int(total_session_costs_cents / session_count)

            # Gross margin only when we have real invoice revenue AND real cost records
            if total_billed > 0 and total_session_costs_cents > 0:
                gross = (total_billed - total_session_costs_cents) / total_billed * 100
                gross_margin_pct = round(gross, 1)
    except Exception:
        pass

    return {
        "monthly": monthly_list,
        "total_billed_cents": total_billed,
        "total_paid_cents": total_paid,
        "total_outstanding_cents": total_outstanding,
        "invoice_count": len(invoices),
        "session_count": session_count,
        "total_session_costs_cents": total_session_costs_cents,
        "cost_per_session_cents": cost_per_session_cents,
        "gross_margin_pct": gross_margin_pct,
    }
