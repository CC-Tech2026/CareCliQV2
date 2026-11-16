"""Integrations with other systems: Xero (invoices and payments; see
services/xero_service.py), and the keys and webhooks other systems such as
CORA Workforce use with the CareCliQ API (services/public_api_service.py,
services/webhook_service.py). Managing directors manage them; anyone who
handles invoices can send a single invoice to Xero."""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..core.security import get_current_user
from ..services import public_api_service, webhook_service, xero_service

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


# ---------------------------------------------------------------------------
# CareCliQ API keys and webhooks (for systems such as CORA Workforce)
# ---------------------------------------------------------------------------

@router.get("/api")
async def api_overview(current_user: dict = Depends(get_current_user)):
    """Keys, webhooks, and the permissions and events there are to choose from."""
    return {
        "keys": public_api_service.list_keys(current_user),
        "webhooks": webhook_service.list_endpoints(current_user),
        "scopes": [{"id": k, "description": v} for k, v in public_api_service.SCOPES.items()],
        "events": [{"id": k, "description": v} for k, v in webhook_service.EVENTS.items()],
    }


class NewApiKey(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    scopes: Optional[list[str]] = None


@router.post("/api/keys")
async def api_create_key(body: NewApiKey, current_user: dict = Depends(get_current_user)):
    """Make a key. The full key is in this response only."""
    return await public_api_service.create_key(current_user, body.name, body.scopes)


@router.delete("/api/keys/{key_id}")
async def api_revoke_key(key_id: str, current_user: dict = Depends(get_current_user)):
    return await public_api_service.revoke_key(current_user, key_id)


class NewWebhook(BaseModel):
    url: str = Field(min_length=8, max_length=2000)
    events: list[str] = Field(min_length=1)
    description: Optional[str] = Field(default=None, max_length=200)


@router.post("/api/webhooks")
async def api_create_webhook(body: NewWebhook, current_user: dict = Depends(get_current_user)):
    """Add a webhook address. Its signing secret is in this response only."""
    return await webhook_service.create_endpoint(current_user, body.url, body.events, body.description)


class WebhookChange(BaseModel):
    url: Optional[str] = Field(default=None, max_length=2000)
    events: Optional[list[str]] = None
    description: Optional[str] = Field(default=None, max_length=200)
    active: Optional[bool] = None


@router.patch("/api/webhooks/{endpoint_id}")
async def api_update_webhook(endpoint_id: str, body: WebhookChange, current_user: dict = Depends(get_current_user)):
    return webhook_service.update_endpoint(current_user, endpoint_id, body.model_dump(exclude_none=True))


@router.delete("/api/webhooks/{endpoint_id}")
async def api_delete_webhook(endpoint_id: str, current_user: dict = Depends(get_current_user)):
    return await webhook_service.delete_endpoint(current_user, endpoint_id)


@router.post("/api/webhooks/{endpoint_id}/test")
async def api_test_webhook(endpoint_id: str, current_user: dict = Depends(get_current_user)):
    """Send a "ping" to check the address works."""
    return await webhook_service.send_test(current_user, endpoint_id)


@router.get("/api/webhooks/{endpoint_id}/deliveries")
async def api_webhook_deliveries(endpoint_id: str, current_user: dict = Depends(get_current_user)):
    return webhook_service.recent_deliveries(current_user, endpoint_id)
