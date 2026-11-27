"""Quill credits: cost of an answer, allowance then bought credits, the
ceilings that protect CareCliQ's AI bill, and Stripe top-ups."""
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from backend.app.services import quill_credits as qc
from backend.app.services.chatbox import blocks as chatbox_blocks
from backend.app.services.chatbox import llm as chatbox_llm
from backend.app.services.chatbox import tools as chatbox_tools


def _usage(model="gpt-4o-mini", inp=9000, cached=0, out=300):
    return qc.ModelUsage(model=model, input_tokens=inp, cached_input_tokens=cached, output_tokens=out)


def test_an_ordinary_question_costs_about_one_credit():
    # As measured: two steps of ~4k tokens, mostly read from cache.
    credits = qc.credits_for([_usage(inp=4000, cached=3300, out=150), _usage(inp=4100, cached=3400, out=200)])
    assert Decimal("0.5") <= credits <= Decimal("1.5")


def test_cached_input_is_cheaper():
    assert qc.cost_usd(_usage(cached=8000)) < qc.cost_usd(_usage())


def test_people_pay_the_standard_rate_even_when_the_fallback_answered():
    opus = _usage(model="claude-opus-5-5")
    mini = _usage(model="gpt-4o-mini")
    assert qc.credits_for([opus]) == qc.credits_for([mini])
    # ...but the real cost recorded against the ceilings is the fallback's.
    assert qc.cost_usd(opus) > 20 * qc.cost_usd(mini)


def test_an_unknown_model_is_priced_as_the_dearest_one():
    assert qc.cost_usd(_usage(model="some-new-model")) == qc.cost_usd(_usage(model="claude-opus-5-5"))


def test_no_model_call_means_no_charge():
    assert qc.credits_for([]) == 0


def test_allowance_renews_on_the_first_in_adelaide():
    # 31 Oct 14:00 UTC is already 1 Nov in Adelaide.
    assert qc.period_start(datetime(2026, 10, 31, 14, 0, tzinfo=timezone.utc)) == date(2026, 11, 1)
    assert qc.next_renewal(date(2026, 12, 1)) == date(2027, 1, 1)


def test_plan_allowances_and_unknown_plans():
    assert qc.plan_allowance("small") == (1000, 8000)
    assert qc.plan_allowance("medium") == (1000, 20000)
    assert qc.plan_allowance(None) == qc.plan_allowance("small")


def test_allowance_can_be_changed_by_setting(monkeypatch):
    monkeypatch.setenv("QUILL_SMALL_PERSON_CREDITS", "250")
    assert qc.plan_allowance("small")[0] == 250


def test_the_org_cost_ceiling_follows_the_plan():
    assert qc.org_cost_cap_usd(8000) == 20.0
    assert qc.org_cost_cap_usd(100) == 5.0


def _status(**kw):
    base = dict(
        period_start=date(2026, 11, 1), renews_on=date(2026, 12, 1), allowance=1000,
        allowance_used=0, allowance_left=1000, org_allowance=8000, org_used=0,
        topup_balance=0, remaining=1000, packs_bought_this_month=0, paused_reason=None,
    )
    base.update(kw)
    return qc.CreditStatus(**base)


def test_out_of_credits_is_a_402_with_the_balance():
    with patch.object(qc, "credit_status", return_value=_status(allowance_left=0, remaining=0, allowance_used=1000)):
        with pytest.raises(qc.OutOfCredits) as exc:
            qc.ensure_can_ask("u1", "o1")
    assert exc.value.status_code == 402
    assert "1 December" in exc.value.detail["message"]
    assert exc.value.detail["credits"]["can_ask"] is False


def test_a_paused_quill_refuses_even_with_credits_left():
    with patch.object(qc, "credit_status", return_value=_status(paused_reason="paused")):
        with pytest.raises(qc.OutOfCredits):
            qc.ensure_can_ask("u1", "o1")


def test_a_database_hiccup_does_not_take_quill_down():
    with patch.object(qc, "credit_status", side_effect=RuntimeError("db down")):
        assert qc.ensure_can_ask("u1", "o1") is None


def _admin_with_totals(totals, topups=(), plan="small"):
    sb = MagicMock()

    def table(name):
        t = MagicMock()
        chain = t.select.return_value
        for m in ("eq", "gt", "order", "limit"):
            getattr(chain, m).return_value = chain
        data = [{"plan_tier": plan}] if name == "organizations" else list(topups)
        chain.execute.return_value = SimpleNamespace(data=data)
        return t

    sb.table.side_effect = table
    sb.rpc.return_value.execute.return_value = SimpleNamespace(data=[totals])
    return sb


def _totals(**kw):
    base = dict(user_included=0, org_included=0, org_cost_usd=0, user_topup_used=0, global_cost_usd=0)
    base.update(kw)
    return base


def test_bought_credits_are_used_after_the_allowance():
    topups = [{"credits": 400, "created_at": "2026-11-10T00:00:00+00:00", "expires_at": "2027-11-10T00:00:00+00:00"}]
    sb = _admin_with_totals(_totals(user_included=1000, user_topup_used=50), topups)
    with patch.object(qc, "get_supabase_admin", return_value=sb):
        st = qc.credit_status("u1", "o1", now=datetime(2026, 11, 20, tzinfo=timezone.utc))
    assert st.allowance_left == 0
    assert st.topup_balance == 350
    assert st.remaining == 350
    assert st.packs_bought_this_month == 1


def test_the_organisation_cap_limits_everyone_s_allowance():
    sb = _admin_with_totals(_totals(user_included=10, org_included=8000))
    with patch.object(qc, "get_supabase_admin", return_value=sb):
        st = qc.credit_status("u1", "o1")
    assert st.allowance_left == 0


