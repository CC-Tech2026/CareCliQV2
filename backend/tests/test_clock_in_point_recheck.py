from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from backend.app.services import shift_service

SVC = "backend.app.services.shift_service"
# Participant's real home, and an old point about 1.4 km away.
HOME = (-34.9235, 138.6040)
OLD_POINT = (-34.9110, 138.6000)


def _shift(**overrides) -> dict:
    return {
        "id": "s-1",
        "participant_id": "p-1",
        "participant_address": "27 Rundle Mall, Adelaide SA 5000",
        "participant_latitude": OLD_POINT[0],
        "participant_longitude": OLD_POINT[1],
        **overrides,
    }


def _check_in(shift: dict, worker_at: tuple[float, float], geocoded):
    supabase = MagicMock()
    with patch(f"{SVC}.get_supabase_admin", return_value=supabase), \
         patch(f"{SVC}.check_in_geofence_bypassed", return_value=False), \
         patch("backend.app.services.geocoding_service.geocode_address_sync", return_value=geocoded) as geocode:
        result = shift_service._apply_verified_check_in(
            shift, "org-1", method="gps", location={"lat": worker_at[0], "lng": worker_at[1], "accuracy": 15},
        )
    return result, supabase, geocode


def test_a_worker_at_the_right_door_is_let_in_and_the_stored_point_fixed():
    result, supabase, _ = _check_in(_shift(), worker_at=HOME, geocoded=HOME)
    assert result["clock_in_verified"] is True
    assert result["_verification_distance_meters"] < 100
    updates = [c.args[0] for c in supabase.table.return_value.update.call_args_list]
    assert {"latitude": HOME[0], "longitude": HOME[1]} in updates
    assert {"participant_latitude": HOME[0], "participant_longitude": HOME[1]} in updates


def test_a_worker_genuinely_far_away_is_still_refused():
    elsewhere = (-34.8000, 138.5000)
    with pytest.raises(ValueError, match="too far"):
        _check_in(_shift(), worker_at=elsewhere, geocoded=HOME)


def test_no_address_lookup_leaves_the_refusal_as_it_was():
    with pytest.raises(ValueError, match="too far"):
        _check_in(_shift(), worker_at=HOME, geocoded=None)


def test_a_worker_inside_the_geofence_never_triggers_a_lookup():
    _, _, geocode = _check_in(_shift(participant_latitude=HOME[0], participant_longitude=HOME[1]), worker_at=HOME, geocoded=HOME)
    geocode.assert_not_called()
