from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException

from backend.app.api import hub
from backend.app.services import meeting_invite_service as invites

ADELAIDE = ZoneInfo("Australia/Adelaide")


def _body(**overrides):
    fields = {
        "title": "Plan review · Liam",
        "event_date": "2026-11-20",
        "start_time": "10:00",
        "duration": "1 hour",
        "event_type": "meeting",
        "meeting_kind": "plan_review",
        "participant_id": "participant-1",
        "meeting_mode": "in_person",
        "location": "12 Glenroy Street, Woodville SA 5011",
        "attendees": [{"email": "jess@example.com", "name": "Jess Mitchell", "role": "Guardian"}],
    }
    fields.update(overrides)
    return hub.OrgEventBody(**fields)


@pytest.fixture
def participant_found(monkeypatch):
    lookup = AsyncMock(return_value={"id": "participant-1", "full_name": "Liam"})
    monkeypatch.setattr(hub.participant_service, "get_participant_by_id", lookup)
    return lookup


# ── Validation ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_participant_meeting_is_accepted_with_its_invitees(participant_found):
    payload = await hub._validated_event_payload(_body(), {})
    assert payload["attendees"] == [{"name": "Jess Mitchell", "email": "jess@example.com", "role": "Guardian"}]
    assert "send_invites" not in payload
    participant_found.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["google_meet", "zoom", "teams", "carrier_pigeon"])
async def test_only_in_person_phone_or_video(participant_found, mode):
    with pytest.raises(HTTPException) as err:
        await hub._validated_event_payload(_body(meeting_mode=mode), {})
    assert err.value.status_code == 422


@pytest.mark.asyncio
async def test_a_bad_invite_address_is_named(participant_found):
    with pytest.raises(HTTPException) as err:
        await hub._validated_event_payload(_body(attendees=[{"email": "not-an-email"}]), {})
    assert err.value.status_code == 422
    assert "not-an-email" in err.value.detail


@pytest.mark.asyncio
async def test_invitees_are_deduplicated_ignoring_case(participant_found):
    payload = await hub._validated_event_payload(
        _body(attendees=[{"email": "Jess@Example.com"}, {"email": "jess@example.com"}, {"email": " "}]), {}
    )
    assert [a["email"] for a in payload["attendees"]] == ["Jess@Example.com"]


@pytest.mark.asyncio
async def test_participant_meeting_needs_a_participant(participant_found):
    with pytest.raises(HTTPException) as err:
        await hub._validated_event_payload(_body(participant_id=None), {})
    assert err.value.status_code == 422


@pytest.mark.asyncio
async def test_participant_from_another_org_is_rejected(monkeypatch):
    monkeypatch.setattr(hub.participant_service, "get_participant_by_id", AsyncMock(return_value=None))
    with pytest.raises(HTTPException) as err:
        await hub._validated_event_payload(_body(), {})
    assert err.value.status_code == 404


@pytest.mark.asyncio
async def test_easy_capture_only_for_in_person(participant_found):
    with pytest.raises(HTTPException):
        await hub._validated_event_payload(_body(easy_capture=True, meeting_mode="video"), {})
    payload = await hub._validated_event_payload(_body(easy_capture=True), {})
    assert payload["easy_capture"] is True


@pytest.mark.asyncio
async def test_internal_meeting_needs_no_participant(monkeypatch):
    lookup = AsyncMock()
    monkeypatch.setattr(hub.participant_service, "get_participant_by_id", lookup)
    payload = await hub._validated_event_payload(
        _body(title="Team meeting", meeting_kind=None, participant_id=None, meeting_mode="video"), {}
    )
    assert payload["participant_id"] is None
    lookup.assert_not_awaited()


# ── The invite itself ───────────────────────────────────────────────────────

EVENT = {
    "id": "event-1",
    "title": "Plan review · Liam",
    "event_date": "2026-11-20",
    "start_time": "10:00",
    "duration": "1h 30m",
    "meeting_mode": "in_person",
    "location": "12 Glenroy Street, Woodville SA 5011",
    "meeting_kind": "plan_review",
    "participant_name": "Liam Mitchell",
}
ORGANISER = {"name": "Olivia Bennett", "email": "olivia@example.com"}
JESS = {"name": "Jess Mitchell", "email": "jess@example.com", "role": "Guardian"}


