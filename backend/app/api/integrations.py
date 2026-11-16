"""Integrations with other systems. For now, Xero (invoices and payments);
see services/xero_service.py. Managing directors connect and manage it;
anyone who handles invoices can send a single invoice to Xero."""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..core.security import get_current_user
from ..services import xero_service

router = APIRouter(prefix="/integrations", tags=["integrations"])


@router.get("/xero")
async def xero_status(current_user: dict = Depends(get_current_user)):
    """Whether Xero is available and connected, its settings and how syncing is going."""
    return xero_service.get_status(current_user)


@router.get("/xero/summary")
async def xero_summary(current_user: dict = Depends(get_current_user)):
    """Whether Xero is connected, for anyone who handles invoices."""
    return xero_service.get_summary(current_user)


@router.post("/xero/connect")
async def xero_connect(current_user: dict = Depends(get_current_user)):
    """The Xero sign-in link to send the director to."""
    return xero_service.create_connect_url(current_user)


class XeroCallback(BaseModel):
    code: str = Field(min_length=1, max_length=2000)
    state: str = Field(min_length=1, max_length=200)


@router.post("/xero/callback")
async def xero_callback(body: XeroCallback, current_user: dict = Depends(get_current_user)):
    """Finish connecting, with the code Xero sent back to the website."""
    return await xero_service.complete_connection(current_user, body.code, body.state)


@router.delete("/xero")
async def xero_disconnect(current_user: dict = Depends(get_current_user)):
    return await xero_service.disconnect(current_user)


class XeroSettings(BaseModel):
    sales_account_code: Optional[str] = Field(default=None, max_length=10)
    tax_type: Optional[str] = Field(default=None, max_length=50)
    invoice_status: Optional[Literal["AUTHORISED", "DRAFT"]] = None
    auto_send: Optional[bool] = None


@router.put("/xero/settings")
async def xero_settings(body: XeroSettings, current_user: dict = Depends(get_current_user)):
    return xero_service.update_settings(current_user, body.model_dump(exclude_none=True))


@router.get("/xero/options")
async def xero_options(current_user: dict = Depends(get_current_user)):
    """The Xero revenue accounts and tax rates to choose from."""
    return await xero_service.list_options(current_user)


@router.post("/xero/sync")
async def xero_sync(current_user: dict = Depends(get_current_user)):
    """Send approved invoices that haven't gone yet, and check Xero for payments."""
    return await xero_service.sync_now(current_user)


@router.post("/xero/invoices/{invoice_id}")
async def xero_push_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Send (or resend) one approved invoice to Xero."""
    return await xero_service.push_invoice_for_user(current_user, invoice_id)
