"""Tests for GPS/QR check-in validation (CARECLIQV2-197)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.app.services import check_in_service


def _scheduled_start(minutes_from_now: float = 0) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes_from_now)).isoformat()


def test_validate_clock_in_window_allows_within_bounds():
    start = _scheduled_start(10)
    check_in_service.validate_clock_in_window(start)


def test_validate_clock_in_window_rejects_too_early():
    start = _scheduled_start(30)
    with pytest.raises(ValueError, match="Too early"):
        check_in_service.validate_clock_in_window(start)


def test_validate_clock_in_window_rejects_too_late():
    start = _scheduled_start(-45)
    with pytest.raises(ValueError, match="window closed"):
        check_in_service.validate_clock_in_window(start)


def test_haversine_meters_same_point():
    assert check_in_service.haversine_meters(-33.86, 151.20, -33.86, 151.20) == 0


def test_verify_gps_location_within_radius():
    ok, distance = check_in_service.verify_gps_location(
        -33.8688,
        151.2093,
        -33.8689,
        151.2094,
    )
    assert ok is True
    assert distance < 20


def test_build_and_decode_qr_token():
    exp = int((datetime.now(timezone.utc) + timedelta(days=1)).timestamp())
    token = check_in_service.build_qr_token("code-1", "patient-1", "org-1", exp=exp)
    payload = check_in_service.decode_qr_token(token)
    assert payload["cid"] == "code-1"
    assert payload["pid"] == "patient-1"
    assert payload["oid"] == "org-1"


def test_decode_qr_token_rejects_tampered_signature():
    exp = int((datetime.now(timezone.utc) + timedelta(days=1)).timestamp())
    token = check_in_service.build_qr_token("code-1", "patient-1", "org-1", exp=exp)
    tampered = token[:-4] + "xxxx"
    with pytest.raises(ValueError, match="Invalid QR code"):
        check_in_service.decode_qr_token(tampered)
