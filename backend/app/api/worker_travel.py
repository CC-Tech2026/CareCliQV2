"""Worker travel expense APIs — CARECLIQV2-292."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..core.access import get_user_id, get_user_organization_id, is_support_worker
from ..core.security import get_current_user
from ..services import travel_expense_service

router = APIRouter(prefix="/worker/travel", tags=["worker-travel"])


def _require_worker(user: dict) -> None:
    if not is_support_worker(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Support worker access required.")


@router.get("/rate")
async def worker_travel_rate(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    org_id = get_user_organization_id(current_user)
    rate_cents = travel_expense_service.get_org_mileage_rate_cents(org_id)
    return {
        "rate_cents": rate_cents,
        "rate_display": f"Current rate: ${rate_cents / 100:.2f}/km",
        "currency": "AUD",
    }


@router.get("/shifts/{shift_id}/mileage-estimate")
async def worker_shift_mileage_estimate(shift_id: str, current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return await travel_expense_service.get_shift_mileage_estimate(
        shift_id,
        get_user_id(current_user),
        get_user_organization_id(current_user),
    )


class MileageExpenseBody(BaseModel):
    claimed_km: float = Field(gt=0, le=2000)
    calculated_km: float | None = Field(default=None, gt=0, le=2000)


@router.post("/shifts/{shift_id}/mileage", status_code=201)
async def worker_save_mileage(
    shift_id: str,
    body: MileageExpenseBody,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    return await travel_expense_service.upsert_mileage_expense(
        shift_id=shift_id,
        worker_id=get_user_id(current_user),
        organization_id=get_user_organization_id(current_user),
        claimed_km=body.claimed_km,
        calculated_km=body.calculated_km,
    )


@router.post("/shifts/{shift_id}/transit", status_code=201)
async def worker_save_transit(
    shift_id: str,
    amount_cents: int = Form(...),
    transit_type: str = Form(...),
    receipt: UploadFile | None = File(default=None),
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    return await travel_expense_service.upsert_transit_expense(
        shift_id=shift_id,
        worker_id=get_user_id(current_user),
        organization_id=get_user_organization_id(current_user),
        amount_cents=amount_cents,
        transit_type=transit_type,
        receipt=receipt,
    )


@router.get("/shifts/{shift_id}/transit-draft")
async def worker_shift_transit_draft(shift_id: str, current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    return travel_expense_service.get_shift_transit_draft(
        shift_id,
        get_user_id(current_user),
        get_user_organization_id(current_user),
    )


@router.get("/rejected")
async def worker_rejected_expenses(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    items = travel_expense_service.list_rejected_expenses(
        get_user_id(current_user),
        get_user_organization_id(current_user),
    )
    return {"items": items}


@router.post("/expenses/{expense_id}/correction", status_code=201)
async def worker_request_correction(
    expense_id: str,
    claimed_km: float | None = Form(default=None),
    amount_cents: int | None = Form(default=None),
    transit_type: str | None = Form(default=None),
    receipt: UploadFile | None = File(default=None),
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    return await travel_expense_service.create_correction_draft(
        expense_id=expense_id,
        worker_id=get_user_id(current_user),
        organization_id=get_user_organization_id(current_user),
        claimed_km=claimed_km,
        amount_cents=amount_cents,
        transit_type=transit_type,
        receipt=receipt,
    )


@router.get("/drafts")
async def worker_travel_drafts(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    drafts = travel_expense_service.list_draft_expenses(
        get_user_id(current_user),
        get_user_organization_id(current_user),
    )
    return {"drafts": drafts}


class SubmitExpensesBody(BaseModel):
  confirm: bool = True


@router.post("/submit")
async def worker_submit_expenses(
    body: SubmitExpensesBody,
    current_user: dict = Depends(get_current_user),
):
    _require_worker(current_user)
    if not body.confirm:
        raise HTTPException(status_code=422, detail="Confirmation required.")
    return travel_expense_service.submit_expense_batch(
        get_user_id(current_user),
        get_user_organization_id(current_user),
    )


@router.get("/summary")
async def worker_travel_summary(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    summary = travel_expense_service.monthly_summary(
        get_user_id(current_user),
        get_user_organization_id(current_user),
    )
    return {"months": summary}


@router.get("/export/csv")
async def worker_travel_csv(current_user: dict = Depends(get_current_user)):
    _require_worker(current_user)
    csv_text = travel_expense_service.export_tax_csv(
        get_user_id(current_user),
        get_user_organization_id(current_user),
    )
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="travel-expenses-tax.csv"'},
    )
