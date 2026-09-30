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
- net profit: revenue less wages less overheads. Overheads (costs outside
  payroll) and cash in the bank come from organization_financial_settings,
  entered by the managing director; without them the page says what's
  missing rather than guessing.
- cash runway: cash on hand divided by the average monthly loss over the
  last three complete months. A business making money has no runway limit;
  "covers" is how many months of costs the cash would pay for.

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
    collected_by_month: dict[str, int] = defaultdict(int)
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
            if paid:
                collected_by_month[paid.isoformat()[:7]] += amount
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
        "collected_by_month": {m: collected_by_month.get(m, 0) for m in months},
    }


def _chunks(items: list[str], size: int = CHUNK):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _completed_shift_months(org_id: str, start: date, end: date, tz) -> dict[str, str]:
    """Completed shifts between two days: shift id -> local "YYYY-MM"."""
    from .billing_service import _fetch_all

    start_at = datetime.combine(start, time.min, tzinfo=tz).isoformat()
    end_at = datetime.combine(end + timedelta(days=1), time.min, tzinfo=tz).isoformat()
    rows = _fetch_all(
        lambda: get_supabase_admin().table("shifts").select("id, scheduled_start")
        .eq("organization_id", org_id).eq("status", "completed")
        .gte("scheduled_start", start_at).lt("scheduled_start", end_at)
        .order("scheduled_start").order("id")
    )
    out: dict[str, str] = {}
    for r in rows:
        day = _local_day(r.get("scheduled_start"), tz)
        if r.get("id") and day:
            out[str(r["id"])] = day.isoformat()[:7]
    return out


def wages_by_shift(org_id: str, shift_ids: list[str]) -> dict[str, int]:
    """Net wages per shift that has pay calculated. Reversals are negative
    rows in the append-only ledger, so a plain sum is the net figure."""
    out: dict[str, int] = defaultdict(int)
    for chunk in _chunks(shift_ids):
        try:
            rows = (
                get_supabase_admin().table("pay_transactions").select("shift_id, amount_cents")
                .eq("organization_id", org_id).in_("shift_id", chunk).execute()
            ).data or []
        except Exception as exc:  # pay engine not set up yet
            logger.info("pay_transactions unavailable: %s", exc)
            return {}
        for row in rows:
            out[str(row.get("shift_id"))] += int(row.get("amount_cents") or 0)
    return dict(out)


def labour_cost(org_id: str, shift_ids: list[str]) -> tuple[int, int]:
    """(wages in cents, shifts with pay calculated)."""
    wages = wages_by_shift(org_id, shift_ids)
    return sum(wages.values()), len(wages)


# ── Settings the MD enters: cash and overheads ──────────────────────────


def load_settings(org_id: str) -> dict[str, Any]:
    try:
        rows = (
            get_supabase_admin().table("organization_financial_settings")
            .select("cash_on_hand_cents, cash_as_of, monthly_overheads_cents, updated_at")
            .eq("organization_id", org_id).limit(1).execute()
        ).data or []
    except Exception as exc:  # migration 228 not applied yet
        logger.info("organization_financial_settings unavailable: %s", exc)
        return {}
    return rows[0] if rows else {}


def _cents(value: Optional[float]) -> Optional[int]:
    return None if value is None else int(round(float(value) * 100))


async def save_settings(
    user: dict, *, cash_on_hand: Optional[float], cash_as_of: Optional[date], monthly_overheads: Optional[float],
) -> dict[str, Any]:
    if not is_managing_director(user):
        raise HTTPException(status_code=403, detail="Only the managing director can change financial settings.")
    from . import audit_service
    from .billing_service import _require_org

    org_id = _require_org(user)
    today = app_today()
    if cash_as_of and cash_as_of > today:
        raise HTTPException(status_code=422, detail="The cash balance date can't be in the future.")
    row = {
        "organization_id": org_id,
        "cash_on_hand_cents": _cents(cash_on_hand),
        "cash_as_of": (cash_as_of or today).isoformat() if cash_on_hand is not None else None,
        "monthly_overheads_cents": _cents(monthly_overheads),
        "updated_by": user.get("id") or user.get("sub"),
        "updated_at": datetime.now(tz=request_timezone()).isoformat(),
    }
    before = load_settings(org_id)
    try:
        get_supabase_admin().table("organization_financial_settings").upsert(row, on_conflict="organization_id").execute()
    except Exception as exc:
        logger.error("Couldn't save financial settings for %s: %s", org_id, exc)
        raise HTTPException(status_code=502, detail="Financial settings couldn't be saved. Try again shortly.")
    await audit_service.log_action(
        action_type="finance.settings_updated", entity_type="organization", entity_id=org_id,
        user_id=row["updated_by"], organization_id=org_id,
        before_state={k: before.get(k) for k in ("cash_on_hand_cents", "cash_as_of", "monthly_overheads_cents")},
        after_state={k: row[k] for k in ("cash_on_hand_cents", "cash_as_of", "monthly_overheads_cents")},
    )
    return load_settings(org_id)


# ── Profit and cash ─────────────────────────────────────────────────────


