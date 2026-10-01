"""The live monitor marks completed shifts already through verification (so
the board stops offering "Review shift"), carries each checklist task's
completion time, and never shows a participant's name as the worker."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from backend.app.api import coordinator
from backend.app.services import medication_service, shift_service

SC = {"sub": "sc-1", "role": "support_coordinator", "organization_id": "org-1"}

SHIFTS = [
    {"id": "done-verified", "organization_id": "org-1", "worker_id": "w1", "participant_name": "Liam",
     "status": "completed", "clocked_in_at": "2026-10-01T00:00:00Z", "clocked_out_at": "2026-10-01T04:00:00Z",
     "scheduled_start": "2026-10-01T00:00:00Z"},
    {"id": "done-pending", "organization_id": "org-1", "worker_id": "w1", "participant_name": "Ava",
     "status": "completed", "clocked_in_at": "2026-10-01T00:00:00Z", "clocked_out_at": "2026-10-01T04:00:00Z",
     "scheduled_start": "2026-10-01T00:00:00Z"},
    {"id": "open", "organization_id": "org-1", "worker_id": None, "participant_name": "Noah",
     "status": "scheduled", "scheduled_start": "2099-10-01T00:00:00Z"},
]


class _Query:
    def __init__(self, rows):
        self._rows = rows

    def __getattr__(self, _name):
        return lambda *a, **k: self

    def execute(self):
        return MagicMock(data=self._rows)


def _db(verification_calls: list):
    client = MagicMock()

    def table(name):
        if name == "users":
            return _Query([{"id": "w1", "full_name": "Priya Sharma"}])
        if name == "shift_verifications":
            q = _Query([{"shift_id": "done-verified"}])
            original_in = q.__getattr__("in_")

            def in_(col, values):
                verification_calls.append(list(values))
                return original_in(col, values)

            q.in_ = in_
            return q
        return _Query([])

    client.table.side_effect = table
    return client


@pytest.mark.asyncio
async def test_live_shifts_flag_verified_and_keep_worker_honest():
    calls: list = []
    tasks = [{"task_id": "t1", "label": "Meds", "completed": True, "completed_at": "2026-10-01T00:30:00Z"},
             {"task_id": "t2", "label": "Lunch", "completed": False, "completed_at": None}]
    with patch.object(coordinator, "get_supabase_admin", return_value=_db(calls)), \
         patch.object(coordinator, "_fetch_live_shifts_raw", return_value=[dict(s) for s in SHIFTS]), \
         patch.object(shift_service, "_resolve_shift_checklist_tasks", return_value=tasks), \
         patch.object(medication_service, "build_shift_medication_checklist", return_value=[]):
        result = await coordinator.get_live_shifts(SC)

    by_id = {r["id"]: r for r in result}
    assert by_id["done-verified"]["verified"] is True
    assert by_id["done-pending"]["verified"] is False
    assert by_id["open"]["verified"] is False
    # Only completed shifts are looked up.
    assert calls == [["done-verified", "done-pending"]]
    assert by_id["done-pending"]["worker_name"] == "Priya Sharma"
    assert by_id["open"]["worker_name"] is None
    checklist = by_id["done-pending"]["checklist"]
    assert checklist[0]["completed_at"] == "2026-10-01T00:30:00Z"
    assert checklist[1]["completed_at"] is None
