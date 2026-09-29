"""MD hub demand vs capacity — real figures instead of the placeholder cards."""
from __future__ import annotations

from datetime import date

from backend.app.services.demand_capacity_service import (
    compute_capacity,
    waitlist_summary,
    week_bounds,
)

WEEK_START = date(2026, 9, 28)  # Monday
MON_TO_FRI = [1, 2, 3, 4, 5]


def test_week_bounds_are_monday_to_sunday():
    assert week_bounds(date(2026, 10, 1)) == (WEEK_START, date(2026, 10, 4))
    assert week_bounds(WEEK_START) == (WEEK_START, date(2026, 10, 4))


def test_waitlist_counts_only_unscreened_enquiries_and_their_hours():
    intakes = [
        {"status": "enquiry", "service_hours_required": 10},
        {"status": "enquiry", "service_hours_required": None},  # hours not captured
        {"status": "screening", "service_hours_required": 20},
        {"status": "active", "service_hours_required": 30},
    ]
    assert waitlist_summary(intakes) == {"count": 2, "hours": 10.0}


def test_spare_hours_split_by_reliability_and_net_of_roster():
    workers = [
        {"id": "pt", "employment_type": "part_time"},
        {"id": "ft", "employment_type": "full_time"},
        {"id": "cas", "employment_type": "casual"},
        {"id": "unset", "employment_type": None},
        {"id": "no-avail", "employment_type": "part_time"},
    ]
    availability = {
        "pt": {"max_hours_per_week": 20, "available_days": MON_TO_FRI},
        "ft": {"max_hours_per_week": 38, "available_days": MON_TO_FRI},
        "cas": {"max_hours_per_week": 15, "available_days": MON_TO_FRI},
        "unset": {"max_hours_per_week": 10, "available_days": MON_TO_FRI},
    }
    shifts = [
        {"worker_id": "pt", "status": "scheduled", "duration_minutes": 480},
        {"worker_id": "ft", "status": "completed", "duration_minutes": 38 * 60},  # fully booked
        {"worker_id": "cas", "status": "cancelled", "duration_minutes": 600},  # doesn't count
        {"worker_id": "cas", "status": "scheduled",
         "scheduled_start": "2026-09-29T09:00:00+09:30", "scheduled_end": "2026-09-29T14:00:00+09:30"},
    ]
    cap = compute_capacity(workers, availability, shifts, [], WEEK_START)
    assert cap.reliable_hours == 12.0  # part-timer 20 - 8; full-timer fully booked
    assert cap.casual_hours == 20.0  # casual 15 - 5, unset employment type 10
    assert cap.workers_counted == 4
    assert cap.workers_without_availability == 1


def test_unavailability_days_reduce_capacity():
    workers = [{"id": "pt", "employment_type": "part_time"}]
    availability = {"pt": {"max_hours_per_week": 20, "available_days": MON_TO_FRI}}
    # Leave Wed–Thu of a Mon–Fri availability: 3 of 5 days remain.
    blackouts = [{"user_id": "pt", "start_date": "2026-09-30", "end_date": "2026-10-01"}]
    cap = compute_capacity(workers, availability, [], blackouts, WEEK_START)
    assert cap.reliable_hours == 12.0


def test_overbooked_worker_contributes_zero_not_negative():
    workers = [{"id": "pt", "employment_type": "part_time"}]
    availability = {"pt": {"max_hours_per_week": 10, "available_days": MON_TO_FRI}}
    shifts = [{"worker_id": "pt", "status": "scheduled", "duration_minutes": 900}]
    assert compute_capacity(workers, availability, shifts, [], WEEK_START).reliable_hours == 0.0
