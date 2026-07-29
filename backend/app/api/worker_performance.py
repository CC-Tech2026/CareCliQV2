"""Worker performance APIs — CARECLIQV2-285/287/288/289."""

from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from ..core.access import get_user_id, get_user_organization_id, is_coordinator_role, is_support_worker
from ..core.security import get_current_user
from ..services import shift_feedback_service, shift_pdf_export_service
from ..services import worker_performance_dashboard_service, worker_shift_history_service, worker_training_service

router = APIRouter(prefix="/worker", tags=["worker-performance"])


def _require_worker(user: dict) -> None:
    if not is_support_worker(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Support worker access required.")


# ── 285 Shift history ─────────────────────────────────────────────────────────

@router.get("/shift-history")
async def worker_shift_history(
    participant_id: list[str] | None = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    compliance_band: Optional[Literal["all", "green", "amber", "red"]] = Query(default="all"),
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    return worker_shift_history_service.list_completed_shifts(
        get_user_id(current_user),
        get_user_organization_id(current_user),
        participant_ids=participant_id,
        date_from=date_from,
        date_to=date_to,
        compliance_band=None if compliance_band == "all" else compliance_band,
    )


@router.get("/shift-history/trend")
async def worker_shift_history_trend(
    limit: int = Query(default=30, ge=1, le=60),
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    trend = worker_shift_history_service.get_compliance_trend(
        get_user_id(current_user),
        get_user_organization_id(current_user),
        limit=limit,
    )
    return {"trend": trend, "limit": limit}


@router.get("/shift-history/exports")
async def worker_shift_exports(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    exports = worker_shift_history_service.list_shift_exports(get_user_id(current_user))
    return {"exports": exports}


@router.get("/shift-history/exports/{export_id}")
async def worker_download_export(export_id: str, current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return shift_pdf_export_service.get_export_download(export_id, get_user_id(current_user))


@router.get("/shift-history/exports/{export_id}/file")
async def worker_download_export_file(export_id: str, current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    from fastapi.responses import Response

    file_bytes, filename = shift_pdf_export_service.stream_export_file(
        export_id,
        get_user_id(current_user),
    )
    return Response(
        content=file_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/shift-history/{shift_id}")
async def worker_shift_history_detail(shift_id: str, current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    detail = worker_shift_history_service.get_shift_history_detail(
        shift_id,
        get_user_id(current_user),
        get_user_organization_id(current_user),
    )
    if not detail:
        raise HTTPException(status_code=404, detail="Shift not found.")
    return detail


class ShareShiftExportBody(BaseModel):
    email_self: bool = False
    email_coordinator: bool = False
    additional_recipients: list[str] = Field(default_factory=list)


@router.post("/shift-history/{shift_id}/share")
async def worker_share_shift_export(
    shift_id: str,
    body: ShareShiftExportBody,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    return shift_pdf_export_service.share_shift_export(
        shift_id,
        get_user_id(current_user),
        get_user_organization_id(current_user),
        email_self=body.email_self,
        email_coordinator=body.email_coordinator,
        additional_recipients=body.additional_recipients,
    )


@router.post("/shift-history/{shift_id}/export", status_code=201)
async def worker_export_shift(shift_id: str, current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return shift_pdf_export_service.get_or_create_auto_export(
        shift_id,
        get_user_id(current_user),
        get_user_organization_id(current_user),
    )


@router.post("/shift-history/backfill-summaries")
async def worker_backfill_shift_summaries(
    limit: int = Query(default=50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
):
    """Retroactive PDF generation for completed shifts missing summaries (CARECLIQV2-294)."""
    _require_worker(current_user)
    return shift_pdf_export_service.backfill_shift_summaries(
        get_user_organization_id(current_user),
        limit=limit,
    )


# ── 287 Feedback (worker) ─────────────────────────────────────────────────────

@router.get("/feedback/unread-count")
async def worker_feedback_unread_count(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    count = shift_feedback_service.count_unacknowledged_feedback(get_user_id(current_user))
    return {"unread_count": count}


@router.get("/feedback/{feedback_id}")
async def worker_feedback_detail(feedback_id: str, current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return shift_feedback_service.get_feedback_detail(feedback_id, get_user_id(current_user))


@router.post("/feedback/{feedback_id}/acknowledge")
async def worker_acknowledge_feedback(feedback_id: str, current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return shift_feedback_service.acknowledge_feedback(feedback_id, get_user_id(current_user))


# ── 288 Performance dashboard ─────────────────────────────────────────────────

@router.get("/performance-dashboard")
async def worker_performance_dashboard(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return worker_performance_dashboard_service.get_performance_dashboard(
        get_user_id(current_user),
        get_user_organization_id(current_user),
    )


# ── 289 Training & certification ──────────────────────────────────────────────

@router.get("/training/certifications")
async def worker_certifications(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    certs = worker_training_service.list_worker_certifications(get_user_id(current_user))
    return {"certifications": certs}


@router.get("/training/modules")
async def worker_training_modules(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    modules = worker_training_service.list_training_modules(get_user_organization_id(current_user))
    return {"modules": modules}


class MarkCompleteBody(BaseModel):
    module_id: str
    completed_at: date
    note: Optional[str] = None


@router.post("/training/complete", status_code=201)
async def worker_mark_training_complete(
    body: MarkCompleteBody,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    return worker_training_service.mark_training_complete(
        get_user_id(current_user),
        get_user_organization_id(current_user),
        body.module_id,
        body.completed_at,
        body.note,
    )


class TrainingRequestBody(BaseModel):
    request_text: str = Field(min_length=1)
    reason: str = Field(min_length=1)
    urgent: bool = False


@router.post("/training/requests", status_code=201)
async def worker_training_request(
    body: TrainingRequestBody,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    return worker_training_service.create_training_request(
        get_user_id(current_user),
        get_user_organization_id(current_user),
        body.request_text,
        body.reason,
        body.urgent,
    )


@router.get("/training/requests")
async def worker_training_requests(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return {"requests": worker_training_service.list_training_requests(get_user_id(current_user))}


@router.get("/training/history")
async def worker_training_history(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return {"history": worker_training_service.list_training_history(get_user_id(current_user))}


@router.get("/training/recommendations")
async def worker_training_recommendations(current_user: dict = Depends(get_current_user)):
    """Training modules a coordinator has specifically assigned to this worker."""
    _require_worker(current_user)
    recs = worker_training_service.list_worker_recommendations(
        get_user_id(current_user),
        get_user_organization_id(current_user),
    )
    return {"recommendations": recs}
