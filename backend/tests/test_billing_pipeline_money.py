"""Roster to invoice: what verification charges the plan is what the invoice
bills, at the verified rate, whatever the clock times or how many tasks the
shift had. Also: a note written after the shift still lets it be verified, a
half-saved verification is undone, and two invoices can't share shifts."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import billing_service, invoice_service
from backend.app.services import shift_verification_service as svc

RATE = 70.23  # charged at the NDIS price limit, as many providers do
PRICE = {"item_code": "01_011_0107_1_1", "effective_price": RATE, "support_purpose": "Core Supports", "unit": "H"}
PLAN = {"id": "plan-1", "plan_budgets": [{"id": "budget-1", "category": "core", "used_amount": 0}]}
NOTE = {"id": "session-1", "compliance_input_text": "Supported Liam with his morning routine."}
USER = {"id": "coord-1", "organization_id": "org-1", "role": "support_coordinator"}


class _Query:
    """Just enough of a PostgREST query, filtering an in-memory table."""

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

    def limit(self, *_a):
        return self

    def order(self, *_a, **_k):
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
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
        if self.op == "insert":
            if self.table in self.db.insert_errors:
                raise self.db.insert_errors[self.table]
            row = {"id": f"{self.table}-{len(rows) + 1}", **self.payload}
            rows.append(row)
            return MagicMock(data=[row])
        hit = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in hit:
                r.update(self.payload)
        if self.op == "delete":
            self.db.tables[self.table] = [r for r in rows if r not in hit]
        return MagicMock(data=hit)


class _DB:
    def __init__(self, **tables):
        self.tables = {name: list(rows) for name, rows in tables.items()}
        self.insert_errors: dict = {}
        self.calls: list = []

    def table(self, name):
        return _Query(self, name)

    def ops(self, table, op):
        return [payload for t, o, payload in self.calls if t == table and o == op]


def _shift(shift_id="shift-1", clock_in="09:00:00", clock_out="11:20:00", scheduled_end="11:20:00", tasks=0):
    day = "2026-09-01T"
    shift = {
        "id": shift_id, "organization_id": "org-1", "participant_id": "p-1", "worker_id": "w-1",
        "status": "completed", "session_id": "session-1", "tasks": [],
        "scheduled_start": f"{day}09:00:00+09:30", "scheduled_end": f"{day}{scheduled_end}+09:30",
        "clocked_in_at": f"{day}{clock_in}+09:30", "clocked_out_at": f"{day}{clock_out}+09:30",
    }
    task_ids = [f"{shift_id}-task-{i}" for i in range(tasks)]
    return shift, task_ids


def _db_for(shift, task_ids):
    return _DB(
        shifts=[shift],
        shift_tasks=[{"shift_id": shift["id"], "task_id": t, "organization_id": "org-1"} for t in task_ids],
        participant_tasks=[{"id": t, "participant_id": "p-1", "organization_id": "org-1"} for t in task_ids],
    )


async def _verify(db, shift, session=NOTE):
    with patch.object(svc, "get_supabase_admin", return_value=db), \
         patch.object(svc, "get_plan_for_participant", new=AsyncMock(return_value=PLAN)), \
         patch.object(svc.ndis_pricing_service, "resolve_price", new=AsyncMock(return_value=PRICE)), \
         patch.object(svc, "_get_session_for_shift", return_value=session), \
         patch.object(svc, "_get_public_holidays", return_value=set()), \
         patch.object(svc, "_agreement_assessment", return_value=None), \
         patch.object(svc, "_price_limit", return_value=RATE), \
         patch.object(svc.agreement_support_service, "check_level", return_value="reason"), \
         patch.object(svc, "_apply_budget_change", return_value=0.0) as charge:
        result = await svc.verify_shift(shift["id"], "coord-1", PRICE["item_code"], "org-1")
    return result, charge


async def _invoice(db, completions_db):
    """create_invoice()'s from-verified-shifts path over what verification wrote."""
    completions = [
        {**c, "ndis_price_items": {"name": "Self-care weekday", "unit": "H", "price_national": RATE},
         "rate": invoice_service._verified_rates_for_shifts(completions_db, [c], "org-1").get(str(c["shift_id"]))}
        for c in completions_db.tables.get("task_completions", [])
    ]
    with patch.object(billing_service, "_verify_invoice_scope", new=AsyncMock()), \
         patch.object(billing_service, "get_supabase_admin", return_value=db), \
         patch.object(billing_service.invoice_service, "get_completed_tasks_for_period", return_value=completions), \
         patch.object(billing_service.billing_period_service, "get_or_open_billing_period", return_value={"id": "bp-1"}), \
         patch.object(billing_service.audit_service, "log_action", new=AsyncMock()), \
         patch("backend.app.services.ndis_pricing_service.price_limit_breaches",
                      side_effect=lambda lines: [f"{l['item_code']} over the limit" for l in lines
                                                 if l["unit_amount_cents"] > round(RATE * 100)]):
        return await billing_service.create_invoice(USER, {
            "participant_id": "p-1", "recipient_name": "Plan Manager", "status": "draft",
            "generate_from_verified_tasks": True, "period_start": "2026-09-01", "period_end": "2026-09-30",
            "due_date": "2026-10-14",
        })