def test_real_cost_ceilings_pause_quill():
    sb = _admin_with_totals(_totals(org_cost_usd=21))
    with patch.object(qc, "get_supabase_admin", return_value=sb):
        assert "organisation" in qc.credit_status("u1", "o1").paused_reason
    sb = _admin_with_totals(_totals(global_cost_usd=301))
    with patch.object(qc, "get_supabase_admin", return_value=sb):
        assert "everyone" in qc.credit_status("u1", "o1").paused_reason


def test_usage_splits_between_allowance_and_bought_credits():
    sb = MagicMock()
    with patch.object(qc, "get_supabase_admin", return_value=sb), \
         patch.object(qc, "credit_status", return_value=_status()):
        qc.record_usage(
            user_id="u1", organization_id="o1", thread_id="t1", provider="openai",
            usages=[_usage(inp=60_000, out=2000)], before=_status(allowance_left=3),
        )
    row = sb.table.return_value.insert.call_args[0][0]
    assert Decimal(row["credits"]) > 3
    assert Decimal(row["from_topup"]) == Decimal(row["credits"]) - 3
    assert row["input_tokens"] == 60_000


def test_a_topup_is_applied_once_and_only_when_paid():
    sb = MagicMock()
    session = {
        "id": "cs_1", "payment_status": "paid", "amount_subtotal": 500, "currency": "aud",
        "metadata": {"kind": "quill_topup", "user_id": "u1", "organization_id": "o1", "credits": "400"},
    }
    with patch.object(qc, "get_supabase_admin", return_value=sb):
        qc.apply_topup({**session, "payment_status": "unpaid"})
        sb.table.return_value.insert.assert_not_called()
        qc.apply_topup(session)
        row = sb.table.return_value.insert.call_args[0][0]
        assert row["credits"] == 400 and row["stripe_checkout_session_id"] == "cs_1"
        sb.table.return_value.insert.return_value.execute.side_effect = Exception("duplicate key value 23505")
        qc.apply_topup(session)  # a repeated webhook is a no-op, not an error


def test_the_stripe_webhook_routes_credit_packs():
    from backend.app.services import stripe_service

    with patch.object(qc, "apply_topup") as apply, \
         patch.object(stripe_service, "_create_org_from_signup") as signup:
        stripe_service._dispatch_event("checkout.session.completed", {"metadata": {"kind": "quill_topup"}})
        stripe_service._dispatch_event("checkout.session.async_payment_succeeded", {"metadata": {"kind": "quill_topup"}})
    assert apply.call_count == 2
    signup.assert_not_called()


def test_the_model_callback_records_token_use():
    sink: list = []
    meter = chatbox_llm.MeterModelCalls(sink, "gpt-4o-mini")
    message = SimpleNamespace(usage_metadata={
        "input_tokens": 1200, "output_tokens": 80, "input_token_details": {"cache_read": 1000},
    })
    meter.on_llm_end(SimpleNamespace(generations=[[SimpleNamespace(message=message)]]))
    assert sink == [qc.ModelUsage("gpt-4o-mini", 1200, 1000, 0, 80)]


def _user(role):
    return {"id": "u1", "role": role, "organization_id": "o1"}


def test_invoices_are_for_the_director_only_and_documents_for_everyone():
    md = {t.name for t in chatbox_tools.build_tools_for_user(_user("managing_director"), "t1")}
    with patch.object(chatbox_tools, "get_coordinator_team_ids", return_value=[]), \
         patch.object(chatbox_tools, "quill_client", return_value=MagicMock()):
        coord = {t.name for t in chatbox_tools.build_tools_for_user(_user("support_coordinator"), "t1")}
    assert "get_unpaid_invoices" in md and "get_unpaid_invoices" not in coord
    for name in ("draft_document", "get_open_incidents", "get_plan_reviews_due", "get_unfilled_shifts"):
        assert name in md and name in coord


def test_a_drafted_document_becomes_a_document_block():
    blocks = chatbox_blocks.build_blocks("draft_document", {
        "title": "Shift handover", "document_type": "template", "content": "# Shift handover\n\n- [Name]",
    })
    assert blocks == [{
        "type": "document", "title": "Shift handover", "document_type": "template",
        "content": "# Shift handover\n\n- [Name]", "section": "Document",
    }]


def test_unpaid_invoices_show_money_and_overdue_rows():
    blocks = chatbox_blocks.build_blocks("get_unpaid_invoices", {
        "unpaid_count": 1, "total_owed_aud": 1250.5, "overdue_aud": 1250.5,
        "invoices": [{"invoice": "INV-1", "participant": "Jo", "amount_aud": 1250.5, "due": "01 Nov 2026", "days_overdue": 26}],
    })
    assert blocks[0]["value"] == "$1,250.50"
    table = blocks[-1]
    assert table["rows"][0][4] == "Overdue" and table["rows"][0][5] == "26 days"


def test_a_report_written_into_the_reply_becomes_a_document():
    from backend.app.services.chatbox.graph import document_from_reply

    report = "# Monthly Report - November\n\n## Finances\n" + "- **Billed:** $441.48\n" * 40
    reply, blocks = document_from_reply(report, [{"type": "stat", "label": "x", "value": 1}])
    assert blocks[-1]["type"] == "document" and blocks[-1]["title"] == "Monthly Report - November"
    assert "Monthly Report - November" in reply and len(reply) < 200


def test_an_ordinary_answer_is_left_alone():
    from backend.app.services.chatbox.graph import document_from_reply

    answer = "Three workers are on shift.\n\n- **Roster:** Tom Walsh starts at 3 pm."
    assert document_from_reply(answer, []) == (answer, [])
