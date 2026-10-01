"""Session notes in the vault read as distinct records: a humanised title
("Support work note", not "Support_Work note"), a short reference, and who /
when / how long, all searchable."""
from __future__ import annotations

from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

from backend.app.core import timezone as tz_mod
from backend.app.services import vault_service

ROWS = [
    {"id": "3f2a91c4-0000-4000-8000-000000000001", "patient_id": "p1", "session_type": "support_work",
     "session_date": "2026-09-30T23:32:00+00:00", "status": "completed", "worker_id": "w1", "duration_minutes": 239},
    {"id": "7b11e0aa-0000-4000-8000-000000000002", "patient_id": "p1", "session_type": None,
     "session_date": "2026-09-25", "status": "draft", "worker_id": None, "duration_minutes": None},
]


class _Q:
    def __getattr__(self, _):
        return lambda *a, **k: self

    def execute(self):
        return MagicMock(data=ROWS)


def _list():
    client = MagicMock()
    client.table.return_value = _Q()
    with patch.object(vault_service, "get_supabase_admin", return_value=client), \
         patch.object(vault_service, "_patient_name_map", return_value={"p1": "Lily Parker"}), \
         patch.object(vault_service, "_user_name_map", return_value={"w1": "Priya Sharma"}), \
         patch.object(tz_mod, "head_office_timezone", return_value=ZoneInfo("Australia/Adelaide")):
        return vault_service._list_sessions("org-1")


def test_session_notes_have_readable_titles_and_unique_references():
    first, second = _list()
    assert first["title"] == "Support work note"
    assert first["reference"] == "SN-3F2A91C4"
    assert first["detail"] == "by Priya Sharma · 9:02 am · 3h 59m"
    assert second["title"] == "Session note"
    assert second["reference"] == "SN-7B11E0AA"
    assert second["detail"] is None


def test_search_matches_reference_and_worker():
    docs = _list()
    assert [d["id"] for d in vault_service._apply_filters(docs, search="sn-3f2a", person=None, date_from=None, date_to=None)] == [ROWS[0]["id"]]
    assert len(vault_service._apply_filters(docs, search="priya", person=None, date_from=None, date_to=None)) == 1
