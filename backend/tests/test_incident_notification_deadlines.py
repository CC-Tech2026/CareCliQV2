"""NDIS Commission notification deadlines — by incident category, not severity.

Previously the deadline came from severity (critical 24h, high 120h, ...), so a
"high" abuse report got 5 days, the clock always ran from incident_date, and
_enrich dropped the reportable flag for incidents that were reportable only
through a Section 5 category.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from backend.app.schemas import incident as schema
from backend.app.services import incident_notification_service
from backend.app.services.incident_service import _enrich

ADELAIDE = ZoneInfo("Australia/Adelaide")
OCCURRED = "2026-10-02T00:30:00+00:00"  # Friday 10:00 ACST


def _dt(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _incident(**overrides) -> dict:
    return {
        "id": "inc-1",
        "incident_type": "other",
        "severity": "medium",
        "status": "reported",
        "incident_date": OCCURRED,
        "reportable_categories": [],
        "ndis_reportable": False,
        **overrides,
    }


class TestTimeframeByCategory:
    def test_high_severity_abuse_is_24_hours_not_5_days(self):
        inc = _incident(incident_type="abuse_neglect", severity="high", ndis_reportable=True)
        assert schema.ndis_notification_due_at(inc) == _dt(OCCURRED) + timedelta(hours=24)

    @pytest.mark.parametrize("category", sorted(schema.NDIS_24_HOUR_CATEGORIES))
    def test_24_hour_categories_on_a_medium_incident(self, category):
        inc = _incident(incident_type="injury", reportable_categories=[category])
        assert schema.is_ndis_reportable("injury", "medium", [category]) is True
        assert schema.ndis_notification_timeframe(inc) == schema.NDIS_TIMEFRAME_24_HOURS
        assert schema.ndis_notification_due_at(inc) == _dt(OCCURRED) + timedelta(hours=24)

    def test_unauthorised_restrictive_practice_without_harm_is_5_business_days(self):
        inc = _incident(reportable_categories=["unauthorised_restrictive_practice"], participant_harmed=False)
        due = schema.ndis_notification_due_at(inc, tz=ADELAIDE)
        # Friday 10:00 -> skips the weekend -> the following Friday 10:00 local
        # (ACDT from 4 Oct, so the UTC offset shifts by an hour).
        assert due.astimezone(ADELAIDE).replace(tzinfo=None) == datetime(2026, 10, 9, 10, 0)
        assert due == _dt("2026-10-08T23:30:00+00:00")

    def test_restrictive_practice_with_harm_is_24_hours(self):
        inc = _incident(reportable_categories=["unauthorised_restrictive_practice"], participant_harmed=True)
        assert schema.ndis_notification_timeframe(inc) == schema.NDIS_TIMEFRAME_24_HOURS

    def test_restrictive_practice_plus_24_hour_category_is_24_hours(self):
        inc = _incident(reportable_categories=["unauthorised_restrictive_practice", "serious_injury"])
        assert schema.ndis_notification_timeframe(inc) == schema.NDIS_TIMEFRAME_24_HOURS

    def test_critical_without_category_defaults_to_24_hours(self):
        inc = _incident(severity="critical", ndis_reportable=True)
        assert schema.ndis_notification_timeframe(inc) == schema.NDIS_TIMEFRAME_24_HOURS


class TestClockStart:
    def test_clock_runs_from_identified_at_when_recorded(self):
        identified = "2026-10-05T03:00:00+00:00"
        inc = _incident(incident_type="abuse_neglect", identified_at=identified)
        assert schema.ndis_notification_due_at(inc) == _dt(identified) + timedelta(hours=24)

    def test_naive_timestamps_are_treated_as_utc(self):
        inc = _incident(incident_type="abuse_neglect", incident_date="2026-10-02T00:30:00")
        assert schema.ndis_notification_due_at(inc) == _dt(OCCURRED) + timedelta(hours=24)


class TestOverride:
    def test_override_not_reportable_removes_commission_deadline(self):
        inc = _incident(incident_type="abuse_neglect", ndis_reportable=True, ndis_reportable_override=False)
        assert schema.ndis_notification_due_at(inc) is None
        # Falls back to the internal severity target.
        assert schema.incident_follow_up_due_at(inc) == _dt(OCCURRED) + timedelta(hours=240)

    def test_override_reportable_on_unclassified_incident_is_24_hours(self):
        inc = _incident(ndis_reportable_override=True)
        assert schema.ndis_notification_due_at(inc) == _dt(OCCURRED) + timedelta(hours=24)


class TestNonReportable:
    def test_internal_target_unchanged(self):
        inc = _incident(severity="low")
        assert schema.ndis_notification_due_at(inc) is None
        assert schema.incident_follow_up_due_at(inc) == _dt(OCCURRED) + timedelta(hours=480)


class TestEnrich:
    def test_category_only_incident_stays_reportable_and_pending(self):
        enriched = _enrich(_incident(incident_type="injury", reportable_categories=["serious_injury"]))
        assert enriched["ndis_reportable"] is True
        assert enriched["ndis_pending"] is True
        assert enriched["ndis_notification_timeframe"] == schema.NDIS_TIMEFRAME_24_HOURS
        assert _dt(enriched["notification_due_at"]) == _dt(OCCURRED) + timedelta(hours=24)
        assert enriched["overdue"] is (datetime.now(timezone.utc) > _dt(OCCURRED) + timedelta(hours=24))

    def test_overridden_incident_is_not_pending(self):
        enriched = _enrich(_incident(incident_type="abuse_neglect", ndis_reportable=True, ndis_reportable_override=False))
        assert enriched["ndis_pending"] is False
        assert enriched["ndis_notification_timeframe"] is None

    def test_escalation_job_uses_the_same_deadline(self):
        inc = _incident(incident_type="abuse_neglect", severity="high", ndis_reportable=True)
        assert incident_notification_service.compute_notification_due_at(inc) == _dt(_enrich(inc)["notification_due_at"])
