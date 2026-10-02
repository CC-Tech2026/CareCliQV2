"""Shift verification safety: a progress note is required, billing uses the
time worked (no more than scheduled unless approved), the budget charge and
its ledger row are one call, and a verification can be reversed."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.app.services import shift_verification_service as svc

PRICE = {"item_code": "01_011_0107_1_1", "effective_price": 60.0, "support_purpose": "Core Supports", "unit": "H"}
PLAN = {"id": "plan-1", "plan_budgets": [{"id": "budget-1", "category": "core", "used_amount": 100}]}
NOTE = {"id": "session-1", "compliance_input_text": "Supported Liam to cook lunch and walk to the park."}


def _shift(clock_in="2026-09-01T09:00:00+00:00", clock_out="2026-09-01T11:00:00+00:00", **kw):
    return {
        "id": "shift-1", "organization_id": "org-1", "participant_id": "p-1", "worker_id": "w-1",
        "status": "completed", "session_id": "session-1", "tasks": [],
        "scheduled_start": "2026-09-01T09:00:00+00:00", "scheduled_end": "2026-09-01T11:00:00+00:00",
        "duration_minutes": 120, "clocked_in_at": clock_in, "clocked_out_at": clock_out, **kw,
    }


class _Query:
    """Chainable stand-in for a PostgREST query: every builder method returns
    itself; execute() returns the canned rows and records the operation."""

    def __init__(self, db, table):
        self.db, self.table, self.op, self.payload = db, table, "select", None

    def __getattr__(self, _name):
        return lambda *a, **k: self

    @property
    def not_(self):  # .not_.is_(...) — a property in postgrest-py, not a method
        return self

    def insert(self, payload, *a, **k):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload, *a, **k):
        self.op, self.payload = "update", payload
        return self

    def delete(self, *a, **k):
        self.op = "delete"
        return self

    def execute(self):
        self.db.calls.append((self.table, self.op, self.payload))
        if self.op == "insert" and self.table in self.db.insert_errors:
            raise self.db.insert_errors[self.table]
        return MagicMock(data=self.db.rows.get((self.table, self.op), []))


class _DB:
    def __init__(self, rows=None, insert_errors=None):
        self.rows = rows or {}
        self.insert_errors = insert_errors or {}
        self.calls: list = []
        self.rpc = MagicMock()

    def table(self, name):
        return _Query(self, name)

    def ops(self, table, op):
        return [payload for t, o, payload in self.calls if t == table and o == op]


def _verify_db(shift):
    return _DB(rows={
        ("shifts", "select"): [shift],
        ("shift_verifications", "insert"): [{"id": "ver-1"}],
        ("task_completions", "insert"): [{"id": "tc-1"}],
    })


async def _verify(db, shift, session=NOTE, **kw):
    with patch.object(svc, "get_supabase_admin", return_value=db), \
         patch.object(svc, "get_plan_for_participant", new=AsyncMock(return_value=PLAN)), \
         patch.object(svc.ndis_pricing_service, "resolve_price", new=AsyncMock(return_value=PRICE)), \
         patch.object(svc, "_get_session_for_shift", return_value=session), \
         patch.object(svc, "_get_public_holidays", return_value=set()):
        return await svc.verify_shift("shift-1", "coord-1", PRICE["item_code"], "org-1", **kw)


# ── Billable time ────────────────────────────────────────────────────────

def test_worked_time_comes_from_the_clock_not_the_schedule():
    # duration_minutes is the scheduled 120; the worker left after 90.
    left_early = _shift(clock_out="2026-09-01T10:30:00+00:00")
    assert svc._actual_minutes(left_early) == 90
    assert svc.billable_minutes(left_early)["billable_minutes"] == 90


def test_time_over_the_schedule_needs_approval():
    stayed_late = _shift(clock_in="2026-09-01T08:30:00+00:00")  # 2.5 h for a 2 h shift
    capped = svc.billable_minutes(stayed_late)
    assert (capped["billable_minutes"], capped["extra_minutes"], capped["capped_at_scheduled"]) == (120, 30, True)
    approved = svc.billable_minutes(stayed_late, approve_extra_time=True)
    assert (approved["billable_minutes"], approved["extra_time_approved"]) == (150, True)


def test_checks_flag_a_missing_note_and_extra_time():
    checks = svc.compute_verification_checks(_shift(clock_in="2026-09-01T08:30:00+00:00"), {"id": "s", "notes": ""})
    assert checks["note"]["flagged"] and checks["extra_time"]["flagged"] and checks["any_flagged"]
    ok = svc.compute_verification_checks(_shift(), NOTE)
    assert not ok["note"]["flagged"] and not ok["extra_time"]["flagged"]


# ── Verifying ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_no_progress_note_no_verification():
    db = _verify_db(_shift())
    with patch.object(svc, "_apply_budget_change") as charge, pytest.raises(ValueError, match="no progress note"):
        await _verify(db, _shift(), session={"id": "session-1", "notes": "  "})
    charge.assert_not_called()
    assert db.ops("shift_verifications", "insert") == []


@pytest.mark.asyncio
async def test_extra_time_is_billed_at_scheduled_unless_approved_with_a_reason():
    shift = _shift(clock_in="2026-09-01T08:30:00+00:00")
    with patch.object(svc, "_apply_budget_change", return_value=0.0) as charge:
        result = await _verify(_verify_db(shift), shift)
    assert result["billed_amount"] == 120.0  # 2 h x $60, not 2.5 h
    assert charge.call_args.kwargs["duration_minutes"] == 120

    with pytest.raises(ValueError, match="reason"):
        await _verify(_verify_db(shift), shift, approve_extra_time=True, extra_time_reason="")

    db = _verify_db(shift)
    with patch.object(svc, "_apply_budget_change", return_value=0.0):
        result = await _verify(db, shift, approve_extra_time=True, extra_time_reason="Hospital visit ran late")
    assert result["billed_amount"] == 150.0
    saved = db.ops("shift_verifications", "insert")[0]["checks_run"]["billing"]
    assert saved["extra_time_approved"] and saved["extra_time_reason"] == "Hospital visit ran late"


@pytest.mark.asyncio
async def test_a_failed_budget_charge_undoes_the_verification():
    db = _verify_db(_shift())
    with patch.object(svc, "_apply_budget_change", side_effect=RuntimeError("db down")), \
         pytest.raises(ValueError, match="wasn't verified"):
        await _verify(db, _shift())
    assert ("shift_verifications", "delete", None) in db.calls
    assert db.ops("task_completions", "insert") == []


@pytest.mark.asyncio
async def test_a_second_verification_of_the_same_shift_is_refused():
    db = _verify_db(_shift())
    db.insert_errors["shift_verifications"] = RuntimeError('duplicate key value violates unique constraint (23505)')
    with patch.object(svc, "_apply_budget_change") as charge, pytest.raises(ValueError, match="already been verified"):
        await _verify(db, _shift())
    charge.assert_not_called()


# ── The budget charge ────────────────────────────────────────────────────

def test_budget_and_ledger_are_one_database_call():
    db = _DB()
    db.rpc.return_value.execute.return_value = MagicMock(data=220.0)
    with patch.object(svc, "get_supabase_admin", return_value=db):
        new_used = svc._apply_budget_change(
            budget={"id": "budget-1", "used_amount": 100}, plan_id="plan-1", amount=120.0, category="core",
            hourly_rate=60.0, duration_minutes=120, description="x", verification_id="ver-1", session_id=None,
        )
    assert new_used == 220.0
    name, params = db.rpc.call_args.args
    assert name == "apply_plan_budget_change" and params["p_amount"] == 120.0 and params["p_verification_id"] == "ver-1"
    assert db.calls == []  # no separate table writes


def test_budget_falls_back_before_the_migration():
    db = _DB()
    db.rpc.return_value.execute.side_effect = RuntimeError("PGRST202 Could not find the function apply_plan_budget_change")
    with patch.object(svc, "get_supabase_admin", return_value=db):
        new_used = svc._apply_budget_change(
            budget={"id": "budget-1", "used_amount": 100}, plan_id="plan-1", amount=120.0, category="core",
            hourly_rate=60.0, duration_minutes=120, description="x", verification_id="ver-1", session_id=None,
        )
    assert new_used == 220.0
    assert db.ops("plan_budgets", "update") == [{"used_amount": 220.0}]
    assert db.ops("budget_usage", "insert")[0]["shift_verification_id"] == "ver-1"


# ── Reversing ────────────────────────────────────────────────────────────

ACTIVE = {"id": "ver-1", "shift_id": "shift-1", "organization_id": "org-1", "support_category": "core",
          "hourly_rate_applied": 60.0}


def _reverse_db(invoiced=False):
    return _DB(rows={
        ("task_completions", "select"): [{"id": "tc-1", "invoice_id": "inv-1"}] if invoiced else [],
        ("budget_usage", "select"): [{"plan_id": "plan-1", "category": "core", "amount": 120.0, "session_id": None}],
        ("plan_budgets", "select"): [{"id": "budget-1", "used_amount": 220}],
    })


@pytest.mark.asyncio
async def test_reversal_refunds_the_budget_and_returns_the_shift_to_the_queue():
    db = _reverse_db()
    with patch.object(svc, "get_supabase_admin", return_value=db), \
         patch.object(svc, "_active_verification", return_value=ACTIVE), \
         patch.object(svc, "_apply_budget_change", return_value=100.0) as charge:
        result = await svc.reverse_verification("shift-1", "coord-1", "org-1", "Wrong support item chosen")
    assert result["refunded_amount"] == 120.0
    assert charge.call_args.kwargs["amount"] == -120.0
    reversed_row = db.ops("shift_verifications", "update")[0]
    assert reversed_row["reversed_by"] == "coord-1" and reversed_row["reversal_reason"] == "Wrong support item chosen"
    assert db.ops("task_completions", "update")[0]["status"] == "submitted"


@pytest.mark.asyncio
async def test_reversal_is_refused_once_invoiced_or_without_a_reason():
    db = _reverse_db(invoiced=True)
    with patch.object(svc, "get_supabase_admin", return_value=db), \
         patch.object(svc, "_active_verification", return_value=ACTIVE), \
         patch.object(svc, "_apply_budget_change") as charge:
        with pytest.raises(ValueError, match="Cancel that invoice first"):
            await svc.reverse_verification("shift-1", "coord-1", "org-1", "Wrong support item chosen")
        with pytest.raises(ValueError, match="reason"):
            await svc.reverse_verification("shift-1", "coord-1", "org-1", "no")
    charge.assert_not_called()
    assert db.ops("shift_verifications", "update") == []


@pytest.mark.asyncio
async def test_reversal_needs_the_migration_before_refunding():
    db = _reverse_db()
    real_table = db.table

    def table(name):
        q = real_table(name)
        if name == "shift_verifications":
            q.execute = lambda: (_ for _ in ()).throw(RuntimeError('column "reversed_at" does not exist (42703)'))
        return q

    db.table = table
    with patch.object(svc, "get_supabase_admin", return_value=db), \
         patch.object(svc, "_apply_budget_change") as charge, \
         pytest.raises(ValueError, match="migration 233"):
        await svc.reverse_verification("shift-1", "coord-1", "org-1", "Wrong support item chosen")
    charge.assert_not_called()
