"""Participant goal outcomes on the director dashboard come from the goals themselves."""

from unittest.mock import patch

from backend.app.api import dashboards


class _Query:
    def __init__(self, table, store, calls):
        self.table, self.store, self.calls, self.filters = table, store, calls, {}

    def select(self, *args, **kwargs):
        return self

    def in_(self, column, values):
        self.filters[column] = set(values)
        return self

    def __getattr__(self, name):
        return lambda *args, **kwargs: self

    def execute(self):
        self.calls.append(self.table)
        if self.store.get("fail") == self.table:
            raise Exception("boom")
        rows = self.store.get(self.table, [])
        for column, allowed in self.filters.items():
            rows = [r for r in rows if r.get(column) in allowed]
        return type("Result", (), {"data": rows})()


class _Client:
    def __init__(self, store):
        self.store, self.calls = store, []

    def table(self, name):
        return _Query(name, self.store, self.calls)


GOALS = [
    {"id": "g1", "participant_id": "p1", "status": "active"},
    {"id": "g2", "participant_id": "p1", "status": "completed"},
    {"id": "g3", "participant_id": "p2", "status": "active"},
    {"id": "g4", "participant_id": "p2", "status": "active"},
    # Another branch's participant: not counted.
    {"id": "g5", "participant_id": "p9", "status": "completed"},
]


def _outcomes(store, participants=("p1", "p2")):
    with patch.object(dashboards, "get_supabase_admin", return_value=_Client(store)):
        return dashboards._goal_outcomes("org-1", set(participants))


def test_counts_achieved_goals_and_goals_with_support_recorded():
    result = _outcomes({
        "ndis_goals": GOALS,
        "shift_visit_notes": [{"goal_id": "g1"}, {"goal_id": "g1"}, {"goal_id": "g4"}],
    })
    assert result == {
        "goals_total": 4,
        "goals_achieved": 1,
        "goals_active": 3,
        "goal_outcome_rate": 25.0,
        "active_goals_supported_30d": 2,
    }


def test_no_goals_reads_as_none_not_zero_percent():
    result = _outcomes({"ndis_goals": []})
    assert result["goals_total"] == 0
    assert result["goal_outcome_rate"] is None
    assert result["active_goals_supported_30d"] == 0


def test_unreadable_goals_are_not_available_rather_than_made_up():
    result = _outcomes({"fail": "ndis_goals"})
    assert all(value is None for value in result.values())


def test_unreadable_notes_leave_only_the_support_figure_unknown():
    result = _outcomes({"ndis_goals": GOALS, "fail": "shift_visit_notes"})
    assert result["goals_achieved"] == 1
    assert result["active_goals_supported_30d"] is None
