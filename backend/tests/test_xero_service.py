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
        ("GET", "/Invoices"): {"Invoices": [{"InvoiceID": "xinv-7", "Type": "ACCREC", "Status": "DRAFT"}]},
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
