"""Billing, subscription, and invoice API endpoints."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from ..core.security import get_current_user
from ..api.security import require_recent_reauth
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
    item_code: Optional[str] = None  # Optional NDIS item code — if provided, locks price version


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
    payment_method: Optional[str] = None
    notes: Optional[str] = None
    generate_from_verified_tasks: bool = False
    period_start: Optional[str] = None
    period_end: Optional[str] = None


class InvoiceUpdate(BaseModel):
    recipient_name: Optional[str] = None
    recipient_email: Optional[str] = None
    line_items: Optional[list[InvoiceLineItem]] = None
    status: Optional[str] = None
    due_date: Optional[str] = None
    payment_method: Optional[str] = None
    notes: Optional[str] = None


@router.get("/subscription")
async def get_subscription(current_user: dict = Depends(get_current_user)):
    return await billing_service.get_subscription(current_user)


@router.put("/subscription")
async def update_subscription(
    body: SubscriptionUpdate,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    require_recent_reauth(request, current_user)
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
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    if body.status and body.status != "draft":
        require_recent_reauth(request, current_user)
    return await billing_service.create_invoice(current_user, body.model_dump(exclude_none=True))


@router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    return await billing_service.get_invoice(invoice_id, current_user)


@router.patch("/invoices/{invoice_id}")
async def update_invoice(
    invoice_id: str,
    body: InvoiceUpdate,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    if body.status and body.status != "draft":
        require_recent_reauth(request, current_user)
    return await billing_service.update_invoice(
        invoice_id,
        current_user,
        body.model_dump(exclude_unset=True, exclude_none=True),
    )


@router.post("/invoices/{invoice_id}/finalize")
async def finalize_invoice(invoice_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    require_recent_reauth(request, current_user)
    return await billing_service.finalize_invoice(invoice_id, current_user)


@router.post("/invoices/{invoice_id}/mark-sent")
async def mark_invoice_sent(invoice_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    require_recent_reauth(request, current_user)
    return await billing_service.mark_invoice_sent(invoice_id, current_user)


@router.post("/invoices/{invoice_id}/mark-paid")
async def mark_invoice_paid(invoice_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    require_recent_reauth(request, current_user)
    return await billing_service.mark_invoice_paid(invoice_id, current_user)


@router.post("/invoices/{invoice_id}/pdf")
async def generate_invoice_pdf(invoice_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    require_recent_reauth(request, current_user)
    return await billing_service.generate_invoice_pdf(invoice_id, current_user)


@router.post("/invoices/{invoice_id}/cancel")
async def cancel_invoice(invoice_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    require_recent_reauth(request, current_user)
    return await billing_service.cancel_invoice(invoice_id, current_user)


@router.get("/revenue-report")
async def revenue_report(current_user: dict = Depends(get_current_user)):
    """Monthly revenue summary for the Support Coordinator invoicing dashboard."""
    return await billing_service.get_revenue_report(current_user)
