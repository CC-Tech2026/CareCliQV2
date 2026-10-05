"""NDIS time bands (Pricing Arrangements 2025-26, Time of Day and Day of
Week): which band a support falls in, and which code of a support to bill."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from backend.app.services import ndis_time_band_service as bands

ADL = ZoneInfo("Australia/Adelaide")
HOLIDAYS = {"2026-10-12"}  # a Monday, for these tests


def _at(day: int, hour: int, minute: int = 0, month: int = 10) -> datetime:
    return datetime(2026, month, day, hour, minute, tzinfo=ADL)


@pytest.mark.parametrize("start, end, expected", [
    (_at(5, 6), _at(5, 20), ["weekday_daytime"]),            # Mon 6am-8pm, both ends inclusive
    (_at(5, 20), _at(6, 0), ["weekday_evening"]),            # Mon 8pm-midnight
    (_at(5, 22), _at(6, 2), ["weekday_night"]),              # crosses midnight
    (_at(6, 4), _at(6, 7), ["weekday_night"]),               # starts before 6am, same weekday
    (_at(9, 22), _at(10, 2), ["weekday_night"]),             # Friday night into Saturday, ends by 6am
    (_at(10, 9), _at(10, 17), ["saturday"]),
    (_at(11, 0), _at(12, 0), ["sunday"]),                    # the whole of Sunday
    (_at(12, 9), _at(12, 13), ["public_holiday"]),           # a holiday Monday is never "weekday"
])
def test_supports_that_fit_one_band(start, end, expected):
    assert bands.support_bands(start, end, HOLIDAYS) == expected


@pytest.mark.parametrize("start, end, expected", [
    (_at(5, 16), _at(5, 22), ["weekday_daytime", "weekday_evening"]),
    (_at(10, 22), _at(11, 2), ["saturday", "sunday"]),
    (_at(9, 22), _at(10, 9), ["weekday_evening", "saturday"]),  # Friday into Saturday past 6am
    (_at(11, 22), _at(12, 2), ["sunday", "public_holiday"]),
])
def test_supports_that_cross_a_boundary_touch_every_band(start, end, expected):
    assert bands.support_bands(start, end, HOLIDAYS) == expected


def _item(code, day_type, time_type, price, name="Assistance With Self-Care Activities - Standard"):
    return {"item_code": code, "day_type": day_type, "time_type": time_type, "price_national": price, "name": name}


SELF_CARE = [
    _item("01_011_0107_1_1", "Weekday", "Daytime", 73.58),
    _item("01_015_0107_1_1", "Weekday", "Evening", 81.07),
    _item("01_002_0107_1_1", "Weekday", "Night", 82.57),
    _item("01_013_0107_1_1", "Saturday", None, 103.54),
    _item("01_014_0107_1_1", "Sunday", None, 133.50),
    _item("01_012_0107_1_1", "Public Holiday", None, 163.46),
]


def test_the_code_for_the_band():
    assert bands.choose_code(SELF_CARE, ["saturday"])["item_code"] == "01_013_0107_1_1"
    assert bands.choose_code(SELF_CARE, ["weekday_night"])["item_code"] == "01_002_0107_1_1"


def test_one_worker_across_a_boundary_bills_the_higher_limit_for_all_of_it():
    assert bands.choose_code(SELF_CARE, ["weekday_daytime", "weekday_evening"])["item_code"] == "01_015_0107_1_1"
    assert bands.choose_code(SELF_CARE, ["saturday", "sunday"])["item_code"] == "01_014_0107_1_1"


def test_a_support_without_that_band_uses_the_bands_it_has():
    community = [g for g in SELF_CARE if g["item_code"] != "01_002_0107_1_1"]  # no weekday night item
    assert bands.choose_code(community, ["weekday_night", "weekday_daytime"])["item_code"] == "01_011_0107_1_1"
    assert bands.choose_code([_item("07_002_0106_8_3", None, None, 100.14, "Coordination Of Supports")], ["saturday"]) is None


def test_item_bands_come_from_the_catalogue_then_the_name():
    assert bands.item_band(_item("x", "Public Holiday", None, 1)) == "public_holiday"
    assert bands.item_band(_item("x", None, None, 1, "Something - Weekday Evening")) == "weekday_evening"
    # Sleepover and supported independent living are their own supports.
    assert bands.item_band(_item("x", None, None, 1, "Assistance With Self-Care Activities - Night-Time Sleepover")) is None
    assert bands.item_band(_item("x", None, None, 1, "Supported Independent Living - Weekday Night")) is None
    assert bands.bands_label(["weekday_daytime", "weekday_evening"]) == "weekday daytime and weekday evening"
