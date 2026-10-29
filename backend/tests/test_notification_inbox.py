"""The notifications inbox for every role, the shared team alert feed, and
notification emails that say why they were sent."""

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from backend.app.api import coordinator as coordinator_api
from backend.app.api import users as users_api
from backend.app.core.security import get_current_user
from backend.app.main import app
from backend.app.services import email_service
from backend.app.services import notification_service as ns
from backend.app.services import user_notification_store as store


class Query:
    """Records a supabase query chain; execute() returns `data`."""

    def __init__(self, data=None, log=None):
        self.data = data if data is not None else []
        self.calls = []
        self.log = log

    def __getattr__(self, name):
        def call(*args, **kwargs):
            self.calls.append((name, args))
            return self
        return call

    def execute(self):
        if self.log is not None:
            self.log.append(self.calls)
        return SimpleNamespace(data=self.data, count=None)


class FakeSupabase:
    def __init__(self, data=None):
        self.queries: list[list] = []
        self.data = data

    def table(self, name):
        q = Query(self.data, self.queries)
        q.calls.append(("table", (name,)))
        return q


COORDINATOR = {"id": "c1", "role": "support_coordinator", "organization_id": "o1"}


class InboxApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        app.dependency_overrides[get_current_user] = lambda: COORDINATOR

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_office_staff_can_read_their_own_inbox(self):
        # Coordinators get reassign requests and incident reports in
        # user_notifications; the inbox used to 403 anyone but workers.
        with patch.object(store, "list_user_notifications", return_value=[{"id": "n1"}]) as listed:
            response = self.client.get("/api/worker/notifications?days=90")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 1)
        self.assertEqual(listed.call_args.args[0], "c1")

    def test_mark_all_read_only_touches_this_persons_unread_rows(self):
        fake = FakeSupabase()
        with patch.object(store, "get_supabase_admin", return_value=fake):
            response = self.client.post("/api/worker/notifications/read-all")
        self.assertEqual(response.status_code, 200)
        calls = fake.queries[0]
        self.assertIn(("eq", ("user_id", "c1")), calls)
        self.assertIn(("is_", ("read_at", "null")), calls)

    def test_team_feed_leaves_out_alerts_addressed_to_one_person(self):
        # Every notify_worker call also writes an alerts row for its recipient;
        # the team feed was showing every worker's shift reminders.
        fake = FakeSupabase(data=[])
        with patch.object(coordinator_api, "get_supabase_admin", return_value=fake):
            self.client.get("/api/coordinator/notifications")
            self.client.post("/api/coordinator/notifications/read-all")
        for calls in fake.queries:
            self.assertIn(("is_", ("recipient_user_id", "null")), calls)


class WorkerReplyTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        app.dependency_overrides[get_current_user] = lambda: {"id": "w1", "role": "support_worker", "organization_id": "o1"}

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_reply_from_the_panel_uses_the_inbox_id(self):
        from backend.app.api import worker as worker_api

        fake = FakeSupabase()
        office_message = {"id": "n1", "event_type": "coordinator_message"}
        with patch.object(worker_api, "get_supabase_admin", return_value=fake), patch.object(
            store, "get_user_notification", return_value=office_message
        ) as lookup:
            response = self.client.post("/api/worker/messages/n1/reply", json={"message": "On my way"})
        self.assertEqual(response.status_code, 200, response.text)
        lookup.assert_called_once_with("n1", "w1")
        insert = next(args for calls in fake.queries for name, args in calls if name == "insert")
        self.assertEqual(insert[0]["alert_type"], "worker_reply")
        self.assertEqual(insert[0]["message"], "On my way")
        self.assertIsNone(insert[0]["related_message_id"])

    def test_cannot_reply_to_someone_elses_notification(self):
        from backend.app.api import worker as worker_api

        with patch.object(worker_api, "get_supabase_admin", return_value=FakeSupabase()), patch.object(
            store, "get_user_notification", return_value=None
        ):
            response = self.client.post("/api/worker/messages/n9/reply", json={"message": "hi"})
        self.assertEqual(response.status_code, 404)


class PreferenceSyncTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        app.dependency_overrides[get_current_user] = lambda: COORDINATOR

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_saving_applies_the_choice_to_every_device(self):
        # Delivery ORs rows across devices, so email left on in an old
        # browser would undo "email off" here.
        fake = FakeSupabase()
        with patch.object(users_api, "get_supabase_admin", return_value=fake):
            response = self.client.put(
                "/api/users/me/notification-preferences",
                json={"device_id": "device-123", "preferences": {"shift_reminder": {"push": True, "email": False}}},
            )
        self.assertEqual(response.status_code, 200)
        sync = [calls for calls in fake.queries if any(name == "neq" for name, _ in calls)]
        self.assertEqual(len(sync), 1)
        self.assertIn(("neq", ("device_id", "device-123")), sync[0])
        self.assertIn(("eq", ("user_id", "c1")), sync[0])
        update = next(args for name, args in sync[0] if name == "update")
        self.assertFalse(update[0]["preferences"]["shift_reminder"]["email"])


class NotificationEmailTests(unittest.TestCase):
    def test_settings_footer_and_urgent_line(self):
        with patch.object(email_service, "send_email") as send:
            email_service.send_worker_notification_email(
                to_email="a@example.com", subject="s", title="Emergency incident",
                message="Details", action_url="https://app/incidents/1",
                severity="critical", settings_url="https://app/notifications/settings",
            )
        kwargs = send.call_args.kwargs
        self.assertIn("Needs your attention", kwargs["html_body"])
        self.assertIn("https://app/notifications/settings", kwargs["html_body"])
        self.assertIn("Choose which emails you get: https://app/notifications/settings", kwargs["text_body"])

    def test_other_emails_using_the_template_are_unchanged(self):
        # Portal and privacy emails share the template but aren't driven by
        # notification settings, so they mustn't claim to be.
        with patch.object(email_service, "send_email") as send:
            email_service.send_worker_notification_email(
                to_email="a@example.com", subject="s", title="t", message="m", action_url="https://app/x",
            )
        kwargs = send.call_args.kwargs
        self.assertNotIn("notification settings", kwargs["html_body"])
        self.assertNotIn("Needs your attention", kwargs["html_body"])


@patch.object(ns.alert_service, "create_alert", new_callable=AsyncMock)
@patch.object(ns.notification_store, "create_user_notification", return_value={"id": "n1"})
@patch.object(ns, "_record_delivery")
@patch.object(ns, "_was_delivered", return_value=False)
@patch.object(ns, "_lookup_user_email", return_value="person@example.com")
@patch.object(ns, "get_effective_preferences", return_value=ns.default_notification_preferences())
@patch.object(ns, "send_push_to_user", new_callable=AsyncMock, return_value=False)
@patch.object(ns, "quiet_hours_active", return_value=False)
class NotifyWorkerLinkTests(unittest.IsolatedAsyncioTestCase):
    async def test_default_link_works_for_every_role_and_email_links_settings(self, *mocks):
        with patch.object(ns, "queue_worker_notification_email") as email:
            await ns.notify_worker(
                user_id="c1", org_id="o1", event="training_request",
                title="Training request", message="m", reference_key="k", severity="high",
            )
        store_call = mocks[6].call_args.kwargs
        self.assertTrue(store_call["action_url"].endswith("/notifications"))
        self.assertTrue(email.call_args.kwargs["settings_url"].endswith("/notifications/settings"))
        self.assertEqual(email.call_args.kwargs["severity"], "high")

    async def test_message_from_a_worker_on_shift_opens_the_shift(self, *_):
        with patch.object(ns, "_org_coordinator_user_ids", return_value=["c1"]), patch.object(
            ns, "_user_display_name", return_value="Sam Lee"
        ), patch.object(ns, "notify_worker", new_callable=AsyncMock) as notify:
            await ns.notify_office_worker_message(org_id="o1", shift_id="s1", worker_id="w1", message="Running late")
        kwargs = notify.call_args.kwargs
        self.assertEqual(kwargs["title"], "Message from Sam Lee on shift")
        self.assertTrue(kwargs["action_url"].endswith("/coordinator/rostering?openShift=s1"))
        self.assertEqual(kwargs["shift_id"], "s1")


if __name__ == "__main__":
    unittest.main()