def _ics(method="REQUEST", sequence=0, event=EVENT):
    return invites.build_ics(
        event, attendees=[JESS], organizer=ORGANISER, method=method, sequence=sequence,
        tz=ADELAIDE, org_name="Harbourside", now=datetime(2026, 11, 10, tzinfo=timezone.utc),
    )


def _unfolded(ics: str) -> str:
    return ics.replace("\r\n ", "")


def test_invite_is_in_utc_with_organiser_and_attendee():
    ics = _unfolded(_ics())
    # 10:00 in Adelaide during daylight saving (UTC+10:30), for 90 minutes.
    assert "DTSTART:20261119T233000Z" in ics
    assert "DTEND:20261120T010000Z" in ics
    assert "METHOD:REQUEST" in ics and "STATUS:CONFIRMED" in ics
    assert "UID:event-1@carecliq.com.au" in ics
    assert 'ORGANIZER;CN="Olivia Bennett":mailto:olivia@example.com' in ics
    assert 'ATTENDEE;CN="Jess Mitchell";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:jess@example.com' in ics
    assert "LOCATION:12 Glenroy Street\\, Woodville SA 5011" in ics


def test_invite_lines_are_folded_and_use_crlf():
    ics = _ics(event={**EVENT, "title": "A very long meeting title " * 6})
    lines = ics.split("\r\n")
    assert all(len(line.encode("utf-8")) <= 75 for line in lines)
    assert ics.endswith("END:VCALENDAR\r\n")


def test_cancellation_keeps_the_same_uid_and_raises_the_sequence():
    ics = _unfolded(_ics(method="CANCEL", sequence=3))
    assert "METHOD:CANCEL" in ics and "STATUS:CANCELLED" in ics
    assert "SEQUENCE:3" in ics and "UID:event-1@carecliq.com.au" in ics


def test_all_day_event_uses_dates():
    ics = _ics(event={**EVENT, "start_time": None})
    assert "DTSTART;VALUE=DATE:20261120" in ics and "DTEND;VALUE=DATE:20261121" in ics


def test_phone_meeting_location_says_so():
    assert invites.meeting_location({"meeting_mode": "phone", "location": "0400 000 000"}) == "Phone call: 0400 000 000"
    assert invites.meeting_location({"meeting_mode": "video"}) == "Video call"


@pytest.mark.asyncio
async def test_sending_emails_each_attendee_with_the_invite(monkeypatch):
    sent = []
    monkeypatch.setattr(invites.email_service.settings, "email_enabled", True, raising=False)
    monkeypatch.setattr(invites.email_service, "send_email", lambda **kw: sent.append(kw))
    result = await invites.send_invites(
        EVENT, attendees=[JESS, {"name": "", "email": "bad@example.com", "role": ""}],
        organizer=ORGANISER, method="REQUEST", sequence=0, tz=ADELAIDE, org_name="Harbourside",
    )
    assert result["sent"] == ["jess@example.com", "bad@example.com"]
    assert sent[0]["to_email"] == "jess@example.com"
    assert sent[0]["reply_to"] == "olivia@example.com"
    assert sent[0]["subject"] == "Invitation: Plan review · Liam"
    ics, method = sent[0]["calendar_invite"]
    assert method == "REQUEST" and "BEGIN:VCALENDAR" in ics


@pytest.mark.asyncio
async def test_a_failed_send_is_reported_not_raised(monkeypatch):
    monkeypatch.setattr(invites.email_service.settings, "email_enabled", True, raising=False)

    def boom(**kw):
        raise RuntimeError("SMTP down")

    monkeypatch.setattr(invites.email_service, "send_email", boom)
    result = await invites.send_invites(
        EVENT, attendees=[JESS], organizer=ORGANISER, method="REQUEST", sequence=0, tz=ADELAIDE, org_name="H",
    )
    assert result == {"sent": [], "failed": ["jess@example.com"], "email_off": False}


# ── Booking, moving and cancelling ──────────────────────────────────────────

