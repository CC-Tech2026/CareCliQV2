"""Australian timezone helpers.

Timestamps are stored in UTC. Which *local* timezone they're shown and
counted in comes from the branch (office) that the record belongs to —
see 198_branches.sql. A provider's Adelaide head office and Melbourne
branch each carry their own zone; staff and participants belong to a
branch and never cross states, so one zone per branch covers shift times,
SCHADS penalty boundaries, billing periods, plan periods and dashboards.

Resolution order for "which zone?":

1. An explicit ``tz`` argument (the participant's branch for anything
   about a participant — shifts, notes, pay).
2. The request's zone — the calling user's branch, set per request by
   OrgContextMiddleware (dashboards, "today", reports).
3. ``APP_TIMEZONE`` — the deployment default, used by cron jobs and tests
   where there is no request.

Until an organisation creates a second branch every path resolves to its
head office, which is backfilled to APP_TIMEZONE, so behaviour is
unchanged for single-office providers.
"""

from __future__ import annotations

import logging
import os
import time
from contextvars import ContextVar, Token
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

logger = logging.getLogger(__name__)

APP_TIMEZONE = ZoneInfo(os.environ.get("APP_TIMEZONE", "Australia/Adelaide"))
LOCATION_BASED_TIMEZONE = os.environ.get("LOCATION_BASED_TIMEZONE", "false").lower() == "true"

# Mirrors public.timezone_for_state() in 198_branches.sql.
AUSTRALIAN_STATE_TIMEZONES: dict[str, str] = {
    "SA": "Australia/Adelaide",
    "NSW": "Australia/Sydney",
    "ACT": "Australia/Sydney",
    "VIC": "Australia/Melbourne",
    "QLD": "Australia/Brisbane",
    "WA": "Australia/Perth",
    "TAS": "Australia/Hobart",
    "NT": "Australia/Darwin",
}
AUSTRALIAN_TIMEZONES: frozenset[str] = frozenset(AUSTRALIAN_STATE_TIMEZONES.values())


# ── Request-scoped zone ────────────────────────────────────────────────

_request_timezone: ContextVar[Optional[ZoneInfo]] = ContextVar("request_timezone", default=None)


def set_request_timezone(tz: Optional[ZoneInfo]) -> Token:
    """Bind the zone for the current request. Returns a token for reset."""
    return _request_timezone.set(tz)


def reset_request_timezone(token: Token) -> None:
    _request_timezone.reset(token)


def request_timezone() -> ZoneInfo:
    """The calling user's branch zone, or APP_TIMEZONE outside a request."""
    return _request_timezone.get() or APP_TIMEZONE


def _resolve(tz: Optional[ZoneInfo]) -> ZoneInfo:
    return tz or request_timezone()


# ── Validation / mapping ───────────────────────────────────────────────

def coerce_timezone(name: Any) -> Optional[ZoneInfo]:
    """IANA name -> ZoneInfo, or None if it isn't a valid zone."""
    if isinstance(name, ZoneInfo):
        return name
    text = str(name or "").strip()
    if not text:
        return None
    try:
        return ZoneInfo(text)
    except (ZoneInfoNotFoundError, ValueError):
        return None


def timezone_for_state(state: Any) -> Optional[ZoneInfo]:
    """'VIC' -> Australia/Melbourne; None for anything unrecognised."""
    name = AUSTRALIAN_STATE_TIMEZONES.get(str(state or "").strip().upper())
    return ZoneInfo(name) if name else None


# ── Branch lookups (cached) ────────────────────────────────────────────
#
# Branch zones change rarely (an MD editing a branch's state), so a short
# TTL cache keeps the per-request middleware lookup and the per-shift
# participant lookups off the database. Failed lookups are cached briefly
# too so an outage doesn't turn every request into a slow query.

CACHE_TTL_SECONDS = 300
_FAILURE_TTL_SECONDS = 30

_branch_cache: dict[str, tuple[Optional[ZoneInfo], float]] = {}
_user_cache: dict[str, tuple[Optional[ZoneInfo], float]] = {}
_participant_cache: dict[str, tuple[Optional[ZoneInfo], float]] = {}
_head_office_cache: dict[str, tuple[Optional[ZoneInfo], float]] = {}


