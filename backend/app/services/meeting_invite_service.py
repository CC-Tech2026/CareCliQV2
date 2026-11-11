"""Calendar invites for meetings booked on the MD Calendar.

A booked meeting goes out as a real calendar invite (iCalendar, RFC 5545) by
email, so it lands in Google Calendar, Outlook or Apple Calendar with
Accept/Decline, whichever one each person uses, without anyone connecting an
account. Moving the meeting sends the same invite again with a higher
SEQUENCE, which updates it in place; cancelling sends METHOD:CANCEL, which
takes it off their calendars.

The organiser is the person who booked it, so replies and RSVPs go to them.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import date, datetime, time, timedelta, timezone
from html import escape
from typing import Any
from zoneinfo import ZoneInfo

from . import email_service
from .participant_portal_access_service import RELATIONSHIP_LABELS

logger = logging.getLogger(__name__)

EMAIL_RE = re.compile(r"^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$")

MODE_LABELS = {"in_person": "In person", "phone": "Phone call", "video": "Video call"}

KIND_LABELS = {
    "intake": "Intake / meet and greet",
    "service_agreement": "Service agreement",
    "plan_review": "NDIS plan review",
    "goal_review": "Goal review",
    "check_in": "Check-in",
    "care_team": "Care team meeting",
    "incident_followup": "Incident follow-up",
}


def normalise_attendees(raw: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Valid, de-duplicated invitees: {"name", "email", "role"}. Raises
    ValueError naming the first address that isn't an email."""
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in raw or []:
        email = str(item.get("email") or "").strip()
        if not email:
            continue
        if not EMAIL_RE.match(email):
            raise ValueError(f"{email} isn't an email address.")
        key = email.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "name": str(item.get("name") or "").strip()[:120],
            "email": email,
            "role": str(item.get("role") or "").strip()[:60],
        })
    return out


def meeting_minutes(duration: str | None) -> int:
    """Length from the calendar's duration label: "45 mins", "1 hour",
    "2 hours", "1h 30m". An hour when it can't be read."""
    text = (duration or "").lower()
    hours = re.search(r"(\d+)\s*h", text)
    mins = re.search(r"(\d+)\s*m(?!o)", text)
    total = (int(hours.group(1)) * 60 if hours else 0) + (int(mins.group(1)) if mins else 0)
    return total if total > 0 else 60


def meeting_window(event: dict[str, Any], tz: ZoneInfo) -> tuple[datetime, datetime] | None:
    """Start and end, timezone-aware. None for an all-day event (no start time)."""
    start_time = (event.get("start_time") or "").strip()
    if not start_time:
        return None
    day = date.fromisoformat(str(event["event_date"])[:10])
    hh, mm = start_time[:5].split(":")
    start = datetime.combine(day, time(int(hh), int(mm)), tzinfo=tz)
    return start, start + timedelta(minutes=meeting_minutes(event.get("duration")))


# ── iCalendar ───────────────────────────────────────────────────────────────

