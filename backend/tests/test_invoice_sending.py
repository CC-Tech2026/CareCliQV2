from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import billing_service, email_service

USER = {"id": "u-1", "sub": "u-1", "organization_id": "org-1", "role": "support_coordinator"}
SVC = "backend.app.services.billing_service"


def _invoice(**overrides) -> dict:
    return {
        "id": "inv-1",
        "organization_id": "org-1",
        "invoice_number": "CS-20261103-AB12",
        "participant_id": "p-1",
        "recipient_name": "Clear Plan Management",
        "recipient_email": "accounts@clearplan.example",
        "status": "finalized",
        "due_date": "2026-11-17",
        "total_cents": 22074,
        "line_items": [{"service_date_from": "2026-10-04", "service_date_to": "2026-10-25"}],
        **overrides,
    }


def _send_patches(invoice: dict, plan_type: str = "plan-managed"):
    supabase = MagicMock()
    supabase.storage.from_.return_value.download.return_value = b"%PDF-1.7 test"
    supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = (
        MagicMock(data=[{"full_name": "Liam Carter"}])
    )
    return supabase, [
        patch(f"{SVC}.get_invoice", new=AsyncMock(return_value=invoice)),
        patch(f"{SVC}.get_supabase_admin", return_value=supabase),
        patch(f"{SVC}._enrich_with_service_category", new=AsyncMock(side_effect=lambda _s, rows: [
            {**rows[0], "plan_management_type": plan_type}
        ])),
        patch(f"{SVC}.generate_invoice_pdf", new=AsyncMock(return_value={**invoice, "pdf_path": "org-1/inv-1/x.pdf"})),
        patch(f"{SVC}.get_letterhead", return_value={
            "provider_name": "Harbourside Care", "logo_url": None, "brand_accent_color": "#4B3F91",
            "email": "billing@harbourside.example", "phone": "08 8000 0000",
        }),
        patch(f"{SVC}.update_invoice", new=AsyncMock(return_value={**invoice, "status": "sent"})),
        patch(f"{SVC}.audit_service.log_action", new=AsyncMock()),
        patch(f"{SVC}.app_today", return_value=date(2026, 11, 3)),
        patch.object(email_service, "delivery_state", return_value=email_service.EmailDelivery(status="queued")),
    ]


@pytest.mark.asyncio
async def test_sending_emails_the_pdf_to_the_payer_and_marks_it_sent():
    invoice = _invoice()
    _, patches = _send_patches(invoice)
    with patch.object(email_service, "send_email") as send:
        for p in patches:
            p.start()
        try:
            result = await billing_service.send_invoice("inv-1", USER)
        finally:
            patch.stopall()
    kwargs = send.call_args.kwargs
    assert kwargs["to_email"] == "accounts@clearplan.example"
    assert kwargs["subject"] == "Invoice CS-20261103-AB12 from Harbourside Care"
    assert kwargs["reply_to"] == "billing@harbourside.example"
    assert kwargs["attachments"] == [("CS-20261103-AB12.pdf", b"%PDF-1.7 test", "application/pdf")]
    assert "$220.74" in kwargs["text_body"]
    assert "4 October 2026 to 25 October 2026" in kwargs["text_body"]
    assert "Liam Carter" in kwargs["text_body"]
    assert result["status"] == "sent"


@pytest.mark.asyncio
async def test_a_reminder_says_how_overdue_and_keeps_the_status():
    invoice = _invoice(status="sent", due_date="2026-10-27")
    _, patches = _send_patches(invoice)
    with patch.object(email_service, "send_email") as send:
        for p in patches:
            p.start()
        try:
            await billing_service.send_invoice("inv-1", USER, reminder=True)
            update = billing_service.update_invoice
        finally:
            patch.stopall()
    assert send.call_args.kwargs["subject"] == "Reminder: invoice CS-20261103-AB12 from Harbourside Care"
    assert "7 days past due" in send.call_args.kwargs["text_body"]
    update.assert_not_awaited()


@pytest.mark.parametrize(
    ("overrides", "plan_type", "kwargs", "status_code"),
    [
        ({"status": "draft"}, "plan-managed", {}, 409),
        ({}, "NDIA-managed", {}, 409),
        ({"recipient_email": None}, "self-managed", {}, 422),
        ({"status": "finalized"}, "plan-managed", {"reminder": True}, 409),
        ({"status": "sent"}, "plan-managed", {"to_email": "someone@else.example"}, 409),
    ],
)
@pytest.mark.asyncio
async def test_sending_refuses_what_it_should(overrides, plan_type, kwargs, status_code):
    invoice = _invoice(**overrides)
    _, patches = _send_patches(invoice, plan_type)
    with patch.object(email_service, "send_email") as send:
        for p in patches:
            p.start()
        try:
            with pytest.raises(HTTPException) as exc:
                await billing_service.send_invoice("inv-1", USER, **kwargs)
        finally:
            patch.stopall()
    assert exc.value.status_code == status_code
    send.assert_not_called()


@pytest.mark.asyncio
async def test_a_failed_email_is_not_recorded_as_sent():
    invoice = _invoice()
    _, patches = _send_patches(invoice)
    with patch.object(email_service, "send_email", side_effect=OSError("smtp down")):
        for p in patches:
            p.start()
        try:
            with pytest.raises(HTTPException) as exc:
                await billing_service.send_invoice("inv-1", USER)
            update = billing_service.update_invoice
        finally:
            patch.stopall()
    assert exc.value.status_code == 502
    update.assert_not_awaited()


@pytest.mark.asyncio
async def test_approving_without_a_due_date_sets_one_from_the_payment_terms():
    existing = _invoice(status="draft", due_date=None)
    supabase = MagicMock()
    supabase.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{**existing, "status": "finalized"}]
    )
    with patch(f"{SVC}.get_invoice", new=AsyncMock(return_value=existing)), \
         patch(f"{SVC}.get_supabase_admin", return_value=supabase), \
         patch(f"{SVC}._enforce_price_limits"), \
         patch(f"{SVC}.audit_service.log_action", new=AsyncMock()), \
         patch(f"{SVC}.app_today", return_value=date(2026, 11, 3)):
        await billing_service.update_invoice("inv-1", USER, {"status": "finalized"})
    payload = supabase.table.return_value.update.call_args.args[0]
    assert payload["due_date"] == "2026-11-17"