# ── What's charged is what's invoiced ───────────────────────────────────

@pytest.mark.parametrize("clock_out,scheduled_end,tasks,minutes,charged", [
    ("10:40:00", "10:40:00", 3, 100, 117.05),   # used to invoice $70.95/h: over the limit, refused
    ("11:20:00", "11:20:00", 3, 140, 163.87),   # used to invoice 2.35 h x $69.73
    ("10:59:47", "11:00:00", 1, 120, 140.46),   # clocked to the second: used to charge 119.58 min
    ("11:20:00", "11:20:00", 0, 140, 163.87),
])
@pytest.mark.asyncio
async def test_the_invoice_bills_what_verification_charged_at_the_verified_rate(
    clock_out, scheduled_end, tasks, minutes, charged,
):
    shift, task_ids = _shift(clock_in="09:00:12" if clock_out == "10:59:47" else "09:00:00",
                             clock_out=clock_out, scheduled_end=scheduled_end, tasks=tasks)
    db = _db_for(shift, task_ids)
    result, charge = await _verify(db, shift)
    assert result["billed_amount"] == charged
    assert charge.call_args.kwargs["duration_minutes"] == minutes

    completions = db.tables["task_completions"]
    assert sum(c["duration_minutes"] for c in completions) == minutes  # shares add back up
    assert round(sum(c["billed_amount"] for c in completions), 2) == charged

    db.tables["shift_verifications"] = [{"shift_id": shift["id"], "organization_id": "org-1",
                                         "hourly_rate_applied": RATE, "reversed_at": None}]
    invoice = await _invoice(db, db)
    [line] = invoice["line_items"]
    assert line["unit_amount_cents"] == 7023
    assert line["quantity"] == round(minutes / 60, 6)
    assert invoice["total_cents"] == round(charged * 100)


@pytest.mark.asyncio
async def test_a_month_of_shifts_is_one_line_at_the_agreed_rate():
    db = _DB()
    charged = 0.0
    for day in range(1, 13):
        shift, task_ids = _shift(f"shift-{day}", clock_in=f"09:00:{day * 7 % 60:02d}",
                                 clock_out=f"11:{29 + day % 3:02d}:{day * 13 % 60:02d}", scheduled_end="11:30:00", tasks=2)
        for name, rows in _db_for(shift, task_ids).tables.items():
            db.tables.setdefault(name, []).extend(rows)
        result, _ = await _verify(db, shift)
        charged += result["billed_amount"]
        db.tables.setdefault("shift_verifications", []).append(
            {"shift_id": shift["id"], "organization_id": "org-1", "hourly_rate_applied": RATE, "reversed_at": None})
    invoice = await _invoice(db, db)
    [line] = invoice["line_items"]
    assert line["unit_amount_cents"] == 7023
    # Each shift is charged to the cent; the line is the month's hours x the
    # rate — within a cent or two of the shifts' sum, never a different rate.
    assert abs(invoice["total_cents"] - round(charged * 100)) <= 6


