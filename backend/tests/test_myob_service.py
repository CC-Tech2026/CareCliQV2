"""MYOB: approved invoices become MYOB service sales invoices, invoices paid
in MYOB are marked paid here, cancelling deletes the MYOB copy unless paid,
and MYOB and Xero are never connected together."""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException

from backend.app.services import myob_service as ms
from backend.tests.test_xero_service import _DB

ORG = "org-1"
DIRECTOR = {"id": "md-1", "organization_id": ORG, "role": "managing_director"}
COORDINATOR = {"id": "c-1", "organization_id": ORG, "role": "support_coordinator"}
ACCOUNT = "acc-uid-4100"
FRE = "tax-uid-fre"


def _future(minutes=20):
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


CONNECTION = {
    "organization_id": ORG,
    "business_id": "biz-1",
    "business_name": "Sunrise Supports",
    "access_token": "access-1",
    "refresh_token": "refresh-1",
    "access_token_expires_at": _future(),
    "settings": {"income_account_uid": ACCOUNT, "tax_code_uid": FRE, "auto_send": True},
}
INVOICE = {
    "id": "inv-1",
    "organization_id": ORG,
    "participant_id": "p-1",
    "invoice_number": "HBCC-INV-202611-004",  # 19 characters: too long for MYOB's Number
    "recipient_name": "Plan Partners",
    "recipient_email": "accounts@planpartners.example",
    "status": "finalized",
    "issued_at": None,
    "finalized_at": "2026-11-15T23:30:00+00:00",  # 16 Nov in Adelaide
    "due_date": "2026-11-30",
    "total_cents": 10535,
    "currency": "AUD",
    "line_items": [
        {"description": "Assistance with self-care, weekday", "quantity": 1.5, "unit_amount_cents": 7023,
         "line_total_cents": 10535, "item_code": "01_011_0107_1_1", "service_date": "2026-11-10"},
    ],
}
PARTICIPANT = {"id": "p-1", "organization_id": ORG, "full_name": "Liam Carter", "ndis_number": "431234567",
               "plan_management_type": "plan_managed"}


@pytest.fixture(autouse=True)
def _configured(monkeypatch):
    monkeypatch.setattr(ms.settings, "myob_client_id", "client")
    monkeypatch.setattr(ms.settings, "myob_client_secret", "secret")
    monkeypatch.setattr(ms, "head_office_timezone", lambda _org: None)


def _api_for(responses):
    """A fake MYOB: responses keyed by (method, path)."""
    calls = []

    async def fake(row, method, path, *, params=None, json=None, _retried=False):
        calls.append((method, path, params, json))
        result = responses[(method, path)]
        if isinstance(result, Exception):
            raise result
        return result(params, json) if callable(result) else result

    return fake, calls


def _sent(calls, method, path):
    return [json for m, p, _params, json in calls if (m, p) == (method, path)]


def test_invoice_payload_is_gst_free_dated_locally_and_keeps_our_number_in_the_po_field():
    payload = ms.build_invoice_payload(
        INVOICE,
        customer_uid="cust-9",
        participant=PARTICIPANT,
        conn_settings=ms._settings_of(CONNECTION),
        invoice_date=date(2026, 11, 16),
    )
    assert payload["Customer"] == {"UID": "cust-9"}
    assert payload["Date"] == "2026-11-16T00:00:00"
    assert payload["IsTaxInclusive"] is False
    # Longer than 13 characters: MYOB numbers it; ours goes in the PO field.
    assert "Number" not in payload
    assert payload["CustomerPurchaseOrderNumber"] == "HBCC-INV-202611-004"
    assert payload["Terms"] == {"PaymentIsDue": "InAGivenNumberOfDays", "BalanceDueDate": 14}
    [line] = payload["Lines"]
    assert line["Total"] == 105.35
    assert line["Account"] == {"UID": ACCOUNT} and line["TaxCode"] == {"UID": FRE}
    assert line["Description"].startswith("01_011_0107_1_1 Assistance with self-care")
    assert "1.5 x $70.23" in line["Description"]
    assert "Liam Carter, NDIS 431234567" in payload["Comment"]

    short = ms.build_invoice_payload(
        {**INVOICE, "invoice_number": "INV-0042"},
        customer_uid="cust-9", participant=PARTICIPANT,
        conn_settings=ms._settings_of(CONNECTION), invoice_date=date(2026, 11, 16),
    )
    assert short["Number"] == "INV-0042"


