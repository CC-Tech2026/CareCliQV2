import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from backend.app.services.notification_service import (
    default_notification_preferences,
    get_effective_preferences,
    notify_worker,
)


class NotificationPreferenceTests(unittest.TestCase):
    def test_default_preferences_enable_all_channels(self):
        prefs = default_notification_preferences()
        self.assertTrue(prefs["shift_reminder"]["email"])
        self.assertTrue(prefs["shift_reminder"]["push"])
        self.assertTrue(prefs["certification_expiry"]["sms"])

    @patch("backend.app.services.notification_service.get_supabase_admin")
    def test_effective_preferences_or_across_devices(self, admin_mock):
        table = MagicMock()
        admin_mock.return_value.table.return_value = table
        table.select.return_value.eq.return_value.execute.return_value = MagicMock(
            data=[
                {"preferences": {"shift_reminder": {"email": False, "push": True, "sms": False}}},
                {"preferences": {"shift_reminder": {"email": True, "push": False, "sms": False}}},
            ]
        )

        prefs = get_effective_preferences("user-1")
        self.assertTrue(prefs["shift_reminder"]["email"])
        self.assertTrue(prefs["shift_reminder"]["push"])
        self.assertFalse(prefs["shift_reminder"]["sms"])


class NotifyWorkerTests(unittest.IsolatedAsyncioTestCase):
    @patch("backend.app.services.notification_service.send_push_to_user", new_callable=AsyncMock, return_value=True)
    @patch("backend.app.services.notification_service.notification_store.create_user_notification", return_value={"id": "n1"})
    @patch("backend.app.services.notification_service._record_delivery")
    @patch("backend.app.services.notification_service._was_delivered", return_value=False)
    @patch("backend.app.services.notification_service.queue_worker_notification_email")
    @patch("backend.app.services.notification_service._lookup_user_email", return_value="worker@example.com")
    @patch("backend.app.services.notification_service.get_effective_preferences")
    @patch("backend.app.services.notification_service.alert_service.create_alert", new_callable=AsyncMock)
    async def test_notify_worker_sends_in_app_and_email(
        self,
        create_alert_mock,
        prefs_mock,
        email_lookup_mock,
        queue_email_mock,
        was_delivered_mock,
        record_delivery_mock,
        create_notif_mock,
        push_mock,
    ):
        prefs_mock.return_value = {
            "shift_reminder": {"push": True, "email": True, "sms": False},
        }

        result = await notify_worker(
            user_id="user-1",
            org_id="org-1",
            event="shift_reminder",
            title="Upcoming shift",
            message="Shift starts soon.",
            reference_key="shift:abc:reminder",
        )

        self.assertTrue(result["in_app"])
        self.assertTrue(result["email"])
        self.assertTrue(result["push"])
        create_alert_mock.assert_awaited_once()
        create_notif_mock.assert_called_once()
        queue_email_mock.assert_called_once()
        push_mock.assert_awaited_once()
        self.assertGreaterEqual(record_delivery_mock.call_count, 2)

    @patch("backend.app.services.notification_service.send_push_to_user", new_callable=AsyncMock, return_value=False)
    @patch("backend.app.services.notification_service.notification_store.create_user_notification", return_value={"id": "n1"})
    @patch("backend.app.services.notification_service._record_delivery")
    @patch("backend.app.services.notification_service._was_delivered", return_value=False)
    @patch("backend.app.services.notification_service.queue_worker_notification_email")
    @patch("backend.app.services.notification_service._lookup_user_email", return_value="worker@example.com")
    @patch("backend.app.services.notification_service.get_effective_preferences")
    @patch("backend.app.services.notification_service.alert_service.create_alert", new_callable=AsyncMock)
    async def test_notify_worker_respects_disabled_email(
        self,
        create_alert_mock,
        prefs_mock,
        email_lookup_mock,
        queue_email_mock,
        was_delivered_mock,
        record_delivery_mock,
        create_notif_mock,
        push_mock,
    ):
        prefs_mock.return_value = {
            "shift_reminder": {"push": True, "email": False, "sms": False},
        }

        result = await notify_worker(
            user_id="user-1",
            org_id="org-1",
            event="shift_reminder",
            title="Upcoming shift",
            message="Shift starts soon.",
            reference_key="shift:abc:reminder",
        )

        self.assertTrue(result["in_app"])
        self.assertFalse(result["email"])
        queue_email_mock.assert_not_called()
