"""Weekly-availability-slot signal used by /coordinator/available-workers."""
from __future__ import annotations

from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from backend.app.services import worker_matching_service as wms

TZ = ZoneInfo("Australia/Adelaide")


class TestSlotsTouched:
    def test_shift_spanning_morning_and_afternoon_touches_both(self):
        start = datetime(2026, 8, 24, 11, 0, tzinfo=TZ)
        end = datetime(2026, 8, 24, 15, 0, tzinfo=TZ)
        assert wms._slots_touched(start, end) == ["morning", "afternoon"]

    def test_shift_within_single_slot(self):
        start = datetime(2026, 8, 24, 9, 0, tzinfo=TZ)
        end = datetime(2026, 8, 24, 11, 0, tzinfo=TZ)
        assert wms._slots_touched(start, end) == ["morning"]

    def test_no_end_time_uses_start_hour_only(self):
        start = datetime(2026, 8, 24, 18, 0, tzinfo=TZ)
        assert wms._slots_touched(start, None) == ["evening"]

    def test_shift_spanning_all_three_slots(self):
        start = datetime(2026, 8, 24, 8, 0, tzinfo=TZ)
        end = datetime(2026, 8, 24, 20, 0, tzinfo=TZ)
        assert wms._slots_touched(start, end) == ["morning", "afternoon", "evening"]


class TestWorstStatus:
    def test_any_unavailable_segment_wins(self):
        assert wms._worst_status(["preferred", "unavailable"]) == "unavailable"

    def test_all_preferred_wins(self):
        assert wms._worst_status(["preferred", "preferred"]) == "preferred"

    def test_mixed_preferred_and_available_is_available(self):
        assert wms._worst_status(["preferred", "available"]) == "available"

    def test_empty_defaults_to_available(self):
        assert wms._worst_status([]) == "available"


class TestAvailabilityStatusForShift:
    # Naive ISO strings (no UTC offset) — parse_shift_datetime interprets these
    # directly as Australia/Adelaide local time, per its own docstring. Using
    # explicit +00:00 UTC strings here would shift the local hour by Adelaide's
    # +9:30/+10:30 offset and silently land in the wrong slot.

    def test_unavailable_slot_propagates(self):
        with patch.object(wms, "get_slot_status_for_shift", return_value="unavailable"):
            status = wms.availability_status_for_shift(
                "worker-1", "2026-08-24T09:00:00", "2026-08-24T13:00:00"
            )
        assert status == "unavailable"

    def test_preferred_slot_propagates(self):
        with patch.object(wms, "get_slot_status_for_shift", return_value="preferred"):
            status = wms.availability_status_for_shift(
                "worker-1", "2026-08-24T09:00:00", None
            )
        assert status == "preferred"

    def test_probes_once_per_slot_touched(self):
        """A shift spanning morning+afternoon must probe both, not just the start hour."""
        calls = []

        def fake_status(worker_id, probe_dt):
            calls.append(probe_dt.hour)
            return "available"

        with patch.object(wms, "get_slot_status_for_shift", side_effect=fake_status):
            wms.availability_status_for_shift(
                "worker-1", "2026-08-24T11:00:00", "2026-08-24T15:00:00"
            )
        # morning probe (9) and afternoon probe (14) — see _PROBE_HOUR_BY_SLOT
        assert sorted(calls) == [9, 14]
