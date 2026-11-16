"""Approving a plan-managed invoice emails it to the plan manager (migration 258)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import billing_service

USER = {"id": "u-1", "sub": "u-1", "organization_id": "org-1", "role": "support_coordinator"}
SVC = "backend.app.services.billing_service"


def _invoice(**overrides) -> dict:
    return {
        "id": "inv-1",
        "organization_id": "org-1",
        "invoice_number": "CS-20261117-AB12",
        "participant_id": "p-1",
        "recipient_name": "Clear Plan Management",
        "recipient_email": "accounts@clearplan.example",
        "status": "finalized",
        **overrides,
    }


def _patches(*, enabled=True, plan_type="plan-managed"):
    supabase = MagicMock()
    return supabase, [
        patch(f"{SVC}.plan_manager_auto_email_enabled", return_value=enabled),
        patch(f"{SVC}.get_supabase_admin", return_value=supabase),
        patch(f"{SVC}._enrich_with_service_category", new=AsyncMock(side_effect=lambda _s, rows: [
            {**rows[0], "plan_management_type": plan_type}
        ])),
    ]


async def _run(invoice, previous="draft", **kwargs):
    supabase, patches = _patches(**kwargs)
    send = AsyncMock(return_value={**invoice, "status": "sent"})
    with patch(f"{SVC}.send_invoice", new=send):
        for p in patches:
            p.start()
        try:
            result = await billing_service._auto_email_plan_manager(invoice, previous, USER)
        finally:
            for p in patches:
                p.stop()
    return result, send, supabase


@pytest.mark.asyncio
async def test_approving_a_plan_managed_invoice_emails_the_plan_manager():
    result, send, _ = await _run(_invoice())
    send.assert_awaited_once_with("inv-1", USER, automatic=True)
    assert result["status"] == "sent"


@pytest.mark.asyncio
@pytest.mark.parametrize("plan_type", ["NDIA-managed", "self-managed", None])
async def test_only_plan_managed_invoices_go_on_their_own(plan_type):
    result, send, _ = await _run(_invoice(), plan_type=plan_type)
    send.assert_not_awaited()
    assert result["status"] == "finalized"


@pytest.mark.asyncio
async def test_nothing_is_sent_while_the_setting_is_off():
    _, send, _ = await _run(_invoice(), enabled=False)
    send.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("previous,status", [("finalized", "sent"), ("sent", "overdue"), ("draft", "draft")])
async def test_only_the_approval_itself_sends(previous, status):
    _, send, _ = await _run(_invoice(status=status), previous=previous)
    send.assert_not_awaited()


@pytest.mark.asyncio
async def test_no_plan_manager_email_keeps_it_approved_and_says_why():
    result, send, supabase = await _run(_invoice(recipient_email=None))
    send.assert_not_awaited()
    assert result["status"] == "finalized"
    assert "no plan manager email" in result["auto_email_error"]
    supabase.table.assert_called_with("invoices")
    saved = supabase.table.return_value.update.call_args.args[0]
    assert "no plan manager email" in saved["auto_email_error"]


@pytest.mark.asyncio
async def test_a_failed_send_never_undoes_the_approval():
    supabase, patches = _patches()
    failing = AsyncMock(side_effect=HTTPException(status_code=503, detail="Invoice email isn't available yet."))
    with patch(f"{SVC}.send_invoice", new=failing):
        for p in patches:
            p.start()
        try:
            result = await billing_service._auto_email_plan_manager(_invoice(), "draft", USER)
        finally:
            for p in patches:
                p.stop()
    assert result["status"] == "finalized"
    assert "Invoice email isn't available yet." in result["auto_email_error"]


@pytest.mark.asyncio
async def test_an_unexpected_error_is_caught_too():
    supabase, patches = _patches()
    with patch(f"{SVC}.send_invoice", new=AsyncMock(side_effect=RuntimeError("smtp down"))):
        for p in patches:
            p.start()
        try:
            result = await billing_service._auto_email_plan_manager(_invoice(), "draft", USER)
        finally:
            for p in patches:
                p.stop()
    assert "Press Email" in result["auto_email_error"]
    assert "smtp" not in result["auto_email_error"]


def test_setting_reads_false_when_the_column_is_missing():
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.side_effect = Exception(
        "column organizations.auto_email_plan_managers does not exist"
    )
    with patch(f"{SVC}.get_supabase_admin", return_value=db):
        assert billing_service.plan_manager_auto_email_enabled("org-1") is False


@pytest.mark.asyncio
async def test_workers_cant_change_the_setting():
    worker = {**USER, "role": "support_worker"}
    with pytest.raises(HTTPException) as exc:
        await billing_service.set_plan_manager_auto_email(worker, True)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_changing_the_setting_is_audited():
    db = MagicMock()
    with patch(f"{SVC}.get_supabase_admin", return_value=db), \
            patch(f"{SVC}.plan_manager_auto_email_enabled", return_value=False), \
            patch(f"{SVC}.audit_service.log_action", new=AsyncMock()) as log:
        result = await billing_service.set_plan_manager_auto_email(USER, True)
    assert result == {"enabled": True}
    db.table.return_value.update.assert_called_once_with({"auto_email_plan_managers": True})
    assert log.await_args.kwargs["after_state"] == {"enabled": True}