class _Table:
    """Just enough of the Supabase query builder for org_events."""

    def __init__(self, store):
        self.store, self.op, self.payload, self.filters = store, None, None, {}

    def select(self, *_):
        self.op = self.op or "select"
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, key, value):
        self.filters[key] = value
        return self

    def limit(self, _):
        return self

    def in_(self, *_):
        return self

    def execute(self):
        rows = self.store["rows"]
        if self.op == "insert":
            row = {**self.payload, "id": "event-1", "invite_sequence": 0, "invites_sent_at": None}
            rows.append(row)
            return SimpleNamespace(data=[row])
        match = [r for r in rows if all(r.get(k) == v for k, v in self.filters.items() if k in r)]
        if self.op == "update":
            for r in match:
                r.update(self.payload)
            return SimpleNamespace(data=[dict(r) for r in match])
        if self.op == "delete":
            self.store["rows"] = [r for r in rows if r not in match]
            return SimpleNamespace(data=match)
        return SimpleNamespace(data=[dict(r) for r in match])


@pytest.fixture
def calendar(monkeypatch, participant_found):
    store = {"rows": []}
    client = MagicMock()
    client.table.side_effect = lambda name: _Table(store) if name == "org_events" else MagicMock()
    monkeypatch.setattr(hub, "get_supabase_admin", lambda: client)
    monkeypatch.setattr(hub, "_require_org_wide", lambda _user: "org-1")
    monkeypatch.setattr(hub, "_organiser", lambda *_: dict(ORGANISER))
    monkeypatch.setattr(hub, "_org_name", lambda *_: "Harbourside")
    monkeypatch.setattr(hub, "user_timezone", lambda *a, **k: ADELAIDE)
    monkeypatch.setattr(hub, "_with_participant_names", lambda _s, rows: [dict(r) for r in rows])
    calls = []

    async def fake_send(event, **kw):
        calls.append({"event": event, **kw})
        return {"sent": [a["email"] for a in kw["attendees"]], "failed": [], "email_off": False}

    monkeypatch.setattr(hub.meeting_invite_service, "send_invites", fake_send)
    return SimpleNamespace(store=store, calls=calls)


@pytest.mark.asyncio
async def test_booking_sends_the_invite_and_records_it(calendar):
    row = await hub.create_org_event(_body(), {"id": "md-1"})
    assert [c["method"] for c in calendar.calls] == ["REQUEST"]
    assert calendar.calls[0]["sequence"] == 0
    assert row["invites"]["sent"] == ["jess@example.com"]
    assert calendar.store["rows"][0]["invites_sent_at"]


@pytest.mark.asyncio
async def test_a_video_call_is_not_emailed_by_carecliq(calendar):
    row = await hub.create_org_event(_body(meeting_mode="video", location=None), {"id": "md-1"})
    assert calendar.calls == []
    assert row["invites"]["sent"] == []
    assert not calendar.store["rows"][0]["invites_sent_at"]


@pytest.mark.asyncio
async def test_booking_without_sending_records_no_invite(calendar):
    await hub.create_org_event(_body(send_invites=False), {"id": "md-1"})
    assert calendar.calls == []


@pytest.mark.asyncio
async def test_moving_the_meeting_updates_the_invite_with_a_higher_sequence(calendar):
    await hub.create_org_event(_body(), {"id": "md-1"})
    calendar.calls.clear()
    await hub.update_org_event("event-1", _body(start_time="14:00"), {"id": "md-1"})
    assert [c["method"] for c in calendar.calls] == ["REQUEST"]
    assert calendar.calls[0]["sequence"] == 1
    assert calendar.calls[0]["update"] is True
    assert calendar.calls[0]["event"]["start_time"] == "14:00"


@pytest.mark.asyncio
async def test_someone_taken_off_the_list_gets_a_cancellation(calendar):
    two = [{"email": "jess@example.com"}, {"email": "tom@example.com"}]
    await hub.create_org_event(_body(attendees=two), {"id": "md-1"})
    calendar.calls.clear()
    await hub.update_org_event("event-1", _body(attendees=[{"email": "jess@example.com"}]), {"id": "md-1"})
    by_method = {c["method"]: [a["email"] for a in c["attendees"]] for c in calendar.calls}
    assert by_method == {"CANCEL": ["tom@example.com"], "REQUEST": ["jess@example.com"]}


