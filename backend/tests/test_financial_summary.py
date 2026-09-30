"""Financial Governance figures: periods, what counts as billed/collected/outstanding, cost per session."""
from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

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
    return {"id": kw.pop("id", "i"), "status": "sent", "total_cents": 10000, "created_at": "2026-09-05T00:00:00Z", **kw}


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


def _summary(settings=None, shift_months=None, wages=None, invoices=None, period="quarter"):
    with patch.object(fin, "get_supabase_admin"), \
         patch("backend.app.services.billing_service._fetch_all", return_value=invoices or []), \
         patch.object(fin, "_completed_shift_months", return_value=shift_months or {}), \
         patch.object(fin, "wages_by_shift", return_value=wages or {}), \
         patch.object(fin, "load_settings", return_value=settings or {}), \
         patch.object(fin, "app_today", return_value=TODAY):
        return fin.get_financial_summary({"id": "m", "role": "managing_director", "organization_id": "o"}, period)


def test_summary_has_no_cost_when_nothing_is_costed():
    result = _summary(shift_months={"s1": "2026-09"})
    assert result["session_count"] == 1
    assert result["cost_per_session_cents"] is None and result["labour_cost_cents"] is None
    last = result["revenue_by_month"][-1]
    assert last["month"] == "2026-09" and last["billed_cents"] == 0 and last["current"] is True
    assert last["net_cents"] is None
    pl = result["profit_and_loss"]
    assert pl["net_profit_cents"] is None and pl["overheads_set"] is False
    assert result["cash"]["runway_months"] is None


def test_profit_counts_wages_and_overheads_for_the_period():
    invoices = [
        _inv(status="paid", issued_at="2026-08-05T00:00:00Z", payment_date="2026-08-20", total_cents=1_000_000),
        _inv(issued_at="2026-09-05T00:00:00Z", total_cents=500_000),
        _inv(issued_at="2026-05-05T00:00:00Z", total_cents=900_000),  # before the quarter
    ]
    result = _summary(
        settings={"monthly_overheads_cents": 100_000, "cash_on_hand_cents": 3_000_000, "cash_as_of": "2026-09-29"},
        shift_months={"a": "2026-08", "b": "2026-09", "c": "2026-05"},
        wages={"a": 400_000, "b": 300_000, "c": 999_999},
        invoices=invoices,
    )
    pl = result["profit_and_loss"]
    assert pl["revenue_cents"] == 1_500_000
    assert pl["wages_cents"] == 700_000          # quarter shifts only
    assert pl["overheads_cents"] == 300_000      # Jul, Aug, Sep
    assert pl["net_profit_cents"] == 500_000
    assert pl["margin_pct"] == 33.3
    assert pl["wages_complete"] is True
    aug = next(m for m in result["revenue_by_month"] if m["month"] == "2026-08")
    assert aug == {"month": "2026-08", "billed_cents": 1_000_000, "collected_cents": 1_000_000, "wages_cents": 400_000,
                   "overheads_cents": 100_000, "net_cents": 500_000, "current": False, "future": False}


def test_year_view_leaves_future_months_empty():
    result = _summary(settings={"monthly_overheads_cents": 100_000}, period="year")
    months = result["revenue_by_month"]
    assert months[0]["month"] == "2026-07" and months[-1]["month"] == "2027-06"
    assert months[-1]["future"] is True and months[-1]["overheads_cents"] is None and months[-1]["net_cents"] is None
    assert result["profit_and_loss"]["overheads_cents"] == 300_000  # Jul–Sep so far


def _m(month, net, wages=None, overheads=0):
    return {"month": month, "net_cents": net, "wages_cents": wages, "overheads_cents": overheads}


def test_runway_from_the_last_three_complete_months():
    monthly = [_m("2026-05", 999), _m("2026-06", -100_000, 200_000), _m("2026-07", -200_000, 300_000),
               _m("2026-08", -300_000, 400_000), _m("2026-09", -9_999_999, 1)]
    cash = fin.cash_position({"cash_on_hand_cents": 1_200_000, "cash_as_of": "2026-09-29"}, monthly, "2026-09")
    assert cash["basis_months"] == ["2026-06", "2026-07", "2026-08"]
    assert cash["avg_monthly_net_cents"] == -200_000
    assert cash["runway_months"] == 6.0
    assert cash["covers_months"] == 4.0
    assert cash["cash_positive"] is False


def test_a_profitable_business_has_no_runway_limit():
    monthly = [_m("2026-07", 50_000, 100_000), _m("2026-08", 10_000, 100_000)]
    cash = fin.cash_position({"cash_on_hand_cents": 500_000}, monthly, "2026-09")
    assert cash["runway_months"] is None and cash["cash_positive"] is True and cash["covers_months"] == 5.0
    # No cash entered: nothing to divide.
    assert fin.cash_position({}, monthly, "2026-09")["covers_months"] is None


@pytest.mark.asyncio
async def test_settings_are_md_only_and_audited():
    with pytest.raises(HTTPException) as err:
        await fin.save_settings({"id": "c", "role": "support_coordinator", "organization_id": "o"},
                                cash_on_hand=1, cash_as_of=None, monthly_overheads=None)
    assert err.value.status_code == 403

    client = MagicMock()
    md = {"id": "m", "role": "managing_director", "organization_id": "o"}
    with patch.object(fin, "get_supabase_admin", return_value=client), \
         patch.object(fin, "app_today", return_value=TODAY), \
         patch.object(fin, "load_settings", return_value={}), \
         patch("backend.app.services.audit_service.log_action", new=AsyncMock()) as audit:
        with pytest.raises(HTTPException):
            await fin.save_settings(md, cash_on_hand=1, cash_as_of=date(2026, 10, 1), monthly_overheads=None)
        await fin.save_settings(md, cash_on_hand=12_345.67, cash_as_of=None, monthly_overheads=4_000)
    row = client.table.return_value.upsert.call_args.args[0]
    assert row["cash_on_hand_cents"] == 1_234_567 and row["cash_as_of"] == "2026-09-30"
    assert row["monthly_overheads_cents"] == 400_000
    assert audit.call_args.kwargs["action_type"] == "finance.settings_updated"
