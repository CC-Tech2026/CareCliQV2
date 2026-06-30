"""Australian timezone helpers for shift scheduling."""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

APP_TIMEZONE = ZoneInfo(os.environ.get("APP_TIMEZONE", "Australia/Adelaide"))
LOCATION_BASED_TIMEZONE = os.environ.get("LOCATION_BASED_TIMEZONE", "false").lower() == "true"


def parse_shift_datetime(value: str) -> datetime:
    """Parse a shift timestamp; naive values are interpreted as APP_TIMEZONE local time."""
    text = str(value).strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=APP_TIMEZONE)
    return dt.astimezone(timezone.utc)


def app_today() -> date:
    """Current calendar date in the application timezone (Australia by default)."""
    return datetime.now(APP_TIMEZONE).date()


def shift_local_date(scheduled_start: Optional[str]) -> Optional[date]:
    """Calendar date of a shift start in APP_TIMEZONE."""
    if not scheduled_start:
        return None
    try:
        return parse_shift_datetime(str(scheduled_start)).astimezone(APP_TIMEZONE).date()
    except ValueError:
        return None


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
    """Resolve timezone from worker coordinates; falls back to APP_TIMEZONE."""
    if not LOCATION_BASED_TIMEZONE:
        return APP_TIMEZONE
    if latitude is None or longitude is None:
        return APP_TIMEZONE
    try:
        lat = float(latitude)
        lon = float(longitude)
    except (TypeError, ValueError):
        return APP_TIMEZONE
    tz_name = _australian_timezone_name(lat, lon)
    if tz_name:
        try:
            return ZoneInfo(tz_name)
        except Exception:
            pass
    return APP_TIMEZONE


def app_day_bounds_utc(day: date) -> tuple[str, str]:
    """UTC ISO bounds [start, end) for a calendar day in APP_TIMEZONE."""
    local_start = datetime.combine(day, datetime.min.time(), tzinfo=APP_TIMEZONE)
    local_end = local_start + timedelta(days=1)
    return (
        local_start.astimezone(timezone.utc).isoformat(),
        local_end.astimezone(timezone.utc).isoformat(),
    )
