"""Which care-plan tasks go on a shift: shift type, local weekday, one-off /
daily / weekly, one task per template reused across shifts."""
from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch
from zoneinfo import ZoneInfo

import pytest

from backend.app.services import shift_task_service as tasks

ADELAIDE = ZoneInfo("Australia/Adelaide")
ORG, PARTICIPANT = "org-1", "p-1"


@pytest.fixture(autouse=True)
def _adelaide():
    with patch.object(tasks, "participant_timezone", return_value=ADELAIDE):
        yield


class FakeDB:
    """In-memory tables with just the query surface shift_task_service uses."""

    def __init__(self, templates=(), shifts=(), task_template_column=True):
        self.data = {
            "participant_task_templates": [dict(t) for t in templates],
            "participant_tasks": [],
            "shift_tasks": [],
            "shifts": [dict(s) for s in shifts],
        }
        self.task_template_column = task_template_column
        self._ids = 0

    def table(self, name):
        return _Query(self, name)

    def new_id(self, prefix):
        self._ids += 1
        return f"{prefix}-{self._ids}"


class _Query:
    def __init__(self, db, name):
        self.db, self.name, self.filters, self.rows_to_insert = db, name, [], None

    def select(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: str(r.get(col)) == str(val))
        return self

    def in_(self, col, vals):
        if col == "task_template_id" and not self.db.task_template_column:
            raise RuntimeError('column participant_tasks.task_template_id does not exist (42703)')
        wanted = {str(v) for v in vals}
        self.filters.append(lambda r: str(r.get(col)) in wanted)
        return self

    def insert(self, rows):
        self.rows_to_insert = rows if isinstance(rows, list) else [rows]
        return self

    def execute(self):
        table = self.db.data[self.name]
        if self.rows_to_insert is not None:
            out = []
            for row in self.rows_to_insert:
                row = {"id": self.db.new_id(self.name), **row}
                table.append(row)
                out.append(row)
            return MagicMock(data=out)
        return MagicMock(data=[r for r in table if all(f(r) for f in self.filters)])


def _template(tid="t-1", **kw):
    return {"id": tid, "participant_id": PARTICIPANT, "organization_id": ORG, "status": "active",
            "name": "Hygiene support", "description": "Assist with hygiene", "linked_goal_id": "goal-1",
            "is_mandatory": True, "evidence_required": "photo", "primary_shift_type": "morning",
            "additional_shift_types": [], "recurrence_type": "recurring", "sort_order": 1, **kw}


def _add_shift(db, sid, start, status="scheduled"):
    db.data["shifts"].append({"id": sid, "organization_id": ORG, "scheduled_start": start, "status": status})
    return tasks.generate_template_tasks(
        db, participant_id=PARTICIPANT, shift_id=sid, shift_type="morning", scheduled_start=start, org_id=ORG,
    )


# ── Matching ─────────────────────────────────────────────────────────────

def test_shift_type_rules():
    monday = date(2026, 10, 5)
    assert tasks.template_fits_shift({"primary_shift_type": "morning"}, "morning", monday)
    assert tasks.template_fits_shift({"primary_shift_type": "night", "additional_shift_types": ["morning"]}, "morning", monday)
    assert not tasks.template_fits_shift({"primary_shift_type": "night"}, "morning", monday)
    # No shift type (or "all") fits any shift.
    assert tasks.template_fits_shift({"primary_shift_type": None}, "morning", monday)
    assert tasks.template_fits_shift({"primary_shift_type": "All"}, "morning", monday)


def test_weekdays_use_the_participants_local_day():
    # 10:00 Monday in Adelaide is still Sunday in UTC.
    start = "2026-10-04T23:30:00+00:00"
    local = tasks.local_shift_date(start, PARTICIPANT, ORG)
    assert local == date(2026, 10, 5)
    mondays = {"recurrence_type": "specific_weekdays", "recurrence_weekdays": [1]}  # 0=Sunday
    assert tasks.template_fits_shift(mondays, None, local)
    assert not tasks.template_fits_shift({**mondays, "recurrence_weekdays": [0]}, None, local)


# ── One task per template, linked per shift ──────────────────────────────

