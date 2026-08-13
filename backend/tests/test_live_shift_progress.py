"""Tests for the Live Monitor board's granular progress fields (workflow_stage, checklist).

Covers the pure helpers added to coordinator.py: a mandatory-but-undocumented task must not
be reported as documented, a non-mandatory completed task is documented by completion alone,
and the workflow_stage column axis reflects clock-in/documentation/completion state.
"""

from backend.app.api.coordinator import _live_checklist_entry, _shift_workflow_stage


def _task(**overrides):
    base = {
        "task_id": "t1",
        "label": "Check vitals",
        "completed": False,
        "mandatory": True,
        "goal_title": "Health",
        "note": "",
        "marked_na": False,
    }
    base.update(overrides)
    return base


class TestLiveChecklistEntry:
    def test_mandatory_completed_without_evidence_is_not_documented(self):
        task = _task(completed=True, note="done")  # note < 20 chars, no photo/voice
        entry = _live_checklist_entry(task)
        assert entry["completed"] is True
        assert entry["documented"] is False

    def test_mandatory_completed_with_sufficient_note_is_documented(self):
        task = _task(completed=True, note="Administered medication and observed no adverse reaction")
        entry = _live_checklist_entry(task)
        assert entry["documented"] is True

    def test_non_mandatory_completed_task_is_documented_by_completion_alone(self):
        task = _task(mandatory=False, completed=True, note="")
        entry = _live_checklist_entry(task)
        assert entry["documented"] is True

    def test_incomplete_task_is_never_documented(self):
        task = _task(completed=False)
        entry = _live_checklist_entry(task)
        assert entry["documented"] is False


class TestShiftWorkflowStage:
    def test_not_clocked_in(self):
        shift = {"clocked_in_at": None, "session_id": None}
        assert _shift_workflow_stage(shift, []) == "not_clocked_in"

    def test_clocked_in_but_no_documentation_started(self):
        shift = {"clocked_in_at": "2026-08-13T09:00:00Z", "session_id": None}
        checklist = [_task(completed=False)]
        assert _shift_workflow_stage(shift, checklist) == "clocked_in"

    def test_documenting_when_session_started_but_mandatory_tasks_incomplete(self):
        shift = {"clocked_in_at": "2026-08-13T09:00:00Z", "session_id": "sess-1"}
        checklist = [_task(completed=False)]
        assert _shift_workflow_stage(shift, checklist) == "documenting"

    def test_wrapping_up_when_all_mandatory_tasks_documented(self):
        shift = {"clocked_in_at": "2026-08-13T09:00:00Z", "session_id": "sess-1"}
        checklist = [_task(completed=True, note="Administered medication, no adverse reaction observed")]
        assert _shift_workflow_stage(shift, checklist) == "wrapping_up"

    def test_documenting_when_some_task_completion_signals_started_but_not_all_mandatory_done(self):
        shift = {"clocked_in_at": "2026-08-13T09:00:00Z", "session_id": None}
        checklist = [
            _task(task_id="t1", completed=True, note="Administered medication, no adverse reaction"),
            _task(task_id="t2", completed=False),
        ]
        assert _shift_workflow_stage(shift, checklist) == "documenting"
