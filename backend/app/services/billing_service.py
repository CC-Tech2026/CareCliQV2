"""Billing, subscription, and independent invoice persistence."""

from __future__ import annotations

from datetime import datetime, timezone
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
    is_allied_health,
    is_coordinator_role,
)
from .supabase_client import get_supabase_admin
from . import audit_service


SUBSCRIPTION_STATUSES = {"trialing", "active", "past_due", "cancelled", "manual_review"}
SUBSCRIPTION_PLANS = {"starter", "team", "pro", "enterprise"}
INVOICE_STATUSES = {"draft", "finalized", "issued", "sent", "paid", "void", "overdue", "cancelled"}
BILLING_ROLES = {"support_coordinator", "allied_health", "managing_director"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _money_to_cents(value: Any) -> int:
    amount = Decimal(str(value or "0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int(amount * 100)


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
            "item_code": item.get("item_code"),  # Pass through, may be None
            "ndis_price_item_id": None,  # Will be resolved later if item_code is present
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

        try:
            # Resolve price for this item as of today
            resolved = await ndis_pricing_service.resolve_price(
                item_code=item.get("item_code"),
                org_id=org_id,
                location_type="national",
            )

            if resolved:
                # Lock this line to the resolved price item version
                item["ndis_price_item_id"] = resolved.get("id")
                # Use resolved price if no unit_amount_cents was explicitly provided
                if item.get("unit_amount_cents") is None:
                    item["unit_amount_cents"] = int(resolved.get("effective_price", 0) * 100)
                    # Recalculate line total with resolved price
                    quantity = Decimal(str(item.get("quantity") or "1"))
                    item["line_total_cents"] = int(
                        (quantity * Decimal(item["unit_amount_cents"])).quantize(
                            Decimal("1"), rounding=ROUND_HALF_UP
                        )
                    )
        except Exception as e:
            # If price resolution fails, continue with manual entry
            # Don't fail invoice creation just because pricing lookup failed
            pass

    return line_items


async def get_subscription(user: dict) -> dict:
    if not is_coordinator_role(user):
        raise HTTPException(status_code=403, detail="Only support coordinators can manage subscriptions.")
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
    if not is_coordinator_role(user):
        raise HTTPException(status_code=403, detail="Only support coordinators can manage subscriptions.")
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
    if is_allied_health(user):
        query = query.eq("issued_by", get_user_id(user))
    return query


async def list_invoices(user: dict, status_filter: str | None = None) -> list[dict]:
    _require_billing_role(user)
    supabase = get_supabase_admin()
    query = _invoice_select_query(supabase, user)
    if status_filter:
        if status_filter not in INVOICE_STATUSES:
            raise HTTPException(status_code=422, detail="Invalid invoice status.")
        query = query.eq("status", status_filter)
    result = query.order("created_at", desc=True).limit(200).execute()
    return result.data or []


async def get_invoice(invoice_id: str, user: dict) -> dict:
    _require_billing_role(user)
    supabase = get_supabase_admin()
    result = _invoice_select_query(supabase, user).eq("id", invoice_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Invoice not found.")
    return result.data[0]


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


async def create_invoice(user: dict, data: dict) -> dict:
    _require_billing_role(user)
    org_id = _require_org(user)
    await _verify_invoice_scope(user, data)
    line_items, subtotal, tax, total = _calculate_totals(data.get("line_items") or [])
    
    # Resolve NDIS prices for items with item_code
    line_items = await _resolve_ndis_prices_for_invoice(line_items, org_id)
    
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

    payload = {
        "organization_id": org_id,
        "issued_by": get_user_id(user),
        "participant_id": data.get("participant_id") or None,
        "session_id": data.get("session_id") or None,
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
        "notes": data.get("notes") or None,
    }
    supabase = get_supabase_admin()
    result = supabase.table("invoices").insert(payload).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Invoice could not be created.")
    created = result.data[0]
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
    payload: dict[str, Any] = {
        "recipient_name": data.get("recipient_name", existing.get("recipient_name")),
        "recipient_email": data.get("recipient_email", existing.get("recipient_email")),
        "status": status_value,
        "due_date": data.get("due_date", existing.get("due_date")),
        "notes": data.get("notes", existing.get("notes")),
        "updated_at": _now_iso(),
    }
    if "line_items" in data:
        line_items, subtotal, tax, total = _calculate_totals(data.get("line_items") or [])
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
        payload["payment_date"] = data.get("payment_date") or datetime.now(timezone.utc).date().isoformat()
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


def _minimal_pdf_bytes(invoice: dict) -> bytes:
    lines = [
        "CareCliQ Invoice",
        f"Invoice: {invoice.get('invoice_number', '')}",
        f"Recipient: {invoice.get('recipient_name', '')}",
        f"Status: {invoice.get('status', '')}",
        f"Total: {(invoice.get('total_cents') or 0) / 100:.2f} {invoice.get('currency') or 'AUD'}",
    ]
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


async def generate_invoice_pdf(invoice_id: str, user: dict) -> dict:
    invoice = await get_invoice(invoice_id, user)
    pdf_bytes = _minimal_pdf_bytes(invoice)
    path = f"{invoice['organization_id']}/{invoice['id']}/{invoice['invoice_number']}.pdf"
    supabase = get_supabase_admin()
    try:
        supabase.storage.from_("invoice-files").upload(
            path,
            pdf_bytes,
            {"content-type": "application/pdf", "upsert": "true"},
        )
        url = supabase.storage.from_("invoice-files").get_public_url(path)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Invoice PDF storage is not configured: {exc}")
    result = (
        supabase.table("invoices")
        .update({"pdf_path": path, "pdf_url": url, "updated_at": _now_iso()})
        .eq("id", invoice_id)
        .eq("organization_id", invoice["organization_id"])
        .execute()
    )
    updated = result.data[0] if result.data else {**invoice, "pdf_path": path, "pdf_url": url}
    await audit_service.log_action(
        action_type="invoice.pdf_generated",
        entity_type="invoice",
        entity_id=invoice_id,
        user_id=get_user_id(user),
        organization_id=invoice.get("organization_id"),
        after_state={"pdf_path": path},
    )
    return updated


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
        month_key = str(inv.get("created_at") or "")[:7]
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