def test_only_a_director_manages_the_connection():
    with pytest.raises(HTTPException) as exc:
        ms.create_connect_url(COORDINATOR)
    assert exc.value.status_code == 403


def test_the_sign_in_link_asks_for_consent_so_myob_says_which_file():
    db = _DB(myob_oauth_states=[], xero_connections=[])
    with patch.object(ms, "get_supabase_admin", return_value=db):
        url = ms.create_connect_url(DIRECTOR)["url"]
    query = parse_qs(urlparse(url).query)
    assert url.startswith(ms.AUTHORIZE_URL)
    assert query["prompt"] == ["consent"]
    assert "sme-sales" in query["scope"][0]
    assert query["state"][0] == db.tables["myob_oauth_states"][0]["state"]


def test_myob_cant_be_connected_while_xero_is():
    db = _DB(myob_oauth_states=[], xero_connections=[{"organization_id": ORG}])
    with patch.object(ms, "get_supabase_admin", return_value=db):
        with pytest.raises(HTTPException) as exc:
            ms.create_connect_url(DIRECTOR)
        assert exc.value.status_code == 409
        assert ms.get_status(DIRECTOR)["blocked_by_xero"] is True
    assert db.tables["myob_oauth_states"] == []


@pytest.mark.asyncio
async def test_a_sign_in_link_only_finishes_for_the_organisation_that_started_it():
    db = _DB(myob_oauth_states=[{"state": "s-1", "organization_id": "someone-else", "user_id": "md-1",
                                 "created_at": datetime.now(timezone.utc).isoformat()}])
    with patch.object(ms, "get_supabase_admin", return_value=db), \
         patch.object(ms, "_token_request", AsyncMock()) as token:
        with pytest.raises(HTTPException) as exc:
            await ms.complete_connection(DIRECTOR, "code", "s-1", "biz-1")
    assert exc.value.status_code == 400
    token.assert_not_awaited()
    assert db.tables["myob_oauth_states"] == []


@pytest.mark.asyncio
async def test_connecting_remembers_the_file_and_picks_an_income_account_and_gst_free():
    db = _DB(
        myob_oauth_states=[{"state": "s-1", "organization_id": ORG, "user_id": "md-1",
                            "created_at": datetime.now(timezone.utc).isoformat()}],
        myob_connections=[], xero_connections=[], invoices=[], users=[],
    )
    tokens = {"access_token": "a", "refresh_token": "r", "expires_in": "1200", "scope": "sme-sales"}
    fake, _calls = _api_for({
        ("GET", "/Company"): {"CompanyName": "Sunrise Supports Pty Ltd"},
        ("GET", "/GeneralLedger/Account"): {"Items": [
            {"UID": "hdr", "DisplayID": "4-0000", "Name": "Income", "IsHeader": True},
            {"UID": ACCOUNT, "DisplayID": "4-1000", "Name": "NDIS services", "IsHeader": False, "IsActive": True},
        ]},
        ("GET", "/GeneralLedger/TaxCode"): {"Items": [
            {"UID": "tax-gst", "Code": "GST", "Description": "Goods & Services Tax"},
            {"UID": FRE, "Code": "FRE", "Description": "GST Free"},
        ]},
    })
    with patch.object(ms, "get_supabase_admin", return_value=db), \
         patch.object(ms, "_token_request", AsyncMock(return_value=tokens)), \
         patch.object(ms, "_api", fake), \
         patch.object(ms.audit_service, "log_action", AsyncMock()):
        status = await ms.complete_connection(DIRECTOR, "code", "s-1", "biz-1")
    assert status["connected"] is True
    saved = db.tables["myob_connections"][0]
    assert saved["business_id"] == "biz-1"
    assert saved["business_name"] == "Sunrise Supports Pty Ltd"
    assert saved["settings"]["income_account_uid"] == ACCOUNT
    assert saved["settings"]["tax_code_uid"] == FRE