def monthly_breakdown(
    months: list[str], billed: dict[str, int], collected: dict[str, int], wages: dict[str, int],
    costed_months: set[str], overheads_monthly: Optional[int], current_month: str,
) -> list[dict[str, Any]]:
    out = []
    for m in months:
        future = m > current_month
        month_wages = wages.get(m, 0) if m in costed_months else None
        month_overheads = overheads_monthly if overheads_monthly is not None and not future else None
        has_costs = month_wages is not None or month_overheads is not None
        net = billed.get(m, 0) - (month_wages or 0) - (month_overheads or 0) if has_costs else None
        out.append({
            "month": m,
            "billed_cents": billed.get(m, 0),
            "collected_cents": collected.get(m, 0),
            "wages_cents": month_wages,
            "overheads_cents": month_overheads,
            "net_cents": net,
            "current": m == current_month,
            "future": future,
        })
    return out


RUNWAY_MONTHS = 3


def cash_position(settings: dict[str, Any], monthly: list[dict[str, Any]], current_month: str) -> dict[str, Any]:
    """Runway from the last three complete months that have cost figures."""
    complete = [m for m in monthly if m["month"] < current_month and m["net_cents"] is not None][-RUNWAY_MONTHS:]
    on_hand = settings.get("cash_on_hand_cents")
    avg_net = round(sum(m["net_cents"] for m in complete) / len(complete)) if complete else None
    avg_costs = (
        round(sum((m["wages_cents"] or 0) + (m["overheads_cents"] or 0) for m in complete) / len(complete))
        if complete else None
    )
    runway = covers = None
    if on_hand is not None:
        if avg_net is not None and avg_net < 0:
            runway = round(on_hand / -avg_net, 1)
        if avg_costs:
            covers = round(on_hand / avg_costs, 1)
    return {
        "on_hand_cents": on_hand,
        "as_of": settings.get("cash_as_of"),
        "basis_months": [m["month"] for m in complete],
        "avg_monthly_net_cents": avg_net,
        "avg_monthly_costs_cents": avg_costs,
        "runway_months": runway,
        "covers_months": covers,
        "cash_positive": avg_net is not None and avg_net >= 0,
    }


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

    current_month = today.isoformat()[:7]
    window_start = date.fromisoformat(f"{months[0]}-01")
    window_end = max(end, date.fromisoformat(f"{months[-1]}-01"))
    shift_months = _completed_shift_months(org_id, min(window_start, start), window_end, tz)
    start_key, end_key = start.isoformat()[:7], end.isoformat()[:7]
    shift_ids = [sid for sid, m in shift_months.items() if start_key <= m <= end_key]
    shift_wages = wages_by_shift(org_id, list(shift_months))
    in_period = set(shift_ids)
    wages = sum(v for sid, v in shift_wages.items() if sid in in_period)
    costed = sum(1 for sid in in_period if sid in shift_wages)
    wages_month: dict[str, int] = defaultdict(int)
    for sid, cents in shift_wages.items():
        wages_month[shift_months[sid]] += cents
    costed_months = set(wages_month)

    settings = load_settings(org_id)
    overheads_monthly = settings.get("monthly_overheads_cents")
    monthly = monthly_breakdown(
        months, {m["month"]: m["billed_cents"] for m in summary["revenue_by_month"]},
        summary["collected_by_month"], wages_month, costed_months, overheads_monthly, current_month,
    )
    period_months = [m for m in monthly if start_key <= m["month"] <= end_key and not m["future"]]
    overheads = overheads_monthly * len(period_months) if overheads_monthly is not None else None
    labour = wages if costed else None
    has_costs = labour is not None or overheads is not None
    net = summary["billed_cents"] - (labour or 0) - (overheads or 0) if has_costs else None

    recent = [inv for inv in invoices if inv.get("status") not in {"cancelled", "void"}][:6]
    names = _participant_names(org_id, list({str(i["participant_id"]) for i in recent if i.get("participant_id")}))
    return {
        "period": period,
        "period_label": label,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        **{k: v for k, v in summary.items() if k != "collected_by_month"},
        "revenue_by_month": monthly,
        "session_count": len(shift_ids),
        "labour_cost_cents": wages if costed else None,
        "costed_session_count": costed,
        "cost_per_session_cents": round(wages / costed) if costed else None,
        "profit_and_loss": {
            "revenue_cents": summary["billed_cents"],
            "wages_cents": labour,
            "overheads_cents": overheads,
            "net_profit_cents": net,
            "margin_pct": round(net / summary["billed_cents"] * 100, 1) if net is not None and summary["billed_cents"] else None,
            "wages_complete": bool(shift_ids) and costed >= len(shift_ids),
            "overheads_set": overheads_monthly is not None,
        },
        "cash": cash_position(settings, monthly, current_month),
        "settings": {
            "cash_on_hand_cents": settings.get("cash_on_hand_cents"),
            "cash_as_of": settings.get("cash_as_of"),
            "monthly_overheads_cents": overheads_monthly,
            "updated_at": settings.get("updated_at"),
        },
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