def clear_timezone_caches() -> None:
    _branch_cache.clear()
    _user_cache.clear()
    _participant_cache.clear()
    _head_office_cache.clear()


def _cached(cache: dict, key: str) -> tuple[bool, Optional[ZoneInfo]]:
    entry = cache.get(key)
    if entry and entry[1] > time.monotonic():
        return True, entry[0]
    return False, None


def _store(cache: dict, key: str, tz: Optional[ZoneInfo]) -> Optional[ZoneInfo]:
    ttl = CACHE_TTL_SECONDS if tz else _FAILURE_TTL_SECONDS
    cache[key] = (tz, time.monotonic() + ttl)
    return tz


def _admin_client(supabase=None):
    if supabase is not None:
        return supabase
    # Lazy: core must not import services at module load (same pattern as
    # core/security.py).
    from ..services.supabase_client import get_supabase_admin

    return get_supabase_admin()


def branch_timezone(branch_id: Any, *, supabase=None) -> Optional[ZoneInfo]:
    """Zone of a branch by id; None if unknown or unreachable."""
    key = str(branch_id or "")
    if not key:
        return None
    hit, tz = _cached(_branch_cache, key)
    if hit:
        return tz
    try:
        rows = (
            _admin_client(supabase)
            .table("branches")
            .select("timezone")
            .eq("id", key)
            .limit(1)
            .execute()
            .data
        ) or []
        tz = coerce_timezone(rows[0].get("timezone")) if rows else None
    except Exception as exc:  # pragma: no cover - network/DB failure path
        logger.debug("branch timezone lookup failed for %s: %s", key, exc)
        tz = None
    return _store(_branch_cache, key, tz)


def head_office_timezone(organization_id: Any, *, supabase=None) -> Optional[ZoneInfo]:
    """Zone of an organisation's head office; None if unknown."""
    key = str(organization_id or "")
    if not key:
        return None
    hit, tz = _cached(_head_office_cache, key)
    if hit:
        return tz
    try:
        rows = (
            _admin_client(supabase)
            .table("branches")
            .select("timezone")
            .eq("organization_id", key)
            .eq("is_head_office", True)
            .limit(1)
            .execute()
            .data
        ) or []
        tz = coerce_timezone(rows[0].get("timezone")) if rows else None
    except Exception as exc:  # pragma: no cover
        logger.debug("head office timezone lookup failed for org %s: %s", key, exc)
        tz = None
    return _store(_head_office_cache, key, tz)


def user_timezone(user_id: Any, organization_id: Any, *, supabase=None) -> ZoneInfo:
    """Zone of a staff member's branch. Falls back to the org's head office,
    then APP_TIMEZONE, so it always returns something usable."""
    uid, oid = str(user_id or ""), str(organization_id or "")
    if not uid or not oid:
        return head_office_timezone(oid, supabase=supabase) or APP_TIMEZONE
    key = f"{oid}:{uid}"
    hit, tz = _cached(_user_cache, key)
    if not hit:
        try:
            rows = (
                _admin_client(supabase)
                .table("organization_members")
                .select("branch_id")
                .eq("user_id", uid)
                .eq("organization_id", oid)
                .limit(1)
                .execute()
                .data
            ) or []
            branch_id = rows[0].get("branch_id") if rows else None
            tz = branch_timezone(branch_id, supabase=supabase) if branch_id else None
        except Exception as exc:  # pragma: no cover
            logger.debug("user timezone lookup failed for %s: %s", key, exc)
            tz = None
        _store(_user_cache, key, tz)
    return tz or head_office_timezone(oid, supabase=supabase) or APP_TIMEZONE


