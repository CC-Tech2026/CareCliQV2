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
from ..core.access import get_user_id, get_user_organization_id, get_user_role, is_super_admin
from . import audit_service

logger = logging.getLogger(__name__)


# ── Price Resolution ───────────────────────────────────────────────────────

def _query_price_table_sync(table: str, query_params: dict[str, str]) -> dict[str, Any] | None:
    """Blocking PostgREST GET for one effective-dated price row. Runs in a thread pool."""
    import requests
    from ..core.config import settings

    url = f"{settings.supabase_url}/rest/v1/{table}"
    headers = {
        "apikey": settings.supabase_service_role_key,  # PostgREST requires apikey header
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }
    try:
        response = requests.get(url, params=query_params, headers=headers, timeout=10)
        if response.status_code != 200:
            logger.warning(f"[resolve_price] Non-200 from {table}: {response.text}")
            return None
        data = response.json()
        return data[0] if data else None
    except requests.exceptions.RequestException as e:
        logger.error(f"[resolve_price] Request error querying {table}: {e}", exc_info=True)
        return None


def _effective_dated_filter(item_code: str, as_of_date: date) -> dict[str, str]:
    # valid_to is a half-open upper bound (see edit_item_price/
    # load_price_schedule/load_platform_price_schedule: the old row's
    # valid_to is set to the new row's valid_from) — a row is current
    # as-of a date if valid_to is NULL or strictly after that date.
    # Without this, ordering by valid_from desc + limit 1 could return an
    # already-expired row whenever a newer version exists but its
    # valid_from is later than as_of_date.
    return {
        "item_code": f"eq.{item_code}",
        "valid_from": f"lte.{as_of_date.isoformat()}",
        "or": f"(valid_to.is.null,valid_to.gt.{as_of_date.isoformat()})",
        "order": "valid_from.desc",
        "limit": "1",
    }


def _compute_effective_price(item: dict[str, Any], location_type: str) -> tuple[Any, str]:
    """Ported from the SQL resolve_ndis_price() function (since retired —
    see backend/supabase/migrations/211_drop_resolve_ndis_price_function.sql):
    remote/very_remote items fall back to a multiplier of price_national
    (1.25x / 1.40x) when no explicit remote/very-remote price was loaded —
    which is the common case, since both load_price_schedule() and
    load_platform_price_schedule() always load price_remote/price_very_remote
    as NULL by design. No org currently resolves at a non-"national"
    location_type (every call site hardcodes or defaults to "national"),
    but the capability must keep working the moment one does.
    """
    price_national = item.get("price_national")
    if location_type == "remote":
        if item.get("price_remote") is not None:
            return item.get("price_remote"), "explicit"
        return (price_national * 1.25 if price_national is not None else None), "calculated_multiplier"
    if location_type == "very_remote":
        if item.get("price_very_remote") is not None:
            return item.get("price_very_remote"), "explicit"
        return (price_national * 1.40 if price_national is not None else None), "calculated_multiplier"
    return price_national, "explicit"


async def resolve_price(
    item_code: str,
    org_id: UUID | str,
    as_of_date: date | str | None = None,
    location_type: str = "national",
) -> dict[str, Any] | None:
    """
    Resolve the effective price for an NDIS item at a point in time.

    Three-tier fallback:
      1. The org's own ndis_price_items, but only a row with
         is_override = true — a real negotiated rate the org set via
         edit_item_price(). A bulk-loaded (is_override = false) org row
         never wins here; it's treated as inheriting future platform
         catalogue updates rather than permanently pinning the org to
         whatever was loaded at import time.
      2. Otherwise, platform_ndis_price_items — the centrally-maintained
         catalogue, for that same date.
      3. Otherwise, the org's own ndis_price_items again, this time any
         row regardless of is_override — this only fires for dates the
         platform catalogue has no coverage for at all (typically a
         historical date from before the platform catalogue existed).
         Without this tier, a shift from before the platform catalogue's
         earliest valid_from would resolve to nothing instead of whatever
         the org actually had on record at the time — tier 2 is additive
         for dates it covers, it must never retroactively erase history
         for dates it doesn't.

    Args:
        item_code: NDIS item code (e.g., "01_011_0107_1_1")
        org_id: Organization ID
        as_of_date: Date to resolve price as of (default: today) — can be date or ISO string
        location_type: "national", "remote", or "very_remote"

    Returns:
        Dict with id, item_code, name, price_national, price_remote,
        price_very_remote, effective_price, effective_price_source,
        price_source ("organization_override", "platform", or
        "organization_historical"), etc. Returns None if none of the
        three tiers cover this date.
    """
    if as_of_date is None:
        as_of_date = date.today()
    elif isinstance(as_of_date, str):
        as_of_date = date.fromisoformat(as_of_date)

    override_params = _effective_dated_filter(item_code, as_of_date)
    override_params["organization_id"] = f"eq.{str(org_id)}"
    override_params["is_override"] = "eq.true"

    item = await asyncio.to_thread(_query_price_table_sync, "ndis_price_items", override_params)
    price_source = "organization_override"

    if not item:
        platform_params = _effective_dated_filter(item_code, as_of_date)
        item = await asyncio.to_thread(_query_price_table_sync, "platform_ndis_price_items", platform_params)
        price_source = "platform"

    if not item:
        org_any_params = _effective_dated_filter(item_code, as_of_date)
        org_any_params["organization_id"] = f"eq.{str(org_id)}"
        item = await asyncio.to_thread(_query_price_table_sync, "ndis_price_items", org_any_params)
        price_source = "organization_historical"

    if not item:
        return None

    effective_price, effective_price_source = _compute_effective_price(item, location_type)

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
        "effective_price_source": effective_price_source,
        "price_source": price_source,
        "day_type": item.get("day_type"),
        "time_type": item.get("time_type"),
        "support_intensity": item.get("support_intensity"),
        "support_purpose": item.get("support_purpose", ""),
        "location_type": location_type,
        "as_of_date": as_of_date.isoformat(),
    }


