"""Workforce and growth planning for a managing director.

Answers, from one organisation's own records:
  - How much support is being delivered and booked, and which way it's heading
  - How much staff time the organisation has, and how much of it is used
  - Whether staff can cover the demand ahead, and if not, who to hire and by when
  - What staff cost per hour against what the hours earn, now and ahead
  - Whether participants' remaining funding supports the demand
  - How the organisation is growing (participants, staff, revenue)

Every figure says whether it was measured from the organisation's data or
assumed for lack of it. The maths is in pure functions (``build_plan`` and its
helpers) so it can be tested exactly; ``load_inputs`` only reads, and every
query is filtered to the one organisation (the service-role client bypasses
row-level security, so the filter is the tenancy boundary).

Definitions (weeks run Monday to Sunday on the organisation's clock):
  delivered hours   completed shifts, by the day they were scheduled
  booked hours      future shifts not cancelled (rostered or still open)
  revenue           shift_verifications.billed_amount, not reversed, by service date
  wages             pay_transactions.amount_cents (award pay as calculated), by service date
  loaded wage       wages x (1 + on-costs); on-costs default to 12% super + 3% workers comp
  staff time        each active support worker's stated maximum weekly hours
  utilisation       delivered hours / staff time
  trend             least-squares line through the last 12 complete weeks of delivered hours
"""

from __future__ import annotations

import logging
import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from statistics import median
from typing import Any, Iterable, Optional
from zoneinfo import ZoneInfo

from ..core.timezone import app_today, request_timezone
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

HISTORY_WEEKS = 12
FORECAST_WEEKS = 12
GROWTH_MONTHS = 6
FULL_TIME_HOURS = 38.0

DEFAULT_TARGET_UTILISATION = 0.85
DEFAULT_ON_COST_RATE = 0.15  # 12% superannuation guarantee + about 3% workers compensation
DEFAULT_CONVERSION = 0.5
DEFAULT_DAYS_TO_ACTIVATE = 28
DEFAULT_LEAD_TIME_WEEKS = 4
DEFAULT_HOURS_PER_NEW_WORKER = 20.0

RELIABLE_EMPLOYMENT_TYPES = frozenset({"part_time", "full_time"})
FUTURE_SHIFT_STATUSES = frozenset({"scheduled", "unassigned", "offered", "confirmed", "in_progress"})
CLOSED_INTAKE_STATUSES = frozenset({"active", "declined", "withdrawn", "exited", "inactive", "suspended"})
LOST_INTAKE_STATUSES = frozenset({"declined", "withdrawn"})
STAFF_ROLES = frozenset({"support_worker", "support_coordinator"})


# ── Inputs ──────────────────────────────────────────────────────────────────


@dataclass
class PlanInputs:
    shifts: list[dict] = field(default_factory=list)
    verifications: list[dict] = field(default_factory=list)
    pay: list[dict] = field(default_factory=list)
    users: list[dict] = field(default_factory=list)
    availability: dict[str, dict] = field(default_factory=dict)
    intakes: list[dict] = field(default_factory=list)
    budgets: list[dict] = field(default_factory=list)  # {plan_end, allocated_amount, used_amount}


@dataclass(frozen=True)
class Assumptions:
    target_utilisation: float = DEFAULT_TARGET_UTILISATION
    on_cost_rate: float = DEFAULT_ON_COST_RATE
    lead_time_weeks: Optional[int] = None  # None = measured from the organisation's hiring
    # Entered by the director when no pay has been run yet; measured pay wins.
    wage_per_hour: Optional[float] = None


# ── Small helpers ───────────────────────────────────────────────────────────


def _num(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=ZoneInfo("UTC"))


def _local_day(value: Any, tz: ZoneInfo) -> Optional[date]:
    dt = _parse_dt(value)
    if dt is not None:
        return dt.astimezone(tz).date()
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def shift_hours(shift: dict) -> float:
    minutes = shift.get("duration_minutes")
    if minutes not in (None, ""):
        return max(0.0, _num(minutes) / 60)
    start, end = _parse_dt(shift.get("scheduled_start")), _parse_dt(shift.get("scheduled_end"))
    if not start or not end:
        return 0.0
    return max(0.0, (end - start).total_seconds() / 3600)