def test_one_task_per_template_reused_across_shifts():
    db = FakeDB(templates=[_template()])
    first = _add_shift(db, "s1", "2026-10-04T23:30:00+00:00")
    second = _add_shift(db, "s2", "2026-10-05T23:30:00+00:00")
    assert first == second  # same task, not a new copy per shift
    assert len(db.data["participant_tasks"]) == 1
    task = db.data["participant_tasks"][0]
    assert task["task_template_id"] == "t-1" and "shift_id" not in task
    assert [(l["shift_id"], l["task_id"], l["completed"]) for l in db.data["shift_tasks"]] == [
        ("s1", task["id"], False), ("s2", task["id"], False),
    ]


def test_other_shift_types_get_nothing():
    db = FakeDB(templates=[_template()])
    db.data["shifts"].append({"id": "s1", "organization_id": ORG, "scheduled_start": "2026-10-04T23:30:00+00:00"})
    assert tasks.generate_template_tasks(
        db, participant_id=PARTICIPANT, shift_id="s1", shift_type="overnight",
        scheduled_start="2026-10-04T23:30:00+00:00", org_id=ORG,
    ) == []


# ── Frequency ────────────────────────────────────────────────────────────

def test_one_off_goes_on_the_first_shift_only():
    db = FakeDB(templates=[_template(recurrence_type="one_off")])
    assert _add_shift(db, "s1", "2026-10-04T23:30:00+00:00")
    assert _add_shift(db, "s2", "2026-10-05T23:30:00+00:00") == []


def test_one_off_is_available_again_if_its_shift_is_cancelled():
    db = FakeDB(templates=[_template(recurrence_type="one_off")])
    _add_shift(db, "s1", "2026-10-04T23:30:00+00:00")
    db.data["shifts"][0]["status"] = "cancelled"
    assert _add_shift(db, "s2", "2026-10-05T23:30:00+00:00")


def test_daily_once_per_local_day():
    db = FakeDB(templates=[_template(recurrence_frequency="daily")])
    assert _add_shift(db, "am", "2026-10-04T23:30:00+00:00")   # Mon 10:00
    assert _add_shift(db, "pm", "2026-10-05T05:30:00+00:00") == []  # Mon 16:00
    assert _add_shift(db, "tue", "2026-10-05T23:30:00+00:00")  # Tue 10:00


def test_weekly_once_per_week():
    db = FakeDB(templates=[_template(recurrence_frequency="weekly")])
    assert _add_shift(db, "mon", "2026-10-04T23:30:00+00:00")
    assert _add_shift(db, "wed", "2026-10-06T23:30:00+00:00") == []
    assert _add_shift(db, "next-mon", "2026-10-11T23:30:00+00:00")


def test_recurring_without_frequency_is_every_shift():
    db = FakeDB(templates=[_template()])
    assert _add_shift(db, "am", "2026-10-04T23:30:00+00:00")
    assert _add_shift(db, "pm", "2026-10-05T05:30:00+00:00")


# ── Attaching to a new shift ─────────────────────────────────────────────

def test_ticked_tasks_are_added_once_alongside_template_tasks():
    db = FakeDB(templates=[_template()])
    db.data["shifts"].append({"id": "s1", "organization_id": ORG, "scheduled_start": "2026-10-04T23:30:00+00:00"})
    shift = {"id": "s1", "participant_id": PARTICIPANT, "shift_type": "morning",
             "scheduled_start": "2026-10-04T23:30:00+00:00"}
    first = tasks.attach_tasks_to_new_shift(db, shift=shift, org_id=ORG, selected_task_ids=[])
    template_task = first["generated"][0]
    result = tasks.attach_tasks_to_new_shift(
        db, shift={**shift, "id": "s2"}, org_id=ORG, selected_task_ids=[template_task, "extra-task", "extra-task"],
    )
    assert result["selected"] == ["extra-task"]
    assert sorted(l["task_id"] for l in db.data["shift_tasks"] if l["shift_id"] == "s2") == sorted([template_task, "extra-task"])


def test_a_task_problem_never_blocks_creating_the_shift():
    db = MagicMock()
    db.table.side_effect = RuntimeError("db down")
    result = tasks.attach_tasks_to_new_shift(
        db, shift={"id": "s1", "participant_id": PARTICIPANT, "shift_type": "morning"}, org_id=ORG,
    )
    assert result["generated"] == [] and result["warning"]


