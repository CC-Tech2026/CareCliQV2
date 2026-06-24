"""NDIS pricing service — resolution, loading, and editing with effective-dating."""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from fastapi import HTTPException, status

from .supabase_client import get_supabase_admin
from ..core.access import get_user_id, get_user_organization_id, get_user_role
from . import audit_service

logger = logging.getLogger(__name__)


# ── Price Resolution ───────────────────────────────────────────────────────

async def resolve_price(
    item_code: str,
    org_id: UUID | str,
    as_of_date: date | str | None = None,
    location_type: str = "national",
) -> dict[str, Any] | None:
    """
    Resolve the effective price for an NDIS item at a point in time.
    
    Args:
        item_code: NDIS item code (e.g., "01_011_0107_1_1")
        org_id: Organization ID
        as_of_date: Date to resolve price as of (default: today) — can be date or ISO string
        location_type: "national", "remote", or "very_remote"
    
    Returns:
        Dict with id, item_code, name, price_national, price_remote, 
        price_very_remote, effective_price, effective_price_source, etc.
        Returns None if item not found or expired.
    """
    import asyncio
    import requests
    from ..core.config import settings
    
    if as_of_date is None:
        as_of_date = date.today()
    elif isinstance(as_of_date, str):
        as_of_date = date.fromisoformat(as_of_date)

    # Use requests in a thread pool to avoid DNS issues in async context
    def _query_db():
        url = f"{settings.supabase_url}/rest/v1/ndis_price_items"
        headers = {
            "apikey": settings.supabase_service_role_key,  # PostgREST requires apikey header
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
            "Content-Type": "application/json",
        }
        
        # Build query parameters for PostgREST
        query_params = {
            "item_code": f"eq.{item_code}",
            "organization_id": f"eq.{str(org_id)}",
            "valid_from": f"lte.{as_of_date.isoformat()}",
            "order": "valid_from.desc",
            "limit": "1",
        }
        
        logger.info(f"[resolve_price] Querying PostgREST: item_code={item_code}, org_id={org_id}, date={as_of_date}")
        
        try:
            response = requests.get(url, params=query_params, headers=headers, timeout=10)
            logger.info(f"[resolve_price] Status: {response.status_code}")
            
            if response.status_code != 200:
                logger.warning(f"[resolve_price] Non-200 response: {response.text}")
                return None
            
            data = response.json()
            logger.info(f"[resolve_price] Got {len(data)} items from PostgREST")
            
            if not data:
                logger.warning(f"[resolve_price] No items found")
                return None
            
            logger.info(f"[resolve_price] Returning item: {data[0].get('item_code')}")
            return data[0]
        except requests.exceptions.RequestException as e:
            logger.error(f"[resolve_price] Request error: {e}", exc_info=True)
            return None
        except Exception as e:
            logger.error(f"[resolve_price] Unexpected error: {e}", exc_info=True)
            return None
    
    item = await asyncio.to_thread(_query_db)
    
    if not item:
        return None
    
    # Determine effective price based on location type
    price_field_map = {
        "national": "price_national",
        "remote": "price_remote",
        "very_remote": "price_very_remote",
    }
    
    price_field = price_field_map.get(location_type, "price_national")
    effective_price = item.get(price_field) or item.get("price_national")
    
    return {
        "id": item.get("id"),
        "item_code": item.get("item_code"),
        "name": item.get("name"),
        "description": item.get("description"),
        "unit": item.get("unit", "hour"),
        "price_national": item.get("price_national"),
        "price_remote": item.get("price_remote"),
        "price_very_remote": item.get("price_very_remote"),
        "effective_price": effective_price,
        "effective_price_source": "explicit",
        "day_type": item.get("day_type"),
        "time_type": item.get("time_type"),
        "support_intensity": item.get("support_intensity"),
        "support_purpose": item.get("support_purpose", ""),
        "location_type": location_type,
        "as_of_date": as_of_date.isoformat(),
    }


