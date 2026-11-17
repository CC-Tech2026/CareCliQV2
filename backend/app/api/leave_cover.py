"""Shifts that clash with a worker's leave, for coordinators and managing directors.

GET  /coordinator/leave-cover           coming shifts rostered to someone on leave
POST /coordinator/leave-cover/release   make chosen ones open shifts
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from ..core.access import get_user_id
from ..core.security import get_current_user
from ..services import leave_cover_service
from ..services.supabase_client import get_supabase_admin
from .coordinator import _require_coordinator, _require_org_read, _require_worker_in_org

router = APIRouter(prefix="/coordinator/leave-cover", tags=["coordinator"])


class ReleaseBody(BaseModel):
    shift_ids: list[str] = Field(min_length=1, max_length=500)


@router.get("")
async def list_leave_clashes(
    worker_id: Optional[str] = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    org_id = _require_org_read(current_user)
    if worker_id:
        _require_worker_in_org(worker_id, org_id)
    return {"shifts": leave_cover_service.find_clashes(get_supabase_admin(), org_id, worker_id=worker_id)}


@router.post("/release")
async def release_leave_shifts(body: ReleaseBody, current_user: dict = Depends(get_current_user)):
    org_id = _require_coordinator(current_user)
    return await leave_cover_service.release(
        get_supabase_admin(), org_id, body.shift_ids, get_user_id(current_user),
    )