def test_before_migration_234_tasks_are_still_added():
    db = FakeDB(templates=[_template()], task_template_column=False)
    linked = _add_shift(db, "s1", "2026-10-04T23:30:00+00:00")
    assert len(linked) == 1 and len(db.data["shift_tasks"]) == 1


# ── Endpoints ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_unassigned_shifts_keep_their_tasks_and_sleepover():
    from backend.app.api import coordinator

    supabase = MagicMock()
    supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = (
        MagicMock(data=[{"id": PARTICIPANT, "full_name": "Liam Carter"}])
    )
    inserted = {}

    def insert(_db, payload):
        inserted.update(payload)
        return MagicMock(data=[payload])

    body = coordinator.CreateUnassignedShiftBody(
        participant_id=PARTICIPANT, scheduled_start="2026-10-05T10:00:00+10:30",
        scheduled_end="2026-10-06T08:00:00+10:30", selected_task_ids=["task-a"],
        is_sleepover=True, sleepover_start="2026-10-05T22:00:00+10:30", sleepover_end="2026-10-06T06:00:00+10:30",
    )
    with patch.object(coordinator, "_require_coordinator", return_value=ORG), \
         patch.object(coordinator, "get_supabase_admin", return_value=supabase), \
         patch.object(coordinator, "_ensure_participant_active_plan", new=AsyncMock()), \
         patch.object(coordinator, "_resolve_care_coordinator_id", return_value=None), \
         patch.object(coordinator, "_insert_shift_with_legacy_fallback", side_effect=insert), \
         patch.object(coordinator, "_derive_sleepover_segments") as sleepover, \
         patch.object(coordinator.shift_task_service, "attach_tasks_to_new_shift",
                      return_value={"generated": ["tpl-task"], "selected": ["task-a"], "warning": None}) as attach:
        result = await coordinator.create_unassigned_shift(body, current_user={"id": "coord-1"})
    assert inserted["is_sleepover"] is True
    sleepover.assert_called_once()
    assert attach.call_args.kwargs["selected_task_ids"] == ["task-a"]
    assert result["tasks_linked"] == 2


class _AnyChain:
    """Every query builder call returns itself; execute() returns `rows`."""

    def __init__(self, rows):
        self.rows = rows

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        return MagicMock(data=self.rows)


@pytest.mark.asyncio
async def test_bulk_and_recurring_shifts_get_tasks_one_at_a_time():
    from backend.app.api import coordinator

    supabase = MagicMock()
    supabase.table.return_value = _AnyChain([{"id": PARTICIPANT, "full_name": "Liam Carter"}])
    order: list[str] = []

    def attach(_db, *, shift, org_id, selected_task_ids=None):
        order.append(shift["scheduled_start"])
        return {"generated": [], "selected": [], "warning": None}

    body = coordinator.BulkShiftBody(
        participant_id=PARTICIPANT, days_of_week=[0, 2], start_time="09:00", end_time="12:00",
        start_date="2026-10-05", weeks=2, selected_task_ids=["task-a"],
    )
    with patch.object(coordinator, "_require_coordinator", return_value=ORG), \
         patch.object(coordinator, "get_supabase_admin", return_value=supabase), \
         patch.object(coordinator, "_resolve_care_coordinator_id", return_value=None), \
         patch.object(coordinator, "participant_timezone", return_value=ADELAIDE), \
         patch.object(coordinator, "_insert_shift_with_legacy_fallback", side_effect=lambda _db, p: MagicMock(data=[p])), \
         patch.object(coordinator.shift_task_service, "attach_tasks_to_new_shift", side_effect=attach) as attached:
        result = await coordinator.bulk_create_shifts(body, current_user={"id": "coord-1"})
    assert result["created_count"] == 4
    assert attached.call_count == 4
    assert all(c.kwargs["selected_task_ids"] == ["task-a"] for c in attached.call_args_list)
    # Each occurrence gets its tasks as it's created, in date order, so a
    # one-off or weekly template sees the earlier ones.
    assert order == sorted(order)