async def list_organization_categories(org_id: UUID | str) -> list[dict[str, Any]]:
    """Distinct fundable categories from the org's currently-loaded NDIS pricing schedule.

    Returns one entry per distinct category_number among the org's current
    (not yet expired) price items. Empty list if the org hasn't loaded a
    pricing schedule, OR if its loaded items simply don't carry a
    category_number yet (true for all current data as of 2026-06 — the
    live ndis_price_items table has no support_category_name column, and
    category_number is unpopulated on every existing row; see the
    plan_budgets foundation review for details). Callers fall back to the
    legacy broad buckets in either case (funding_service.list_available_categories).
    """
    supabase = get_supabase_admin()
    result = (
        supabase.table("ndis_price_items")
        .select("category_number, registration_group, support_purpose")
        .eq("organization_id", str(org_id))
        .is_("valid_to", "null")
        .execute()
    )

    rows = result.data if isinstance(result.data, list) else []

    seen: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        number = row.get("category_number")
        if not number or number in seen:
            continue
        seen[number] = {
            "category_number": number,
            # ndis_price_items has no category-name column live — fall back to
            # registration_group, else the bare number, until pricing data
            # actually carries a category label.
            "category_name": row.get("registration_group") or number,
            "support_purpose": row.get("support_purpose") or "",
        }

    return sorted(seen.values(), key=lambda c: c["category_number"])


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
    if get_user_role(user) not in {"support_coordinator", "managing_director"}:
        raise HTTPException(
            status_code=403,
            detail="Only support coordinators and managing directors can load pricing schedules.",
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
                "category_number": cat_num,
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
        "source_json": source_json,
    }

    schedule_result = supabase.table("ndis_price_schedules").insert(schedule_payload).execute()
    if not schedule_result.data:
        raise HTTPException(
            status_code=500,
            detail="Failed to create price schedule record.",
        )

    schedule_id = schedule_result.data[0]["id"]

    # ── Close out prior active versions of these item codes ─────
    # Only one row per (item_code, organization_id) may have valid_to
    # IS NULL at a time — close the old ones before inserting the new
    # active versions, same as edit_item_price does for a single item.
    incoming_item_codes = sorted({item["item_code"] for item in items_to_insert})
    supabase.table("ndis_price_items").update(
        {"valid_to": effective_date.isoformat() + "T00:00:00Z"}
    ).eq("organization_id", str(org_id)).in_(
        "item_code", incoming_item_codes
    ).is_("valid_to", "null").execute()

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


# ── Platform Reference Catalogue (Bulk Load) ───────────────────────────────

