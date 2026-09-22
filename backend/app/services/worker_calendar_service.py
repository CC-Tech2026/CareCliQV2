"""Worker calendar — CARECLIQV2-281."""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
from datetime import date, datetime, time, timezone
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
    """Return a new feed token (stored as hash only; raw token returned to client once)."""
    supabase = get_supabase_admin()
    had_existing = False
    try:
        existing = (
            supabase.table("worker_calendar_feed_tokens")
            .select("id")
            .eq("user_id", worker_id)
            .limit(1)
            .execute()
        )
        had_existing = bool(existing.data)
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
        "created_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="user_id").execute()
    return {"token": raw, "regenerated": had_existing}


def resolve_feed_user(token: str) -> Optional[dict[str, Any]]:
    if not token or len(token) < 16:
        return None
    token_hash = _hash_token(token)
    try:
        resp = (
            get_supabase_admin()
            .table("worker_calendar_feed_tokens")
            .select("user_id, organization_id")
            .eq("token_hash", token_hash)
            .is_("revoked_at", "null")
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
        if not row:
            return None
        now = datetime.now(timezone.utc).isoformat()
        get_supabase_admin().table("worker_calendar_feed_tokens").update(
            {"last_accessed_at": now}
        ).eq("token_hash", token_hash).execute()
        return row
    except Exception:
        return None


def build_ical_feed(worker_id: str, organization_id: str) -> str:
    """Generate iCal document for confirmed upcoming shifts."""
    today = date.today()
    end = date(today.year + 1, today.month, today.day)
    shifts = list_shifts_for_calendar(worker_id, organization_id, today, end)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//CareCliQ//Worker Schedule//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:CareCliQ Shifts",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    ]
    for shift in shifts:
        if shift.get("calendar_status") != "confirmed":
            continue
        if (shift.get("status") or "").lower() == "cancelled":
            continue
        uid = shift.get("id", "")
        start = shift.get("scheduled_start", "")
        end_dt = shift.get("scheduled_end", "")
        if not start or not end_dt:
            continue
        name = shift.get("participant_first_name") or "Shift"
        def _ical_dt(iso: str) -> str:
            try:
                dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
                return dt.astimezone(DEFAULT_TZ).strftime("%Y%m%dT%H%M%S")
            except ValueError:
                return ""

        dtstart = _ical_dt(start)
        dtend = _ical_dt(end_dt)
        if not dtstart or not dtend:
            continue
        lines.extend([
            "BEGIN:VEVENT",
            f"UID:{uid}@carecliq",
            f"DTSTART;TZID=Australia/Adelaide:{dtstart}",
            f"DTEND;TZID=Australia/Adelaide:{dtend}",
            f"SUMMARY:Shift with {name}",
            "END:VEVENT",
        ])
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def anonymise_participant_name(full_name: str) -> str:
    parts = (full_name or "Participant").split()
    if not parts:
        return "Participant"
    first = parts[0]
    last_initial = parts[-1][0].upper() if len(parts) > 1 and parts[-1] else ""
    return f"{first} {last_initial}." if last_initial else first