@pytest.mark.asyncio
async def test_turning_it_into_a_video_call_cancels_the_emailed_invite(calendar):
    await hub.create_org_event(_body(), {"id": "md-1"})
    calendar.calls.clear()
    await hub.update_org_event("event-1", _body(meeting_mode="video", location=None), {"id": "md-1"})
    assert [c["method"] for c in calendar.calls] == ["CANCEL"]
    assert not calendar.store["rows"][0]["invites_sent_at"]


@pytest.mark.asyncio
async def test_cancelling_the_meeting_takes_it_off_everyones_calendar(calendar):
    await hub.create_org_event(_body(), {"id": "md-1"})
    calendar.calls.clear()
    await hub.delete_org_event("event-1", {"id": "md-1"})
    assert [c["method"] for c in calendar.calls] == ["CANCEL"]
    assert calendar.calls[0]["event"]["invite_sequence"] == 1
    assert calendar.store["rows"] == []


@pytest.mark.asyncio
async def test_cancelling_a_meeting_no_one_was_sent_sends_nothing(calendar):
    await hub.create_org_event(_body(send_invites=False), {"id": "md-1"})
    await hub.delete_org_event("event-1", {"id": "md-1"})
    assert calendar.calls == []


# ── Suggested invitees ──────────────────────────────────────────────────────

def test_suggested_invitees_cover_participant_contacts_and_workers():
    tables = {
        "participants": [{"full_name": "Liam Mitchell", "email": "liam@example.com"}],
        "participant_portal_access": [
            {"full_name": "Jess Mitchell", "email": "jess@example.com", "relationship": "guardian", "status": "active"},
            {"full_name": "Old Contact", "email": "old@example.com", "relationship": "consented_family", "status": "revoked"},
            {"full_name": "Liam", "email": "liam@example.com", "relationship": "self", "status": "active"},
        ],
        "practitioner_allocations": [
            {"user_id": "w1", "allocated_role": "support_worker", "is_active": True},
            {"user_id": "w2", "allocated_role": "support_worker", "is_active": False},
        ],
        "users": [{"id": "w1", "full_name": "Priya Nair", "email": "priya@example.com"}],
    }

    def table(name):
        q = MagicMock()
        for method in ("select", "eq", "limit", "in_"):
            getattr(q, method).return_value = q
        q.execute.return_value = SimpleNamespace(data=tables[name])
        return q

    client = MagicMock()
    client.table.side_effect = table
    people = invites.suggested_invitees(client, "org-1", "participant-1", {"name": "Olivia", "email": "OLIVIA@example.com"})
    assert [(p["email"], p["role"]) for p in people] == [
        ("OLIVIA@example.com", "You"),
        ("liam@example.com", "Participant"),
        ("jess@example.com", "Guardian"),
        ("priya@example.com", "Support worker"),
    ]


# ── Booking from participant onboarding ─────────────────────────────────────

INTAKE = {
    "id": "intake-1",
    "full_name": "Ava Thompson",
    "email": "ava@example.com",
    "participant_id": None,
    "web_intake": {
        "next_of_kin": [
            {"name": "Mark Thompson", "relationship": "father", "email": "mark@example.com"},
            {"name": "No Email", "relationship": "aunt"},
            {"name": "Ava again", "email": "AVA@example.com"},
        ],
        "plan_manager_org": "Plan Partners",
        "plan_manager_email": "invoices@planpartners.example.com",
    },
}


@pytest.mark.asyncio
async def test_a_meet_and_greet_can_be_booked_for_someone_in_onboarding(monkeypatch):
    lookup = AsyncMock()
    monkeypatch.setattr(hub.participant_service, "get_participant_by_id", lookup)
    monkeypatch.setattr(hub, "_find_intake", lambda intake_id, org_id: dict(INTAKE) if intake_id == "intake-1" else None)
    payload = await hub._validated_event_payload(
        _body(meeting_kind="intake", participant_id=None, intake_id="intake-1", easy_capture=True), {}
    )
    assert payload["intake_id"] == "intake-1"
    assert payload["participant_id"] is None
    assert payload["easy_capture"] is True
    lookup.assert_not_awaited()


