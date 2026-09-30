"""Financial Governance figures: periods, what counts as billed/collected/outstanding, cost per session."""
from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import financial_summary_service as fin

TODAY = date(2026, 9, 30)


def test_period_bounds():
    assert fin.period_bounds("month", TODAY)[:2] == (date(2026, 9, 1), date(2026, 9, 30))
    assert fin.period_bounds("quarter", TODAY)[:2] == (date(2026, 7, 1), date(2026, 9, 30))
    assert fin.period_bounds("quarter", date(2026, 2, 3))[:2] == (date(2026, 1, 1), date(2026, 3, 31))
    start, end, label = fin.period_bounds("year", TODAY)
    assert (start, end, label) == (date(2026, 7, 1), date(2027, 6, 30), "FY2026–27")
    assert fin.period_bounds("year", date(2026, 3, 1))[:2] == (date(2025, 7, 1), date(2026, 6, 30))


def test_month_keys_run_oldest_first_and_cross_years():
    assert fin.month_keys(date(2026, 2, 10), 4) == ["2025-11", "2025-12", "2026-01", "2026-02"]


def _inv(**kw):
    return {"status": "sent", "total_cents": 10000, "created_at": "2026-09-05T00:00:00Z", **kw}


def test_what_counts():
    invoices = [
        _inv(status="draft"),                                                    # not raised
        _inv(status="cancelled"),                                                # not raised
        _inv(issued_at="2026-09-10T01:00:00Z"),                                  # outstanding, in period
        _inv(status="sent", due_date="2026-09-20"),                              # overdue
        _inv(status="paid", payment_date="2026-09-12", total_cents=5000),        # collected in period
        _inv(status="paid", payment_date="2026-06-01", total_cents=7000,
             created_at="2026-05-01T00:00:00Z"),                                  # paid before the period
    ]
    months = fin.month_keys(TODAY, 6)
    s = fin.summarise_invoices(invoices, date(2026, 9, 1), date(2026, 9, 30), TODAY, None, months)
    assert s["invoice_count"] == 3
    assert s["billed_cents"] == 25000
    assert s["collected_cents"] == 5000
    assert s["outstanding_cents"] == 20000
    assert s["overdue_cents"] == 10000
    by_month = {m["month"]: m["billed_cents"] for m in s["revenue_by_month"]}
    assert by_month["2026-09"] == 25000 and by_month["2026-05"] == 7000
    assert [m["month"] for m in s["revenue_by_month"]] == months


def test_display_status():
    assert fin.display_status({"status": "sent", "due_date": "2026-09-01"}, TODAY) == "overdue"
    assert fin.display_status({"status": "finalized"}, TODAY) == "outstanding"
    assert fin.display_status({"status": "paid"}, TODAY) == "paid"
    assert fin.display_status({"status": "draft"}, TODAY) == "draft"


def test_labour_cost_nets_reversals_and_counts_costed_shifts():
    client = MagicMock()
    rows = [
        {"shift_id": "s1", "amount_cents": 12000},
        {"shift_id": "s1", "amount_cents": -2000},
        {"shift_id": "s2", "amount_cents": 8000},
    ]
    client.table.return_value.select.return_value.eq.return_value.in_.return_value.execute.return_value = MagicMock(data=rows)
    with patch.object(fin, "get_supabase_admin", return_value=client):
        assert fin.labour_cost("org", ["s1", "s2", "s3"]) == (18000, 2)


def test_only_managing_directors():
    with pytest.raises(HTTPException) as err:
        fin.get_financial_summary({"id": "c1", "role": "support_coordinator", "organization_id": "o"}, "month")
    assert err.value.status_code == 403


def test_summary_has_no_cost_when_nothing_is_costed():
    with patch.object(fin, "get_supabase_admin"), \
         patch("backend.app.services.billing_service._fetch_all", return_value=[]), \
         patch.object(fin, "_completed_shift_ids", return_value=["s1"]), \
         patch.object(fin, "labour_cost", return_value=(0, 0)), \
         patch.object(fin, "app_today", return_value=TODAY):
        result = fin.get_financial_summary({"id": "m", "role": "managing_director", "organization_id": "o"}, "quarter")
    assert result["session_count"] == 1
    assert result["cost_per_session_cents"] is None and result["labour_cost_cents"] is None
    assert result["revenue_by_month"][-1] == {"month": "2026-09", "billed_cents": 0, "current": True}
