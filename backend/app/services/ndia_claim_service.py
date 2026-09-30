"""NDIA bulk claims for NDIA-managed invoices.

Ready to claim -> Submitted -> Paid:

- Ready: a finalised (reviewed) invoice for an NDIA-managed participant
  that hasn't been claimed yet. Anything that would make the claim bounce
  (no NDIS number, a line with no support item or no delivery dates, no
  registration number on the organisation) is listed against it and it
  can't be selected until fixed.
- Submitting a selection creates a claim batch: one bulk payment request
  CSV for the provider portal's bulk upload, stored with the batch. The
  invoices are marked sent (payment method: NDIS portal).
- When the remittance arrives the invoices, or the whole batch, are marked
  paid with the remittance reference.

The file follows the NDIA bulk payment request layout (column order in
BULK_COLUMNS). Time-based items go in Hours as hh:mm, everything else in
Quantity; supports are GST-free (P2). Test a small batch before relying on
it for a full pay run — the NDIA occasionally revises the template.
"""

from __future__ import annotations

import csv
import io
import logging
import re
from datetime import date, datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException

from ..core.access import get_user_id
from ..core.timezone import app_today
from . import audit_service, billing_period_service
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

BUCKET = "ndia-claims"
READY_STATUSES = ("finalized", "issued")
SUBMITTED_STATUSES = ("sent", "overdue", "issued", "finalized")
BULK_COLUMNS = [
    "RegistrationNumber", "NDISNumber", "SupportsDeliveredFrom", "SupportsDeliveredTo", "SupportNumber",
    "ClaimReference", "Quantity", "Hours", "UnitPrice", "GSTCode", "AuthorisedBy", "ParticipantApproved",
    "InKindFundingProgram", "ClaimType", "CancellationReason", "ABN of Support Provider",
]
GST_FREE = "P2"
CLAIM_REFERENCE_MAX = 50
DATE_FORMAT = "%Y-%m-%d"
HOUR_UNITS = {"H", "HOUR", "HR"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def _rows(query) -> list[dict]:
    return [r for r in (query.execute().data or []) if isinstance(r, dict)]


def _require_billing(user: dict) -> str:
    from .billing_service import _require_billing_role, _require_org

    _require_billing_role(user)
    return _require_org(user)


# ── Loading ──────────────────────────────────────────────────────────────


def _org(org_id: str) -> dict[str, Any]:
    rows = _rows(
        get_supabase_admin().table("organizations").select("ndis_provider_number, abn")
        .eq("organization_id", org_id).limit(1)
    )
    return rows[0] if rows else {}


def _participants(org_id: str, ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    rows = _rows(
        get_supabase_admin().table("participants")
        .select("id, full_name, ndis_number, plan_management_type")
        .eq("organization_id", org_id).in_("id", ids)
    )
    return {str(r["id"]): r for r in rows}


def _periods(ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    rows = _rows(
        get_supabase_admin().table("billing_periods")
        .select("id, period_start, period_end, locked_plan_management_type").in_("id", ids)
    )
    return {str(r["id"]): r for r in rows}


def _batches(ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    rows = _rows(
        get_supabase_admin().table("ndia_claim_batches")
        .select("id, batch_number, created_at, file_name, paid_at, remittance_reference").in_("id", ids)
    )
    return {str(r["id"]): r for r in rows}


def plan_type(invoice: dict, period: Optional[dict], participant: Optional[dict]) -> Optional[str]:
    """The plan management type the invoice was raised under: locked on its
    billing period, otherwise the participant's current one."""
    locked = (period or {}).get("locked_plan_management_type")
    if locked:
        return billing_period_service.normalize_plan_management_type(str(locked))
    raw = (participant or {}).get("plan_management_type")
    return billing_period_service.normalize_plan_management_type(str(raw)) if raw else None


# ── Claim lines ──────────────────────────────────────────────────────────


def claim_lines(invoice: dict, period: Optional[dict]) -> list[dict[str, Any]]:
    """One claim line per invoice line, with the dates and unit NDIA needs."""
    lines = []
    fallback_from = (period or {}).get("period_start")
    fallback_to = (period or {}).get("period_end")
    for index, item in enumerate(invoice.get("line_items") or []):
        start = item.get("service_date_from") or item.get("service_date") or fallback_from
        end = item.get("service_date_to") or item.get("service_date") or start or fallback_to
        lines.append({
            "index": index,
            "item_code": (item.get("item_code") or "").strip() or None,
            "description": item.get("description") or "",
            "quantity": float(item.get("quantity") or 0),
            "unit": str(item.get("unit") or "H").upper(),
            "unit_amount_cents": int(item.get("unit_amount_cents") or 0),
            "line_total_cents": int(item.get("line_total_cents") or 0),
            "from": str(start)[:10] if start else None,
            "to": str(end)[:10] if end else None,
        })
    return lines


def claim_problems(invoice: dict, participant: Optional[dict], org: dict, lines: list[dict]) -> list[str]:
    problems = []
    if not _digits(org.get("ndis_provider_number")):
        problems.append("Add your NDIS registration number in organisation settings.")
    if not participant:
        problems.append("Invoice isn't linked to a participant.")
    elif len(_digits(participant.get("ndis_number"))) != 9:
        problems.append(f"{participant.get('full_name') or 'Participant'} needs a 9-digit NDIS number.")
    if not lines:
        problems.append("Invoice has no lines.")
    for line in lines:
        label = line["description"] or f"Line {line['index'] + 1}"
        if not line["item_code"]:
            problems.append(f"{label}: no NDIS support item.")
        if not line["from"] or not line["to"]:
            problems.append(f"{label}: no delivery dates.")
        if line["quantity"] <= 0:
            problems.append(f"{label}: quantity is zero.")
    return problems


def _hours(quantity: float) -> str:
    minutes = int(round(quantity * 60))
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _fmt(day: str) -> str:
    return date.fromisoformat(day).strftime(DATE_FORMAT)


def claim_reference(invoice_number: str, index: int, line_count: int) -> str:
    base = re.sub(r"[^A-Za-z0-9\-_/]", "", invoice_number or "INV")
    ref = base if line_count == 1 else f"{base}-{index + 1}"
    return ref[:CLAIM_REFERENCE_MAX]


def build_bulk_csv(org: dict, claims: list[dict[str, Any]]) -> str:
    """claims: [{invoice, participant, lines}] already validated."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(BULK_COLUMNS)
    registration = _digits(org.get("ndis_provider_number"))
    abn = _digits(org.get("abn"))
    for claim in claims:
        lines = claim["lines"]
        for line in lines:
            hourly = line["unit"] in HOUR_UNITS
            writer.writerow([
                registration,
                _digits(claim["participant"].get("ndis_number")),
                _fmt(line["from"]),
                _fmt(line["to"]),
                line["item_code"],
                claim_reference(claim["invoice"].get("invoice_number") or "", line["index"], len(lines)),
                "" if hourly else f"{line['quantity']:g}",
                _hours(line["quantity"]) if hourly else "",
                f"{line['unit_amount_cents'] / 100:.2f}",
                GST_FREE,
                "", "", "", "", "",
                abn,
            ])
    return buffer.getvalue()


# ── Listing ──────────────────────────────────────────────────────────────


def _quantity_label(lines: list[dict]) -> str:
    if len(lines) != 1:
        return f"{len(lines)} items"
    line = lines[0]
    qty = f"{line['quantity']:.2f}".rstrip("0").rstrip(".")
    if line["unit"] in HOUR_UNITS:
        return f"{qty} hr" if line["quantity"] == 1 else f"{qty} hrs"
    return qty


def _row(invoice: dict, participant: Optional[dict], period: Optional[dict], org: dict, batch: Optional[dict]) -> dict[str, Any]:
    lines = claim_lines(invoice, period)
    codes = [line["item_code"] for line in lines if line["item_code"]]
    return {
        "invoice_id": invoice["id"],
        "invoice_number": invoice.get("invoice_number"),
        "participant_id": invoice.get("participant_id"),
        "participant_name": (participant or {}).get("full_name") or invoice.get("recipient_name"),
        "support_item": codes[0] if len(codes) == 1 else (f"{codes[0]} +{len(codes) - 1} more" if codes else None),
        "quantity_label": _quantity_label(lines),
        "total_cents": int(invoice.get("total_cents") or 0),
        "status": invoice.get("status"),
        "problems": claim_problems(invoice, participant, org, lines),
        "claim_submitted_at": invoice.get("claim_submitted_at"),
        "paid_at": invoice.get("paid_at"),
        "payment_reference": invoice.get("payment_reference"),
        "batch": batch,
    }


def list_claims(user: dict) -> dict[str, Any]:
    org_id = _require_billing(user)
    from .billing_service import _fetch_all

    supabase = get_supabase_admin()
    invoices = _fetch_all(
        supabase.table("invoices")
        .select("id, invoice_number, participant_id, billing_period_id, recipient_name, line_items, total_cents, "
                "status, claim_batch_id, claim_submitted_at, paid_at, payment_reference, created_at")
        .eq("organization_id", org_id)
        .not_.in_("status", ["cancelled", "void"])
        .order("created_at", desc=True)
    )
    participants = _participants(org_id, list({str(i["participant_id"]) for i in invoices if i.get("participant_id")}))
    periods = _periods(list({str(i["billing_period_id"]) for i in invoices if i.get("billing_period_id")}))
    batches = _batches(list({str(i["claim_batch_id"]) for i in invoices if i.get("claim_batch_id")}))
    org = _org(org_id)

    ready, submitted, paid = [], [], []
    drafts_awaiting_review = 0
    for invoice in invoices:
        participant = participants.get(str(invoice.get("participant_id")))
        period = periods.get(str(invoice.get("billing_period_id")))
        batch = batches.get(str(invoice.get("claim_batch_id")))
        if invoice.get("claim_batch_id"):
            row = _row(invoice, participant, period, org, batch)
            (paid if invoice.get("status") == "paid" else submitted).append(row)
            continue
        if plan_type(invoice, period, participant) != "NDIA-managed":
            continue
        if invoice.get("status") == "draft":
            drafts_awaiting_review += 1
        elif invoice.get("status") in READY_STATUSES:
            ready.append(_row(invoice, participant, period, org, None))
    return {
        "ready": ready,
        "submitted": submitted,
        "paid": paid[:200],
        "drafts_awaiting_review": drafts_awaiting_review,
        "registration_number_missing": not _digits(org.get("ndis_provider_number")),
    }


# ── Submitting ───────────────────────────────────────────────────────────


def _next_batch_number(org_id: str) -> str:
    prefix = f"CLM-{app_today().strftime('%Y%m%d')}-"
    rows = _rows(
        get_supabase_admin().table("ndia_claim_batches").select("batch_number")
        .eq("organization_id", org_id).like("batch_number", f"{prefix}%")
    )
    highest = max((int(r["batch_number"].rsplit("-", 1)[-1]) for r in rows
                   if str(r.get("batch_number", "")).rsplit("-", 1)[-1].isdigit()), default=0)
    return f"{prefix}{highest + 1:02d}"


async def submit_batch(user: dict, invoice_ids: list[str]) -> dict[str, Any]:
    org_id = _require_billing(user)
    ids = list(dict.fromkeys(str(i) for i in invoice_ids))
    if not ids:
        raise HTTPException(status_code=422, detail="Select at least one invoice to claim.")
    supabase = get_supabase_admin()
    invoices = _rows(
        supabase.table("invoices")
        .select("id, invoice_number, participant_id, billing_period_id, line_items, total_cents, status, claim_batch_id")
        .eq("organization_id", org_id).in_("id", ids)
    )
    if len(invoices) != len(ids):
        raise HTTPException(status_code=404, detail="Some of those invoices weren't found.")
    participants = _participants(org_id, list({str(i["participant_id"]) for i in invoices if i.get("participant_id")}))
    periods = _periods(list({str(i["billing_period_id"]) for i in invoices if i.get("billing_period_id")}))
    org = _org(org_id)

    claims, blocked = [], []
    for invoice in invoices:
        participant = participants.get(str(invoice.get("participant_id")))
        period = periods.get(str(invoice.get("billing_period_id")))
        label = invoice.get("invoice_number") or invoice["id"]
        if invoice.get("claim_batch_id"):
            blocked.append(f"{label} has already been claimed.")
            continue
        if invoice.get("status") not in READY_STATUSES:
            blocked.append(f"{label} isn't finalised.")
            continue
        if plan_type(invoice, period, participant) != "NDIA-managed":
            blocked.append(f"{label} isn't for an NDIA-managed participant.")
            continue
        lines = claim_lines(invoice, period)
        problems = claim_problems(invoice, participant, org, lines)
        if problems:
            blocked.append(f"{label}: {problems[0]}")
            continue
        claims.append({"invoice": invoice, "participant": participant, "lines": lines})
    if blocked:
        raise HTTPException(status_code=409, detail=" ".join(blocked[:5]))

    batch_number = _next_batch_number(org_id)
    content = build_bulk_csv(org, claims)
    file_name = f"ndia-bulk-claim-{batch_number}.csv"
    path = f"{org_id}/{batch_number}.csv"
    try:
        supabase.storage.from_(BUCKET).upload(path, content.encode("utf-8"), {"content-type": "text/csv", "upsert": "true"})
    except Exception as exc:
        from ..core.errors import internal_error_detail
        raise HTTPException(status_code=502, detail=internal_error_detail("Couldn't store the claim file", exc))

    total = sum(int(c["invoice"].get("total_cents") or 0) for c in claims)
    batch = (supabase.table("ndia_claim_batches").insert({
        "organization_id": org_id,
        "batch_number": batch_number,
        "created_by": get_user_id(user),
        "invoice_count": len(claims),
        "line_count": sum(len(c["lines"]) for c in claims),
        "total_cents": total,
        "file_path": path,
        "file_name": file_name,
    }).execute().data or [{}])[0]

    now = _now()
    # Only invoices still unclaimed and finalised are moved, so a double
    # click (or two people) can't put an invoice in two batches.
    moved = (
        supabase.table("invoices").update({
            "status": "sent",
            "claim_batch_id": batch.get("id"),
            "claim_submitted_at": now,
            "issued_at": now,
            "payment_method": "ndis_portal",
            "updated_at": now,
        })
        .eq("organization_id", org_id)
        .in_("id", [c["invoice"]["id"] for c in claims])
        .is_("claim_batch_id", "null")
        .in_("status", list(READY_STATUSES))
        .execute()
    ).data or []
    if len(moved) != len(claims):
        logger.warning("Claim batch %s: %s of %s invoices moved", batch_number, len(moved), len(claims))

    await audit_service.log_action(
        action_type="ndia_claim.batch_submitted", entity_type="ndia_claim_batch", entity_id=str(batch.get("id")),
        user_id=get_user_id(user), organization_id=org_id,
        after_state={"batch_number": batch_number, "invoice_ids": [c["invoice"]["id"] for c in claims], "total_cents": total},
    )
    return {"batch": batch, "file_name": file_name, "csv": content, "invoice_count": len(moved)}


def batch_file(user: dict, batch_id: str) -> tuple[str, bytes]:
    org_id = _require_billing(user)
    rows = _rows(
        get_supabase_admin().table("ndia_claim_batches").select("file_path, file_name")
        .eq("organization_id", org_id).eq("id", batch_id).limit(1)
    )
    if not rows or not rows[0].get("file_path"):
        raise HTTPException(status_code=404, detail="Claim file not found.")
    data = get_supabase_admin().storage.from_(BUCKET).download(rows[0]["file_path"])
    return rows[0].get("file_name") or "ndia-bulk-claim.csv", data


async def mark_paid(user: dict, invoice_ids: list[str], payment_date: Optional[str], reference: Optional[str]) -> dict[str, Any]:
    """Record the NDIA remittance against claimed invoices."""
    org_id = _require_billing(user)
    ids = list(dict.fromkeys(str(i) for i in invoice_ids))
    if not ids:
        raise HTTPException(status_code=422, detail="Select at least one claim.")
    day = payment_date or app_today().isoformat()
    try:
        if date.fromisoformat(day) > app_today():
            raise HTTPException(status_code=422, detail="Payment date can't be in the future.")
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid payment date.")
    supabase = get_supabase_admin()
    now = _now()
    updated = (
        supabase.table("invoices").update({
            "status": "paid", "paid_at": now, "payment_date": day,
            "payment_reference": (reference or "").strip() or None, "updated_at": now,
        })
        .eq("organization_id", org_id).in_("id", ids)
        .not_.is_("claim_batch_id", "null")
        .in_("status", list(SUBMITTED_STATUSES))
        .execute()
    ).data or []

    # A batch whose invoices are all paid is settled.
    for batch_id in {str(r["claim_batch_id"]) for r in updated if r.get("claim_batch_id")}:
        unpaid = _rows(
            supabase.table("invoices").select("id").eq("organization_id", org_id)
            .eq("claim_batch_id", batch_id).neq("status", "paid").limit(1)
        )
        if not unpaid:
            supabase.table("ndia_claim_batches").update({
                "paid_at": now, "remittance_reference": (reference or "").strip() or None,
            }).eq("id", batch_id).eq("organization_id", org_id).execute()

    await audit_service.log_action(
        action_type="ndia_claim.marked_paid", entity_type="invoice", entity_id=",".join(r["id"] for r in updated)[:200] or "none",
        user_id=get_user_id(user), organization_id=org_id,
        after_state={"invoice_ids": [r["id"] for r in updated], "payment_date": day, "reference": reference},
    )
    return {"paid": len(updated)}


async def return_to_ready(user: dict, invoice_id: str, reason: str) -> dict[str, Any]:
    """The NDIA rejected the claim: take the invoice out of its batch so it
    can be corrected and claimed again. The batch keeps its file as sent."""
    org_id = _require_billing(user)
    if len((reason or "").strip()) < 5:
        raise HTTPException(status_code=422, detail="Say why the claim was rejected.")
    supabase = get_supabase_admin()
    rows = _rows(
        supabase.table("invoices").select("id, status, claim_batch_id, invoice_number")
        .eq("organization_id", org_id).eq("id", invoice_id).limit(1)
    )
    if not rows or not rows[0].get("claim_batch_id"):
        raise HTTPException(status_code=404, detail="That invoice isn't in a claim.")
    if rows[0].get("status") == "paid":
        raise HTTPException(status_code=409, detail="This claim has been paid.")
    supabase.table("invoices").update({
        "status": "finalized", "claim_batch_id": None, "claim_submitted_at": None, "updated_at": _now(),
    }).eq("organization_id", org_id).eq("id", invoice_id).execute()
    await audit_service.log_action(
        action_type="ndia_claim.rejected", entity_type="invoice", entity_id=invoice_id,
        user_id=get_user_id(user), organization_id=org_id,
        before_state={"status": rows[0].get("status"), "claim_batch_id": rows[0].get("claim_batch_id")},
        details={"reason": reason.strip()},
    )
    return {"returned": True}
