"""NDIS Pricing API endpoints — load schedules, resolve prices, edit items."""

from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from ..core.security import get_current_user
from ..api.security import require_recent_reauth
from ..services import ndis_pricing_service


router = APIRouter(prefix="/ndis-pricing", tags=["ndis-pricing"])


# ── Request/Response Schemas ───────────────────────────────────────────────

class PriceResolutionRequest(BaseModel):
    item_code: str
    as_of_date: Optional[str] = None
    location_type: str = Field(default="national", pattern="^(national|remote|very_remote)$")


class PriceResolutionResponse(BaseModel):
    id: Optional[str] = None
    item_code: str
    name: str
    description: Optional[str] = None
    unit: str
    price_national: float
    price_remote: Optional[float] = None
    price_very_remote: Optional[float] = None
    effective_price: float
    effective_price_source: str
    day_type: Optional[str] = None
    time_type: Optional[str] = None
    support_intensity: Optional[str] = None
    support_purpose: Optional[str] = None


class LoadScheduleRequest(BaseModel):
    """Bulk NDIS pricing schedule JSON (raw dict from file)."""
    metadata: dict
    support_categories: list[dict]
    location_loadings: Optional[dict] = None
    claim_types: Optional[dict] = None
    plan_management_types: Optional[dict] = None


class LoadScheduleResponse(BaseModel):
    schedule_id: str
    financial_year: str
    effective_date: str
    items_loaded: int
    validation_errors: list[str] = []


class EditItemPriceRequest(BaseModel):
    price_national: Optional[float] = None
    price_remote: Optional[float] = None
    price_very_remote: Optional[float] = None
    effective_date: Optional[str] = None
    reason: Optional[str] = None


class EditItemPriceResponse(BaseModel):
    old_version: dict
    new_version: dict
    schedule_id: Optional[str] = None
    effective_date: str
    reason: Optional[str] = None


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.post("/resolve")
async def resolve_price(
    request_body: PriceResolutionRequest,
    current_user: dict = Depends(get_current_user),
) -> PriceResolutionResponse:
    """
    Resolve the current effective price for an NDIS item.
    
    Returns the price that applies as of a given date (default: today),
    including fallback remote/very-remote prices if no explicit override exists.
    """
    org_id = current_user.get("organization_id")
    if not org_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="User must belong to an organization.")

    resolved = await ndis_pricing_service.resolve_price(
        item_code=request_body.item_code,
        org_id=org_id,
        as_of_date=request_body.as_of_date,
        location_type=request_body.location_type,
    )

    if not resolved:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=404,
            detail=f"Item '{request_body.item_code}' not found or expired.",
        )

    return PriceResolutionResponse(**resolved)


@router.post("/schedules/load", status_code=201)
async def load_schedule(
    request_body: LoadScheduleRequest,
    http_request: Request,
    current_user: dict = Depends(get_current_user),
) -> LoadScheduleResponse:
    """
    Load a complete NDIS pricing schedule (bulk import from JSON file).
    
    Requires recent re-authentication and support_coordinator role.
    """
    require_recent_reauth(http_request, current_user)

    result = await ndis_pricing_service.load_price_schedule(
        user=current_user,
        source_json=request_body.dict(),
    )

    return LoadScheduleResponse(**result)


@router.post("/platform-schedules/load", status_code=201)
async def load_platform_schedule(
    request_body: LoadScheduleRequest,
    http_request: Request,
    current_user: dict = Depends(get_current_user),
) -> LoadScheduleResponse:
    """
    Load a schedule into the platform-wide reference catalogue
    (platform_ndis_price_items) — CareCliQ's own centrally-maintained
    rates, not any one provider's.

    Requires recent re-authentication and super_admin role.
    """
    require_recent_reauth(http_request, current_user)

    result = await ndis_pricing_service.load_platform_price_schedule(
        user=current_user,
        source_json=request_body.dict(),
    )

    return LoadScheduleResponse(**result)


@router.get("/schedules")
async def list_schedules(
    current_user: dict = Depends(get_current_user),
) -> list[dict]:
    """
    List all active and superseded price schedules for the user's organization.
    
    Returns newest schedules first.
    """
    org_id = current_user.get("organization_id")
    if not org_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="User must belong to an organization.")

    return await ndis_pricing_service.list_schedules(org_id)


@router.get("/schedules/{schedule_id}")
async def get_schedule(
    schedule_id: str,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Get details of a specific price schedule."""
    schedule = await ndis_pricing_service.get_schedule(schedule_id)
    if not schedule:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Schedule not found.")

    # Verify org access
    org_id = current_user.get("organization_id")
    if schedule.get("organization_id") != org_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Access denied.")

    return schedule


@router.get("/items/{item_code}/history")
async def get_item_history(
    item_code: str,
    limit: int = 50,
    current_user: dict = Depends(get_current_user),
) -> list[dict]:
    """
    Get the version history for a single NDIS item (all valid versions).
    
    Shows when prices were edited, by whom, and when each version was effective.
    """
    org_id = current_user.get("organization_id")
    if not org_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="User must belong to an organization.")

    return await ndis_pricing_service.get_item_history(
        item_code=item_code,
        org_id=org_id,
        limit=limit,
    )


@router.post("/items/{item_code}/edit")
async def edit_item_price(
    item_code: str,
    request_body: EditItemPriceRequest,
    http_request: Request,
    current_user: dict = Depends(get_current_user),
) -> EditItemPriceResponse:
    """
    Edit the price for a single NDIS item (coordinator only).
    
    Creates a new version; old version is closed out with valid_to set.
    Validates that the edit doesn't overlap with invoiced periods.
    Requires recent re-authentication.
    """
    require_recent_reauth(http_request, current_user)

    result = await ndis_pricing_service.edit_item_price(
        user=current_user,
        item_code=item_code,
        price_national=request_body.price_national,
        price_remote=request_body.price_remote,
        price_very_remote=request_body.price_very_remote,
        effective_date=request_body.effective_date,
        reason=request_body.reason,
    )

    return EditItemPriceResponse(**result)
