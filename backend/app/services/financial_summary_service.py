"""Financial Governance summary for the managing director.

Everything is counted on the server from the full invoice set (the page
used to add up a list capped at 200 rows):

- invoices / billed: invoices raised in the period (not drafts — nothing
  has been asked for yet — and not cancelled or void)
- collected: invoices paid in the period, by payment date
- outstanding: everything raised and not yet paid, as of today, with the
  overdue part (past its due date) broken out
- sessions: shifts completed in the period
- cost per session: wages for those shifts from the pay engine
  (pay_transactions) divided by the shifts that have been costed. Not
  shown when no pay has been calculated — it is never estimated.

Periods follow the office's calendar: this month, this quarter, or the
Australian financial year (1 July – 30 June).
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from typing import Any, Iterable, Literal, Optional

from fastapi import HTTPException

from ..core.access import is_managing_director
from ..core.timezone import app_today, request_timezone
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

Period = Literal["month", "quarter", "year"]
RAISED_EXCLUDED = {"draft", "cancelled", "void"}
UNPAID_RAISED = {"finalized", "issued", "sent", "overdue"}
CHUNK = 200


def period_bounds(period: Period, today: date) -> tuple[date, date, str]:
    """Inclusive start/end and a label."""
    if period == "month":
        start = today.replace(day=1)
        end = (start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        return start, end, start.strftime("%B %Y")
    if period == "quarter":
        first_month = 3 * ((today.month - 1) // 3) + 1
        start = date(today.year, first_month, 1)
        end_month = first_month + 2
        end = (date(today.year, end_month, 28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        return start, end, f"{start.strftime('%b')}–{end.strftime('%b %Y')}"
    fy_start_year = today.year if today.month >= 7 else today.year - 1
    start, end = date(fy_start_year, 7, 1), date(fy_start_year + 1, 6, 30)
    return start, end, f"FY{fy_start_year}–{str(fy_start_year + 1)[2:]}"


def month_keys(end: date, count: int) -> list[str]:
    keys = []
    year, month = end.year, end.month
    for _ in range(count):
        keys.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    return list(reversed(keys))


def _local_day(value: Any, tz) -> Optional[date]:
    if not value:
        return None
    text = str(value)
    if len(text) == 10:
        try:
            return date.fromisoformat(text)
        except ValueError:
            return None
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo and tz is not None:
        moment = moment.astimezone(tz)
    return moment.date()


def raised_day(invoice: dict, tz) -> Optional[date]:
    """When the invoice was raised: issued, else finalised, else created."""
    return _local_day(invoice.get("issued_at") or invoice.get("finalized_at") or invoice.get("created_at"), tz)


def paid_day(invoice: dict, tz) -> Optional[date]:
    return _local_day(invoice.get("payment_date") or invoice.get("paid_at"), tz)


def display_status(invoice: dict, today: date) -> str:
    status = invoice.get("status") or "draft"
    if status in UNPAID_RAISED:
        due = _local_day(invoice.get("due_date"), None)
        if status == "overdue" or (due and due < today):
            return "overdue"
        return "outstanding"
    return status


def summarise_invoices(invoices: Iterable[dict], start: date, end: date, today: date, tz, months: list[str]) -> dict[str, Any]:
    count = billed = collected = outstanding = overdue = 0
    by_month: dict[str, int] = defaultdict(int)
    for inv in invoices:
        status = inv.get("status") or "draft"
        amount = int(inv.get("total_cents") or 0)
        if status in RAISED_EXCLUDED:
            continue
        raised = raised_day(inv, tz)
        if raised:
            if start <= raised <= end:
                count += 1
                billed += amount
            by_month[raised.isoformat()[:7]] += amount
        if status == "paid":
            paid = paid_day(inv, tz)
            if paid and start <= paid <= end:
                collected += amount
        elif status in UNPAID_RAISED:
            outstanding += amount
            if display_status(inv, today) == "overdue":
                overdue += amount
    return {
        "invoice_count": count,
        "billed_cents": billed,
        "collected_cents": collected,
        "outstanding_cents": outstanding,
        "overdue_cents": overdue,
        "revenue_by_month": [{"month": m, "billed_cents": by_month.get(m, 0)} for m in months],
    }


def _chunks(items: list[str], size: int = CHUNK):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _completed_shift_ids(org_id: str, start: date, end: date, tz) -> list[str]:
    from .billing_service import _fetch_all

    start_at = datetime.combine(start, time.min, tzinfo=tz).isoformat()
    end_at = datetime.combine(end + timedelta(days=1), time.min, tzinfo=tz).isoformat()
    rows = _fetch_all(
        lambda: get_supabase_admin().table("shifts").select("id")
        .eq("organization_id", org_id).eq("status", "completed")
        .gte("scheduled_start", start_at).lt("scheduled_start", end_at)
        .order("scheduled_start").order("id")
    )
    return [str(r["id"]) for r in rows if r.get("id")]


def labour_cost(org_id: str, shift_ids: list[str]) -> tuple[int, int]:
    """(wages in cents, shifts with pay calculated). Reversals are negative
    rows in the append-only ledger, so a plain sum is the net figure."""
    total = 0
    costed: set[str] = set()
    for chunk in _chunks(shift_ids):
        try:
            rows = (
                get_supabase_admin().table("pay_transactions").select("shift_id, amount_cents")
                .eq("organization_id", org_id).in_("shift_id", chunk).execute()
            ).data or []
        except Exception as exc:  # pay engine not set up yet
            logger.info("pay_transactions unavailable: %s", exc)
            return 0, 0
        for row in rows:
            total += int(row.get("amount_cents") or 0)
            costed.add(str(row.get("shift_id")))
    return total, len(costed)


def _participant_names(org_id: str, ids: list[str]) -> dict[str, str]:
    names: dict[str, str] = {}
    for chunk in _chunks(ids):
        rows = (
            get_supabase_admin().table("participants").select("id, full_name")
            .eq("organization_id", org_id).in_("id", chunk).execute()
        ).data or []
        names.update({str(r["id"]): r.get("full_name") or "" for r in rows})
    return names


def get_financial_summary(user: dict, period: Period) -> dict[str, Any]:
    if not is_managing_director(user):
        raise HTTPException(status_code=403, detail="Financial reports are available to the managing director only.")
    from .billing_service import _fetch_all, _require_org

    org_id = _require_org(user)
    tz = request_timezone()
    today = app_today()
    start, end, label = period_bounds(period, today)
    months = month_keys(end if period == "year" else today, 12 if period == "year" else 6)

    invoices = _fetch_all(
        lambda: get_supabase_admin().table("invoices")
        .select("id, invoice_number, participant_id, recipient_name, total_cents, status, created_at, "
                "issued_at, finalized_at, paid_at, payment_date, due_date")
        .eq("organization_id", org_id)
        .order("created_at", desc=True).order("id")
    )
    summary = summarise_invoices(invoices, start, end, today, tz, months)

    shift_ids = _completed_shift_ids(org_id, start, end, tz)
    wages, costed = labour_cost(org_id, shift_ids)

    recent = [inv for inv in invoices if inv.get("status") not in {"cancelled", "void"}][:6]
    names = _participant_names(org_id, list({str(i["participant_id"]) for i in recent if i.get("participant_id")}))
    current_month = today.isoformat()[:7]
    return {
        "period": period,
        "period_label": label,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        **summary,
        "revenue_by_month": [{**m, "current": m["month"] == current_month} for m in summary["revenue_by_month"]],
        "session_count": len(shift_ids),
        "labour_cost_cents": wages if costed else None,
        "costed_session_count": costed,
        "cost_per_session_cents": round(wages / costed) if costed else None,
        "recent_invoices": [
            {
                "id": inv["id"],
                "invoice_number": inv.get("invoice_number"),
                "name": names.get(str(inv.get("participant_id"))) or inv.get("recipient_name") or "",
                "total_cents": int(inv.get("total_cents") or 0),
                "status": display_status(inv, today),
            }
            for inv in recent
        ],
    }
