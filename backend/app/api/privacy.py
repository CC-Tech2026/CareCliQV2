"""Worker privacy & data protection API — CARECLIQV2-269."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..core.access import get_user_id, get_user_organization_id, is_support_worker
from ..core.security import get_current_user
from ..services import privacy_service
from ..services.supabase_client import get_supabase_admin

router = APIRouter(prefix="/worker/privacy", tags=["worker-privacy"])


class AnalyticsOptOutBody(BaseModel):
    analytics_opt_out: bool


class DeletionRequestBody(BaseModel):
    confirmation_text: str = Field(min_length=1)


def _require_worker(user: dict) -> None:
    if not is_support_worker(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Support worker access required.")


def _user_email(user_id: str) -> str:
    try:
        resp = (
            get_supabase_admin()
            .table("users")
            .select("email")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        if resp and resp.data:
            return str(resp.data.get("email") or "")
    except Exception:
        pass
    return ""


@router.get("")
async def get_privacy_overview(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    user_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    return privacy_service.get_privacy_overview(user_id, org_id)


@router.get("/policy/versions")
async def list_policy_versions(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return {"versions": privacy_service.list_privacy_policy_versions()}


@router.patch("/analytics-opt-out")
async def update_analytics_opt_out(
    body: AnalyticsOptOutBody,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    user_id = get_user_id(current_user)
    return privacy_service.set_analytics_opt_out(user_id, body.analytics_opt_out)


@router.post("/export")
async def request_data_export(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    user_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    email = _user_email(user_id)
    return privacy_service.request_data_export(user_id, org_id, email)


@router.get("/export/{request_id}/download")
async def download_data_export(
    request_id: str,
    token: str = Query(..., min_length=8),
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    user_id = get_user_id(current_user)
    data, filename = privacy_service.download_export(request_id, user_id, token)
    return Response(
        content=data,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/deletion-request")
async def request_account_deletion(
    body: DeletionRequestBody,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    user_id = get_user_id(current_user)
    org_id = get_user_organization_id(current_user)
    try:
        return privacy_service.request_account_deletion(user_id, org_id, body.confirmation_text)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
