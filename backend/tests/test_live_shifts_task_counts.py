"""Live Monitoring counts the tasks the worker actually ticked off. The
query used to leave out shifts.tasks, so the checklist fell back to the
blank template and every shift read "Tasks 0 of N"."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from backend.app.api import coordinator
from backend.app.services import shift_service


class _Query:
    def __init__(self, selects: list[str], rows):
        self._selects = selects
        self._rows = rows

    def select(self, columns):
        self._selects.append(columns)
        return self

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        return MagicMock(data=self._rows)


def test_live_query_fetches_the_checklist():
    selects: list[str] = []
    db = MagicMock()
    db.table.side_effect = lambda name: _Query(selects, [])
    coordinator._fetch_live_shifts_raw(db, "org-1", "2026-10-30T00:00:00Z")
    columns = {c.strip() for c in selects[0].split(",")}
    assert "tasks" in columns


def test_ticked_tasks_are_counted():
    shift = {
        "id": "s1", "participant_id": "p1", "scheduled_start": "2026-10-30T09:00:00+10:30",
        "tasks": [{"id": "a", "completed": True}, {"id": "b", "completed": True}, {"id": "c", "completed": False}],
    }
    with patch.object(shift_service, "_load_tasks_from_shift_tasks", return_value=[]):
        tasks = shift_service._resolve_shift_checklist_tasks(shift, "org-1")
    assert sum(1 for t in tasks if t.get("completed")) == 2
