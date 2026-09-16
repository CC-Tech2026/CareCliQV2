"""Worker travel expense tracking — CARECLIQV2-292."""

from __future__ import annotations

import csv
import io
import logging
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional
from uuid import uuid4

from fastapi import HTTPException, UploadFile

from ..core.timezone import user_timezone
from .supabase_client import get_supabase_admin
from .travel_distance_service import estimate_shift_mileage
from ..core.timezone import shift_local_date

logger = logging.getLogger(__name__)

TRANSIT_TYPES = frozenset({"bus", "train", "tram", "ferry", "other"})
RECEIPT_REQUIRED_CENTS = 1000  # $10 AUD


def _is_missing_schema(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _cents_from_km(km: float, rate_cents: int) -> int:
    amount = Decimal(str(km)) * Decimal(rate_cents)
    return int(amount.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def get_org_mileage_rate_cents(organization_id: str) -> int:
    try:
        resp = (
            get_supabase_admin()
            .table("organization_travel_settings")
            .select("mileage_rate_cents")
            .eq("organization_id", organization_id)
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
        if row:
            return int(row.get("mileage_rate_cents") or 88)
    except Exception as exc:
        if not _is_missing_schema(exc):
            logger.debug("mileage rate lookup: %s", exc)
    return 88


def get_worker_home_address(worker_id: str) -> str | None:
    try:
        resp = (
            get_supabase_admin()
            .table("users")
            .select("address, suburb")
            .eq("id", worker_id)
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
        if not row:
            return None
        parts = [str(row.get("address") or "").strip(), str(row.get("suburb") or "").strip()]
        joined = ", ".join(p for p in parts if p)
        return joined or None
    except Exception:
        return None


async def get_shift_mileage_estimate(
    shift_id: str,
    worker_id: str,
    organization_id: str,
) -> dict[str, Any]:
    shift_resp = (
        get_supabase_admin()
        .table("shifts")
        .select("id, worker_id, organization_id, participant_address, status, scheduled_start")
        .eq("id", shift_id)
        .limit(1)
        .execute()
    )
    shift = (shift_resp.data or [None])[0]
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found.")
    if str(shift.get("worker_id")) != str(worker_id):
        raise HTTPException(status_code=403, detail="Not your shift.")
    if str(shift.get("organization_id")) != str(organization_id):
        raise HTTPException(status_code=403, detail="Shift not in your organisation.")

    home = get_worker_home_address(worker_id)
    destination = str(shift.get("participant_address") or "").strip()
    rate_cents = get_org_mileage_rate_cents(organization_id)
    estimate = await estimate_shift_mileage(home or "", destination)

    distance_km = estimate.get("distance_km")
    amount_cents = _cents_from_km(distance_km, rate_cents) if distance_km is not None else None
    draft = _get_draft_mileage_expense(shift_id, worker_id)

    return {
        "shift_id": shift_id,
        "home_address_set": bool(home),
        "destination_address": destination or None,
        "rate_cents": rate_cents,
        "rate_display": f"Current rate: ${rate_cents / 100:.2f}/km",
        "distance_km": distance_km,
        "distance_text": estimate.get("distance_text"),
        "estimated_amount_cents": amount_cents,
        "available": estimate.get("available", False),
        "reason": estimate.get("reason"),
        "navigation_url": estimate.get("navigation_url"),
        "draft_mileage": draft,
    }


def _get_draft_mileage_expense(shift_id: str, worker_id: str) -> dict[str, Any] | None:
    try:
        resp = (
            get_supabase_admin()
            .table("shift_travel_expenses")
            .select("id, claimed_km, calculated_km, amount_cents, status, created_at")
            .eq("shift_id", shift_id)
            .eq("worker_id", worker_id)
            .eq("expense_type", "mileage")
            .eq("status", "draft")
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
        return row if row else None
    except Exception as exc:
        if not _is_missing_schema(exc):
            logger.debug("draft mileage lookup: %s", exc)
        return None


def _get_draft_transit_expense(shift_id: str, worker_id: str) -> dict[str, Any] | None:
    try:
        resp = (
            get_supabase_admin()
            .table("shift_travel_expenses")
            .select("id, amount_cents, transit_type, receipt_storage_path, status, created_at")
            .eq("shift_id", shift_id)
            .eq("worker_id", worker_id)
            .eq("expense_type", "transit")
            .eq("status", "draft")
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
        return row if row else None
    except Exception as exc:
        if not _is_missing_schema(exc):
            logger.debug("draft transit lookup: %s", exc)
        return None


def get_shift_transit_draft(shift_id: str, worker_id: str, organization_id: str) -> dict[str, Any]:
    shift_resp = (
        get_supabase_admin()
        .table("shifts")
        .select("id, worker_id, organization_id")
        .eq("id", shift_id)
        .limit(1)
        .execute()
    )
    shift = (shift_resp.data or [None])[0]
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found.")
    if str(shift.get("worker_id")) != str(worker_id):
        raise HTTPException(status_code=403, detail="Not your shift.")
    if str(shift.get("organization_id")) != str(organization_id):
        raise HTTPException(status_code=403, detail="Shift not in your organisation.")
    return {"draft_transit": _get_draft_transit_expense(shift_id, worker_id)}


async def create_correction_draft(
    *,
    expense_id: str,
    worker_id: str,
    organization_id: str,
    claimed_km: float | None = None,
    amount_cents: int | None = None,
    transit_type: str | None = None,
    receipt: UploadFile | None = None,
) -> dict[str, Any]:
    """Create a new draft correcting a rejected expense."""
    resp = (
        get_supabase_admin()
        .table("shift_travel_expenses")
        .select("*")
        .eq("id", expense_id)
        .eq("worker_id", worker_id)
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    )
    original = (resp.data or [None])[0]
    if not original:
        raise HTTPException(status_code=404, detail="Expense not found.")
    if original.get("status") != "rejected":
        raise HTTPException(status_code=422, detail="Only rejected claims can be corrected.")

    existing_correction = (
        get_supabase_admin()
        .table("shift_travel_expenses")
        .select("id")
        .eq("correction_of_id", expense_id)
        .eq("status", "draft")
        .limit(1)
        .execute()
    )
    if (existing_correction.data or []):
        raise HTTPException(status_code=409, detail="A correction draft already exists for this claim.")

    expense_type = original.get("expense_type")
    shift_id = str(original.get("shift_id"))

    if expense_type == "mileage":
        if claimed_km is None:
            claimed_km = float(original.get("claimed_km") or 0)
        draft = await upsert_mileage_expense(
            shift_id=shift_id,
            worker_id=worker_id,
            organization_id=organization_id,
            claimed_km=claimed_km,
            calculated_km=original.get("calculated_km"),
        )
        get_supabase_admin().table("shift_travel_expenses").update({
            "correction_of_id": expense_id,
            "updated_at": _now_iso(),
        }).eq("id", draft["id"]).execute()
        draft["correction_of_id"] = expense_id
        return draft

    if expense_type == "transit":
        cents = amount_cents if amount_cents is not None else int(original.get("amount_cents") or 0)
        t_type = transit_type or str(original.get("transit_type") or "other")
        draft = await upsert_transit_expense(
            shift_id=shift_id,
            worker_id=worker_id,
            organization_id=organization_id,
            amount_cents=cents,
            transit_type=t_type,
            receipt=receipt,
        )
        get_supabase_admin().table("shift_travel_expenses").update({
            "correction_of_id": expense_id,
            "updated_at": _now_iso(),
        }).eq("id", draft["id"]).execute()
        draft["correction_of_id"] = expense_id
        return draft

    raise HTTPException(status_code=422, detail="Unsupported expense type.")


def list_rejected_expenses(worker_id: str, organization_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("shift_travel_expenses")
            .select("*")
            .eq("worker_id", worker_id)
            .eq("organization_id", organization_id)
            .eq("status", "rejected")
            .order("rejected_at", desc=True)
            .limit(50)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise


def get_org_travel_settings(organization_id: str) -> dict[str, Any]:
    rate_cents = get_org_mileage_rate_cents(organization_id)
    return {
        "mileage_rate_cents": rate_cents,
        "rate_display": f"Current rate: ${rate_cents / 100:.2f}/km",
        "currency": "AUD",
    }


def set_org_mileage_rate_cents(organization_id: str, rate_cents: int, updated_by: str) -> dict[str, Any]:
    """Update the org's per-km mileage reimbursement rate (coordinator-only).

    Logs every change to organization_mileage_rate_history so past
    submissions' rate_cents_snapshot can always be explained.
    """
    if rate_cents <= 0:
        raise HTTPException(status_code=422, detail="mileage_rate_cents must be positive.")
    now = _now_iso()
    get_supabase_admin().table("organization_travel_settings").upsert(
        {
            "organization_id": organization_id,
            "mileage_rate_cents": rate_cents,
            "updated_by": updated_by,
            "updated_at": now,
        },
        on_conflict="organization_id",
    ).execute()
    get_supabase_admin().table("organization_mileage_rate_history").insert(
        {
            "organization_id": organization_id,
            "rate_cents": rate_cents,
            "created_by": updated_by,
        }
    ).execute()
    return get_org_travel_settings(organization_id)


async def auto_save_mileage_on_clock_in(
    *,
    shift_id: str,
    worker_id: str,
    organization_id: str,
    participant_address: str | None = None,
    claimed_km_override: float | None = None,
) -> dict[str, Any] | None:
    """Best-effort draft mileage claim when a worker clocks in."""
    try:
        home = get_worker_home_address(worker_id)
        if not home:
            return None

        destination = (participant_address or "").strip()
        if not destination:
            shift_resp = (
                get_supabase_admin()
                .table("shifts")
                .select("participant_address")
                .eq("id", shift_id)
                .limit(1)
                .execute()
            )
            shift = (shift_resp.data or [None])[0]
            destination = str((shift or {}).get("participant_address") or "").strip()
        if not destination:
            return None

        estimate = await estimate_shift_mileage(home, destination)
        calculated_km = estimate.get("distance_km") if estimate.get("available") else None

        if claimed_km_override is not None:
            return await upsert_mileage_expense(
                shift_id=shift_id,
                worker_id=worker_id,
                organization_id=organization_id,
                claimed_km=float(claimed_km_override),
                calculated_km=float(calculated_km) if calculated_km is not None else None,
            )

        if calculated_km is None:
            logger.debug("mileage auto-save skipped for shift %s: %s", shift_id, estimate.get("reason"))
            return None

        return await upsert_mileage_expense(
            shift_id=shift_id,
            worker_id=worker_id,
            organization_id=organization_id,
            claimed_km=float(calculated_km),
            calculated_km=float(calculated_km),
        )
    except HTTPException:
        raise
    except Exception as exc:
        if _is_missing_schema(exc):
            logger.debug("mileage auto-save unavailable: schema missing")
            return None
        logger.info("mileage auto-save failed for shift %s: %s", shift_id, exc)
        return None


def _guard_editable(expense: dict[str, Any]) -> None:
    if expense.get("status") != "draft":
        raise HTTPException(status_code=409, detail="Submitted expenses cannot be edited.")


async def upsert_mileage_expense(
    *,
    shift_id: str,
    worker_id: str,
    organization_id: str,
    claimed_km: float,
    calculated_km: Optional[float] = None,
) -> dict[str, Any]:
    if claimed_km <= 0 or claimed_km > 2000:
        raise HTTPException(status_code=422, detail="Invalid distance.")

    rate_cents = get_org_mileage_rate_cents(organization_id)
    amount_cents = _cents_from_km(claimed_km, rate_cents)
    now = _now_iso()

    existing = (
        get_supabase_admin()
        .table("shift_travel_expenses")
        .select("*")
        .eq("shift_id", shift_id)
        .eq("worker_id", worker_id)
        .eq("expense_type", "mileage")
        .eq("status", "draft")
        .limit(1)
        .execute()
    )
    row = (existing.data or [None])[0]
    payload = {
        "shift_id": shift_id,
        "worker_id": worker_id,
        "organization_id": organization_id,
        "expense_type": "mileage",
        "status": "draft",
        "calculated_km": calculated_km,
        "claimed_km": claimed_km,
        "rate_cents_snapshot": rate_cents,
        "amount_cents": amount_cents,
        "updated_at": now,
    }
    try:
        if row:
            _guard_editable(row)
            resp = (
                get_supabase_admin()
                .table("shift_travel_expenses")
                .update(payload)
                .eq("id", row["id"])
                .execute()
            )
            return (resp.data or [payload])[0]
        payload["id"] = str(uuid4())
        payload["created_at"] = now
        resp = get_supabase_admin().table("shift_travel_expenses").insert(payload).execute()
        return (resp.data or [payload])[0]
    except HTTPException:
        raise
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Travel expense service unavailable.") from exc
        raise


async def upsert_transit_expense(
    *,
    shift_id: str,
    worker_id: str,
    organization_id: str,
    amount_cents: int,
    transit_type: str,
    receipt: UploadFile | None = None,
) -> dict[str, Any]:
    if transit_type not in TRANSIT_TYPES:
        raise HTTPException(status_code=422, detail="Invalid transit type.")
    if amount_cents <= 0:
        raise HTTPException(status_code=422, detail="Amount must be positive.")

    receipt_path = None
    if amount_cents > RECEIPT_REQUIRED_CENTS:
        if not receipt:
            raise HTTPException(status_code=422, detail="Receipt required for claims over $10.")
        data = await receipt.read()
        if not data:
            raise HTTPException(status_code=422, detail="Receipt file is empty.")
        receipt_path = f"{organization_id}/{worker_id}/{shift_id}/{uuid4()}-{receipt.filename or 'receipt'}"
        get_supabase_admin().storage.from_("travel-receipts").upload(
            receipt_path,
            data,
            {"content-type": receipt.content_type or "application/octet-stream", "upsert": "true"},
        )
    elif receipt:
        data = await receipt.read()
        if data:
            receipt_path = f"{organization_id}/{worker_id}/{shift_id}/{uuid4()}-{receipt.filename or 'receipt'}"
            get_supabase_admin().storage.from_("travel-receipts").upload(
                receipt_path,
                data,
                {"content-type": receipt.content_type or "application/octet-stream", "upsert": "true"},
            )

    now = _now_iso()
    existing = (
        get_supabase_admin()
        .table("shift_travel_expenses")
        .select("*")
        .eq("shift_id", shift_id)
        .eq("worker_id", worker_id)
        .eq("expense_type", "transit")
        .eq("status", "draft")
        .limit(1)
        .execute()
    )
    row = (existing.data or [None])[0]
    payload = {
        "shift_id": shift_id,
        "worker_id": worker_id,
        "organization_id": organization_id,
        "expense_type": "transit",
        "status": "draft",
        "transit_type": transit_type,
        "amount_cents": amount_cents,
        "receipt_storage_path": receipt_path,
        "updated_at": now,
    }
    try:
        if row:
            _guard_editable(row)
            resp = (
                get_supabase_admin()
                .table("shift_travel_expenses")
                .update(payload)
                .eq("id", row["id"])
                .execute()
            )
            return (resp.data or [payload])[0]
        payload["id"] = str(uuid4())
        payload["created_at"] = now
        resp = get_supabase_admin().table("shift_travel_expenses").insert(payload).execute()
        return (resp.data or [payload])[0]
    except HTTPException:
        raise
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Travel expense service unavailable.") from exc
        raise


def list_draft_expenses(worker_id: str, organization_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("shift_travel_expenses")
            .select("*")
            .eq("worker_id", worker_id)
            .eq("organization_id", organization_id)
            .eq("status", "draft")
            .order("created_at", desc=True)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise
    # The worker's own branch zone — an expense claim is the worker's own
    # action, not a participant care record, so it's unambiguous even
    # though a shift ties to one participant.
    tz = str(user_timezone(worker_id, organization_id))
    for row in rows:
        row["timezone"] = tz
    return rows


def submit_expense_batch(worker_id: str, organization_id: str) -> dict[str, Any]:
    drafts = list_draft_expenses(worker_id, organization_id)
    if not drafts:
        raise HTTPException(status_code=422, detail="No draft expenses to submit.")

    total = sum(int(d.get("amount_cents") or 0) for d in drafts)
    batch_id = str(uuid4())
    now = _now_iso()
    batch = {
        "id": batch_id,
        "worker_id": worker_id,
        "organization_id": organization_id,
        "total_amount_cents": total,
        "status": "pending",
        "submitted_at": now,
    }
    get_supabase_admin().table("travel_expense_submissions").insert(batch).execute()

    for draft in drafts:
        get_supabase_admin().table("shift_travel_expenses").update({
            "status": "submitted",
            "submission_batch_id": batch_id,
            "submitted_at": now,
            "rate_cents_snapshot": draft.get("rate_cents_snapshot") or get_org_mileage_rate_cents(organization_id),
            "updated_at": now,
        }).eq("id", draft["id"]).execute()

    return {"submission_id": batch_id, "total_amount_cents": total, "expense_count": len(drafts)}


def monthly_summary(worker_id: str, organization_id: str, months: int = 12) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("shift_travel_expenses")
            .select("*")
            .eq("worker_id", worker_id)
            .eq("organization_id", organization_id)
            .neq("status", "draft")
            .order("submitted_at", desc=True)
            .limit(500)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise

    tz = str(user_timezone(worker_id, organization_id))
    buckets: dict[str, dict[str, Any]] = {}
    for row in rows:
        submitted = row.get("submitted_at") or row.get("created_at") or ""
        month_key = str(submitted)[:7]
        if not month_key:
            continue
        bucket = buckets.setdefault(
            month_key,
            {
                "month": month_key,
                "claimed_cents": 0,
                "approved_cents": 0,
                "paid_cents": 0,
                "items": [],
            },
        )
        amount = int(row.get("amount_cents") or 0)
        status = row.get("status")
        bucket["claimed_cents"] += amount
        if status in ("approved", "paid"):
            bucket["approved_cents"] += amount
        if status == "paid":
            bucket["paid_cents"] += amount
        row["timezone"] = tz
        bucket["items"].append(row)

    ordered = sorted(buckets.values(), key=lambda b: b["month"], reverse=True)
    return ordered[:months]


def export_tax_csv(worker_id: str, organization_id: str) -> str:
    summary = monthly_summary(worker_id, organization_id, months=12)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["date", "type", "amount_aud", "status", "shift_id"])
    for month in summary:
        for item in month.get("items") or []:
            submitted_raw = item.get("submitted_at") or item.get("created_at")
            submitted = (shift_local_date(submitted_raw) or date.fromisoformat(str(submitted_raw or "")[:10])).isoformat() if submitted_raw else ""
            amount = int(item.get("amount_cents") or 0) / 100
            writer.writerow([
                submitted,
                item.get("expense_type"),
                f"{amount:.2f}",
                item.get("status"),
                item.get("shift_id"),
            ])
    return buffer.getvalue()


def list_pending_for_coordinator(organization_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("travel_expense_submissions")
            .select("*")
            .eq("organization_id", organization_id)
            .eq("status", "pending")
            .order("submitted_at", desc=True)
            .execute()
        )
        submissions = resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return []
        raise

    if not submissions:
        return []

    worker_ids = list({str(s.get("worker_id")) for s in submissions if s.get("worker_id")})
    workers: dict[str, str] = {}
    if worker_ids:
        users_resp = (
            get_supabase_admin()
            .table("users")
            .select("id, full_name")
            .in_("id", worker_ids)
            .eq("organization_id", organization_id)
            .execute()
        )
        for row in users_resp.data or []:
            workers[str(row["id"])] = row.get("full_name") or "Worker"

    batch_ids = [str(s["id"]) for s in submissions]
    expenses_resp = (
        get_supabase_admin()
        .table("shift_travel_expenses")
        .select("*")
        .in_("submission_batch_id", batch_ids)
        .execute()
    )
    by_batch: dict[str, list[dict[str, Any]]] = {}
    for exp in expenses_resp.data or []:
        bid = str(exp.get("submission_batch_id") or "")
        by_batch.setdefault(bid, []).append(exp)

    enriched: list[dict[str, Any]] = []
    for sub in submissions:
        sid = str(sub["id"])
        enriched.append({
            **sub,
            "worker_name": workers.get(str(sub.get("worker_id")), "Worker"),
            "expenses": by_batch.get(sid, []),
            # The worker's own branch zone — a batch belongs to exactly one
            # worker, so this is unambiguous regardless of which shifts (and
            # participants) its expenses came from.
            "timezone": str(user_timezone(sub.get("worker_id"), organization_id)),
        })
    return enriched


def action_submission(
    submission_id: str,
    coordinator_id: str,
    organization_id: str,
    *,
    approve: bool,
    rejection_reason: str | None = None,
    mark_paid: bool = False,
) -> dict[str, Any]:
    sub_resp = (
        get_supabase_admin()
        .table("travel_expense_submissions")
        .select("*")
        .eq("id", submission_id)
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    )
    submission = (sub_resp.data or [None])[0]
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found.")

    now = _now_iso()
    if mark_paid:
        new_status = "paid"
    elif approve:
        new_status = "approved"
    else:
        new_status = "rejected"

    get_supabase_admin().table("travel_expense_submissions").update({
        "status": new_status,
        "actioned_at": now,
        "actioned_by": coordinator_id,
        "rejection_reason": rejection_reason,
    }).eq("id", submission_id).execute()

    expense_status = "paid" if mark_paid else ("approved" if approve else "rejected")
    expense_update: dict[str, Any] = {
        "status": expense_status,
        "updated_at": now,
    }
    if approve or mark_paid:
        expense_update["approved_at"] = now
        expense_update["approved_by"] = coordinator_id
    if mark_paid:
        expense_update["paid_at"] = now
    if not approve and not mark_paid:
        expense_update["rejected_at"] = now
        expense_update["rejection_reason"] = rejection_reason

    get_supabase_admin().table("shift_travel_expenses").update(expense_update).eq(
        "submission_batch_id", submission_id
    ).execute()

    return {"submission_id": submission_id, "status": new_status}
