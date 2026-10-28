import re
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

from backend.app.services import notification_service as ns


class EventRegistryTests(unittest.TestCase):
    def test_every_event_the_code_sends_is_deliverable(self):
        # notify_worker raises on unlisted events, which silently dropped
        # medication dose reminders, screening rechecks and more.
        app_dir = Path(ns.__file__).resolve().parents[1]
        sent = set()
        for path in app_dir.rglob("*.py"):
            sent.update(re.findall(r'event="(\w+)"', path.read_text(encoding="utf-8")))
        self.assertEqual(sorted(sent - set(ns.NOTIFICATION_EVENTS)), [])

    def test_in_shift_prompts_default_to_no_email(self):
        prefs = ns.default_notification_preferences()
        self.assertFalse(prefs["medication_dose_reminder"]["email"])
        self.assertTrue(prefs["medication_dose_reminder"]["push"])
        self.assertTrue(prefs["applicant_stage_stuck"]["email"])
        # A saved row that predates the event still gets the default, not "on".
        self.assertFalse(ns._channel_enabled({}, "long_shift_checkin", "email"))


class QuietHoursTests(unittest.TestCase):
    def _at(self, hhmm: str) -> datetime:
        hour, minute = map(int, hhmm.split(":"))
        return datetime(2026, 10, 28, hour, minute, tzinfo=timezone.utc)

    def test_overnight_window_wraps_midnight(self):
        quiet = ns.clean_quiet_hours({"enabled": True, "from": "22:00", "to": "07:00", "timezone": "UTC"})
        self.assertTrue(ns.is_within_quiet_hours(quiet, self._at("23:30")))
        self.assertTrue(ns.is_within_quiet_hours(quiet, self._at("06:59")))
        self.assertFalse(ns.is_within_quiet_hours(quiet, self._at("07:00")))
        self.assertFalse(ns.is_within_quiet_hours(quiet, self._at("12:00")))

    def test_uses_the_saved_timezone(self):
        # 12:30 UTC is 23:00 in Adelaide (ACDT, +10:30) on this date.
        quiet = ns.clean_quiet_hours({"enabled": True, "from": "22:00", "to": "07:00", "timezone": "Australia/Adelaide"})
        self.assertTrue(ns.is_within_quiet_hours(quiet, self._at("12:30")))

    def test_bad_input_is_disabled_not_an_error(self):
        quiet = ns.clean_quiet_hours({"enabled": True, "from": "late", "to": "07:00"})
        self.assertFalse(quiet["enabled"])
        self.assertFalse(ns.is_within_quiet_hours(quiet))

    def test_emergencies_ignore_quiet_hours(self):
        with patch.object(ns, "quiet_hours_active", return_value=True):
            self.assertFalse(ns._held_for_quiet_hours("u1", "safety_alert", "medium"))
            self.assertFalse(ns._held_for_quiet_hours("u1", "coordinator_message", "critical"))
            self.assertTrue(ns._held_for_quiet_hours("u1", "coordinator_message", "high"))


@patch.object(ns.alert_service, "create_alert", new_callable=AsyncMock)
@patch.object(ns.notification_store, "create_user_notification", return_value={"id": "n1"})
@patch.object(ns, "_record_delivery")
@patch.object(ns, "_was_delivered", return_value=False)
@patch.object(ns, "queue_worker_notification_email")
@patch.object(ns, "_lookup_user_email", return_value="person@example.com")
@patch.object(ns, "get_effective_preferences", return_value=ns.default_notification_preferences())
class NotifyWorkerPushTests(unittest.IsolatedAsyncioTestCase):
    async def test_quiet_hours_hold_push_but_keep_inbox_and_email(self, *_):
        with patch.object(ns, "quiet_hours_active", return_value=True), patch.object(
            ns, "send_push_to_user", new_callable=AsyncMock, return_value=True
        ) as push:
            result = await ns.notify_worker(
                user_id="u1", org_id="o1", event="worker_cannot_attend",
                title="Shift needs reassigning", message="m", reference_key="k", severity="high",
            )
        push.assert_not_awaited()
        self.assertTrue(result["in_app"])
        self.assertTrue(result["email"])

    async def test_push_carries_the_inbox_id_for_browser_dedupe(self, *_):
        with patch.object(ns, "quiet_hours_active", return_value=False), patch.object(
            ns, "send_push_to_user", new_callable=AsyncMock, return_value=True
        ) as push:
            await ns.notify_worker(
                user_id="u1", org_id="o1", event="medication_dose_reminder",
                title="Upcoming dose", message="m", reference_key="k2",
            )
        self.assertEqual(push.await_args.kwargs["data"]["notification_id"], "n1")

    async def test_send_push_false_skips_device_push(self, *_):
        with patch.object(ns, "send_push_to_user", new_callable=AsyncMock) as push:
            result = await ns.notify_worker(
                user_id="u1", org_id=None, event="long_shift_checkin",
                title="Shift check-in", message="m", reference_key="k3", send_push=False,
            )
        push.assert_not_awaited()
        self.assertTrue(result["in_app"])


if __name__ == "__main__":
    unittest.main()
