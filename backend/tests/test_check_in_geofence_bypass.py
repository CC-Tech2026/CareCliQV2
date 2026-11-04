"""CHECK_IN_GEOFENCE_DISABLED only ever relaxes clock-in against a local database."""

from unittest.mock import patch

import pytest

from backend.app.services import check_in_service


@pytest.mark.parametrize(
    ("flag", "url", "bypassed"),
    [
        (True, "http://127.0.0.1:54321", True),
        (True, "http://localhost:54321", True),
        (True, "https://sndwllbtmguzduuazahd.supabase.co", False),
        (False, "http://127.0.0.1:54321", False),
    ],
)
def test_geofence_bypass_is_local_only(flag, url, bypassed):
    with patch.object(check_in_service.settings, "check_in_geofence_disabled", flag), patch.object(
        check_in_service.settings, "supabase_url", url
    ):
        assert check_in_service.check_in_geofence_bypassed() is bypassed
