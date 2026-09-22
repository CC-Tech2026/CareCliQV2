"""
SCHADS pricing uses the zone of the branch the shift is worked in.

Day-type penalties (Saturday/Sunday/public holiday) turn over at local
midnight. A Melbourne shift must split at Melbourne midnight (14:00 UTC in
winter), not Adelaide's (14:30 UTC) — otherwise a Melbourne worker's
Saturday-into-Sunday shift is priced 30 minutes wrong.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest

from backend.app.core import timezone as app_tz
from backend.app.services import schads_engine

ADELAIDE = ZoneInfo("Australia/Adelaide")
MELBOURNE = ZoneInfo("Australia/Melbourne")


@pytest.fixture(autouse=True)
def _adelaide_default():
    app_tz.clear_timezone_caches()
    with patch.object(app_tz, "APP_TIMEZONE", ADELAIDE):
        yield


def _utc(y, m, d, hh, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=timezone.utc)


def test_day_splitter_uses_the_branch_midnight():
    # Sat 22 Aug 2026 22:00 → Sun 23 Aug 02:00 Melbourne  ==  12:00 → 16:00 UTC
    start, end = _utc(2026, 8, 22, 12), _utc(2026, 8, 22, 16)

    melb = schads_engine._segment_shift_by_local_day(start, end, MELBOURNE)
    adl = schads_engine._segment_shift_by_local_day(start, end, ADELAIDE)

    assert [s[1] for s in melb][0] == _utc(2026, 8, 22, 14)      # Melbourne midnight
    assert [s[1] for s in adl][0] == _utc(2026, 8, 22, 14, 30)   # Adelaide midnight
    assert len(melb) == len(adl) == 2


class _Q:
    def __init__(self, sb, name):
        self._sb, self._name = sb, name

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a):
        return self

    def maybe_single(self):
        return self

    def insert(self, rows):
        self._sb.inserted.extend(rows)
        return self

    def execute(self):
        data = self._sb.tables.get(self._name)
        return SimpleNamespace(data=data)


class _FakeSupabase:
    def __init__(self, tables):
        self.tables, self.inserted = tables, []

    def table(self, name):
        return _Q(self, name)


def test_shift_pay_prices_a_melbourne_shift_on_melbourne_days():
    """Saturday 22:00 → Sunday 02:00 in Melbourne: 2h Saturday + 2h Sunday.
    Priced in Adelaide time it would be 2.5h Saturday + 1.5h Sunday."""
    worker_id, org_id, shift_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    classification_id = str(uuid.uuid4())
    db = _FakeSupabase({
        "users": {"id": worker_id, "classification_id": classification_id, "employment_type": "permanent"},
        "award_classifications": {"id": classification_id, "base_rate": 30.0, "casual_rate": 37.5},
        "public_holidays": [],
    })
    shift = {
        "id": shift_id, "worker_id": worker_id, "organization_id": org_id,
        "participant_id": str(uuid.uuid4()),
        "scheduled_start": "2026-08-22T12:00:00+00:00",
        "scheduled_end": "2026-08-22T16:00:00+00:00",
    }

    with patch.object(schads_engine, "get_supabase_admin", return_value=db), \
         patch.object(schads_engine, "participant_timezone", return_value=MELBOURNE):
        result = schads_engine.calculate_shift_pay(shift, dry_run=True)

    by_type = {r["component_type"]: r for r in result["components"]}
    assert result["reason"] is None
    assert by_type["penalty_saturday"]["hours_applied"] == pytest.approx(2.0)
    assert by_type["penalty_sunday"]["hours_applied"] == pytest.approx(2.0)


def test_shift_pay_defaults_to_adelaide_for_a_head_office_shift():
    worker_id, org_id, shift_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    classification_id = str(uuid.uuid4())
    db = _FakeSupabase({
        "users": {"id": worker_id, "classification_id": classification_id, "employment_type": "permanent"},
        "award_classifications": {"id": classification_id, "base_rate": 30.0, "casual_rate": 37.5},
        "public_holidays": [],
    })
    shift = {
        "id": shift_id, "worker_id": worker_id, "organization_id": org_id,
        "scheduled_start": "2026-08-22T12:00:00+00:00",
        "scheduled_end": "2026-08-22T16:00:00+00:00",
    }

    with patch.object(schads_engine, "get_supabase_admin", return_value=db), \
         patch.object(schads_engine, "participant_timezone", return_value=ADELAIDE):
        result = schads_engine.calculate_shift_pay(shift, dry_run=True)

    by_type = {r["component_type"]: r for r in result["components"]}
    assert by_type["penalty_saturday"]["hours_applied"] == pytest.approx(2.5)
    assert by_type["penalty_sunday"]["hours_applied"] == pytest.approx(1.5)
