"""Worker calendar — CARECLIQV2-281."""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional

from ..core.timezone import APP_TIMEZONE as DEFAULT_TZ
from ..core.timezone import user_timezone
from .shift_service import (
    _enrich_worker_shift_card,
    _get_session_for_shift,
    _shift_card_payload,
    get_shift_detail_for_worker,
)
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

PARTICIPANT_PALETTE = ["#5533CC", "#F03060", "#0EA5E9", "#10B981"]
MULTIPLE_COLOUR = "#7A6A9E"


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return "does not exist" in err or "42703" in err or "pgrst" in err or "could not find" in err


def extract_suburb(address: Optional[str]) -> Optional[str]:
    """Best-effort suburb from a free-text Australian address."""
    if not address or not str(address).strip():
        return None
    text = str(address).strip()
    # "123 Street, Suburb SA 5000" or "Suburb, SA 5000"
    match = re.search(r",\s*([^,]+?)(?:\s+(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s+\d{4})?\s*$", text, re.I)
    if match:
        return match.group(1).strip()
    parts = [p.strip() for p in text.split(",") if p.strip()]
    if len(parts) >= 2:
        return parts[-2] if re.search(r"\d{4}", parts[-1]) else parts[-1]
    return None


def _calendar_display_status(shift: dict[str, Any]) -> str:
    status = (shift.get("status") or "scheduled").lower()
    if status == "cancelled":
        return "cancelled"
    confirmation = (shift.get("confirmation_status") or "confirmed").lower()
    if confirmation == "tentative":
        return "tentative"
    return "confirmed"


def _participant_colour_map(shifts: list[dict[str, Any]]) -> dict[str, str]:
    participant_ids: list[str] = []
    for shift in shifts:
        pid = str(shift.get("participant_id") or "")
        if pid and pid not in participant_ids:
            participant_ids.append(pid)
    if len(participant_ids) > 4:
        return {pid: MULTIPLE_COLOUR for pid in participant_ids}
    return {pid: PARTICIPANT_PALETTE[i % len(PARTICIPANT_PALETTE)] for i, pid in enumerate(participant_ids)}


