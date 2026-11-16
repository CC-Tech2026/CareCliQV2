"""CareCliQ API, version 1: read-only access for other systems (for example
CORA Workforce), with an organisation's API key. See
services/public_api_service.py for keys and the data shapes, and
services/webhook_service.py for change notifications."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from fastapi import APIRouter, Query, Request

from ..services import public_api_service as api

router = APIRouter(prefix="/v1", tags=["CareCliQ API v1"])

Limit = Query(100, ge=1, le=api.MAX_LIMIT, description="How many to return (up to 500).")
Offset = Query(0, ge=0, description="How many to skip, for the next page.")


@router.get("/organisation")
async def v1_organisation(request: Request):
    """Which organisation this key belongs to and what it can read. A quick way to test a key."""
    key = api.authenticate(request, None)
    return api.organisation(key["organization_id"], key)


@router.get("/workers")
async def v1_workers(
    request: Request,
    status: Literal["active", "inactive", "all"] = Query("active", description="Active workers only (default), inactive, or all."),
    role: Optional[Literal["support_worker", "support_coordinator", "managing_director"]] = None,
    limit: int = Limit,
    offset: int = Offset,
):
    """Staff: support workers, coordinators and directors."""
    key = api.authenticate(request, "workers:read")
    return api.list_workers(key["organization_id"], status=status, role=role, limit=limit, offset=offset)


@router.get("/workers/{worker_id}")
async def v1_worker(worker_id: str, request: Request):
    key = api.authenticate(request, "workers:read")
    return api.get_worker(key["organization_id"], worker_id)


@router.get("/workers/{worker_id}/credentials")
async def v1_worker_credentials(worker_id: str, request: Request, limit: int = Limit, offset: int = Offset):
    key = api.authenticate(request, "credentials:read")
    return api.list_credentials(key["organization_id"], worker_id=worker_id, limit=limit, offset=offset)


@router.get("/credentials")
async def v1_credentials(
    request: Request,
    worker_id: Optional[str] = None,
    status: Optional[str] = Query(None, description="For example valid, pending_review, expired, rejected."),
    type: Optional[str] = Query(None, description="Credential type, for example ndis_screening, first_aid, wwcc."),
    expiring_before: Optional[date] = Query(None, description="Only credentials expiring on or before this date."),
    updated_since: Optional[datetime] = Query(None, description="Only credentials changed since this time (ISO 8601)."),
    limit: int = Limit,
    offset: int = Offset,
):
    key = api.authenticate(request, "credentials:read")
    return api.list_credentials(
        key["organization_id"],
        worker_id=worker_id,
        status=status,
        type_=type,
        expiring_before=expiring_before,
        updated_since=updated_since,
        limit=limit,
        offset=offset,
    )


@router.get("/training/modules")
async def v1_training_modules(request: Request, limit: int = Limit, offset: int = Offset):
    key = api.authenticate(request, "training:read")
    return api.list_training_modules(key["organization_id"], limit=limit, offset=offset)


@router.get("/training/completions")
async def v1_training_completions(
    request: Request,
    worker_id: Optional[str] = None,
    status: Optional[str] = Query(None, description="For example pending, confirmed, rejected."),
    completed_since: Optional[datetime] = Query(None, description="Only completions since this time (ISO 8601)."),
    limit: int = Limit,
    offset: int = Offset,
):
    key = api.authenticate(request, "training:read")
    return api.list_training_completions(
        key["organization_id"], worker_id=worker_id, status=status, completed_since=completed_since, limit=limit, offset=offset,
    )