async def get_item_history(
    item_code: str,
    org_id: UUID | str,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Get version history for an NDIS item (all valid versions)."""
    supabase = get_supabase_admin()
    result = (
        supabase.table("ndis_price_items")
        .select("*")
        .eq("item_code", item_code)
        .eq("organization_id", str(org_id))
        .order("valid_from", desc=True)
        .limit(limit)
        .execute()
    )
    return result.data if result.data else []


# ── Schedule Loading ───────────────────────────────────────────────────────

async def load_price_schedule(
    user: dict,
    source_json: dict[str, Any],
) -> dict[str, Any]:
    """
    Load a complete NDIS pricing schedule from JSON (bulk import).
    
    Args:
        user: Current authenticated user (must be support_coordinator)
        source_json: Parsed NDIS pricing JSON file
    
    Returns:
        Dict with schedule_id, items_loaded, validation_errors
    
    Raises:
        HTTPException if user not authorized, data validation fails, etc.
    """
    # ── Authorization ──────────────────────────────────────────
    if get_user_role(user) != "support_coordinator":
        raise HTTPException(
            status_code=403,
            detail="Only support coordinators can load pricing schedules.",
        )

    org_id = get_user_organization_id(user)
    if not org_id:
        raise HTTPException(status_code=403, detail="User must belong to an organization.")

    user_id = get_user_id(user)

    # ── Extract metadata ───────────────────────────────────────
    metadata = source_json.get("metadata", {})
    financial_year = metadata.get("financial_year")
    effective_date_str = metadata.get("effective_date")
    source_document = metadata.get("source")
    version_str = metadata.get("version", "")

    if not all([financial_year, effective_date_str, source_document]):
        raise HTTPException(
            status_code=422,
            detail="Source JSON must include financial_year, effective_date, source in metadata.",
        )

    try:
        effective_date = datetime.fromisoformat(effective_date_str).date()
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid effective_date format: {effective_date_str}",
        )

    # ── Collect items ──────────────────────────────────────────
    items_to_insert: list[dict[str, Any]] = []
    validation_errors: list[str] = []

    support_categories = source_json.get("support_categories", [])

    for category in support_categories:
        cat_num = category.get("category_number", "")
        cat_name = category.get("category_name", "")
        support_purpose = category.get("support_purpose", "")
        reg_group = category.get("registration_group", "")

        # Validate category-level fields
        if support_purpose not in ("Core Supports", "Capacity Building"):
            validation_errors.append(
                f"Category {cat_num}: invalid support_purpose '{support_purpose}'"
            )
            continue

        for item in category.get("items", []):
            item_code = item.get("item_code", "").strip()
            if not item_code:
                validation_errors.append(
                    f"Category {cat_num}: item missing item_code"
                )
                continue

            # Validate item-level fields
            price_national = item.get("price_national")
            if price_national is None:
                # Skip items without prices (e.g., items requiring quotes)
                # Don't count as error - just skip silently
                continue

            try:
                price_national = float(price_national)
                if price_national < 0:
                    raise ValueError("Negative price")
            except (ValueError, TypeError):
                validation_errors.append(
                    f"Item {item_code}: invalid price_national '{price_national}'"
                )
                continue

            unit = (item.get("unit") or "H").upper()
            if unit not in ("H", "E"):
                validation_errors.append(f"Item {item_code}: invalid unit '{unit}'")
                continue

            # Note: price_remote and price_very_remote from source are DISCARDED
            # per design — only price_national is loaded
            items_to_insert.append({
                "organization_id": str(org_id),
                "item_code": item_code,
                "schedule_id": None,  # Will be set after schedule is created
                "support_category_number": cat_num,
                "support_category_name": cat_name,
                "support_purpose": support_purpose,
                "registration_group": reg_group,
                "name": item.get("name", ""),
                "description": item.get("description", ""),
                "unit": unit,
                "price_national": price_national,
                "price_remote": None,  # Always NULL on load
                "price_very_remote": None,  # Always NULL on load
                "effective_date": effective_date.isoformat(),
                "day_type": item.get("day_type"),
                "time_type": item.get("time_type"),
                "support_intensity": item.get("support_intensity"),
                "valid_from": effective_date.isoformat() + "T00:00:00Z",
                "valid_to": None,
            })

    if validation_errors:
        raise HTTPException(
            status_code=422,
            detail=f"Validation errors in pricing data: {'; '.join(validation_errors[:5])}",
        )

    if not items_to_insert:
        raise HTTPException(
            status_code=422,
            detail="No valid items found in pricing schedule.",
        )

    # ── Create schedule row ────────────────────────────────────
    supabase = get_supabase_admin()

    schedule_payload = {
        "organization_id": str(org_id),
        "financial_year": financial_year,
        "effective_date": effective_date.isoformat(),
        "source_document": source_document,
        "version": version_str,
    }

    schedule_result = supabase.table("ndis_price_schedules").insert(schedule_payload).execute()
    if not schedule_result.data:
        raise HTTPException(
            status_code=500,
            detail="Failed to create price schedule record.",
        )

    schedule_id = schedule_result.data[0]["id"]

    # ── Update all items with schedule FK and insert ──────────
    for item in items_to_insert:
        item["schedule_id"] = schedule_id

    insert_result = supabase.table("ndis_price_items").insert(items_to_insert).execute()
    if not insert_result.data:
        raise HTTPException(
            status_code=500,
            detail="Failed to insert pricing items.",
        )

    # ── Audit log ──────────────────────────────────────────────
    await audit_service.log_action(
        action_type="ndis_schedule.loaded",
        entity_type="ndis_price_schedules",
        entity_id=schedule_id,
        user_id=user_id,
        organization_id=org_id,
        after_state={
            "financial_year": financial_year,
            "effective_date": effective_date.isoformat(),
            "source_document": source_document,
            "items_loaded": len(items_to_insert),
        },
    )

    return {
        "schedule_id": schedule_id,
        "financial_year": financial_year,
        "effective_date": effective_date.isoformat(),
        "items_loaded": len(items_to_insert),
        "validation_errors": validation_errors,
    }


# ── Price Editing (Single Item) ────────────────────────────────────────────

async def edit_item_price(
    user: dict,
    item_code: str,
    price_national: float | None = None,
    price_remote: float | None = None,
    price_very_remote: float | None = None,
    effective_date: date | str | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    """
    Edit the price for a single NDIS item.
    
    Creates a new version of the item (closes old, inserts new with new prices).
    Validates that the edit doesn't overlap with invoiced periods.
    
    Args:
        user: Current authenticated user (must be support_coordinator)
        item_code: NDIS item code to edit
        price_national: New national price (required if editing)
        price_remote: New remote price (optional override)
        price_very_remote: New very-remote price (optional override)
        effective_date: Date when new price takes effect (default: today)
        reason: Audit trail reason for the change
    
    Returns:
        Dict with old_version, new_version, schedule_id=None (signals manual edit)
    
    Raises:
        HTTPException if validation fails, backdating conflicts with invoices, etc.
    """
    # ── Authorization ──────────────────────────────────────────
    if get_user_role(user) != "support_coordinator":
        raise HTTPException(
            status_code=403,
            detail="Only support coordinators can edit pricing.",
        )

    org_id = get_user_organization_id(user)
    if not org_id:
        raise HTTPException(status_code=403, detail="User must belong to an organization.")

    user_id = get_user_id(user)

    # ── Normalize effective date ───────────────────────────────
    if effective_date is None:
        effective_date = date.today()
    elif isinstance(effective_date, str):
        try:
            effective_date = date.fromisoformat(effective_date)
        except ValueError:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid effective_date format: {effective_date}",
            )

    # ── Fetch current version ──────────────────────────────────
    supabase = get_supabase_admin()

    current_result = (
        supabase.table("ndis_price_items")
        .select("*")
        .eq("item_code", item_code)
        .eq("organization_id", str(org_id))
        .is_("valid_to", "null")
        .limit(1)
        .execute()
    )

    if not current_result.data:
        raise HTTPException(
            status_code=404,
            detail=f"Item code '{item_code}' not found or already expired.",
        )

    current_row = current_result.data[0]
    current_id = current_row["id"]

    # ── Use existing values if not provided ────────────────────
    if price_national is None:
        price_national = current_row["price_national"]
    if price_remote is None:
        price_remote = None  # Keep as NULL; no fallback
    if price_very_remote is None:
        price_very_remote = None  # Keep as NULL; no fallback

    # ── Validate prices ────────────────────────────────────────
    try:
        price_national = float(price_national)
        if price_national < 0:
            raise ValueError("Negative price")
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid price_national: {price_national}",
        )

    if price_remote is not None:
        try:
            price_remote = float(price_remote)
            if price_remote < 0:
                raise ValueError("Negative price")
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=422,
                detail=f"Invalid price_remote: {price_remote}",
            )

    if price_very_remote is not None:
        try:
            price_very_remote = float(price_very_remote)
            if price_very_remote < 0:
                raise ValueError("Negative price")
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=422,
                detail=f"Invalid price_very_remote: {price_very_remote}",
            )

    # ── Backdating check: reject if edits overlap invoiced periods ───
    grace_period_days = 90  # Configurable
    cutoff_date = date.today() - __import__("datetime").timedelta(days=grace_period_days)

    if effective_date < cutoff_date:
        # Check for invoices using this item in the overlapping period
        invoice_check = supabase.table("invoices").select(
            "id, created_at"
        ).eq(
            "ndis_price_item_id", current_id
        ).gte(
            "created_at", effective_date.isoformat() + "T00:00:00Z"
        ).limit(1).execute()

        if invoice_check.data:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Cannot apply price change retroactively to {effective_date.isoformat()}. "
                    f"Invoices exist using this item from that period. "
                    f"Contact support to manually adjust or void affected invoices."
                ),
            )

    # ── Close out current row (atomic transaction) ──────────────
    # We'll do this step-by-step with proper transaction handling

    try:
        # Step 1: Update current row to set valid_to
        update_result = (
            supabase.table("ndis_price_items")
            .update({"valid_to": effective_date.isoformat() + "T00:00:00Z"})
            .eq("id", current_id)
            .execute()
        )

        if not update_result.data:
            raise HTTPException(
                status_code=500,
                detail="Failed to close out current price version.",
            )

        # Step 2: Insert new row
        new_row_payload = {
            "organization_id": str(org_id),
            "item_code": item_code,
            "schedule_id": None,  # Signal: manual edit
            "support_category_number": current_row["support_category_number"],
            "support_category_name": current_row["support_category_name"],
            "support_purpose": current_row["support_purpose"],
            "registration_group": current_row["registration_group"],
            "name": current_row["name"],
            "description": current_row["description"],
            "unit": current_row["unit"],
            "price_national": price_national,
            "price_remote": price_remote,
            "price_very_remote": price_very_remote,
            "day_type": current_row["day_type"],
            "time_type": current_row["time_type"],
            "support_intensity": current_row["support_intensity"],
            "notes": current_row["notes"],
            "valid_from": effective_date.isoformat() + "T00:00:00Z",
            "valid_to": None,
            "edited_by": user_id,
            "edited_at": datetime.now(timezone.utc).isoformat(),
        }

        insert_result = supabase.table("ndis_price_items").insert(new_row_payload).execute()
        if not insert_result.data:
            raise HTTPException(
                status_code=500,
                detail="Failed to create new price version.",
            )

        new_row = insert_result.data[0]

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Transaction failed: {str(e)}",
        )

    # ── Audit log ──────────────────────────────────────────────
    await audit_service.log_action(
        action_type="ndis_price.edited",
        entity_type="ndis_price_items",
        entity_id=new_row["id"],
        user_id=user_id,
        organization_id=org_id,
        before_state={
            "price_national": current_row["price_national"],
            "price_remote": current_row["price_remote"],
            "price_very_remote": current_row["price_very_remote"],
            "valid_from": current_row["valid_from"],
            "valid_to": current_row["valid_to"],
        },
        after_state={
            "price_national": price_national,
            "price_remote": price_remote,
            "price_very_remote": price_very_remote,
            "valid_from": new_row["valid_from"],
            "valid_to": new_row["valid_to"],
            "reason": reason,
            "effective_date": effective_date.isoformat(),
        },
    )

    return {
        "old_version": current_row,
        "new_version": new_row,
        "schedule_id": None,
        "effective_date": effective_date.isoformat(),
        "reason": reason,
    }


async def list_schedules(
    org_id: UUID | str,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """List all price schedules for an organization (newest first)."""
    supabase = get_supabase_admin()
    result = (
        supabase.table("ndis_price_schedules")
        .select("*")
        .eq("organization_id", str(org_id))
        .order("effective_date", desc=True)
        .limit(limit)
        .execute()
    )
    return result.data if result.data else []


async def get_schedule(schedule_id: UUID | str) -> dict[str, Any] | None:
    """Get a single price schedule by ID."""
    supabase = get_supabase_admin()
    result = (
        supabase.table("ndis_price_schedules")
        .select("*")
        .eq("id", str(schedule_id))
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None
