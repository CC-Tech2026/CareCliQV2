"""Xero: approved invoices become Xero sales invoices, payments made in Xero
mark the CareCliQ invoice paid, and nothing about Xero can break invoicing."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import xero_service as xs

ORG = "org-1"
DIRECTOR = {"id": "md-1", "organization_id": ORG, "role": "managing_director"}
COORDINATOR = {"id": "c-1", "organization_id": ORG, "role": "support_coordinator"}


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], "select", None

    def select(self, *_a, **_k):
        return self

    def eq(self, key, value):
        self.filters.append(lambda r: str(r.get(key)) == str(value))
        return self

    def in_(self, key, values):
        values = {str(v) for v in values}
        self.filters.append(lambda r: str(r.get(key)) in values)
        return self

    def is_(self, key, _null):
        self.filters.append(lambda r: r.get(key) is None)
        return self

    def lt(self, *_a):
        return self

    def limit(self, *_a):
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def upsert(self, payload, **_k):
        self.op, self.payload = "upsert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def delete(self):
        self.op = "delete"
        return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        self.db.calls.append((self.table, self.op, self.payload))
        if self.op in ("insert", "upsert"):
            rows.append(dict(self.payload))
            return MagicMock(data=[self.payload])
        hit = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in hit:
                r.update(self.payload)
        if self.op == "delete":
            self.db.tables[self.table] = [r for r in rows if r not in hit]
        return MagicMock(data=hit)


class _DB:
    def __init__(self, **tables):
        self.tables = {name: [dict(r) for r in rows] for name, rows in tables.items()}
        self.calls: list = []

    def table(self, name):
        return _Query(self, name)


def _future(minutes=20):
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


CONNECTION = {
    "organization_id": ORG,
    "tenant_id": "tenant-1",
    "tenant_name": "Sunrise Supports",
    "access_token": "access-1",
    "refresh_token": "refresh-1",
    "access_token_expires_at": _future(),
    "settings": {},
}
INVOICE = {
    "id": "inv-1",
    "organization_id": ORG,
    "participant_id": "p-1",
    "invoice_number": "INV-0042",
    "recipient_name": "Plan Partners",
    "recipient_email": "accounts@planpartners.example",
    "status": "finalized",
    "issued_at": None,
    "finalized_at": "2026-11-15T23:30:00+00:00",  # 16 Nov in Adelaide
    "due_date": "2026-11-30",
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
    monkeypatch.setattr(xs.settings, "xero_client_id", "client")
    monkeypatch.setattr(xs.settings, "xero_client_secret", "secret")
    monkeypatch.setattr(xs, "head_office_timezone", lambda _org: None)


def test_reads_xero_dates():
    assert xs.parse_xero_date("/Date(1763251200000+0000)/") == "2025-11-16"
    assert xs.parse_xero_date("2026-11-16T00:00:00") == "2026-11-16"
    assert xs.parse_xero_date(None) is None


def test_invoice_payload_is_gst_free_with_ndis_codes_and_whole_cent_prices():
    payload = xs.build_invoice_payload(
        INVOICE,
        contact_id="contact-9",
        participant=PARTICIPANT,
        conn_settings=dict(xs.DEFAULT_SETTINGS),
        invoice_date="2026-11-16",
    )
    assert payload["Type"] == "ACCREC"
    assert payload["Contact"] == {"ContactID": "contact-9"}
    assert payload["InvoiceNumber"] == "INV-0042"
    assert payload["Reference"] == "Liam Carter, NDIS 431234567"
    assert payload["Status"] == "AUTHORISED"
    assert payload["DueDate"] == "2026-11-30"
    line = payload["LineItems"][0]
    assert line["Description"] == "01_011_0107_1_1 Assistance with self-care, weekday (2026-11-10)"
    assert line["Quantity"] == 1.5 and line["UnitAmount"] == 70.23
    assert line["TaxType"] == "EXEMPTOUTPUT" and line["AccountCode"] == "200"
    assert "InvoiceID" not in payload


def test_only_a_director_manages_the_connection():
    with pytest.raises(HTTPException) as exc:
        xs.create_connect_url(COORDINATOR)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_a_sign_in_link_only_finishes_for_the_organisation_that_started_it():
    db = _DB(xero_oauth_states=[{"state": "s-1", "organization_id": "someone-else", "user_id": "md-1",
                                 "created_at": datetime.now(timezone.utc).isoformat()}])
    with patch.object(xs, "get_supabase_admin", return_value=db), \
         patch.object(xs, "_token_request", AsyncMock()) as token:
        with pytest.raises(HTTPException) as exc:
            await xs.complete_connection(DIRECTOR, "code", "s-1")
    assert exc.value.status_code == 400
    token.assert_not_awaited()
    assert db.tables["xero_oauth_states"] == []  # used up either way


class _XeroConnections:
    """httpx.AsyncClient for the /connections call: the organisations the
    person just authorised, the one they picked last-updated first."""

    def __init__(self, tenants):
        self.tenants = tenants

    def __call__(self, *a, **k):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, *a, **k):
        return MagicMock(status_code=200, json=lambda: self.tenants)


def _signing_in(db, tenants):
    tokens = {"access_token": "access-9", "refresh_token": "refresh-9", "expires_in": 1800,
              "scope": "offline_access accounting.invoices payroll.timesheets"}
    return [
        patch.object(xs, "get_supabase_admin", return_value=db),
        patch.object(xs, "_token_request", AsyncMock(return_value=tokens)),
        patch.object(xs.httpx, "AsyncClient", _XeroConnections(tenants)),
        patch.object(xs.audit_service, "log_action", AsyncMock()),
        patch.object(xs, "get_status", lambda user: {"ok": True}),
    ]


def _state():
    return {"state": "s-1", "organization_id": ORG, "user_id": "md-1", "created_at": datetime.now(timezone.utc).isoformat()}


@pytest.mark.asyncio
async def test_signing_in_again_never_switches_to_another_xero_organisation():
    db = _DB(xero_oauth_states=[_state()], xero_connections=[dict(CONNECTION)])
    picked = [{"tenantId": "tenant-real", "tenantName": "CC Tech Australia PTY LTD", "tenantType": "ORGANISATION",
               "id": "conn-real", "updatedDateUtc": "2026-11-18T00:00:00"},
              {"tenantId": "tenant-1", "tenantName": "Sunrise Supports", "tenantType": "ORGANISATION",
               "id": "conn-1", "updatedDateUtc": "2026-11-16T00:00:00"}]
    patches = _signing_in(db, picked)
    for p in patches:
        p.start()
    try:
        with pytest.raises(HTTPException) as exc:
            await xs.complete_connection(DIRECTOR, "code", "s-1")
    finally:
        for p in reversed(patches):
            p.stop()
    assert exc.value.status_code == 409
    assert "CC Tech Australia PTY LTD" in exc.value.detail and "Sunrise Supports" in exc.value.detail
    # The existing connection is untouched: same organisation, same tokens.
    saved = db.tables["xero_connections"][0]
    assert saved["tenant_id"] == "tenant-1" and saved["access_token"] == "access-1"


@pytest.mark.asyncio
async def test_signing_in_again_to_the_same_organisation_still_works():
    db = _DB(xero_oauth_states=[_state()], xero_connections=[dict(CONNECTION)])
    picked = [{"tenantId": "tenant-1", "tenantName": "Sunrise Supports", "tenantType": "ORGANISATION",
               "id": "conn-1", "updatedDateUtc": "2026-11-18T00:00:00"}]
    patches = _signing_in(db, picked)
    for p in patches:
        p.start()
    try:
        assert await xs.complete_connection(DIRECTOR, "code", "s-1") == {"ok": True}
    finally:
        for p in reversed(patches):
            p.stop()
    saved = db.tables["xero_connections"][-1]  # the upsert (this fake appends it)
    assert saved["tenant_id"] == "tenant-1"
    assert "payroll.timesheets" in saved["scopes"]


@pytest.mark.asyncio
async def test_an_expired_access_token_is_refreshed_and_the_new_pair_saved():
    row = {**CONNECTION, "access_token_expires_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()}
    db = _DB(xero_connections=[dict(row)])
    fresh = {"access_token": "access-2", "refresh_token": "refresh-2", "expires_in": 1800}
    with patch.object(xs, "get_supabase_admin", return_value=db), \
         patch.object(xs, "_token_request", AsyncMock(return_value=fresh)) as token:
        assert await xs._access_token(row) == "access-2"
    assert token.await_args.args[0] == {"grant_type": "refresh_token", "refresh_token": "refresh-1"}
    saved = db.tables["xero_connections"][0]
    assert saved["refresh_token"] == "refresh-2"


def _api_for(responses):
    """A fake Xero: responses keyed by (method, path)."""
    calls = []

    async def fake(row, method, path, *, params=None, json=None, _retried=False):
        calls.append((method, path, params, json))
        result = responses[(method, path)]
        if isinstance(result, Exception):
            raise result
        return result(params, json) if callable(result) else result

    return fake, calls


@pytest.mark.asyncio
async def test_an_approved_invoice_goes_to_xero_with_a_new_contact():
    db = _DB(xero_connections=[dict(CONNECTION)], invoices=[dict(INVOICE)], participants=[PARTICIPANT], xero_contacts=[])
    fake, calls = _api_for({
        ("GET", "/Invoices"): {"Invoices": []},
        ("GET", "/Contacts"): {"Contacts": []},
        ("POST", "/Contacts"): {"Contacts": [{"ContactID": "contact-9"}]},
        ("POST", "/Invoices"): {"Invoices": [{"InvoiceID": "xinv-1", "Status": "AUTHORISED"}]},
    })
    with patch.object(xs, "get_supabase_admin", return_value=db), patch.object(xs, "_api", fake):
        result = await xs.push_invoice(ORG, "inv-1")
    assert result == {"ok": True, "message": "Sent to Xero."}
    invoice = db.tables["invoices"][0]
    assert invoice["xero_invoice_id"] == "xinv-1" and invoice["xero_status"] == "AUTHORISED"
    assert invoice["xero_sync_error"] is None
    assert db.tables["xero_contacts"][0]["xero_contact_id"] == "contact-9"
    sent = [json for method, path, _p, json in calls if (method, path) == ("POST", "/Invoices")][0]
    # Approved at 23:30 UTC on the 15th: the 16th in Australia, which is the invoice date.
    assert sent["Invoices"][0]["Date"] == "2026-11-16"
    assert sent["Invoices"][0]["Contact"] == {"ContactID": "contact-9"}


@pytest.mark.asyncio
async def test_a_known_payer_and_an_already_sent_number_are_reused():
    db = _DB(
        xero_connections=[dict(CONNECTION)], invoices=[dict(INVOICE)], participants=[PARTICIPANT],
        xero_contacts=[{"organization_id": ORG, "payer_key": "name:plan partners", "xero_contact_id": "contact-1"}],
    )
    fake, calls = _api_for({
        ("GET", "/Invoices"): {"Invoices": [{"InvoiceID": "xinv-7", "Type": "ACCREC", "Status": "DRAFT",
                                             "Contact": {"Name": "Plan Partners"}, "Total": 105.35}]},
        ("POST", "/Invoices"): {"Invoices": [{"InvoiceID": "xinv-7", "Status": "AUTHORISED"}]},
    })
    with patch.object(xs, "get_supabase_admin", return_value=db), patch.object(xs, "_api", fake):
        await xs.push_invoice(ORG, "inv-1")
    sent = [json for method, path, _p, json in calls if (method, path) == ("POST", "/Invoices")][0]
    assert sent["Invoices"][0]["InvoiceID"] == "xinv-7"
    assert sent["Invoices"][0]["Contact"] == {"ContactID": "contact-1"}
    assert not any(path == "/Contacts" for _m, path, _p, _j in calls)


@pytest.mark.asyncio
async def test_a_xero_error_is_kept_on_the_invoice_and_never_raised():
    db = _DB(xero_connections=[dict(CONNECTION)], invoices=[dict(INVOICE)], participants=[PARTICIPANT], xero_contacts=[])
    fake, _calls = _api_for({
        ("GET", "/Invoices"): {"Invoices": []},
        ("GET", "/Contacts"): {"Contacts": [{"ContactID": "contact-9"}]},
        ("POST", "/Invoices"): xs.XeroError("Account code '999' is not a valid code for this document."),
    })
    with patch.object(xs, "get_supabase_admin", return_value=db), patch.object(xs, "_api", fake):
        result = await xs.push_invoice(ORG, "inv-1")
    assert result["ok"] is False
    assert db.tables["invoices"][0]["xero_sync_error"].startswith("Account code '999'")


@pytest.mark.asyncio
async def test_drafts_and_paid_invoices_stay_out_of_xero():
    for status in ("draft", "paid"):
        db = _DB(xero_connections=[dict(CONNECTION)], invoices=[{**INVOICE, "status": status}])
        fake, calls = _api_for({})
        with patch.object(xs, "get_supabase_admin", return_value=db), patch.object(xs, "_api", fake):
            result = await xs.push_invoice(ORG, "inv-1")
        assert result["ok"] is False and calls == []


@pytest.mark.asyncio
async def test_paid_in_xero_marks_it_paid_here_with_the_date_and_reference():
    open_invoice = {**INVOICE, "status": "sent", "xero_invoice_id": "xinv-1", "xero_status": "AUTHORISED"}
    db = _DB(xero_connections=[dict(CONNECTION)], invoices=[open_invoice])
    fake, _calls = _api_for({
        ("GET", "/Invoices"): {"Invoices": [{
            "InvoiceID": "xinv-1", "Status": "PAID", "FullyPaidOnDate": "/Date(1763856000000+0000)/",
            "Payments": [{"Date": "/Date(1763856000000+0000)/", "Reference": "PM remittance 5521"}],
        }]},
    })
    with patch.object(xs, "get_supabase_admin", return_value=db), patch.object(xs, "_api", fake), \
         patch.object(xs.audit_service, "log_action", AsyncMock()) as audit:
        result = await xs.check_payments(ORG)
    assert result == {"paid": 1, "checked": 1}
    invoice = db.tables["invoices"][0]
    assert invoice["status"] == "paid"
    assert invoice["payment_date"] == "2025-11-23"
    assert invoice["payment_reference"] == "PM remittance 5521"
    assert audit.await_args.kwargs["details"]["source"] == "xero"


@pytest.mark.asyncio
async def test_a_cancelled_invoice_is_voided_in_xero_but_not_once_paid_there():
    cancelled = {**INVOICE, "status": "cancelled", "xero_invoice_id": "xinv-1"}
    db = _DB(xero_connections=[dict(CONNECTION)], invoices=[dict(cancelled)])
    fake, calls = _api_for({
        ("GET", "/Invoices/xinv-1"): {"Invoices": [{"InvoiceID": "xinv-1", "Status": "AUTHORISED", "AmountPaid": 0}]},
        ("POST", "/Invoices/xinv-1"): {"Invoices": [{"InvoiceID": "xinv-1", "Status": "VOIDED"}]},
    })
    with patch.object(xs, "get_supabase_admin", return_value=db), patch.object(xs, "_api", fake):
        assert (await xs.void_invoice(ORG, "inv-1"))["ok"] is True
    assert calls[-1][3] == {"Invoices": [{"InvoiceID": "xinv-1", "Status": "VOIDED"}]}

    db = _DB(xero_connections=[dict(CONNECTION)], invoices=[dict(cancelled)])
    fake, calls = _api_for({
        ("GET", "/Invoices/xinv-1"): {"Invoices": [{"InvoiceID": "xinv-1", "Status": "PAID", "AmountPaid": 105.35}]},
    })
    with patch.object(xs, "get_supabase_admin", return_value=db), patch.object(xs, "_api", fake):
        result = await xs.void_invoice(ORG, "inv-1")
    assert result["ok"] is False and "already been paid" in result["message"]
    assert not any(method == "POST" for method, *_ in calls)


def test_only_newly_approved_or_cancelled_invoices_reach_xero():
    spawned = []
    with patch.object(xs, "_spawn", lambda coro: (spawned.append(coro), coro.close())):
        xs.invoice_status_changed({**INVOICE, "status": "finalized"}, "draft")
        xs.invoice_status_changed({**INVOICE, "status": "overdue", "xero_invoice_id": "xinv-1"}, "sent")
        xs.invoice_status_changed({**INVOICE, "status": "cancelled"}, "draft")  # never went to Xero
        xs.invoice_status_changed({**INVOICE, "status": "cancelled", "xero_invoice_id": "xinv-1"}, "sent")
    assert len(spawned) == 2


@pytest.mark.asyncio
async def test_two_invoices_for_one_payer_sent_together_share_one_contact():
    import asyncio

    db = _DB(xero_connections=[dict(CONNECTION)], xero_contacts=[])
    made: list[str] = []

    async def fake(row, method, path, *, params=None, json=None, _retried=False):
        await asyncio.sleep(0.01)  # let the two sends overlap
        if (method, path) == ("GET", "/Contacts"):
            return {"Contacts": [{"ContactID": c} for c in made]}
        made.append(f"contact-{len(made) + 1}")
        return {"Contacts": [{"ContactID": made[-1]}]}

    with patch.object(xs, "get_supabase_admin", return_value=db), patch.object(xs, "_api", fake):
        first, second = await asyncio.gather(
            xs._contact_id(CONNECTION, "Ruby Thompson", None), xs._contact_id(CONNECTION, "Ruby Thompson", None),
        )
    assert first == second == "contact-1" and made == ["contact-1"]


@pytest.mark.asyncio
async def test_a_name_xero_says_is_taken_uses_that_existing_contact():
    db = _DB(xero_connections=[dict(CONNECTION)], xero_contacts=[])
    lookups = iter([{"Contacts": []}, {"Contacts": [{"ContactID": "contact-already"}]}])
    fake, _calls = _api_for({
        ("GET", "/Contacts"): lambda _p, _j: next(lookups),
        ("POST", "/Contacts"): xs.XeroError("The contact name Plan Partners is already assigned to another contact."),
    })
    with patch.object(xs, "get_supabase_admin", return_value=db), patch.object(xs, "_api", fake):
        assert await xs._contact_id(CONNECTION, "Plan Partners", None) == "contact-already"
    assert db.tables["xero_contacts"][0]["xero_contact_id"] == "contact-already"


@pytest.mark.asyncio
async def test_a_paid_xero_invoice_that_only_shares_the_number_is_not_adopted():
    invoice = {**INVOICE, "total_cents": 10535}
    db = _DB(xero_connections=[dict(CONNECTION)], invoices=[invoice], participants=[PARTICIPANT], xero_contacts=[])
    fake, calls = _api_for({
        ("GET", "/Invoices"): {"Invoices": [{"InvoiceID": "someone-elses", "Type": "ACCREC", "Status": "PAID",
                                             "Contact": {"Name": "NDIA"}, "Total": 1324.44}]},
    })
    with patch.object(xs, "get_supabase_admin", return_value=db), patch.object(xs, "_api", fake):
        result = await xs.push_invoice(ORG, "inv-1")
    assert result["ok"] is False and "isn't this one" in result["message"]
    saved = db.tables["invoices"][0]
    assert saved.get("xero_invoice_id") is None and saved.get("xero_status") is None
    assert "isn't this one" in saved["xero_sync_error"]
    assert not any(method == "POST" for method, *_ in calls)


@pytest.mark.asyncio
async def test_our_own_unrecorded_send_is_still_picked_up_by_number():
    invoice = {**INVOICE, "total_cents": 10535}
    db = _DB(xero_connections=[dict(CONNECTION)], invoices=[invoice], participants=[PARTICIPANT], xero_contacts=[])
    fake, _calls = _api_for({
        ("GET", "/Invoices"): {"Invoices": [{"InvoiceID": "ours", "Type": "ACCREC", "Status": "PAID",
                                             "Contact": {"Name": "plan partners"}, "Total": 105.35}]},
    })
    with patch.object(xs, "get_supabase_admin", return_value=db), patch.object(xs, "_api", fake):
        result = await xs.push_invoice(ORG, "inv-1")
    assert result["ok"] is True
    assert db.tables["invoices"][0]["xero_invoice_id"] == "ours"


# --- Less manual work: payments both ways, part payments, invoices from before connecting ---

BANK_ACCOUNTS = {"Accounts": [
    {"AccountID": "bank-1", "Code": "090", "Name": "Business Bank Account", "Type": "BANK", "Status": "ACTIVE"},
    {"AccountID": "rev-1", "Code": "200", "Name": "Sales", "Type": "REVENUE", "Class": "REVENUE", "Status": "ACTIVE"},
]}


@pytest.mark.asyncio
async def test_marked_paid_here_is_recorded_in_xero_into_the_only_bank_account():
    paid = {**INVOICE, "status": "paid", "xero_invoice_id": "xinv-1", "xero_status": "AUTHORISED",
            "payment_date": "2026-11-20", "payment_reference": "EFT-8001"}
    db = _DB(xero_connections=[dict(CONNECTION)], invoices=[paid])
    fake, calls = _api_for({
        ("GET", "/Invoices/xinv-1"): {"Invoices": [{"InvoiceID": "xinv-1", "Status": "AUTHORISED", "AmountDue": 105.35, "Total": 105.35}]},
        ("GET", "/Accounts"): BANK_ACCOUNTS,
        ("PUT", "/Payments"): {"Payments": [{"PaymentID": "pay-1", "Status": "AUTHORISED"}]},
    })
    with patch.object(xs, "get_supabase_admin", return_value=db), patch.object(xs, "_api", fake):
        result = await xs.record_payment(ORG, "inv-1")
    assert result == {"ok": True, "message": "Payment recorded in Xero."}
    sent = [j for m, p, _q, j in calls if (m, p) == ("PUT", "/Payments")][0]["Payments"][0]
    assert sent == {"Invoice": {"InvoiceID": "xinv-1"}, "Account": {"AccountID": "bank-1"}, "Date": "2026-11-20",
                    "Amount": 105.35, "Reference": "EFT-8001"}
    saved = db.tables["invoices"][0]
    assert saved["xero_status"] == "PAID" and saved["xero_amount_due_cents"] == 0 and saved["xero_sync_error"] is None


@pytest.mark.asyncio
async def test_with_several_bank_accounts_the_director_is_asked_to_choose():
    paid = {**INVOICE, "status": "paid", "xero_invoice_id": "xinv-1"}
    db = _DB(xero_connections=[dict(CONNECTION)], invoices=[dict(paid)])
    two = {"Accounts": BANK_ACCOUNTS["Accounts"] + [{"AccountID": "bank-2", "Name": "Savings", "Type": "BANK", "Status": "ACTIVE"}]}
    fake, calls = _api_for({
        ("GET", "/Invoices/xinv-1"): {"Invoices": [{"InvoiceID": "xinv-1", "Status": "AUTHORISED", "AmountDue": 105.35}]},
        ("GET", "/Accounts"): two,
    })
    with patch.object(xs, "get_supabase_admin", return_value=db), patch.object(xs, "_api", fake):
        result = await xs.record_payment(ORG, "inv-1")
    assert result["ok"] is False
    assert "Choose which bank account" in db.tables["invoices"][0]["xero_sync_error"]
    assert not any(m == "PUT" for m, *_ in calls)

    chosen = {**CONNECTION, "settings": {"payment_account_id": "bank-2"}}
    db = _DB(xero_connections=[chosen], invoices=[dict(paid)])
    fake, calls = _api_for({
        ("GET", "/Invoices/xinv-1"): {"Invoices": [{"InvoiceID": "xinv-1", "Status": "AUTHORISED", "AmountDue": 105.35}]},
        ("PUT", "/Payments"): {"Payments": [{"PaymentID": "pay-1"}]},
    })
    with patch.object(xs, "get_supabase_admin", return_value=db), patch.object(xs, "_api", fake):
        assert (await xs.record_payment(ORG, "inv-1", row=chosen))["ok"] is True
    assert [j for m, p, _q, j in calls if m == "PUT"][0]["Payments"][0]["Account"] == {"AccountID": "bank-2"}


@pytest.mark.asyncio
async def test_already_paid_in_xero_is_not_paid_twice():
    paid = {**INVOICE, "status": "paid", "xero_invoice_id": "xinv-1"}
    db = _DB(xero_connections=[dict(CONNECTION)], invoices=[paid])
    fake, calls = _api_for({
        ("GET", "/Invoices/xinv-1"): {"Invoices": [{"InvoiceID": "xinv-1", "Status": "PAID", "AmountDue": 0, "AmountPaid": 105.35}]},
    })
    with patch.object(xs, "get_supabase_admin", return_value=db), patch.object(xs, "_api", fake):
        assert (await xs.record_payment(ORG, "inv-1"))["message"] == "Already paid in Xero."
    assert [m for m, *_ in calls] == ["GET"]


def test_marking_paid_here_sends_the_payment_but_only_for_invoices_in_xero():
    spawned = []
    with patch.object(xs, "_spawn", lambda coro: (spawned.append(coro), coro.close())):
        xs.invoice_status_changed({**INVOICE, "status": "paid", "xero_invoice_id": "xinv-1"}, "sent")
        xs.invoice_status_changed({**INVOICE, "status": "paid"}, "sent")  # never in Xero
    assert len(spawned) == 1


@pytest.mark.asyncio
async def test_a_part_payment_in_xero_shows_as_amounts():
    open_invoice = {**INVOICE, "status": "sent", "xero_invoice_id": "xinv-1", "xero_status": "AUTHORISED"}
    db = _DB(xero_connections=[dict(CONNECTION)], invoices=[open_invoice])
    fake, _calls = _api_for({
        ("GET", "/Invoices"): {"Invoices": [{"InvoiceID": "xinv-1", "Status": "AUTHORISED", "AmountPaid": 50, "AmountDue": 55.35}]},
    })
    with patch.object(xs, "get_supabase_admin", return_value=db), patch.object(xs, "_api", fake):
        assert (await xs.check_payments(ORG))["paid"] == 0
    saved = db.tables["invoices"][0]
    assert saved["status"] == "sent"
    assert saved["xero_amount_paid_cents"] == 5000 and saved["xero_amount_due_cents"] == 5535


@pytest.mark.asyncio
async def test_invoices_from_before_connecting_wait_until_the_director_says_so():
    row = {**CONNECTION, "connected_at": "2026-11-10T00:00:00+00:00"}
    before = {**INVOICE, "id": "old", "invoice_number": "OLD-1", "status": "sent", "finalized_at": "2026-11-01T00:00:00+00:00"}
    after = {**INVOICE, "id": "new", "invoice_number": "NEW-1", "status": "finalized", "finalized_at": "2026-11-12T00:00:00+00:00"}
    db = _DB(xero_connections=[row], invoices=[before, after], participants=[PARTICIPANT], xero_contacts=[])
    pushed = []

    async def fake_push(org_id, invoice_id, *, row=None):
        pushed.append(invoice_id)
        return {"ok": True, "message": "Sent to Xero."}

    with patch.object(xs, "get_supabase_admin", return_value=db), patch.object(xs, "push_invoice", fake_push):
        await xs._retry_unsent(ORG, row)
        assert pushed == ["new"]
        offer = xs._earlier_offer(ORG, row)
        assert offer["count"] == 1 and offer["invoices"][0]["invoice_number"] == "OLD-1"
        assert xs._invoice_counts(ORG, row)["earlier"] == 1

        pushed.clear()
        with patch.object(xs.audit_service, "log_action", AsyncMock()):
            result = await xs.send_earlier(DIRECTOR)
        assert pushed == ["old"] and result["sent"] == 1
        assert db.tables["xero_connections"][0]["settings"]["include_earlier"] is True


@pytest.mark.asyncio
async def test_opening_billing_checks_for_payments_at_most_every_few_minutes():
    fresh = {**CONNECTION, "last_payment_check_at": datetime.now(timezone.utc).isoformat()}
    stale = {**CONNECTION, "last_payment_check_at": (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()}
    for row, expect in ((fresh, False), (stale, True)):
        db = _DB(xero_connections=[row], invoices=[])
        with patch.object(xs, "get_supabase_admin", return_value=db), \
             patch.object(xs, "check_payments", AsyncMock(return_value={"paid": 0, "checked": 0})) as check:
            result = await xs.refresh_payments({**COORDINATOR})
        assert result["checked"] is expect and check.await_count == int(expect)


def test_xero_wont_connect_while_myob_is():
    with patch.object(xs, "_myob_connected", lambda _org: True):
        with pytest.raises(HTTPException) as exc:
            xs.create_connect_url(DIRECTOR)
    assert exc.value.status_code == 409 and "MYOB" in exc.value.detail


@pytest.mark.asyncio
async def test_a_sign_in_saved_under_another_key_asks_to_reconnect_instead_of_crashing(monkeypatch):
    import base64
    import os

    from backend.app.services import pii_service

    monkeypatch.setenv("PII_ENCRYPTION_KEY", base64.b64encode(os.urandom(32)).decode())
    sealed_elsewhere = pii_service.encrypt_field("access-1")
    monkeypatch.setenv("PII_ENCRYPTION_KEY", base64.b64encode(os.urandom(32)).decode())  # the key changed
    row = {**CONNECTION, "access_token": sealed_elsewhere}
    in_xero = {**INVOICE, "status": "sent", "xero_invoice_id": "xinv-1", "xero_status": "AUTHORISED"}
    db = _DB(xero_connections=[dict(row)], invoices=[in_xero])
    with patch.object(xs, "get_supabase_admin", return_value=db):
        with pytest.raises(xs.XeroAuthError) as exc:
            await xs._access_token(row)
        assert "Reconnect Xero" in str(exc.value)
        result = await xs.refresh_payments({**COORDINATOR})
    assert result["checked"] is False and "Reconnect Xero" in result["error"]
    assert "Reconnect Xero" in db.tables["xero_connections"][0]["last_error"]