@pytest.mark.asyncio
async def test_onboarding_from_another_org_is_rejected(monkeypatch):
    monkeypatch.setattr(hub, "_find_intake", lambda *_: None)
    with pytest.raises(HTTPException) as err:
        await hub._validated_event_payload(_body(meeting_kind="intake", participant_id=None, intake_id="intake-9"), {})
    assert err.value.status_code == 404


@pytest.mark.asyncio
async def test_once_activated_the_meeting_is_filed_on_the_participant_too(monkeypatch, participant_found):
    monkeypatch.setattr(hub, "_find_intake", lambda *_: {**INTAKE, "participant_id": "participant-1"})
    payload = await hub._validated_event_payload(_body(meeting_kind="intake", participant_id=None, intake_id="intake-1"), {})
    assert payload["participant_id"] == "participant-1"
    participant_found.assert_awaited_once()


@pytest.mark.asyncio
async def test_an_onboarding_meeting_needs_a_meeting_type(monkeypatch):
    monkeypatch.setattr(hub, "_find_intake", lambda *_: dict(INTAKE))
    with pytest.raises(HTTPException) as err:
        await hub._validated_event_payload(_body(meeting_kind=None, participant_id=None, intake_id="intake-1"), {})
    assert err.value.status_code == 422


def test_onboarding_invitees_come_from_the_intake_form():
    people = invites.intake_invitees(INTAKE, {"name": "Olivia", "email": "olivia@example.com"})
    assert [(p["email"], p["role"]) for p in people] == [
        ("olivia@example.com", "You"),
        ("ava@example.com", "Participant"),
        ("mark@example.com", "Father"),
        ("invoices@planpartners.example.com", "Plan manager"),
    ]
    assert people[3]["name"] == "Plan Partners"


def test_the_board_shows_the_next_meeting_or_else_the_last_one():
    from backend.app.services.participant_intake_service import pick_next_meeting

    past = {"id": "a", "event_date": "2026-11-10", "start_time": "10:00"}
    soon = {"id": "b", "event_date": "2026-11-20", "start_time": "09:00"}
    later = {"id": "c", "event_date": "2026-11-20", "start_time": "14:00"}
    today = date(2026, 11, 17)
    assert pick_next_meeting([later, past, soon], today)["id"] == "b"
    assert pick_next_meeting([past], today)["id"] == "a"
    assert pick_next_meeting([], today) is None


def test_names_fall_back_to_the_intake_for_someone_in_onboarding():
    def table(name):
        q = MagicMock()
        q.select.return_value.in_.return_value.execute.return_value = SimpleNamespace(
            data=[{"id": "intake-1", "full_name": "Ava Thompson"}] if name == "participant_intakes" else []
        )
        return q

    client = MagicMock()
    client.table.side_effect = table
    rows = hub._with_participant_names(client, [{"id": "e1", "intake_id": "intake-1", "participant_id": None}])
    assert rows[0]["participant_name"] == "Ava Thompson"


@pytest.mark.asyncio
async def test_range_listing_attaches_participant_names(monkeypatch):
    events = MagicMock()
    chain = events.select.return_value.eq.return_value.gte.return_value.lte.return_value.limit.return_value
    chain.order.return_value.execute.return_value = SimpleNamespace(
        data=[{"id": "event-1", "participant_id": "participant-1"}, {"id": "event-2", "participant_id": None}]
    )
    participants = MagicMock()
    participants.select.return_value.in_.return_value.execute.return_value = SimpleNamespace(
        data=[{"id": "participant-1", "full_name": "Liam Mitchell"}]
    )
    client = MagicMock()
    client.table.side_effect = lambda table: participants if table == "participants" else events
    monkeypatch.setattr(hub, "get_supabase_admin", lambda: client)
    monkeypatch.setattr(hub, "_get_org_id", lambda _: "org-1")

    rows = await hub.list_org_events(start=date(2026, 11, 1), end=date(2026, 11, 30), current_user={})

    events.select.return_value.eq.return_value.gte.assert_called_once_with("event_date", "2026-11-01")
    assert [r["participant_name"] for r in rows] == ["Liam Mitchell", None]
