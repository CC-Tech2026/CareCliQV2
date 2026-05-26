"""Billing, subscription, and invoice API endpoints."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..core.security import get_current_user
from ..services import billing_service


router = APIRouter(prefix="/billing", tags=["billing"])


class SubscriptionUpdate(BaseModel):
    plan_name: str = "starter"
    status: str = "trialing"
    billing_email: Optional[str] = None
    seats: int = Field(default=1, ge=1)
    price_cents: int = Field(default=0, ge=0)
    currency: str = "AUD"
    renewal_date: Optional[str] = None
    payment_provider: str = "manual"
    external_customer_id: Optional[str] = None
    external_subscription_id: Optional[str] = None
    notes: Optional[str] = None


class InvoiceLineItem(BaseModel):
    description: str
    quantity: float = Field(default=1, gt=0)
    unit_amount: Optional[float] = Field(default=None, ge=0)
    unit_amount_cents: Optional[int] = Field(default=None, ge=0)


class InvoiceCreate(BaseModel):
    participant_id: Optional[str] = None
    session_id: Optional[str] = None
    invoice_number: Optional[str] = None
    recipient_name: str
    recipient_email: Optional[str] = None
    line_items: list[InvoiceLineItem]
    currency: str = "AUD"
    status: str = "draft"
    due_date: Optional[str] = None
    notes: Optional[str] = None


class InvoiceUpdate(BaseModel):
    recipient_name: Optional[str] = None
    recipient_email: Optional[str] = None
    line_items: Optional[list[InvoiceLineItem]] = None
    status: Optional[str] = None
    due_date: Optional[str] = None
    notes: Optional[str] = None


@router.get("/subscription")
async def get_subscription(current_user: dict = Depends(get_current_user)):
    return await billing_service.get_subscription(current_user)


@router.put("/subscription")
async def update_subscription(
    body: SubscriptionUpdate,
    current_user: dict = Depends(get_current_user),
):
    return await billing_service.upsert_subscription(current_user, body.model_dump())


@router.get("/invoices")
async def list_invoices(
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    return await billing_service.list_invoices(current_user, status)


@router.post("/invoices", status_code=201)
async def create_invoice(
    body: InvoiceCreate,
    current_user: dict = Depends(get_current_user),
):
    return await billing_service.create_invoice(current_user, body.model_dump(exclude_none=True))


@router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    return await billing_service.get_invoice(invoice_id, current_user)


@router.patch("/invoices/{invoice_id}")
async def update_invoice(
    invoice_id: str,
    body: InvoiceUpdate,
    current_user: dict = Depends(get_current_user),
):
    return await billing_service.update_invoice(
        invoice_id,
        current_user,
        body.model_dump(exclude_unset=True, exclude_none=True),
    )


@router.post("/invoices/{invoice_id}/mark-paid")
async def mark_invoice_paid(invoice_id: str, current_user: dict = Depends(get_current_user)):
    return await billing_service.mark_invoice_paid(invoice_id, current_user)

