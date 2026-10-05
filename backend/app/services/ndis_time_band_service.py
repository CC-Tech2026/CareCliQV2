"""NDIS time bands: which day and time of day a support was delivered in, and
so which of a support's codes is billed.

From the NDIS Pricing Arrangements and Price Limits 2025-26 (v1.0), "Time
of Day and Day of Week", for disability support workers:

- Public holiday, Saturday or Sunday: starts at or after midnight before
  that day and ends at or before midnight of that day.
- Weekday daytime: starts at or after 6:00 am and ends at or before
  8:00 pm on a single weekday.
- Weekday evening: starts at or after 8:00 pm and finishes at or before
  midnight on a single weekday.
- Weekday night: starts at or before midnight on a weekday and finishes
  after midnight, or starts before 6:00 am and finishes that weekday.
- A support that fits none of these is billed as separate supports, except
  that when it crosses a boundary and the same worker delivers all of it,
  the higher of the price limits applies to the whole support. CareCliQ
  shifts are one worker, so that exception is the rule used here.

One reading is ours: a weekday support that runs past midnight counts as
weekday night only when it ends by 6:00 am. Anything longer is treated as
crossing a boundary, so a Friday night shift that runs into Saturday
morning is billed at the higher of the two.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any, Iterable, Optional

BANDS = ("weekday_daytime", "weekday_evening", "weekday_night", "saturday", "sunday", "public_holiday")
BAND_LABELS = {
    "weekday_daytime": "weekday daytime",
    "weekday_evening": "weekday evening",
    "weekday_night": "weekday night",
    "saturday": "Saturday",
    "sunday": "Sunday",
    "public_holiday": "public holiday",
}

_SIX_AM = time(6, 0)
_EIGHT_PM = time(20, 0)


def _norm(value: Any) -> str:
    return str(value or "").strip().lower().replace(" ", "_")


def item_band(item: dict[str, Any]) -> Optional[str]:
    """The band a catalogue item is priced for, or None for items that aren't
    time-banded. Uses the catalogue's day and time types, and the item name
    only when those are empty. Night-time sleepover and supported
    independent living items are their own supports, never read from the
    name."""
    day, tod = _norm(item.get("day_type")), _norm(item.get("time_type"))
    if not day:
        name = str(item.get("name") or "").lower()
        if "sleepover" in name or "supported independent living" in name:
            return None
        for band in ("public_holiday", "saturday", "sunday"):
            if BAND_LABELS[band].lower() in name:
                return band
        if "weekday" not in name:
            return None
        day = "weekday"
        tod = next((t for t in ("daytime", "evening", "night") if t in name), "")
    if day == "weekday":
        return f"weekday_{tod}" if tod in ("daytime", "evening", "night") else None
    return day if day in ("saturday", "sunday", "public_holiday") else None


def _day_kind(day: date, holidays: set[str]) -> str:
    if day.isoformat() in holidays:
        return "public_holiday"
    return {5: "saturday", 6: "sunday"}.get(day.weekday(), "weekday")


def _at(day: date, clock: time, like: datetime) -> datetime:
    return datetime.combine(day, clock, tzinfo=like.tzinfo)


def support_bands(start: datetime, end: datetime, holidays: Iterable[str]) -> list[str]:
    """The bands a support touches, given its local start and end. One band
    when it fits a single NDIS definition; several when it crosses a
    boundary (the higher price limit then applies to all of it)."""
    holidays = set(holidays)
    if end <= start:
        return []
    first = start.date()
    kind = _day_kind(first, holidays)
    next_midnight = _at(first + timedelta(days=1), time(0), start)
    if end <= next_midnight:
        if kind != "weekday":
            return [kind]
        if start.time() < _SIX_AM:
            return ["weekday_night"]
        if start.time() >= _EIGHT_PM:
            return ["weekday_evening"]
        if end <= _at(first, _EIGHT_PM, start):
            return ["weekday_daytime"]
    elif kind == "weekday" and end <= _at(first + timedelta(days=1), _SIX_AM, start):
        return ["weekday_night"]

    # Crosses a boundary: every band any part of it falls in.
    touched: list[str] = []
    cursor = start
    while cursor < end:
        day = cursor.date()
        day_kind = _day_kind(day, holidays)
        midnight = _at(day + timedelta(days=1), time(0), cursor)
        if day_kind != "weekday":
            band, boundary = day_kind, midnight
        elif cursor.time() < _SIX_AM:
            band, boundary = "weekday_night", _at(day, _SIX_AM, cursor)
        elif cursor.time() < _EIGHT_PM:
            band, boundary = "weekday_daytime", _at(day, _EIGHT_PM, cursor)
        else:
            band, boundary = "weekday_evening", midnight
        if band not in touched:
            touched.append(band)
        cursor = min(end, boundary)
    return touched


def choose_code(group: list[dict[str, Any]], bands: list[str]) -> Optional[dict[str, Any]]:
    """The item in a support group to bill for these bands: the one with the
    highest price limit among the bands the support touched. None when the
    group isn't time-banded or has no item for any of the bands (community
    access, for one, has no weekday night item)."""
    candidates = [g for g in group if item_band(g) in bands]
    if not candidates:
        return None
    return max(candidates, key=lambda g: float(g.get("price_national") or 0))


def bands_label(bands: list[str]) -> str:
    labels = [BAND_LABELS[b] for b in bands if b in BAND_LABELS]
    return " and ".join(labels) if len(labels) <= 2 else ", ".join(labels[:-1]) + " and " + labels[-1]