def participant_timezone(participant: Any, *, organization_id: Any = None, supabase=None) -> ZoneInfo:
    """Zone of the branch a participant belongs to.

    Accepts a participant id, a participant row (uses ``branch_id`` /
    ``organization_id`` if present), or a shift/session row carrying
    ``participant_id`` / ``patient_id``. Falls back to the request zone.
    """
    row: dict = participant if isinstance(participant, dict) else {}
    branch_id = row.get("branch_id")
    if branch_id:
        tz = branch_timezone(branch_id, supabase=supabase)
        if tz:
            return tz

    pid = (
        row.get("participant_id") or row.get("patient_id") or row.get("id")
        if row else participant
    )
    key = str(pid or "")
    if not key:
        return request_timezone()

    hit, tz = _cached(_participant_cache, key)
    if not hit:
        try:
            query = _admin_client(supabase).table("patients").select("branch_id").eq("id", key)
            org = organization_id or row.get("organization_id")
            if org:
                query = query.eq("organization_id", str(org))
            rows = query.limit(1).execute().data or []
            bid = rows[0].get("branch_id") if rows else None
            tz = branch_timezone(bid, supabase=supabase) if bid else None
        except Exception as exc:  # pragma: no cover
            logger.debug("participant timezone lookup failed for %s: %s", key, exc)
            tz = None
        _store(_participant_cache, key, tz)
    return tz or request_timezone()


# ── Conversions ────────────────────────────────────────────────────────

def parse_shift_datetime(value: str, tz: Optional[ZoneInfo] = None) -> datetime:
    """Parse a shift timestamp to UTC; naive values are read as local time
    in ``tz`` (default: the request zone)."""
    text = str(value).strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_resolve(tz))
    return dt.astimezone(timezone.utc)


def app_today(tz: Optional[ZoneInfo] = None) -> date:
    """Current calendar date in ``tz`` (default: the request zone)."""
    return datetime.now(_resolve(tz)).date()


def shift_local_date(scheduled_start: Optional[str], tz: Optional[ZoneInfo] = None) -> Optional[date]:
    """Calendar date of a timestamp in ``tz`` (default: the request zone)."""
    if not scheduled_start:
        return None
    try:
        return parse_shift_datetime(str(scheduled_start), tz).astimezone(_resolve(tz)).date()
    except ValueError:
        return None


def app_day_bounds_utc(day: date, tz: Optional[ZoneInfo] = None) -> tuple[str, str]:
    """UTC ISO bounds [start, end) for a calendar day in ``tz``."""
    zone = _resolve(tz)
    local_start = datetime.combine(day, datetime.min.time(), tzinfo=zone)
    local_end = local_start + timedelta(days=1)
    return (
        local_start.astimezone(timezone.utc).isoformat(),
        local_end.astimezone(timezone.utc).isoformat(),
    )


# ── Coordinates → zone (optional, LOCATION_BASED_TIMEZONE) ─────────────

def _australian_timezone_name(latitude: float, longitude: float) -> Optional[str]:
    """Map Australian coordinates to an IANA timezone name."""
    if not (-44.5 <= latitude <= -9.0 and 113.0 <= longitude <= 154.5):
        return None
    if longitude < 129.0:
        return "Australia/Perth"
    if latitude > -26.0 and 129.0 <= longitude < 138.0:
        return "Australia/Darwin"
    if -38.5 <= latitude <= -26.0 and 129.0 <= longitude < 141.0:
        return "Australia/Adelaide"
    if latitude > -29.0 and 138.0 <= longitude:
        return "Australia/Brisbane"
    if latitude < -39.5 and 144.0 <= longitude <= 149.5:
        return "Australia/Hobart"
    if -39.0 <= latitude <= -33.5 and 140.5 <= longitude <= 150.5:
        return "Australia/Sydney"
    if -39.5 <= latitude <= -34.0 and 140.5 <= longitude <= 150.0:
        return "Australia/Melbourne"
    return "Australia/Sydney"


def get_timezone_for_location(
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
) -> ZoneInfo:
    """Resolve timezone from worker coordinates; falls back to the request zone."""
    if not LOCATION_BASED_TIMEZONE:
        return request_timezone()
    if latitude is None or longitude is None:
        return request_timezone()
    try:
        lat = float(latitude)
        lon = float(longitude)
    except (TypeError, ValueError):
        return request_timezone()
    tz_name = _australian_timezone_name(lat, lon)
    if tz_name:
        try:
            return ZoneInfo(tz_name)
        except Exception:
            pass
    return request_timezone()