@pytest.mark.asyncio
async def test_an_expired_access_token_is_refreshed_and_the_new_pair_saved():
    row = {**CONNECTION, "access_token_expires_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()}
    db = _DB(myob_connections=[dict(row)])
    fresh = {"access_token": "access-2", "refresh_token": "refresh-2", "expires_in": "1200"}
    with patch.object(ms, "get_supabase_admin", return_value=db), \
         patch.object(ms, "_token_request", AsyncMock(return_value=fresh)) as token:
        assert await ms._access_token(row) == "access-2"
    assert token.await_args.args[0] == {"grant_type": "refresh_token", "refresh_token": "refresh-1"}
    assert db.tables["myob_connections"][0]["refresh_token"] == "refresh-2"


@pytest.mark.asyncio
async def test_an_approved_invoice_goes_to_myob_with_a_new_customer_card():
    db = _DB(myob_connections=[dict(CONNECTION)], invoices=[dict(INVOICE)], participants=[PARTICIPANT], myob_contacts=[])
    fake, calls = _api_for({
        ("GET", "/Sale/Invoice"): {"Items": []},
        ("GET", "/Contact/Customer"): {"Items": []},
        ("POST", "/Contact/Customer"): {"UID": "cust-9"},
        ("POST", "/Sale/Invoice/Service"): {"UID": "minv-1"},
        ("GET", "/Sale/Invoice/Service/minv-1"): {"UID": "minv-1", "Number": "00000123", "Status": "Open"},
    })
    with patch.object(ms, "get_supabase_admin", return_value=db), patch.object(ms, "_api", fake):
        result = await ms.push_invoice(ORG, "inv-1")
    assert result == {"ok": True, "message": "Sent to MYOB as 00000123."}
    invoice = db.tables["invoices"][0]
    assert invoice["myob_invoice_uid"] == "minv-1"
    assert invoice["myob_invoice_number"] == "00000123"
    assert invoice["myob_status"] == "Open" and invoice["myob_sync_error"] is None
    [card] = _sent(calls, "POST", "/Contact/Customer")
    assert card["CompanyName"] == "Plan Partners"
    assert card["SellingDetails"]["TaxCode"] == {"UID": FRE}
    assert db.tables["myob_contacts"][0]["myob_customer_uid"] == "cust-9"
    [sent] = _sent(calls, "POST", "/Sale/Invoice/Service")
    assert sent["Date"] == "2026-11-16T00:00:00"
    assert sent["Customer"] == {"UID": "cust-9"}


@pytest.mark.asyncio
async def test_reapproving_updates_the_same_myob_invoice():
    db = _DB(
        myob_connections=[dict(CONNECTION)],
        invoices=[{**INVOICE, "myob_invoice_uid": "minv-1"}],
        participants=[PARTICIPANT],
        myob_contacts=[{"organization_id": ORG, "payer_key": "name:plan partners", "myob_customer_uid": "cust-1"}],
    )
    fake, calls = _api_for({
        ("GET", "/Sale/Invoice/Service/minv-1"): {"UID": "minv-1", "Number": "00000123", "RowVersion": "77",
                                                  "Status": "Open", "TotalAmount": 90.0, "BalanceDueAmount": 90.0},
        ("PUT", "/Sale/Invoice/Service/minv-1"): {},
    })
    with patch.object(ms, "get_supabase_admin", return_value=db), patch.object(ms, "_api", fake):
        result = await ms.push_invoice(ORG, "inv-1")
    assert result["ok"] is True
    [sent] = _sent(calls, "PUT", "/Sale/Invoice/Service/minv-1")
    assert sent["UID"] == "minv-1" and sent["RowVersion"] == "77" and sent["Number"] == "00000123"
    assert not any(path == "/Contact/Customer" for _m, path, _p, _j in calls)


@pytest.mark.asyncio
async def test_nothing_goes_until_the_income_account_and_tax_code_are_chosen():
    row = {**CONNECTION, "settings": {"auto_send": True}}
    db = _DB(myob_connections=[row], invoices=[dict(INVOICE)])
    fake, calls = _api_for({})
    with patch.object(ms, "get_supabase_admin", return_value=db), patch.object(ms, "_api", fake):
        result = await ms.push_invoice(ORG, "inv-1")
    assert result["ok"] is False and "income account" in result["message"]
    assert calls == []
    assert "income account" in db.tables["invoices"][0]["myob_sync_error"]


@pytest.mark.asyncio
async def test_a_myob_error_is_kept_on_the_invoice_and_never_raised():
    db = _DB(myob_connections=[dict(CONNECTION)], invoices=[dict(INVOICE)], participants=[PARTICIPANT],
             myob_contacts=[{"organization_id": ORG, "payer_key": "name:plan partners", "myob_customer_uid": "cust-1"}])
    fake, _calls = _api_for({
        ("GET", "/Sale/Invoice"): {"Items": []},
        ("POST", "/Sale/Invoice/Service"): ms.MyobError("The period is locked (Lock periods prior to 1/07/2026)"),
    })
    with patch.object(ms, "get_supabase_admin", return_value=db), patch.object(ms, "_api", fake):
        result = await ms.push_invoice(ORG, "inv-1")
    assert result["ok"] is False
    assert db.tables["invoices"][0]["myob_sync_error"].startswith("The period is locked")


@pytest.mark.asyncio
async def test_drafts_and_paid_invoices_stay_out_of_myob():
    for status in ("draft", "paid"):
        db = _DB(myob_connections=[dict(CONNECTION)], invoices=[{**INVOICE, "status": status}])
        fake, calls = _api_for({})
        with patch.object(ms, "get_supabase_admin", return_value=db), patch.object(ms, "_api", fake):
            result = await ms.push_invoice(ORG, "inv-1")
        assert result["ok"] is False and calls == []


@pytest.mark.asyncio
async def test_an_invoice_that_only_shares_our_po_number_is_not_adopted():
    db = _DB(myob_connections=[dict(CONNECTION)], invoices=[dict(INVOICE)], participants=[PARTICIPANT], myob_contacts=[])
    fake, calls = _api_for({
        ("GET", "/Sale/Invoice"): {"Items": [{"UID": "other", "InvoiceType": "Service", "Status": "Closed",
                                              "Customer": {"Name": "Someone Else"}, "TotalAmount": 105.35}]},
    })
    with patch.object(ms, "get_supabase_admin", return_value=db), patch.object(ms, "_api", fake):
        result = await ms.push_invoice(ORG, "inv-1")
    assert result["ok"] is False and "isn't this one" in result["message"]
    invoice = db.tables["invoices"][0]
    assert invoice.get("myob_invoice_uid") is None and invoice["status"] == "finalized"


@pytest.mark.asyncio
async def test_closed_in_myob_marks_it_paid_here_with_the_date_and_reference():
    open_invoice = {**INVOICE, "status": "sent", "myob_invoice_uid": "MINV-1", "myob_status": "Open"}
    db = _DB(myob_connections=[dict(CONNECTION)], invoices=[open_invoice])
    fake, _calls = _api_for({
        ("GET", "/Sale/Invoice"): {"Items": [{"UID": "minv-1", "Status": "Closed", "Customer": {"UID": "cust-1"}}]},
        ("GET", "/Sale/CustomerPayment"): {"Items": [
            {"Date": "2026-11-23T00:00:00", "Memo": "PM remittance 5521", "Invoices": [{"UID": "minv-1"}]},
        ]},
    })
    with patch.object(ms, "get_supabase_admin", return_value=db), patch.object(ms, "_api", fake), \
         patch.object(ms.audit_service, "log_action", AsyncMock()) as audit:
        result = await ms.check_payments(ORG)
    assert result == {"paid": 1, "checked": 1}
    invoice = db.tables["invoices"][0]
    assert invoice["status"] == "paid"
    assert invoice["payment_date"] == "2026-11-23"
    assert invoice["payment_reference"] == "PM remittance 5521"
    assert audit.await_args.kwargs["details"]["source"] == "myob"


@pytest.mark.asyncio
async def test_an_invoice_deleted_in_myob_is_flagged_not_paid():
    open_invoice = {**INVOICE, "status": "sent", "myob_invoice_uid": "minv-1", "myob_status": "Open"}
    db = _DB(myob_connections=[dict(CONNECTION)], invoices=[open_invoice])
    fake, _calls = _api_for({("GET", "/Sale/Invoice"): {"Items": []}})
    with patch.object(ms, "get_supabase_admin", return_value=db), patch.object(ms, "_api", fake):
        result = await ms.check_payments(ORG)
    assert result["paid"] == 0
    invoice = db.tables["invoices"][0]
    assert invoice["status"] == "sent"
    assert invoice["myob_status"] == "Deleted"
    assert "Deleted in MYOB" in invoice["myob_sync_error"]


@pytest.mark.asyncio
async def test_a_cancelled_invoice_is_deleted_in_myob_but_not_once_paid_there():
    cancelled = {**INVOICE, "status": "cancelled", "myob_invoice_uid": "minv-1"}
    db = _DB(myob_connections=[dict(CONNECTION)], invoices=[dict(cancelled)])
    fake, calls = _api_for({
        ("GET", "/Sale/Invoice/Service/minv-1"): {"UID": "minv-1", "Status": "Open", "TotalAmount": 105.35,
                                                  "BalanceDueAmount": 105.35},
        ("DELETE", "/Sale/Invoice/Service/minv-1"): {},
    })
    with patch.object(ms, "get_supabase_admin", return_value=db), patch.object(ms, "_api", fake):
        assert (await ms.remove_invoice(ORG, "inv-1"))["ok"] is True
    assert calls[-1][:2] == ("DELETE", "/Sale/Invoice/Service/minv-1")
    assert db.tables["invoices"][0]["myob_status"] == "Deleted"

    db = _DB(myob_connections=[dict(CONNECTION)], invoices=[dict(cancelled)])
    fake, calls = _api_for({
        ("GET", "/Sale/Invoice/Service/minv-1"): {"UID": "minv-1", "Status": "Open", "TotalAmount": 105.35,
                                                  "BalanceDueAmount": 50.0},
    })
    with patch.object(ms, "get_supabase_admin", return_value=db), patch.object(ms, "_api", fake):
        result = await ms.remove_invoice(ORG, "inv-1")
    assert result["ok"] is False and "paid in MYOB" in result["message"]
    assert not any(method == "DELETE" for method, *_ in calls)


def test_only_newly_approved_or_cancelled_invoices_reach_myob():
    spawned = []
    with patch.object(ms, "_spawn", lambda coro: (spawned.append(coro), coro.close())):
        ms.invoice_status_changed({**INVOICE, "status": "finalized"}, "draft")
        ms.invoice_status_changed({**INVOICE, "status": "overdue", "myob_invoice_uid": "minv-1"}, "sent")
        ms.invoice_status_changed({**INVOICE, "status": "cancelled"}, "draft")
        ms.invoice_status_changed({**INVOICE, "status": "cancelled", "myob_invoice_uid": "minv-1"}, "sent")
    assert len(spawned) == 2


def test_nothing_happens_when_myob_isnt_switched_on(monkeypatch):
    monkeypatch.setattr(ms.settings, "myob_client_id", "")
    spawned = []
    with patch.object(ms, "_spawn", lambda coro: (spawned.append(coro), coro.close())):
        ms.invoice_status_changed({**INVOICE, "status": "finalized"}, "draft")
    assert spawned == []


@pytest.mark.asyncio
async def test_two_invoices_for_one_payer_sent_together_share_one_customer_card():
    db = _DB(myob_connections=[dict(CONNECTION)], myob_contacts=[])
    created = []

    async def fake(row, method, path, *, params=None, json=None, _retried=False):
        await asyncio.sleep(0)
        if (method, path) == ("GET", "/Contact/Customer"):
            return {"Items": [{"UID": "cust-1"}]} if created else {"Items": []}
        if (method, path) == ("POST", "/Contact/Customer"):
            created.append(json)
            return {"UID": "cust-1"}
        raise AssertionError((method, path))

    row = dict(CONNECTION)
    with patch.object(ms, "get_supabase_admin", return_value=db), patch.object(ms, "_api", fake):
        first, second = await asyncio.gather(
            ms._customer_uid(row, "Plan Partners", None, FRE),
            ms._customer_uid(row, "Plan Partners", None, FRE),
        )
    assert first == second == "cust-1"
    assert len(created) == 1


def test_myob_error_messages_are_readable():
    import httpx

    resp = httpx.Response(400, json={"Errors": [{"Name": "ValidationError", "Message": "Customer is required",
                                                  "AdditionalDetails": "Customer.UID"}]})
    assert ms._myob_message(resp) == "Customer is required (Customer.UID)"