def linear_trend(values: list[float]) -> tuple[float, float]:
    """Least-squares (intercept, slope) through points x = 0..n-1."""
    n = len(values)
    if n < 2:
        return (values[0] if values else 0.0), 0.0
    mean_x = (n - 1) / 2
    mean_y = sum(values) / n
    sxx = sum((x - mean_x) ** 2 for x in range(n))
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in enumerate(values))
    slope = sxy / sxx if sxx else 0.0
    return mean_y - slope * mean_x, slope


def _r(value: float, digits: int = 1) -> float:
    return round(value + 0.0, digits)


def _month_end(year: int, month: int) -> date:
    first_next = date(year + (month // 12), month % 12 + 1, 1)
    return first_next - timedelta(days=1)


# ── The plan ────────────────────────────────────────────────────────────────


def build_plan(inputs: PlanInputs, today: date, tz: ZoneInfo, assumptions: Assumptions = Assumptions()) -> dict[str, Any]:
    this_week = week_start(today)
    history_weeks = [this_week - timedelta(weeks=HISTORY_WEEKS - i) for i in range(HISTORY_WEEKS)]
    forecast_weeks = [this_week + timedelta(weeks=i) for i in range(FORECAST_WEEKS)]
    measured: dict[str, bool] = {}

    # Which week each shift falls in, on the organisation's clock.
    shift_week: dict[str, date] = {}
    shift_by_id: dict[str, dict] = {}
    delivered: dict[date, float] = defaultdict(float)
    booked: dict[date, float] = defaultdict(float)
    for s in inputs.shifts:
        day = _local_day(s.get("scheduled_start"), tz)
        if not day:
            continue
        wk = week_start(day)
        sid = str(s.get("id") or "")
        if sid:
            shift_week[sid] = wk
            shift_by_id[sid] = s
        status = s.get("status")
        if status == "completed":
            delivered[wk] += shift_hours(s)
        elif status in FUTURE_SHIFT_STATUSES and day >= today:
            booked[wk] += shift_hours(s)

    # Revenue and wages by service week.
    revenue: dict[date, float] = defaultdict(float)
    verified_hours = 0.0
    verified_revenue = 0.0
    for v in inputs.verifications:
        if v.get("reversed_at"):
            continue
        sid = str(v.get("shift_id") or "")
        wk = shift_week.get(sid) or (week_start(d) if (d := _local_day(v.get("verified_at"), tz)) else None)
        amount = _num(v.get("billed_amount"))
        if wk:
            revenue[wk] += amount
        if wk and wk >= history_weeks[0] and sid in shift_by_id:
            verified_revenue += amount
            verified_hours += shift_hours(shift_by_id[sid])
    # Pay rows split a shift into overlapping parts (base pay, a casual
    # loading on the same hours, penalties) and reversals carry no hours, so
    # hours are never summed from them: wage per hour is each shift's net pay
    # over that shift's own length. A fully reversed shift drops out.
    wages: dict[date, float] = defaultdict(float)
    net_pay: dict[str, float] = defaultdict(float)
    for p in inputs.pay:
        sid = str(p.get("shift_id") or "")
        wk = shift_week.get(sid) or (week_start(d) if (d := _local_day(p.get("created_at"), tz)) else None)
        amount = _num(p.get("amount_cents")) / 100
        if wk:
            wages[wk] += amount
        if sid:
            net_pay[sid] += amount
    paid_hours = 0.0
    paid_amount = 0.0
    for sid, amount in net_pay.items():
        shift = shift_by_id.get(sid)
        if shift is None or amount <= 0.005 or shift_week.get(sid, date.min) < history_weeks[0]:
            continue
        hours = shift_hours(shift)
        if hours > 0:
            paid_amount += amount
            paid_hours += hours

    # ── Demand ──
    history_hours = [delivered[w] for w in history_weeks]
    recent = history_hours[-4:]
    current_demand = sum(recent) / len(recent) if recent else 0.0
    intercept, slope = linear_trend(history_hours)
    measured["trend"] = sum(1 for h in history_hours if h > 0) >= 4

    # Pipeline: open enquiries, how many usually become participants, and how fast.
    year_ago = today - timedelta(days=365)
    converted_days: list[float] = []
    decided = converted = 0
    open_hours = 0.0
    open_count = 0
    for i in inputs.intakes:
        status = i.get("status") or ""
        created = _parse_dt(i.get("created_at"))
        activated = _parse_dt(i.get("activated_at"))
        if status not in CLOSED_INTAKE_STATUSES and not activated:
            open_count += 1
            open_hours += max(0.0, _num(i.get("service_hours_required")))
        if created and created.date() >= year_ago:
            if activated:
                decided += 1
                converted += 1
                converted_days.append(max(0.0, (activated - created).total_seconds() / 86400))
            elif status in LOST_INTAKE_STATUSES:
                decided += 1
    measured["conversion"] = decided >= 3
    conversion = converted / decided if measured["conversion"] else DEFAULT_CONVERSION
    measured["days_to_activate"] = len(converted_days) >= 3
    days_to_activate = median(converted_days) if measured["days_to_activate"] else DEFAULT_DAYS_TO_ACTIVATE
    pipeline_hours = open_hours * conversion
    pipeline_start_week = min(FORECAST_WEEKS - 1, max(1, math.ceil(days_to_activate / 7)))

    # ── Staff time ──
    now_staff = [
        u for u in inputs.users
        if u.get("role") in STAFF_ROLES and u.get("is_active", True) and not u.get("deactivated_at")
    ]
    workers = [u for u in now_staff if u.get("role") == "support_worker"]
    stated: dict[str, Optional[float]] = {}
    for w in workers:
        row = inputs.availability.get(str(w.get("id")))
        value = row.get("max_hours_per_week") if row else None
        stated[str(w.get("id"))] = max(0.0, _num(value)) if value not in (None, "") else None
    known_hours = [h for h in stated.values() if h is not None]
    missing = sum(1 for h in stated.values() if h is None)
    measured["staff_hours"] = bool(known_hours)
    positive = [h for h in known_hours if h > 0]
    avg_hours = sum(positive) / len(positive) if positive else DEFAULT_HOURS_PER_NEW_WORKER
    # Workers who haven't said their hours count at the team's average, flagged.
    hours_for = {wid: (h if h is not None else avg_hours) for wid, h in stated.items()}
    staff_time = sum(hours_for.values())
    reliable = sum(
        hours_for[str(w.get("id"))] for w in workers
        if (w.get("employment_type") or "") in RELIABLE_EMPLOYMENT_TYPES
    )
    utilisation = current_demand / staff_time if staff_time else None

    # Staff leaving: departures in the last year against the average headcount.
    left_last_year = [
        u for u in inputs.users
        if u.get("role") in STAFF_ROLES and (d := _parse_dt(u.get("deactivated_at"))) and d.date() >= year_ago
    ]
    headcount_now = len(now_staff)
    avg_headcount = max(1.0, headcount_now + len(left_last_year) / 2)
    annual_attrition = min(0.9, len(left_last_year) / avg_headcount)
    measured["attrition"] = headcount_now + len(left_last_year) >= 3
    weekly_survival = (1 - annual_attrition) ** (1 / 52)

    # Lead time to hire: from a worker's account being created to their first
    # completed shift, for workers who started in the last year.
    first_shift: dict[str, date] = {}
    for s in inputs.shifts:
        if s.get("status") == "completed" and s.get("worker_id"):
            d = _local_day(s.get("scheduled_start"), tz)
            wid = str(s["worker_id"])
            if d and (wid not in first_shift or d < first_shift[wid]):
                first_shift[wid] = d
    starts = []
    for w in inputs.users:
        created = _parse_dt(w.get("created_at"))
        wid = str(w.get("id"))
        if w.get("role") == "support_worker" and created and created.date() >= year_ago and wid in first_shift:
            starts.append((first_shift[wid] - created.date()).days / 7)
    if assumptions.lead_time_weeks is not None:
        lead_time = max(1, int(assumptions.lead_time_weeks))
        measured["lead_time"] = False
    elif len(starts) >= 2:
        lead_time = max(1, min(12, math.ceil(median(starts))))
        measured["lead_time"] = True
    else:
        lead_time = DEFAULT_LEAD_TIME_WEEKS
        measured["lead_time"] = False

    # ── Forecast ──
    forecast = []
    for k, wk in enumerate(forecast_weeks):
        trend_k = max(0.0, intercept + slope * (HISTORY_WEEKS + k))
        base = max(booked[wk], trend_k if measured["trend"] else current_demand)
        demand_k = base + (pipeline_hours if k >= pipeline_start_week else 0.0)
        capacity_k = staff_time * (weekly_survival ** k)
        usable_k = capacity_k * assumptions.target_utilisation
        forecast.append({
            "week": wk.isoformat(),
            "booked_hours": _r(booked[wk]),
            "demand_hours": _r(demand_k),
            "staff_hours": _r(capacity_k),
            "usable_hours": _r(usable_k),
            "gap_hours": _r(demand_k - usable_k),
        })

    # ── Hiring ──
    peak = max(forecast, key=lambda f: f["gap_hours"]) if forecast else None
    short_weeks = [f for f in forecast if f["gap_hours"] > 0]
    expected_leavers = headcount_now * (1 - weekly_survival ** FORECAST_WEEKS)
    hiring: dict[str, Any] = {
        "needed": bool(short_weeks),
        "hours_short": _r(peak["gap_hours"]) if short_weeks and peak else 0.0,
        "workers": 0,
        "fte": 0.0,
        "hire_by": None,
        "short_from": None,
        "hours_per_new_worker": _r(avg_hours),
        "lead_time_weeks": lead_time,
        "expected_leavers": _r(expected_leavers),
        "spare_hours": _r(max(0.0, -max((f["gap_hours"] for f in forecast), default=0.0))),
    }
    if short_weeks and peak:
        hiring["workers"] = math.ceil(peak["gap_hours"] / (avg_hours * assumptions.target_utilisation))
        hiring["fte"] = _r(peak["gap_hours"] / FULL_TIME_HOURS)
        first = date.fromisoformat(short_weeks[0]["week"])
        hiring["short_from"] = first.isoformat()
        hiring["hire_by"] = max(this_week, first - timedelta(weeks=lead_time)).isoformat()

    # ── Money ──
    measured["revenue_rate"] = verified_hours > 0
    measured["wage_rate"] = paid_hours > 0
    revenue_per_hour = verified_revenue / verified_hours if verified_hours else None
    if paid_hours:
        wage_per_hour: Optional[float] = paid_amount / paid_hours
        wage_source = "pay records"
    elif assumptions.wage_per_hour:
        wage_per_hour = float(assumptions.wage_per_hour)
        wage_source = "entered"
    else:
        wage_per_hour = None
        wage_source = None
    loaded_wage = wage_per_hour * (1 + assumptions.on_cost_rate) if wage_per_hour is not None else None
    margin_per_hour = (revenue_per_hour - loaded_wage) if revenue_per_hour is not None and loaded_wage is not None else None
    deliverable = [min(f["demand_hours"], f["staff_hours"]) for f in forecast]
    unmet = [max(0.0, f["demand_hours"] - f["staff_hours"]) for f in forecast]
    recent_wages = [wages[w] for w in history_weeks[-4:]]
    # With an entered wage and no pay run yet, this week's wage bill is the
    # hours being delivered at that wage.
    weekly_wage_bill = (
        sum(recent_wages) / len(recent_wages) if paid_hours
        else current_demand * wage_per_hour if wage_per_hour is not None
        else 0.0
    )
    finance = {
        "wage_source": wage_source,
        "revenue_per_hour": _r(revenue_per_hour, 2) if revenue_per_hour is not None else None,
        "wage_per_hour": _r(wage_per_hour, 2) if wage_per_hour is not None else None,
        "loaded_wage_per_hour": _r(loaded_wage, 2) if loaded_wage is not None else None,
        "margin_per_hour": _r(margin_per_hour, 2) if margin_per_hour is not None else None,
        "margin_pct": _r(margin_per_hour / revenue_per_hour * 100) if margin_per_hour is not None and revenue_per_hour else None,
        "weekly_wages": _r(weekly_wage_bill, 2),
        "weekly_wages_loaded": _r(weekly_wage_bill * (1 + assumptions.on_cost_rate), 2),
        "projected_revenue": _r(sum(deliverable) * revenue_per_hour, 0) if revenue_per_hour is not None else None,
        "projected_wages_loaded": _r(sum(deliverable) * loaded_wage, 0) if loaded_wage is not None else None,
        "revenue_at_risk": _r(sum(unmet) * revenue_per_hour, 0) if revenue_per_hour is not None else None,
        "new_worker_weekly_cost": _r(avg_hours * assumptions.target_utilisation * loaded_wage, 0) if loaded_wage is not None else None,
        "new_worker_weekly_revenue": _r(avg_hours * assumptions.target_utilisation * revenue_per_hour, 0) if revenue_per_hour is not None else None,
    }

    # ── Funding ──
    funded_weekly_dollars = 0.0
    funded_plans = 0
    for b in inputs.budgets:
        end = _local_day(b.get("plan_end"), tz)
        if not end or end < today:
            continue
        remaining = max(0.0, _num(b.get("allocated_amount")) - _num(b.get("used_amount")))
        weeks_left = max(1.0, (end - today).days / 7)
        funded_weekly_dollars += remaining / weeks_left
        funded_plans += 1
    funding = {
        "plans_counted": funded_plans,
        "weekly_dollars": _r(funded_weekly_dollars, 0),
        "weekly_hours": _r(funded_weekly_dollars / revenue_per_hour) if revenue_per_hour else None,
    }

    # ── Growth, by month ──
    months = []
    y, m = today.year, today.month
    for _ in range(GROWTH_MONTHS):
        months.append((y, m))
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    months.reverse()
    month_revenue: dict[tuple[int, int], float] = defaultdict(float)
    month_hours: dict[tuple[int, int], float] = defaultdict(float)
    for s in inputs.shifts:
        if s.get("status") == "completed" and (d := _local_day(s.get("scheduled_start"), tz)):
            month_hours[(d.year, d.month)] += shift_hours(s)
    for v in inputs.verifications:
        if v.get("reversed_at"):
            continue
        sid = str(v.get("shift_id") or "")
        d = _local_day(shift_by_id[sid].get("scheduled_start"), tz) if sid in shift_by_id else _local_day(v.get("verified_at"), tz)
        if d:
            month_revenue[(d.year, d.month)] += _num(v.get("billed_amount"))
    growth_rows = []
    for (yy, mm) in months:
        end = min(_month_end(yy, mm), today)
        participants = sum(
            1 for i in inputs.intakes
            if (a := _parse_dt(i.get("activated_at"))) and a.date() <= end
            and not ((x := _parse_dt(i.get("exited_at"))) and x.date() <= end)
        )
        staff = sum(
            1 for u in inputs.users
            if u.get("role") in STAFF_ROLES and (c := _parse_dt(u.get("created_at"))) and c.date() <= end
            and not ((x := _parse_dt(u.get("deactivated_at"))) and x.date() <= end)
        )
        growth_rows.append({
            "month": f"{yy:04d}-{mm:02d}",
            "participants": participants,
            "staff": staff,
            "hours": _r(month_hours[(yy, mm)]),
            "revenue": _r(month_revenue[(yy, mm)], 0),
        })
    first, last = growth_rows[0], growth_rows[-1]

    def change(a: float, b: float) -> Optional[float]:
        return _r((b - a) / a * 100) if a else None

    growth = {
        "months": growth_rows,
        "participants_change_pct": change(first["participants"], last["participants"]),
        "staff_change_pct": change(first["staff"], last["staff"]),
        "open_enquiries": open_count,
        "conversion_pct": _r(conversion * 100),
        "days_to_activate": _r(days_to_activate, 0),
    }

    return {
        "as_of": today.isoformat(),
        "history": [
            {
                "week": w.isoformat(),
                "delivered_hours": _r(delivered[w]),
                "revenue": _r(revenue[w], 0),
                "wages": _r(wages[w], 0),
                "wages_loaded": _r(wages[w] * (1 + assumptions.on_cost_rate), 0),
            }
            for w in history_weeks
        ],
        "demand": {
            "current_weekly_hours": _r(current_demand),
            "trend_hours_per_week": _r(slope, 2),
            "trend_pct_per_month": _r(slope * 4.33 / current_demand * 100) if current_demand else None,
            "booked_next_4_weeks": _r(sum(booked[w] for w in forecast_weeks[:4]) / 4),
            "pipeline": {
                "open_enquiries": open_count,
                "requested_hours": _r(open_hours),
                "conversion_pct": _r(conversion * 100),
                "expected_hours": _r(pipeline_hours),
                "starts_in_weeks": pipeline_start_week,
            },
        },
        "capacity": {
            "staff_hours": _r(staff_time),
            "reliable_hours": _r(reliable),
            "casual_hours": _r(staff_time - reliable),
            "workers": len(workers),
            "workers_without_hours": missing,
            "utilisation_pct": _r(utilisation * 100) if utilisation is not None else None,
            "target_utilisation_pct": _r(assumptions.target_utilisation * 100),
            "annual_attrition_pct": _r(annual_attrition * 100),
        },
        "forecast": forecast,
        "hiring": hiring,
        "finance": finance,
        "funding": funding,
        "growth": growth,
        "assumptions": {
            "target_utilisation_pct": _r(assumptions.target_utilisation * 100),
            "on_cost_pct": _r(assumptions.on_cost_rate * 100),
            "measured": measured,
        },
    }


# ── Loading (one organisation only) ─────────────────────────────────────────


def _all(query, page: int = 1000) -> list[dict]:
    rows: list[dict] = []
    start = 0
    while True:
        batch = query.range(start, start + page - 1).execute().data or []
        rows.extend(r for r in batch if isinstance(r, dict))
        if len(batch) < page:
            return rows
        start += page


def load_inputs(org_id: str, today: date, tz: ZoneInfo) -> PlanInputs:
    if not org_id:
        raise ValueError("An organisation is required")
    sb = get_supabase_admin()
    since = datetime.combine(week_start(today) - timedelta(weeks=max(HISTORY_WEEKS, GROWTH_MONTHS * 5)), time.min, tzinfo=tz)
    until = datetime.combine(week_start(today) + timedelta(weeks=FORECAST_WEEKS), time.min, tzinfo=tz)

    shifts = _all(
        sb.table("shifts")
        .select("id, worker_id, participant_id, status, scheduled_start, scheduled_end, duration_minutes")
        .eq("organization_id", org_id)
        .gte("scheduled_start", since.isoformat())
        .lt("scheduled_start", until.isoformat())
        .order("scheduled_start")
    )
    verifications = _all(
        sb.table("shift_verifications")
        .select("shift_id, billed_amount, reversed_at, verified_at")
        .eq("organization_id", org_id)
        .gte("verified_at", since.isoformat())
        .order("verified_at")
    )
    pay = _all(
        sb.table("pay_transactions")
        .select("shift_id, amount_cents, hours_applied, created_at")
        .eq("organization_id", org_id)
        .gte("created_at", since.isoformat())
        .order("created_at")
    )
    users = _all(
        sb.table("users")
        .select("id, role, employment_type, is_active, created_at, deactivated_at")
        .eq("organization_id", org_id)
        .in_("role", sorted(STAFF_ROLES))
        .order("created_at")
    )
    availability = {
        str(r["user_id"]): r
        for r in _all(
            sb.table("worker_availability")
            .select("user_id, max_hours_per_week, available_days")
            .eq("organization_id", org_id)
            .order("user_id")
        )
        if r.get("user_id")
    }
    intakes = _all(
        sb.table("participant_intakes")
        .select("status, created_at, activated_at, exited_at, service_hours_required")
        .eq("organization_id", org_id)
        .order("created_at")
    )
    plans = {
        str(p["id"]): p
        for p in _all(
            sb.table("ndis_plans")
            .select("id, plan_end, status")
            .eq("organization_id", org_id)
            .gte("plan_end", today.isoformat())
            .order("plan_end")
        )
    }
    budgets: list[dict] = []
    if plans:
        for b in _all(
            sb.table("plan_budgets")
            .select("plan_id, allocated_amount, used_amount")
            .eq("organization_id", org_id)
            .in_("plan_id", list(plans))
            .order("plan_id")
        ):
            plan = plans.get(str(b.get("plan_id")))
            if plan and (plan.get("status") or "active") == "active":
                budgets.append({**b, "plan_end": plan.get("plan_end")})
    return PlanInputs(
        shifts=shifts, verifications=verifications, pay=pay, users=users,
        availability=availability, intakes=intakes, budgets=budgets,
    )


def get_workforce_plan(org_id: str, assumptions: Assumptions = Assumptions()) -> dict[str, Any]:
    tz = request_timezone()
    today = app_today(tz)
    return build_plan(load_inputs(org_id, today, tz), today, tz, assumptions)