async def load_platform_price_schedule(
    user: dict,
    source_json: dict[str, Any],
) -> dict[str, Any]:
    """
    Load a complete NDIS pricing schedule into the platform-wide reference
    catalogue (platform_ndis_price_items) — the thing CareCliQ, not any one
    provider, keeps current. Same shape and validation as
    load_price_schedule(), minus organization_id.

    Args:
        user: Current authenticated user (must be super_admin — this is a
            CareCliQ-operated catalogue, not something a provider's own
            coordinator loads)
        source_json: Parsed NDIS Support Catalogue JSON (metadata +
            support_categories, same format load_price_schedule() takes)

    Returns:
        Dict with schedule_id, items_loaded, validation_errors

    Raises:
        HTTPException if user not authorized, data validation fails, etc.
    """
    if not is_super_admin(user):
        raise HTTPException(
            status_code=403,
            detail="Only CareCliQ super admins can load the platform price catalogue.",
        )

    user_id = get_user_id(user)

    # ── Extract metadata ───────────────────────────────
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
        support_purpose = category.get("support_purpose", "")
        reg_group = category.get("registration_group", "")

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

            price_national = item.get("price_national")
            if price_national is None:
                # Skip items without prices (e.g., items requiring quotes) —
                # not an error, same as load_price_schedule().
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

            items_to_insert.append({
                "item_code": item_code,
                "schedule_id": None,  # set after schedule row is created
                "category_number": cat_num,
                "support_purpose": support_purpose,
                "registration_group": reg_group,
                "name": item.get("name", ""),
                "description": item.get("description", ""),
                "unit": unit,
                "price_national": price_national,
                "price_remote": None,  # Always NULL on load, same as load_price_schedule()
                "price_very_remote": None,
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
        "financial_year": financial_year,
        "effective_date": effective_date.isoformat(),
        "source_document": source_document,
        "version": version_str,
        "loaded_by": user_id,
        "source_json": source_json,
    }

    schedule_result = supabase.table("platform_ndis_price_schedules").insert(schedule_payload).execute()
    if not schedule_result.data:
        raise HTTPException(
            status_code=500,
            detail="Failed to create platform price schedule record.",
        )

    schedule_id = schedule_result.data[0]["id"]

    # ── Close out prior active versions of these item codes ─────
    incoming_item_codes = sorted({item["item_code"] for item in items_to_insert})
    supabase.table("platform_ndis_price_items").update(
        {"valid_to": effective_date.isoformat() + "T00:00:00Z"}
    ).in_(
        "item_code", incoming_item_codes
    ).is_("valid_to", "null").execute()

    for item in items_to_insert:
        item["schedule_id"] = schedule_id

    insert_result = supabase.table("platform_ndis_price_items").insert(items_to_insert).execute()
    if not insert_result.data:
        raise HTTPException(
            status_code=500,
            detail="Failed to insert platform pricing items.",
        )

    # ── Audit log ──────────────────────────────────────────────
    await audit_service.log_action(
        action_type="platform_ndis_schedule.loaded",
        entity_type="platform_ndis_price_schedules",
        entity_id=schedule_id,
        user_id=user_id,
        organization_id=None,
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
    
    Sets is_override=True, edited_by, and edited_at on the new row — this is
    the one write path that marks a row as a provider's own negotiated rate
    rather than an untouched bulk-loaded one.

    Returns:
        Dict with old_version, new_version, schedule_id=None (top-level
        return value only — the stored row's own schedule_id is carried
        forward from the version being edited, not cleared; is_override is
        the reliable signal for "this was a manual edit", not schedule_id)

    Raises:
        HTTPException if validation fails, backdating conflicts with invoices, etc.
    """
    # ── Authorization ──────────────────────────────────────────
    if get_user_role(user) not in {"support_coordinator", "managing_director"}:
        raise HTTPException(
            status_code=403,
            detail="Only support coordinators and managing directors can edit pricing.",
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
        # invoices has no per-line FK to a specific ndis_price_items row —
        # line_items is a JSONB blob on the invoice itself, not normalised
        # rows (confirmed live: invoices.ndis_price_item_id doesn't exist and
        # never has; this queried it unconditionally, so any edit backdated
        # past the grace period has always raised an unhandled 42703 here,
        # not the intended 409). task_completions is the correct live join:
        # price_item_code + invoice_id (set once actually invoiced) records
        # exactly what was billed, for which item, and when.
        invoice_check = (
            supabase.table("task_completions")
            .select("id, invoice_id")
            .eq("organization_id", str(org_id))
            .eq("price_item_code", item_code)
            .not_.is_("invoice_id", "null")
            .gte("completion_date", effective_date.isoformat())
            .limit(1)
            .execute()
        )

        if invoice_check.data:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Cannot apply price change retroactively to {effective_date.isoformat()}. "
                    f"Invoiced task completions exist using this item from that period. "
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
            "schedule_id": current_row["schedule_id"],  # carried forward; not NULL live
            "category_number": current_row["category_number"],
            "support_purpose": current_row["support_purpose"],
            "registration_group": current_row["registration_group"],
            "name": current_row["name"],
            "description": current_row["description"],
            "unit": current_row["unit"],
            "price_national": price_national,
            "price_remote": price_remote,
            "price_very_remote": price_very_remote,
            "effective_date": effective_date.isoformat(),
            "day_type": current_row["day_type"],
            "time_type": current_row["time_type"],
            "support_intensity": current_row["support_intensity"],
            "valid_from": effective_date.isoformat() + "T00:00:00Z",
            "valid_to": None,
            "is_override": True,
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
