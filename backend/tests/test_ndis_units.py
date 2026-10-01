"""Quantity labels for NDIS supports: units from the price guide, and a noun
for per-item supports only when it's clear what's being counted."""
from backend.app.services.ndis_units import quantity_label


def test_time_and_distance_units():
    assert quantity_label(1, "H") == "1 hr"
    assert quantity_label(4.5, "H") == "4.5 hrs"
    assert quantity_label(2, "hr") == "2 hrs"
    assert quantity_label(3, "D") == "3 days"
    assert quantity_label(120, "KM") == "120 km"
    assert quantity_label(1250, "WK") == "1,250 weeks"


def test_transport_is_counted_in_trips():
    assert quantity_label(4, "E", "04_590_0125_6_1") == "4 trips"
    assert quantity_label(1, "E", "04_590_0125_6_1") == "1 trip"
    assert quantity_label(2, "E", None, "Provider travel - non-labour costs") == "2 trips"


def test_other_per_item_supports_by_name():
    assert quantity_label(3, "E", None, "Delivery of health supports - Meal preparation") == "3 meals"
    assert quantity_label(1, "E", None, "Assessment, recommendation, therapy") == "1 session"


def test_unknown_per_item_count_is_just_the_number():
    assert quantity_label(4, "E", "01_002_0107_1_1", "Assistance with personal domestic activities") == "4"
    assert quantity_label(4, None) == "4"
    # An unfamiliar unit isn't given a made-up noun.
    assert quantity_label(4, "ZZ", "04_590_0125_6_1") == "4"