def test_shifts_verified_at_different_rates_stay_separate_lines():
    care = {"name": "Self-care", "unit": "H", "price_national": RATE}
    items = invoice_service.aggregate_line_items([
        {"id": "c1", "price_item_code": "01_011", "duration_minutes": 60, "billed_amount": 70.23,
         "completion_date": "2026-09-01", "ndis_price_items": care, "rate": 70.23},
        {"id": "c2", "price_item_code": "01_011", "duration_minutes": 60, "billed_amount": 72.00,
         "completion_date": "2026-09-20", "ndis_price_items": care, "rate": 72.00},
    ])
    assert sorted(str(i["rate"]) for i in items.values()) == ["70.23", "72.0"]


# ── A note written after the shift ended ────────────────────────────────

@pytest.mark.asyncio
async def test_a_note_written_after_the_shift_still_lets_it_be_verified():
    shift, task_ids = _shift()
    db = _db_for(shift, task_ids)
    late = "Supported Liam to the shops; he chose lunch himself."
    with patch("backend.app.services.shift_service.aggregate_shift_visit_notes_text", return_value=late):
        assert svc._note_text_for_shift(shift, {"id": "session-1", "notes": ""}) == late
        result, _ = await _verify(db, shift, session={"id": "session-1", "notes": ""})
    assert result["checks"]["note"]["present"]
    # Kept as the session's record too, as ending the shift would have.
    assert db.ops("sessions", "update")[0]["compliance_input_text"] == late


@pytest.mark.asyncio
async def test_still_no_note_anywhere_still_blocks_verification():
    shift, task_ids = _shift()
    with patch("backend.app.services.shift_service.aggregate_shift_visit_notes_text", return_value="  "), \
         pytest.raises(ValueError, match="no progress note"):
        await _verify(_db_for(shift, task_ids), shift, session={"id": "session-1", "notes": ""})


# ── A half-saved verification ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_verification_whose_billing_record_fails_is_undone_and_refunded():
    shift, task_ids = _shift()
    db = _db_for(shift, task_ids)
    db.insert_errors["task_completions"] = RuntimeError("db down")
    with patch.object(svc, "get_supabase_admin", return_value=db), \
         patch.object(svc, "get_plan_for_participant", new=AsyncMock(return_value=PLAN)), \
         patch.object(svc.ndis_pricing_service, "resolve_price", new=AsyncMock(return_value=PRICE)), \
         patch.object(svc, "_get_session_for_shift", return_value=NOTE), \
         patch.object(svc, "_get_public_holidays", return_value=set()), \
         patch.object(svc, "_agreement_assessment", return_value=None), \
         patch.object(svc, "_price_limit", return_value=None), \
         patch.object(svc, "_apply_budget_change", return_value=163.87) as charge, \
         pytest.raises(ValueError, match="undone and the plan budget refunded"):
        await svc.verify_shift("shift-1", "coord-1", PRICE["item_code"], "org-1")
    charge_amounts = [c.kwargs["amount"] for c in charge.call_args_list]
    assert charge_amounts == [163.87, -163.87]
    assert charge.call_args.kwargs["budget"]["used_amount"] == 163.87  # refunded from the new balance
    assert db.ops("shift_verifications", "update")[0]["reversal_reason"].startswith("Undone automatically")


# ── Two invoices at once ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_an_invoice_whose_shifts_were_taken_meanwhile_is_not_created():
    shift, task_ids = _shift()
    db = _db_for(shift, task_ids)
    await _verify(db, shift)
    db.tables["shift_verifications"] = [{"shift_id": "shift-1", "organization_id": "org-1",
                                         "hourly_rate_applied": RATE, "reversed_at": None}]
    snapshot = [dict(c) for c in db.tables["task_completions"]]
    # Another invoice links the shift between this one reading and linking it.
    for row in db.tables["task_completions"]:
        row["invoice_id"] = "other-invoice"
    completions_db = _DB(task_completions=snapshot, shift_verifications=db.tables["shift_verifications"])
    with pytest.raises(HTTPException) as refused:
        await _invoice(db, completions_db)
    assert refused.value.status_code == 409
    assert db.tables["invoices"] == []  # discarded
    assert all(c["invoice_id"] == "other-invoice" for c in db.tables["task_completions"])
