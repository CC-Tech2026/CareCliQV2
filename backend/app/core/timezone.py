"""Australian timezone helpers for shift scheduling."""

from __future__ import annotations

import os
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

APP_TIMEZONE = ZoneInfo(os.environ.get("APP_TIMEZONE", "Australia/Adelaide"))


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
