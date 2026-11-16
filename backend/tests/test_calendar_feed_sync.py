"""The worker's calendar feed (Google Calendar, Outlook, Apple Calendar)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from backend.app.services import worker_calendar_service as svc

SHIFTS = [
    {
        "id": "s-1",
        "participant_name": "Liam Carter",
        "participant_address": "12 King William St, Adelaide SA 5000",
        "scheduled_start": "2026-11-20T09:00:00+10:30",
        "scheduled_end": "2026-11-20T12:00:00+10:30",
        "status": "scheduled",
        "confirmation_status": "confirmed",
        "updated_at": "2026-11-17T01:00:00+00:00",
    },
    {
        "id": "s-2",
        "participant_name": "Mia Wong",
        "participant_address": "4 Smith St, Fitzroy VIC 3065",
        "scheduled_start": "2026-11-21T09:00:00+11:00",
        "scheduled_end": "2026-11-21T10:30:00+11:00",
        "status": "scheduled",
        "confirmation_status": "tentative",
    },
    {
        "id": "s-3",
        "participant_name": "Noah Hill",
        "scheduled_start": "2026-11-22T09:00:00+10:30",
        "scheduled_end": "2026-11-22T10:00:00+10:30",
        "status": "cancelled",
    },
]


def _feed(shifts=SHIFTS) -> str:
    with patch.object(svc, "_feed_shifts", return_value=shifts):
        return svc.build_ical_feed("w-1", "org-1")


def _events(feed: str) -> list[str]:
    unfolded = feed.replace("\r\n ", "")
    return [chunk for chunk in unfolded.split("BEGIN:VEVENT")[1:]]


def test_times_are_utc_so_every_state_shows_the_right_local_time():
    events = _events(_feed())
    # 9:00 am Adelaide (UTC+10:30) is 22:30 UTC the day before.
    assert "DTSTART:20261119T223000Z" in events[0]
    assert "DTEND:20261120T013000Z" in events[0]
    # 9:00 am Melbourne daylight time (UTC+11) is 22:00 UTC.
    assert "DTSTART:20261120T220000Z" in events[1]
    assert "TZID" not in _feed()


def test_each_event_has_what_strict_calendar_apps_require():
    feed = _feed()
    assert feed.startswith("BEGIN:VCALENDAR\r\n")
    assert feed.endswith("END:VCALENDAR\r\n")
    for event in _events(feed):
        assert "UID:" in event and "DTSTAMP:" in event and "END:VEVENT" in event


def test_tentative_shifts_are_marked_and_cancelled_ones_are_left_out():
    events = _events(_feed())
    assert len(events) == 2
    assert "STATUS:CONFIRMED" in events[0]
    assert "STATUS:TENTATIVE" in events[1]
    assert "SUMMARY:Shift with Mia (to be confirmed)" in events[1]
    assert "Noah" not in _feed()


def test_only_first_name_and_suburb_leave_carecliq():
    feed = _feed()
    assert "SUMMARY:Shift with Liam" in feed
    assert "LOCATION:Adelaide" in feed
    assert "Carter" not in feed
    assert "King William" not in feed


def test_text_is_escaped_and_long_lines_are_folded():
    shift = {**SHIFTS[0], "participant_name": "Ann;Marie, Jones", "participant_address": "1 A St, North, Adelaide SA 5000"}
    feed = _feed([shift])
    assert "SUMMARY:Shift with Ann\\;Marie\\," in feed
    for line in feed.split("\r\n"):
        assert len(line.encode("utf-8")) <= 75


def test_a_shift_without_usable_times_is_skipped():
    feed = _feed([{**SHIFTS[0], "scheduled_end": None}, {**SHIFTS[0], "scheduled_start": "not a date"}])
    assert "BEGIN:VEVENT" not in feed


def _token_db(user_row: dict | None):
    db = MagicMock()

    def table(name):
        t = MagicMock()
        chain = t.select.return_value.eq.return_value
        if name == "worker_calendar_feed_tokens":
            chain.is_.return_value.limit.return_value.execute.return_value = MagicMock(
                data=[{"user_id": "w-1", "organization_id": "org-1"}]
            )
        else:
            chain.limit.return_value.execute.return_value = MagicMock(data=[user_row] if user_row else [])
        return t

    db.table.side_effect = table
    return db


def test_a_deactivated_worker_stops_getting_shifts():
    with patch.object(svc, "get_supabase_admin", return_value=_token_db({"id": "w-1", "organization_id": "org-1", "is_active": False})):
        assert svc.resolve_feed_user("x" * 43) is None


def test_a_worker_who_moved_organisation_stops_getting_the_old_one():
    with patch.object(svc, "get_supabase_admin", return_value=_token_db({"id": "w-1", "organization_id": "org-2", "is_active": True})):
        assert svc.resolve_feed_user("x" * 43) is None


def test_an_active_worker_gets_their_feed():
    with patch.object(svc, "get_supabase_admin", return_value=_token_db({"id": "w-1", "organization_id": "org-1", "is_active": True})):
        assert svc.resolve_feed_user("x" * 43) == {"user_id": "w-1", "organization_id": "org-1"}


def test_feed_status_and_stop_endpoints():
    from fastapi.testclient import TestClient

    from backend.app.core.security import get_current_user
    from backend.app.main import app

    worker = {"sub": "w-1", "id": "w-1", "role": "support_worker", "organization_id": "org-1"}
    app.dependency_overrides[get_current_user] = lambda: worker
    try:
        client = TestClient(app)
        with patch.object(svc, "get_feed_status", return_value={"active": True, "created_at": "x", "last_accessed_at": None}):
            assert client.get("/api/worker/calendar/feed").json()["active"] is True
        with patch.object(svc, "revoke_feed_token") as revoke:
            assert client.delete("/api/worker/calendar/feed").json() == {"active": False}
        revoke.assert_called_once_with("w-1")
        with patch.object(svc, "get_or_create_feed_token", return_value={"token": "t" * 43, "regenerated": False}):
            body = client.post("/api/worker/calendar/feed-token").json()
        assert body["feed_path"] == f"/api/public/calendar/feed/{'t' * 43}.ics"
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_public_feed_route_serves_ics_and_is_private():
    from fastapi.testclient import TestClient

    from backend.app.main import app

    client = TestClient(app)
    with patch.object(svc, "resolve_feed_user", return_value={"user_id": "w-1", "organization_id": "org-1"}), \
            patch.object(svc, "_feed_shifts", return_value=SHIFTS[:1]):
        res = client.get(f"/api/public/calendar/feed/{'t' * 43}.ics")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/calendar")
    assert res.headers["cache-control"].startswith("private")
    assert "SUMMARY:Shift with Liam" in res.text
    with patch.object(svc, "resolve_feed_user", return_value=None):
        assert client.get("/api/public/calendar/feed/unknown-token-value.ics").status_code == 404
