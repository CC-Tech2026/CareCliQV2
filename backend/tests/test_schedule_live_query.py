from unittest.mock import MagicMock, patch
from backend.app.api import coordinator


def test_live_query_includes_completed_shifts_with_organisation_and_time_bounds():
    db = MagicMock()
    query = db.table.return_value.select.return_value
    for method in ("eq", "in_", "gte", "lt", "order"):
        getattr(query, method).return_value = query
    query.execute.return_value.data = []
    coordinator._fetch_live_shifts_raw(db, "org-1", "2026-10-01T00:00:00Z")
    query.eq.assert_called_with("organization_id", "org-1")
    assert "completed" in query.in_.call_args.args[1]
    query.gte.assert_called_once()
    query.lt.assert_called_once()
    assert "clock_in_verified" in db.table.return_value.select.call_args.args[0]
