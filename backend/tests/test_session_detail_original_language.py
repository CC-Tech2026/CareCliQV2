"""Session detail returns the worker's own words beside each note's English record."""

from unittest.mock import patch

import pytest

from backend.app.services import session_service


class _Query:
    def __init__(self, table, store, missing_columns):
        self.table, self.store, self.missing_columns, self.columns = table, store, missing_columns, ""

    def select(self, columns="*", *args, **kwargs):
        self.columns = columns
        return self

    def __getattr__(self, name):
        # eq / order / limit / in_ / single and friends just chain.
        return lambda *args, **kwargs: self

    def execute(self):
        if self.table == "shift_visit_notes" and self.missing_columns and "original_content" in self.columns:
            raise Exception('{"code":"42703","message":"column shift_visit_notes.original_content does not exist"}')
        data = self.store.get(self.table, [])
        if self.table == "sessions":
            data = data[0] if data else None
        return type("Result", (), {"data": data})()


class _Client:
    def __init__(self, store, missing_columns=False):
        self.store, self.missing_columns = store, missing_columns

    def table(self, name):
        return _Query(name, self.store, self.missing_columns)


NOTES = [
    {
        "id": "n1",
        "content": "Benjamin chose his clothes and dressed himself.",
        "task_id": "t1",
        "category": "task_context",
        "created_at": "2026-11-03T09:15:00Z",
        "original_content": "Benjamin tự chọn quần áo và tự mặc đồ.",
        "original_language": "vi",
    },
    {
        "id": "n2",
        "content": "Made breakfast together.",
        "task_id": "t2",
        "category": "task_context",
        "created_at": "2026-11-03T09:40:00Z",
        "original_content": None,
        "original_language": None,
    },
]


def _store():
    return {
        "sessions": [{"id": "s1", "organization_id": "org-1", "notes": "", "status": "completed"}],
        "shift_visit_notes": NOTES,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("missing_columns", [False, True])
async def test_session_detail_keeps_notes_and_their_original_words(missing_columns):
    store = _store()
    if missing_columns:
        # Before migration 250 the columns aren't there; the notes must still show.
        store["shift_visit_notes"] = [
            {k: v for k, v in n.items() if k not in ("original_content", "original_language")} for n in NOTES
        ]
    with (
        patch.object(session_service, "get_supabase_admin", return_value=_Client(store, missing_columns)),
        patch.object(session_service, "_user_org_or_none", return_value="org-1"),
        patch.object(session_service, "_can_access_legacy_session", return_value=True),
    ):
        row = await session_service.get_session_by_id("s1", {"id": "md-1", "role": "managing_director"})

    notes = row["session_notes"]
    assert [n["content"] for n in notes] == [n["content"] for n in NOTES]
    if missing_columns:
        assert all(n["original_content"] is None for n in notes)
    else:
        assert notes[0]["original_content"] == "Benjamin tự chọn quần áo và tự mặc đồ."
        assert notes[0]["original_language"] == "vi"
        assert notes[1]["original_content"] is None
