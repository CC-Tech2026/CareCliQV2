from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..core.access import get_user_id, get_user_organization_id, is_coordinator_role
from ..core.security import get_current_user
from ..services.supabase_client import get_supabase_admin

router = APIRouter(prefix="/toolkit", tags=["toolkit"])


class ToolkitItemBody(BaseModel):
    name: str
    category: str = "general"
    sku: str | None = None
    quantity: float = Field(default=0, ge=0)
    unit: str = "item"
    minimum_quantity: float = Field(default=0, ge=0)
    expiry_date: str | None = None
    batch_number: str | None = None
    assigned_user_id: str | None = None


class UseItemBody(BaseModel):
    item_id: str
    quantity: float = Field(default=1, gt=0)
    notes: str | None = None


class RestockRequestBody(BaseModel):
    item_id: str
    quantity_requested: float = Field(default=1, gt=0)
    notes: str | None = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _item_query_for_user(user: dict):
    supabase = get_supabase_admin()
    query = supabase.table("toolkit_items").select("*").eq("organization_id", get_user_organization_id(user))
    if not is_coordinator_role(user):
        query = query.eq("assigned_user_id", get_user_id(user))
    return query


def _get_item(item_id: str, user: dict) -> dict:
    result = _item_query_for_user(user).eq("id", item_id).maybe_single().execute()
    if not result or not result.data:
        raise HTTPException(status_code=404, detail="Toolkit item not found")
    return result.data


def _with_low_stock(row: dict) -> dict:
    return {**row, "low_stock": float(row.get("quantity") or 0) <= float(row.get("minimum_quantity") or 0)}


@router.get("/me")
async def get_my_toolkit(current_user: dict = Depends(get_current_user)):
    result = _item_query_for_user(current_user).order("name").execute()
    items = [_with_low_stock(row) for row in (result.data or [])]
    requests = (
        get_supabase_admin()
        .table("restock_requests")
        .select("*")
        .eq("requested_by", get_user_id(current_user))
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )
    return {"items": items, "restock_requests": requests.data or []}


@router.post("/me/use-item")
async def use_my_item(body: UseItemBody, current_user: dict = Depends(get_current_user)):
    item = _get_item(body.item_id, current_user)
    quantity = float(item.get("quantity") or 0)
    if body.quantity > quantity:
        raise HTTPException(status_code=422, detail="Insufficient stock for this item.")
    new_quantity = quantity - body.quantity
    supabase = get_supabase_admin()
    updated = supabase.table("toolkit_items").update({"quantity": new_quantity, "updated_at": _now()}).eq("id", body.item_id).execute()
    supabase.table("toolkit_movements").insert(
        {
            "item_id": body.item_id,
            "user_id": get_user_id(current_user),
            "movement_type": "use",
            "quantity": body.quantity,
            "notes": body.notes,
        }
    ).execute()
    return _with_low_stock(updated.data[0] if updated.data else {**item, "quantity": new_quantity})


@router.post("/me/restock-request", status_code=201)
async def create_restock_request(body: RestockRequestBody, current_user: dict = Depends(get_current_user)):
    item = _get_item(body.item_id, current_user)
    payload = {
        "organization_id": get_user_organization_id(current_user),
        "requested_by": get_user_id(current_user),
        "item_id": item["id"],
        "quantity_requested": body.quantity_requested,
        "notes": body.notes,
        "status": "pending",
    }
    result = get_supabase_admin().table("restock_requests").insert(payload).execute()
    return result.data[0] if result.data else payload


@router.get("/team")
async def get_team_toolkit(current_user: dict = Depends(get_current_user)):
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=403, detail="Only support coordinators can view team toolkit.")
    org_id = get_user_organization_id(current_user)
    supabase = get_supabase_admin()
    items = supabase.table("toolkit_items").select("*").eq("organization_id", org_id).order("name").execute()
    requests = supabase.table("restock_requests").select("*").eq("organization_id", org_id).order("created_at", desc=True).execute()
    return {"items": [_with_low_stock(row) for row in (items.data or [])], "restock_requests": requests.data or []}


@router.post("/items", status_code=201)
async def create_toolkit_item(body: ToolkitItemBody, current_user: dict = Depends(get_current_user)):
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=403, detail="Only support coordinators can manage toolkit stock.")
    payload = body.model_dump()
    payload["organization_id"] = get_user_organization_id(current_user)
    result = get_supabase_admin().table("toolkit_items").insert(payload).execute()
    return _with_low_stock(result.data[0] if result.data else payload)


@router.patch("/items/{item_id}")
async def update_toolkit_item(item_id: str, body: ToolkitItemBody, current_user: dict = Depends(get_current_user)):
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=403, detail="Only support coordinators can manage toolkit stock.")
    payload = body.model_dump(exclude_unset=True)
    payload["updated_at"] = _now()
    result = (
        get_supabase_admin()
        .table("toolkit_items")
        .update(payload)
        .eq("id", item_id)
        .eq("organization_id", get_user_organization_id(current_user))
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Toolkit item not found")
    return _with_low_stock(result.data[0])


@router.post("/items/{item_id}/assign")
async def assign_toolkit_item(item_id: str, body: dict, current_user: dict = Depends(get_current_user)):
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=403, detail="Only support coordinators can assign toolkit stock.")
    assigned_user_id = body.get("assigned_user_id")
    result = (
        get_supabase_admin()
        .table("toolkit_items")
        .update({"assigned_user_id": assigned_user_id, "updated_at": _now()})
        .eq("id", item_id)
        .eq("organization_id", get_user_organization_id(current_user))
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Toolkit item not found")
    get_supabase_admin().table("toolkit_movements").insert(
        {"item_id": item_id, "user_id": get_user_id(current_user), "movement_type": "assign", "quantity": 0}
    ).execute()
    return _with_low_stock(result.data[0])


@router.get("/restock-requests")
async def list_restock_requests(current_user: dict = Depends(get_current_user)):
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=403, detail="Only support coordinators can view restock requests.")
    result = (
        get_supabase_admin()
        .table("restock_requests")
        .select("*")
        .eq("organization_id", get_user_organization_id(current_user))
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


@router.patch("/restock-requests/{request_id}")
async def update_restock_request(request_id: str, body: dict, current_user: dict = Depends(get_current_user)):
    if not is_coordinator_role(current_user):
        raise HTTPException(status_code=403, detail="Only support coordinators can manage restock requests.")
    status_value = body.get("status")
    if status_value not in {"pending", "approved", "rejected", "fulfilled"}:
        raise HTTPException(status_code=422, detail="Invalid restock request status.")
    result = (
        get_supabase_admin()
        .table("restock_requests")
        .update({"status": status_value, "notes": body.get("notes"), "updated_at": _now()})
        .eq("id", request_id)
        .eq("organization_id", get_user_organization_id(current_user))
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Restock request not found")
    return result.data[0]
