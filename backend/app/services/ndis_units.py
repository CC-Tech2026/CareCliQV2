"""How a quantity of an NDIS support reads: "4 hrs", "4 trips", "120 km".

The NDIS price guide gives a unit of measure (H, D, WK, MON, YR, KM, E for
"each"). "Each" says nothing about what's being counted, so for those the
noun comes from the support itself when it's clear (transport is per trip),
and otherwise the quantity is shown on its own rather than guessed.
"""

from __future__ import annotations

import re
from typing import Optional

UNIT_NOUNS: dict[str, tuple[str, str]] = {
    "H": ("hr", "hrs"),
    "HOUR": ("hr", "hrs"),
    "HR": ("hr", "hrs"),
    "D": ("day", "days"),
    "WK": ("week", "weeks"),
    "MON": ("month", "months"),
    "YR": ("year", "years"),
    "KM": ("km", "km"),
}
HOUR_UNITS = {"H", "HOUR"}

# Per-item ("each") supports whose count has an obvious noun, matched on the
# support's name or description. First match wins.
_EACH_NOUNS: tuple[tuple[re.Pattern[str], tuple[str, str]], ...] = (
    (re.compile(r"transport|travel", re.I), ("trip", "trips")),
    (re.compile(r"\bmeal", re.I), ("meal", "meals")),
    (re.compile(r"\bsession|\bassessment|\bconsult", re.I), ("session", "sessions")),
    (re.compile(r"\breport\b", re.I), ("report", "reports")),
    (re.compile(r"\bvisit", re.I), ("visit", "visits")),
)
# Activity Based Transport (support category 04, item 590) is claimed per trip.
_TRANSPORT_CODE = re.compile(r"^04_590_")


def format_quantity(quantity: float) -> str:
    return f"{quantity:,.2f}".rstrip("0").rstrip(".")


def unit_nouns(unit: Optional[str], item_code: Optional[str] = None, name: Optional[str] = None) -> Optional[tuple[str, str]]:
    """(singular, plural) for a support's unit, or None to show the number only."""
    key = (unit or "").strip().upper()
    if key in UNIT_NOUNS:
        return UNIT_NOUNS[key]
    if key not in ("", "E", "EA", "EACH"):
        return None
    if item_code and _TRANSPORT_CODE.match(item_code.strip()):
        return ("trip", "trips")
    for pattern, nouns in _EACH_NOUNS:
        if name and pattern.search(name):
            return nouns
    return None


def quantity_label(
    quantity: float, unit: Optional[str], item_code: Optional[str] = None, name: Optional[str] = None,
) -> str:
    text = format_quantity(quantity)
    nouns = unit_nouns(unit, item_code, name)
    if not nouns:
        return text
    return f"{text} {nouns[0] if quantity == 1 else nouns[1]}"