def _resolve_worker_org(worker_id: str, organization_id: Optional[str]) -> Optional[str]:
    if organization_id:
        return organization_id
    try:
        resp = (
            get_supabase_admin()
            .table("users")
            .select("organization_id")
            .eq("id", worker_id)
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
        if row and row.get("organization_id"):
            return str(row["organization_id"])
    except Exception:
        pass
    return None


def list_shifts_for_calendar(
    worker_id: str,
    organization_id: str,
    start_date: date,
    end_date: date,
) -> list[dict[str, Any]]:
    """Shifts in inclusive date range for worker calendar views."""
    if end_date < start_date:
        return []
    # Use the worker's own branch day boundaries, not the deployment default —
    # otherwise a Melbourne worker's Monday-morning shift could fall just
    # outside a range computed in Adelaide time and silently drop off the
    # calendar.
    tz = user_timezone(worker_id, organization_id)
    start_local = datetime.combine(start_date, time.min, tzinfo=tz)
    end_local = datetime.combine(end_date, time(23, 59, 59), tzinfo=tz)
    start_iso = start_local.astimezone(timezone.utc).isoformat()
    end_iso = end_local.astimezone(timezone.utc).isoformat()
    try:
        resp = (
            get_supabase_admin()
            .table("shifts")
            .select("*")
            .eq("organization_id", organization_id)
            .eq("worker_id", worker_id)
            .gte("scheduled_start", start_iso)
            .lte("scheduled_start", end_iso)
            .order("scheduled_start")
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        raise

    colours = _participant_colour_map(rows)
    cards: list[dict[str, Any]] = []
    for shift in rows:
        session = _get_session_for_shift(shift)
        card = _shift_card_payload(shift, session)
        card = _enrich_worker_shift_card(card, shift, organization_id, session, worker_id)
        pid = str(shift.get("participant_id") or "")
        card["participant_suburb"] = extract_suburb(card.get("participant_address"))
        card["calendar_status"] = _calendar_display_status(shift)
        card["participant_colour"] = colours.get(pid, MULTIPLE_COLOUR)
        card["participant_first_name"] = (card.get("participant_name") or "Participant").split()[0]
        cards.append(card)
    return cards


def list_approved_time_off_blocks(
    worker_id: str,
    organization_id: str,
    start_date: date,
    end_date: date,
) -> list[dict[str, Any]]:
    """Approved leave ranges for calendar grey blocks (CARECLIQV2-283)."""
    try:
        resp = (
            get_supabase_admin()
            .table("worker_schedule_requests")
            .select(
                "id, resolved_at, worker_time_off_request_details(start_date, end_date, reason_code)"
            )
            .eq("user_id", worker_id)
            .eq("organization_id", organization_id)
            .eq("request_type", "time_off")
            .eq("status", "approved")
            .execute()
        )
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        raise

    blocks: list[dict[str, Any]] = []
    for row in resp.data or []:
        detail = row.get("worker_time_off_request_details")
        if isinstance(detail, list):
            detail = detail[0] if detail else None
        if not detail:
            continue
        sd = detail.get("start_date")
        ed = detail.get("end_date")
        if not sd or not ed:
            continue
        if str(ed) < str(start_date) or str(sd) > str(end_date):
            continue
        blocks.append({
            "request_id": row.get("id"),
            "start_date": sd,
            "end_date": ed,
            "reason_code": detail.get("reason_code"),
            "resolved_at": row.get("resolved_at"),
            "label": "Time off",
        })
    return blocks


def get_calendar_payload(
    worker_id: str,
    organization_id: str,
    start_date: date,
    end_date: date,
) -> dict[str, Any]:
    org_id = _resolve_worker_org(worker_id, organization_id)
    if not org_id:
        return {"shifts": [], "time_off_blocks": [], "start_date": str(start_date), "end_date": str(end_date)}
    shifts = list_shifts_for_calendar(worker_id, org_id, start_date, end_date)
    time_off = list_approved_time_off_blocks(worker_id, org_id, start_date, end_date)
    return {"shifts": shifts, "time_off_blocks": time_off, "start_date": str(start_date), "end_date": str(end_date)}


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def get_or_create_feed_token(worker_id: str, organization_id: str) -> dict[str, Any]:
    """Make a new private calendar link for the worker.

    Only the hash is stored, so the raw token is returned once. A worker has
    one link at a time: making a new one stops the old one working."""
    supabase = get_supabase_admin()
    had_existing = False
    try:
        existing = (
            supabase.table("worker_calendar_feed_tokens")
            .select("id, revoked_at")
            .eq("user_id", worker_id)
            .limit(1)
            .execute()
        )
        had_existing = any(not row.get("revoked_at") for row in existing.data or [])
    except Exception as exc:
        if _is_missing_schema_error(exc):
            raise ValueError("Calendar feed unavailable. Run migration 060_worker_calendar.") from exc
        raise

    raw = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw)
    supabase.table("worker_calendar_feed_tokens").upsert({
        "user_id": worker_id,
        "organization_id": organization_id,
        "token_hash": token_hash,
        "revoked_at": None,
        "last_accessed_at": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="user_id").execute()
    return {"token": raw, "regenerated": had_existing}


def get_feed_status(worker_id: str) -> dict[str, Any]:
    """Whether the worker has a working calendar link, and when their
    calendar app last fetched it (the link itself can't be shown again)."""
    inactive = {"active": False, "created_at": None, "last_accessed_at": None}
    try:
        resp = (
            get_supabase_admin()
            .table("worker_calendar_feed_tokens")
            .select("created_at, last_accessed_at, revoked_at")
            .eq("user_id", worker_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return inactive
        raise
    row = (resp.data or [None])[0]
    if not row or row.get("revoked_at"):
        return inactive
    return {"active": True, "created_at": row.get("created_at"), "last_accessed_at": row.get("last_accessed_at")}


def revoke_feed_token(worker_id: str) -> None:
    """Stop the worker's calendar link. Their calendar app keeps what it last
    fetched but gets no new shifts."""
    try:
        get_supabase_admin().table("worker_calendar_feed_tokens").update(
            {"revoked_at": datetime.now(timezone.utc).isoformat()}
        ).eq("user_id", worker_id).is_("revoked_at", "null").execute()
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            raise


def resolve_feed_user(token: str) -> Optional[dict[str, Any]]:
    if not token or len(token) < 16:
        return None
    token_hash = _hash_token(token)
    try:
        supabase = get_supabase_admin()
        resp = (
            supabase.table("worker_calendar_feed_tokens")
            .select("user_id, organization_id")
            .eq("token_hash", token_hash)
            .is_("revoked_at", "null")
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
        if not row:
            return None
        # A worker who has left (deactivated, or moved to another
        # organisation) stops getting shifts in their calendar.
        user_rows = (
            supabase.table("users")
            .select("id, organization_id, is_active")
            .eq("id", str(row["user_id"]))
            .limit(1)
            .execute()
            .data
            or []
        )
        user = user_rows[0] if user_rows else None
        if not user or user.get("is_active") is False:
            return None
        if str(user.get("organization_id") or "") != str(row.get("organization_id") or ""):
            return None
        now = datetime.now(timezone.utc).isoformat()
        supabase.table("worker_calendar_feed_tokens").update(
            {"last_accessed_at": now}
        ).eq("token_hash", token_hash).execute()
        return row
    except Exception:
        logger.warning("Calendar feed lookup failed", exc_info=True)
        return None


# How much of the roster the feed carries: recent shifts stay visible for a
# while (so a calendar doesn't wipe last week), and the next six months.
FEED_PAST_DAYS = 30
FEED_FUTURE_DAYS = 183
FEED_MAX_EVENTS = 1000


def _ical_escape(value: str) -> str:
    """TEXT value escaping (RFC 5545 3.3.11)."""
    return (
        str(value)
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
        .replace("\r", "\\n")
    )


def _ical_fold(line: str) -> list[str]:
    """Lines longer than 75 octets are folded (RFC 5545 3.1); strict
    calendar apps reject feeds that don't."""
    parts: list[str] = []
    current = ""
    size = 0
    for char in line:
        width = len(char.encode("utf-8"))
        limit = 75 if not parts else 74  # continuation lines start with a space
        if size + width > limit:
            parts.append(current)
            current, size = char, width
        else:
            current += char
            size += width
    parts.append(current)
    return [parts[0], *(" " + part for part in parts[1:])]


def _ical_utc(value: Any) -> str:
    """An ISO timestamp as an iCalendar UTC time, '' if it can't be read.
    UTC means every calendar shows the shift at the right local time,
    whichever state the worker or participant is in."""
    if not value:
        return ""
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=DEFAULT_TZ)
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _feed_shifts(worker_id: str, organization_id: str) -> list[dict[str, Any]]:
    """The worker's shifts for the feed, in one query. The participant's
    name and address are copied onto each shift, so nothing else is read."""
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=FEED_PAST_DAYS)).isoformat()
    end = (now + timedelta(days=FEED_FUTURE_DAYS)).isoformat()
    try:
        resp = (
            get_supabase_admin()
            .table("shifts")
            .select(
                "id, participant_name, participant_address, scheduled_start, scheduled_end, "
                "status, confirmation_status, updated_at"
            )
            .eq("organization_id", organization_id)
            .eq("worker_id", worker_id)
            .gte("scheduled_start", start)
            .lte("scheduled_start", end)
            .order("scheduled_start")
            .limit(FEED_MAX_EVENTS)
            .execute()
        )
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        raise
    return resp.data or []


def build_ical_feed(worker_id: str, organization_id: str) -> str:
    """The worker's roster as an iCalendar feed, for Google Calendar,
    Outlook and Apple Calendar to subscribe to.

    Each event carries the participant's first name and suburb only: the
    feed lives in the worker's personal calendar account, outside CareCliQ,
    so the full address, notes and health details stay in the app.
    Cancelled shifts are left out, which removes them from the calendar on
    its next refresh."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//CareCliQ//Worker Shifts//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:CareCliQ shifts",
        "X-WR-CALDESC:Your rostered shifts from CareCliQ",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
    ]
    for shift in _feed_shifts(worker_id, organization_id):
        if (shift.get("status") or "").lower() == "cancelled":
            continue
        dtstart = _ical_utc(shift.get("scheduled_start"))
        dtend = _ical_utc(shift.get("scheduled_end"))
        if not dtstart or not dtend or dtend <= dtstart:
            continue
        tentative = _calendar_display_status(shift) == "tentative"
        first_name = (str(shift.get("participant_name") or "").split() or ["a participant"])[0]
        summary = f"Shift with {first_name}"
        if tentative:
            summary += " (to be confirmed)"
        event = [
            "BEGIN:VEVENT",
            f"UID:{shift.get('id')}@carecliq",
            f"DTSTAMP:{stamp}",
            f"DTSTART:{dtstart}",
            f"DTEND:{dtend}",
            f"SUMMARY:{_ical_escape(summary)}",
        ]
        modified = _ical_utc(shift.get("updated_at"))
        if modified:
            event.append(f"LAST-MODIFIED:{modified}")
        suburb = extract_suburb(shift.get("participant_address"))
        if suburb:
            event.append(f"LOCATION:{_ical_escape(suburb)}")
        event.extend([
            "DESCRIPTION:"
            + _ical_escape("Open the CareCliQ app for the address, tasks and notes for this shift."),
            f"STATUS:{'TENTATIVE' if tentative else 'CONFIRMED'}",
            "TRANSP:OPAQUE",
            "END:VEVENT",
        ])
        for line in event:
            lines.extend(_ical_fold(line))
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def anonymise_participant_name(full_name: str) -> str:
    parts = (full_name or "Participant").split()
    if not parts:
        return "Participant"
    first = parts[0]
    last_initial = parts[-1][0].upper() if len(parts) > 1 and parts[-1] else ""
    return f"{first} {last_initial}." if last_initial else first
