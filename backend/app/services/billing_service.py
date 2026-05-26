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


SUBSCRIPTION_STATUSES = {"trialing", "active", "past_due", "cancelled", "manual_review"}
SUBSCRIPTION_PLANS = {"starter", "team", "pro", "enterprise"}
INVOICE_STATUSES = {"draft", "issued", "paid", "void", "overdue"}
BILLING_ROLES = {"support_coordinator", "allied_health"}


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
        })
    if not cleaned:
        raise HTTPException(status_code=422, detail="At least one invoice line item is required.")
    tax = 0
    return cleaned, subtotal, tax, subtotal + tax


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
    invoice_number = data.get("invoice_number") or f"CS-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{str(uuid4())[:8].upper()}"
    status_value = data.get("status") or "draft"
    if status_value not in INVOICE_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid invoice status.")

    payload = {
        "organization_id": org_id,
        "issued_by": get_user_id(user),
        "participant_id": data.get("participant_id") or None,
        "session_id": data.get("session_id") or None,
        "invoice_number": invoice_number,
        "recipient_name": data.get("recipient_name") or "",
        "recipient_email": data.get("recipient_email") or None,
        "line_items": line_items,
        "subtotal_cents": subtotal,
        "tax_cents": tax,
        "total_cents": total,
        "currency": data.get("currency") or "AUD",
        "status": status_value,
        "due_date": data.get("due_date") or None,
        "issued_at": _now_iso() if status_value in {"issued", "paid"} else data.get("issued_at"),
        "paid_at": _now_iso() if status_value == "paid" else None,
        "notes": data.get("notes") or None,
    }
    supabase = get_supabase_admin()
    result = supabase.table("invoices").insert(payload).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Invoice could not be created.")
    return result.data[0]


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
    if status_value in {"issued", "paid"} and not existing.get("issued_at"):
        payload["issued_at"] = _now_iso()
    if status_value == "paid" and not existing.get("paid_at"):
        payload["paid_at"] = _now_iso()

    supabase = get_supabase_admin()
    result = (
        supabase.table("invoices")
        .update(payload)
        .eq("id", invoice_id)
        .eq("organization_id", existing["organization_id"])
        .execute()
    )
    return result.data[0] if result.data else await get_invoice(invoice_id, user)


async def mark_invoice_paid(invoice_id: str, user: dict) -> dict:
    return await update_invoice(invoice_id, user, {"status": "paid"})

