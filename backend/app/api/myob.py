"""MYOB Business (AccountRight): invoices out, payments back. See
services/myob_service.py. Managing directors connect and manage it; anyone who
handles invoices can send a single invoice to MYOB.

Kept apart from api/integrations.py (Xero and the CareCliQ API) so the two
accounting systems can change independently."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..core.security import get_current_user
from ..services import myob_service

router = APIRouter(prefix="/integrations/myob", tags=["integrations"])


@router.get("")
async def myob_status(current_user: dict = Depends(get_current_user)):
    """Whether MYOB is available and connected, its settings and how syncing is going."""
    return myob_service.get_status(current_user)


@router.get("/summary")
async def myob_summary(current_user: dict = Depends(get_current_user)):
    """Whether MYOB is connected, for anyone who handles invoices."""
    return myob_service.get_summary(current_user)


@router.post("/connect")
async def myob_connect(current_user: dict = Depends(get_current_user)):
    """The MYOB sign-in link to send the director to."""
    return myob_service.create_connect_url(current_user)


class MyobCallback(BaseModel):
    code: str = Field(min_length=1, max_length=4000)
    state: str = Field(min_length=1, max_length=200)
    business_id: str = Field(min_length=1, max_length=100)


@router.post("/callback")
async def myob_callback(body: MyobCallback, current_user: dict = Depends(get_current_user)):
    """Finish connecting, with the code and company file MYOB sent back to the website."""
    return await myob_service.complete_connection(current_user, body.code, body.state, body.business_id)


@router.delete("")
async def myob_disconnect(current_user: dict = Depends(get_current_user)):
    return await myob_service.disconnect(current_user)


class MyobSettings(BaseModel):
    income_account_uid: Optional[str] = Field(default=None, max_length=64)
    income_account_name: Optional[str] = Field(default=None, max_length=200)
    tax_code_uid: Optional[str] = Field(default=None, max_length=64)
    tax_code_name: Optional[str] = Field(default=None, max_length=200)
    auto_send: Optional[bool] = None


@router.put("/settings")
async def myob_settings(body: MyobSettings, current_user: dict = Depends(get_current_user)):
    return myob_service.update_settings(current_user, body.model_dump(exclude_none=True))


@router.get("/options")
async def myob_options(current_user: dict = Depends(get_current_user)):
    """The income accounts and tax codes in the company file to choose from."""
    return await myob_service.list_options(current_user)


@router.post("/sync")
async def myob_sync(current_user: dict = Depends(get_current_user)):
    """Send approved invoices that haven't gone yet, and check MYOB for payments."""
    return await myob_service.sync_now(current_user)


@router.post("/invoices/{invoice_id}")
async def myob_push_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Send (or resend) one approved invoice to MYOB."""
    return await myob_service.push_invoice_for_user(current_user, invoice_id)
