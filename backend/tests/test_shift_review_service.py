"""Where a worker's finished shifts stand with the office (shift_review_service)."""

from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from backend.app.services import conversation_service, shift_review_service


class _Query:
    """Enough of the supabase query builder for these tests: eq/neq/in_/is_/gte
    filters, order, limit, select, update and insert on in-memory rows."""

    def __init__(self, db, table):
        self.db, self.table, self.filters, self.update_values, self.insert_values = db, table, [], None, None
        self.single = False

    def select(self, *args, **kwargs):
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: str(r.get(col)) == str(val) if not isinstance(val, bool) else r.get(col) is val)
        return self

    def neq(self, col, val):
        self.filters.append(lambda r: str(r.get(col)) != str(val))
        return self

    def in_(self, col, vals):
        vals = {str(v) for v in vals}
        self.filters.append(lambda r: str(r.get(col)) in vals)
        return self

    def is_(self, col, val):
        self.filters.append(lambda r: r.get(col) is None)
        return self

    def gte(self, col, val):
        self.filters.append(lambda r: str(r.get(col) or "") >= str(val))
        return self

    def order(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def maybe_single(self):
        self.single = True
        return self

    def update(self, values):
        self.update_values = values
        return self

    def insert(self, values):
        self.insert_values = values
        return self

    def execute(self):
        rows = self.db.setdefault(self.table, [])
        if self.insert_values is not None:
            row = {"id": f"{self.table}-{len(rows) + 1}", "created_at": datetime.now(timezone.utc).isoformat(), **self.insert_values}
            rows.append(row)
            return type("R", (), {"data": [row]})()
        matched = [r for r in rows if all(f(r) for f in self.filters)]
        if self.update_values is not None:
            for r in matched:
                r.update(self.update_values)
        data = (matched[0] if matched else None) if self.single else matched
        return type("R", (), {"data": data})()


class _Client:
    def __init__(self, db):
        self.db = db

    def table(self, name):
        return _Query(self.db, name)


NOW = datetime.now(timezone.utc)


def _iso(days_ago: int) -> str:
    return (NOW - timedelta(days=days_ago)).isoformat()


def _db():
    return {
        "shifts": [
            {"id": "s-waiting", "worker_id": "w1", "organization_id": "org", "status": "completed", "participant_name": "Ben", "scheduled_start": _iso(1), "session_id": "sess-1", "created_by": "coord"},
            {"id": "s-changes", "worker_id": "w1", "organization_id": "org", "status": "completed", "participant_name": "Ava", "scheduled_start": _iso(3), "session_id": "sess-2", "created_by": "coord"},
            {"id": "s-verified", "worker_id": "w1", "organization_id": "org", "status": "completed", "participant_name": "Max", "scheduled_start": _iso(2), "session_id": "sess-3", "created_by": "coord"},
            {"id": "s-other", "worker_id": "w2", "organization_id": "org", "status": "completed", "participant_name": "Zed", "scheduled_start": _iso(1)},
        ],
        "shift_verifications": [{"shift_id": "s-verified", "reversed_at": None}],
        "conversations": [{"id": "c-changes", "shift_id": "s-changes", "worker_id": "w1", "organization_id": "org", "coordinator_id": None, "status": "active"}],
        "conversation_messages": [
            {"id": "m1", "conversation_id": "c-changes", "sender_id": "md", "body": "Please add how Ava responded.", "requires_action": True, "actioned_at": None, "read_at": None, "created_at": _iso(2)},
        ],
        "sessions": [{"id": "sess-1", "compliance_score": 92}, {"id": "sess-2", "compliance_score": 64}],
        "users": [{"id": "md", "full_name": "Morgan Lee"}],
    }


@pytest.fixture
def db():
    data = _db()
    client = _Client(data)
    with (
        patch.object(shift_review_service, "get_supabase_admin", return_value=client),
        patch.object(conversation_service, "get_supabase_admin", return_value=client),
        patch("backend.app.services.shift_service.get_supabase_admin", return_value=client),
        patch("backend.app.services.shift_service.get_shift_by_id", side_effect=lambda sid: copy.deepcopy(next((s for s in data["shifts"] if s["id"] == sid), None))),
    ):
        yield data


def test_overview_lists_unverified_shifts_with_changes_requested_first(db):
    result = shift_review_service.list_worker_shift_reviews("w1", "org")
    assert [(s["shift_id"], s["review_status"]) for s in result["shifts"]] == [
        ("s-changes", "changes_requested"),
        ("s-waiting", "awaiting_review"),
    ]
    assert result["counts"] == {"changes_requested": 1, "awaiting_review": 1, "verified": 1}
    assert result["shifts"][0]["open_requests"] == 1
    assert result["shifts"][0]["compliance_score"] == 64


def test_history_includes_verified_shifts(db):
    ids = [s["shift_id"] for s in shift_review_service.list_worker_shift_reviews("w1", "org", include_verified=True)["shifts"]]
    assert ids[-1] == "s-verified"


def test_thread_shows_the_request_and_allows_notes_only_while_changes_are_requested(db):
    thread = shift_review_service.get_worker_shift_thread("s-changes", "w1", "org")
    assert thread["review_status"] == "changes_requested"
    assert thread["can_add_notes"] is True
    [request] = thread["messages"]
    assert request["kind"] == "change_request" and request["from_worker"] is False
    assert request["sender_name"] == "Morgan Lee"
    # Reading the thread marks the office's message read.
    assert db["conversation_messages"][0]["read_at"]

    waiting = shift_review_service.get_worker_shift_thread("s-waiting", "w1", "org")
    assert waiting["review_status"] == "awaiting_review" and waiting["can_add_notes"] is False


def test_another_workers_shift_is_not_found(db):
    assert shift_review_service.get_worker_shift_thread("s-other", "w1", "org") is None


def test_sending_back_closes_the_requests_and_tells_whoever_asked(db):
    result = shift_review_service.send_back_for_review("s-changes", "w1", "org", None)
    assert db["conversation_messages"][0]["actioned_at"]
    assert result["notify_id"] == "md"
    assert result["message"]["body"] == shift_review_service.SENT_BACK_DEFAULT
    assert shift_review_service.get_worker_shift_thread("s-changes", "w1", "org")["review_status"] == "awaiting_review"
    assert shift_review_service.office_review_states(["s-changes"]) == {"s-changes": "sent_back"}


def test_sending_back_with_nothing_requested_is_refused(db):
    with pytest.raises(ValueError):
        shift_review_service.send_back_for_review("s-waiting", "w1", "org", "done")


def test_worker_can_message_about_a_waiting_shift_but_not_a_verified_one(db):
    result = shift_review_service.post_worker_message("s-waiting", "w1", "org", "Forgot to mention the bus was late.")
    assert result["message"]["body"] == "Forgot to mention the bus was late."
    assert result["notify_id"] == "coord"
    with pytest.raises(PermissionError):
        shift_review_service.post_worker_message("s-verified", "w1", "org", "hello")


def test_office_sees_which_shifts_are_back_with_the_worker(db):
    assert shift_review_service.office_review_states(["s-changes", "s-waiting"]) == {"s-changes": "changes_requested"}
