"""Workforce planning maths, on small data that can be checked by hand."""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from backend.app.services import workforce_planning_service as wp

TZ = ZoneInfo("Australia/Adelaide")
TODAY = date(2026, 11, 18)  # a Wednesday; this week starts Mon 16 Nov
THIS_WEEK = date(2026, 11, 16)


def at(day: date, hour: int = 9) -> str:
    return datetime(day.year, day.month, day.day, hour, 0, tzinfo=TZ).isoformat()


def shift(sid: str, day: date, hours: float, status: str = "completed", worker: str = "w1") -> dict:
    start = datetime(day.year, day.month, day.day, 9, 0, tzinfo=TZ)
    return {
        "id": sid, "worker_id": worker, "status": status,
        "scheduled_start": start.isoformat(),
        "scheduled_end": (start + timedelta(hours=hours)).isoformat(),
        "duration_minutes": None,
    }


def worker(wid: str, employment: str = "casual", created: date = date(2025, 1, 1), left: date | None = None) -> dict:
    return {
        "id": wid, "role": "support_worker", "employment_type": employment,
        "is_active": left is None, "created_at": at(created), "deactivated_at": at(left) if left else None,
    }


def weekly_history(hours_by_week: list[float]) -> list[dict]:
    """One completed shift per past week, oldest first, ending last week."""
    out = []
    for i, h in enumerate(hours_by_week):
        day = THIS_WEEK - timedelta(weeks=len(hours_by_week) - i) + timedelta(days=1)
        if h:
            out.append(shift(f"h{i}", day, h))
    return out


def test_linear_trend_is_least_squares():
    intercept, slope = wp.linear_trend([10, 12, 14, 16])
    assert (round(intercept, 6), round(slope, 6)) == (10, 2)
    assert wp.linear_trend([5]) == (5, 0.0)


def test_demand_capacity_and_hiring():
    # 12 weeks rising 10 -> 32 hours (2 h a week), 2 workers of 20 h.
    history = weekly_history([10 + 2 * i for i in range(12)])
    inputs = wp.PlanInputs(
        shifts=history,
        users=[worker("w1"), worker("w2", "part_time")],
        availability={"w1": {"max_hours_per_week": 20}, "w2": {"max_hours_per_week": 20}},
    )
    plan = wp.build_plan(inputs, TODAY, TZ)

    # Current demand = average of the last 4 complete weeks: (26+28+30+32)/4.
    assert plan["demand"]["current_weekly_hours"] == 29.0
    assert plan["demand"]["trend_hours_per_week"] == 2.0
    # Staff time 40 h; 29/40 used.
    assert plan["capacity"]["staff_hours"] == 40.0
    assert plan["capacity"]["reliable_hours"] == 20.0
    assert plan["capacity"]["utilisation_pct"] == 72.5
    # Forecast this week continues the line: 10 + 2*12 = 34 h against
    # 40 * 85% = 34 usable, so the gap starts the week after.
    first = plan["forecast"][0]
    assert first["demand_hours"] == 34.0 and first["usable_hours"] == 34.0
    last = plan["forecast"][-1]
    assert last["demand_hours"] == 56.0  # 10 + 2*23
    hiring = plan["hiring"]
    assert hiring["needed"] is True
    assert hiring["hours_short"] == 22.0  # 56 - 34
    # 22 h short / (20 h a worker x 85%) = 1.29 -> 2 workers; 22/38 FTE.
    assert hiring["workers"] == 2
    assert hiring["fte"] == 0.6
    assert hiring["short_from"] == "2026-11-23"
    # Default 4 weeks to hire, but never before this week.
    assert hiring["hire_by"] == THIS_WEEK.isoformat()


def test_workers_without_hours_count_at_the_team_average():
    inputs = wp.PlanInputs(
        users=[worker("w1"), worker("w2"), worker("w3")],
        availability={"w1": {"max_hours_per_week": 30}, "w2": {"max_hours_per_week": 10}},
    )
    cap = wp.build_plan(inputs, TODAY, TZ)["capacity"]
    assert cap["staff_hours"] == 60.0  # 30 + 10 + average 20
    assert cap["workers_without_hours"] == 1


def test_wage_per_hour_uses_net_pay_over_shift_length():
    # One 4 h shift paid in overlapping parts (base + casual loading on the
    # same hours); another shift paid then fully reversed.
    shifts = [shift("s1", THIS_WEEK - timedelta(days=6), 4), shift("s2", THIS_WEEK - timedelta(days=5), 3)]
    pay = [
        {"shift_id": "s1", "amount_cents": 16000, "hours_applied": 4, "created_at": at(TODAY)},
        {"shift_id": "s1", "amount_cents": 4000, "hours_applied": 4, "created_at": at(TODAY)},
        {"shift_id": "s2", "amount_cents": 12000, "hours_applied": 3, "created_at": at(TODAY)},
        {"shift_id": "s2", "amount_cents": -12000, "hours_applied": None, "created_at": at(TODAY)},
    ]
    verifications = [{"shift_id": "s1", "billed_amount": 280, "reversed_at": None, "verified_at": at(TODAY)}]
    fin = wp.build_plan(wp.PlanInputs(shifts=shifts, pay=pay, verifications=verifications), TODAY, TZ)["finance"]
    # $200 for 4 hours = $50/h (not $25/h from adding up 8 "hours").
    assert fin["wage_per_hour"] == 50.0
    assert fin["loaded_wage_per_hour"] == 57.5  # + 15% on-costs
    assert fin["revenue_per_hour"] == 70.0
    assert fin["margin_per_hour"] == 12.5
    assert fin["margin_pct"] == pytest.approx(17.9, abs=0.05)
    assert fin["wage_source"] == "pay records"