def _text(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def _param(value: str) -> str:
    """A parameter value such as CN, quoted, with characters a quoted value
    can't hold taken out."""
    return '"' + re.sub(r'["\r\n]', "", value) + '"'


def _fold(line: str) -> str:
    """Lines longer than 75 octets continue on the next line after a space,
    never splitting a UTF-8 character."""
    data = line.encode("utf-8")
    parts: list[bytes] = []
    limit = 75
    while len(data) > limit:
        cut = limit
        while cut > 0 and (data[cut] & 0xC0) == 0x80:
            cut -= 1
        parts.append(data[:cut])
        data = data[cut:]
        limit = 74  # the leading space takes one octet
    parts.append(data)
    return "\r\n ".join(p.decode("utf-8") for p in parts)


def _utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def meeting_location(event: dict[str, Any]) -> str:
    mode = event.get("meeting_mode")
    where = (event.get("location") or "").strip()
    if mode == "phone":
        return f"Phone call: {where}" if where else "Phone call"
    if mode == "video":
        return "Video call"
    return where


def meeting_description(event: dict[str, Any], org_name: str) -> str:
    lines = []
    kind = KIND_LABELS.get(event.get("meeting_kind") or "")
    if kind:
        lines.append(kind)
    if event.get("participant_name"):
        lines.append(f"Participant: {event['participant_name']}")
    mode = MODE_LABELS.get(event.get("meeting_mode") or "")
    if mode:
        lines.append(f"How: {mode}")
    notes = (event.get("participants_desc") or "").strip()
    if notes:
        lines.extend(["", notes])
    lines.extend(["", f"Booked by {org_name} on CareCliQ."])
    return "\n".join(lines)


def build_ics(
    event: dict[str, Any],
    *,
    attendees: list[dict[str, str]],
    organizer: dict[str, str],
    method: str,
    sequence: int,
    tz: ZoneInfo,
    org_name: str,
    now: datetime | None = None,
) -> str:
    window = meeting_window(event, tz)
    if window:
        start, end = window
        when = [f"DTSTART:{_utc(start)}", f"DTEND:{_utc(end)}"]
    else:
        day = date.fromisoformat(str(event["event_date"])[:10])
        when = [
            f"DTSTART;VALUE=DATE:{day.strftime('%Y%m%d')}",
            f"DTEND;VALUE=DATE:{(day + timedelta(days=1)).strftime('%Y%m%d')}",
        ]
    lines = [
        "BEGIN:VCALENDAR",
        "PRODID:-//CareCliQ//Meetings//EN",
        "VERSION:2.0",
        "CALSCALE:GREGORIAN",
        f"METHOD:{method}",
        "BEGIN:VEVENT",
        f"UID:{event['id']}@carecliq.com.au",
        f"SEQUENCE:{sequence}",
        f"DTSTAMP:{_utc(now or datetime.now(timezone.utc))}",
        *when,
        f"SUMMARY:{_text(event.get('title') or 'Meeting')}",
        f"DESCRIPTION:{_text(meeting_description(event, org_name))}",
    ]
    location = meeting_location(event)
    if location:
        lines.append(f"LOCATION:{_text(location)}")
    lines.append(
        f"ORGANIZER;CN={_param(organizer.get('name') or org_name)}:mailto:{organizer['email']}"
    )
    for person in attendees:
        cn = f";CN={_param(person['name'])}" if person.get("name") else ""
        lines.append(f"ATTENDEE{cn};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:{person['email']}")
    lines.extend([
        f"STATUS:{'CANCELLED' if method == 'CANCEL' else 'CONFIRMED'}",
        "TRANSP:OPAQUE",
        "END:VEVENT",
        "END:VCALENDAR",
    ])
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"


# ── Sending ─────────────────────────────────────────────────────────────────

def _when_label(event: dict[str, Any], tz: ZoneInfo) -> str:
    window = meeting_window(event, tz)
    day = date.fromisoformat(str(event["event_date"])[:10])
    day_label = f"{day:%a} {day.day} {day:%b %Y}"
    if not window:
        return day_label
    start, end = window
    fmt = lambda d: f"{d.hour % 12 or 12}:{d.minute:02d}{'am' if d.hour < 12 else 'pm'}"  # noqa: E731
    return f"{day_label}, {fmt(start)} to {fmt(end)} ({start.tzname()})"


def _email_bodies(event: dict[str, Any], method: str, update: bool, tz: ZoneInfo, org_name: str, organizer: dict[str, str]) -> tuple[str, str, str]:
    title = event.get("title") or "Meeting"
    when = _when_label(event, tz)
    where = meeting_location(event)
    if method == "CANCEL":
        subject = f"Cancelled: {title}"
        lead = f"{org_name} has cancelled this meeting. It will come off your calendar."
    elif update:
        subject = f"Updated: {title}"
        lead = f"{org_name} has changed this meeting. Your calendar will update."
    else:
        subject = f"Invitation: {title}"
        lead = f"{org_name} has invited you to a meeting. Accept it to add it to your calendar."
    rows = [("When", when)] + ([("Where", where)] if where else []) + [("Organiser", organizer.get("name") or organizer["email"])]
    text = "\n".join([lead, "", title, *[f"{k}: {v}" for k, v in rows], "", "Reply to this email to reach the organiser."])
    html = (
        f"<p>{escape(lead)}</p><h2 style=\"margin:16px 0 8px;font-size:18px\">{escape(title)}</h2>"
        + "".join(f"<p style=\"margin:4px 0\"><strong>{escape(k)}:</strong> {escape(v)}</p>" for k, v in rows)
        + "<p style=\"margin-top:16px;color:#6A6A77\">Reply to this email to reach the organiser.</p>"
    )
    return subject, text, html


async def send_invites(
    event: dict[str, Any],
    *,
    attendees: list[dict[str, str]],
    organizer: dict[str, str],
    method: str,
    sequence: int,
    tz: ZoneInfo,
    org_name: str,
    update: bool = False,
) -> dict[str, Any]:
    """Emails the invite (or cancellation) to each attendee. Returns who it
    reached and who it didn't, so the calendar can say so."""
    if not attendees:
        return {"sent": [], "failed": [], "email_off": False}
    if not email_service.settings.email_enabled:
        return {"sent": [], "failed": [], "email_off": True}
    ics = build_ics(event, attendees=attendees, organizer=organizer, method=method, sequence=sequence, tz=tz, org_name=org_name)
    subject, text, html = _email_bodies(event, method, update, tz, org_name, organizer)
    sent: list[str] = []
    failed: list[str] = []
    for person in attendees:
        try:
            await asyncio.to_thread(
                email_service.send_email,
                to_email=person["email"],
                subject=subject,
                text_body=text,
                html_body=html,
                from_display_name=f"{org_name} via CareCliQ",
                reply_to=organizer["email"],
                calendar_invite=(ics, method),
            )
            sent.append(person["email"])
        except Exception as exc:
            logger.warning("Meeting invite to %s failed: %s", person["email"], exc)
            failed.append(person["email"])
    return {"sent": sent, "failed": failed, "email_off": False}


# ── Who to invite ───────────────────────────────────────────────────────────

def suggested_invitees(supabase, org_id: str, participant_id: str | None, me: dict[str, str]) -> list[dict[str, str]]:
    """The organiser, then, for a participant meeting, the participant, their
    portal contacts (nominee, guardian, family) and their support workers.
    Only people with an email address; each once."""
    people: list[dict[str, str]] = []

    def add(name: str | None, email: str | None, role: str) -> None:
        if email and EMAIL_RE.match(email.strip()):
            people.append({"name": (name or "").strip(), "email": email.strip(), "role": role})

    add(me.get("name"), me.get("email"), "You")
    if participant_id:
        try:
            rows = (
                supabase.table("participants").select("full_name, email")
                .eq("id", participant_id).eq("organization_id", org_id).limit(1).execute().data
            ) or []
            if rows:
                add(rows[0].get("full_name"), rows[0].get("email"), "Participant")
        except Exception as exc:
            logger.debug("invitee lookup (participant) failed: %s", exc)
        try:
            access = (
                supabase.table("participant_portal_access").select("full_name, email, relationship, status")
                .eq("participant_id", participant_id).eq("organization_id", org_id).execute().data
            ) or []
            for row in access:
                if row.get("status") == "revoked" or row.get("relationship") == "self":
                    continue
                add(row.get("full_name"), row.get("email"), RELATIONSHIP_LABELS.get(row.get("relationship"), "Contact"))
        except Exception as exc:
            logger.debug("invitee lookup (portal) failed: %s", exc)
        try:
            allocations = (
                supabase.table("practitioner_allocations").select("user_id, allocated_role, is_active")
                .eq("patient_id", participant_id).eq("organization_id", org_id).execute().data
            ) or []
            ids = sorted({str(a["user_id"]) for a in allocations if a.get("is_active") is not False and a.get("user_id")})
            if ids:
                users = supabase.table("users").select("id, full_name, email").in_("id", ids).execute().data or []
                for u in sorted(users, key=lambda u: u.get("full_name") or ""):
                    add(u.get("full_name"), u.get("email"), "Support worker")
        except Exception as exc:
            logger.debug("invitee lookup (workers) failed: %s", exc)

    seen: set[str] = set()
    unique = []
    for person in people:
        key = person["email"].lower()
        if key not in seen:
            seen.add(key)
            unique.append(person)
    return unique