def test_an_entered_wage_is_used_only_without_pay_records():
    shifts = weekly_history([0] * 8 + [10, 10, 10, 10])
    fin = wp.build_plan(wp.PlanInputs(shifts=shifts), TODAY, TZ, wp.Assumptions(wage_per_hour=40))["finance"]
    assert fin["wage_source"] == "entered"
    assert fin["weekly_wages"] == 400.0  # 10 h a week at $40
    assert fin["weekly_wages_loaded"] == 460.0


def test_pipeline_conversion_and_timing():
    created = datetime(2026, 9, 1, tzinfo=timezone.utc)
    intakes = [
        {"status": "active", "created_at": created.isoformat(), "activated_at": (created + timedelta(days=21)).isoformat(), "service_hours_required": 5},
        {"status": "active", "created_at": created.isoformat(), "activated_at": (created + timedelta(days=14)).isoformat(), "service_hours_required": 5},
        {"status": "active", "created_at": created.isoformat(), "activated_at": (created + timedelta(days=10)).isoformat(), "service_hours_required": 5},
        {"status": "declined", "created_at": created.isoformat(), "activated_at": None, "service_hours_required": 5},
        {"status": "withdrawn", "created_at": created.isoformat(), "activated_at": None, "service_hours_required": 5},
        {"status": "enquiry", "created_at": created.isoformat(), "activated_at": None, "service_hours_required": 10},
    ]
    pipe = wp.build_plan(wp.PlanInputs(intakes=intakes), TODAY, TZ)["demand"]["pipeline"]
    assert pipe["conversion_pct"] == 60.0  # 3 of 5 decided
    assert pipe["open_enquiries"] == 1
    assert pipe["expected_hours"] == 6.0  # 10 h requested x 60%
    assert pipe["starts_in_weeks"] == 2  # median 14 days -> 2 weeks


def test_too_few_conversions_fall_back_to_stated_defaults():
    created = datetime(2026, 9, 1, tzinfo=timezone.utc)
    intakes = [{"status": "enquiry", "created_at": created.isoformat(), "activated_at": None, "service_hours_required": 8}]
    plan = wp.build_plan(wp.PlanInputs(intakes=intakes), TODAY, TZ)
    assert plan["demand"]["pipeline"]["conversion_pct"] == 50.0
    assert plan["demand"]["pipeline"]["starts_in_weeks"] == 4  # 28 days
    assert plan["assumptions"]["measured"]["conversion"] is False


def test_funding_supports_hours():
    shifts = [shift("s1", THIS_WEEK - timedelta(days=6), 2)]
    verifications = [{"shift_id": "s1", "billed_amount": 140, "reversed_at": None, "verified_at": at(TODAY)}]
    budgets = [{"plan_end": (TODAY + timedelta(weeks=10)).isoformat(), "allocated_amount": 10000, "used_amount": 3000}]
    funding = wp.build_plan(wp.PlanInputs(shifts=shifts, verifications=verifications, budgets=budgets), TODAY, TZ)["funding"]
    assert funding["weekly_dollars"] == 700.0  # $7,000 left over 10 weeks
    assert funding["weekly_hours"] == 10.0  # at $70 an hour


def test_attrition_shrinks_staff_time():
    users = [worker(f"w{i}") for i in range(4)] + [worker("gone", left=TODAY - timedelta(days=30))]
    availability = {f"w{i}": {"max_hours_per_week": 25} for i in range(4)}
    plan = wp.build_plan(wp.PlanInputs(users=users, availability=availability), TODAY, TZ)
    # 1 left against an average headcount of 4.5 -> 22.2% a year.
    assert plan["capacity"]["annual_attrition_pct"] == 22.2
    assert plan["forecast"][-1]["staff_hours"] < plan["forecast"][0]["staff_hours"] == 100.0
    assert plan["hiring"]["expected_leavers"] > 0


class _Q:
    def __init__(self, table, log):
        self.table, self.log, self.filters = table, log, []

    def select(self, *_a):
        return self

    def eq(self, col, val):
        self.filters.append((col, val))
        return self

    def gte(self, *_a):
        return self

    lt = in_ = order = gte

    def range(self, *_a):
        return self

    def execute(self):
        self.log.append((self.table, list(self.filters)))
        return type("R", (), {"data": []})()


class _SB:
    def __init__(self):
        self.log = []

    def table(self, name):
        return _Q(name, self.log)


def test_every_query_is_limited_to_the_one_organisation(monkeypatch):
    sb = _SB()
    monkeypatch.setattr(wp, "get_supabase_admin", lambda: sb)
    wp.load_inputs("org-a", TODAY, TZ)
    assert sb.log, "nothing was read"
    for table, filters in sb.log:
        assert ("organization_id", "org-a") in filters, f"{table} read without the organisation filter"
    with pytest.raises(ValueError):
        wp.load_inputs("", TODAY, TZ)
