"""Replying to messages from their notifications, and notifications that
carry enough to link to the exact record."""

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from backend.app.core.security import get_current_user
from backend.app.main import app
from backend.app.services import notification_reply_service as replies
from backend.app.services import notification_service as ns


def _patches(notification, *, conversation=None, shift=None, coordinators=("c1", "c2")):
    """Everything the reply service touches outside itself."""
    return [
        patch.object(replies.store, "get_user_notification", return_value=notification),
        patch.object(replies, "_conversation", return_value=conversation),
        patch.object(replies, "_shift_in_org", return_value=shift),
        patch.object(replies, "_user_display_name", return_value="Sam Lee"),
        patch.object(replies, "_org_coordinator_user_ids", return_value=list(coordinators)),
        patch.object(replies.conversation_service, "send_conversation_message", return_value={"id": "m1"}),
        patch.object(replies.conversation_service, "get_or_create_shift_conversation", return_value={"id": "conv-new", "worker_id": "w1", "shift_id": "s1", "status": "active"}),
        patch.object(replies, "notify_conversation_message", new_callable=AsyncMock),
        patch.object(replies, "notify_coordinator_message", new_callable=AsyncMock),
        patch.object(replies, "notify_worker", new_callable=AsyncMock),
    ]


class ReplyTests(unittest.IsolatedAsyncioTestCase):
    async def _reply(self, notification, role, **kwargs):
        started = [p.start() for p in _patches(notification, **kwargs)]
        try:
            result = await replies.reply_to_notification(
                user_id="w1" if role == "support_worker" else "c1",
                role=role, org_id="o1", notification_id=notification["id"] if notification else "x", text="On my way",
            )
        finally:
            patch.stopall()
        names = ["get", "conv", "shift", "name", "coords", "send", "create", "notify_conv", "notify_direct", "notify"]
        return result, dict(zip(names, started))

    async def test_worker_reply_to_a_shift_conversation_goes_into_it(self):
        conversation = {"id": "conv1", "worker_id": "w1", "coordinator_id": "c7", "shift_id": "s1", "status": "active"}
        result, m = await self._reply(
            {"id": "n1", "event_type": "coordinator_message", "conversation_id": "conv1", "shift_id": "s1", "payload": {}},
            "support_worker", conversation=conversation,
        )
        self.assertEqual(result, {"sent_to": "conversation"})
        self.assertEqual(m["send"].call_args.kwargs["conversation_id"], "conv1")
        kwargs = m["notify_conv"].call_args.kwargs
        self.assertEqual(kwargs["recipient_id"], "c7")
        # The coordinator's copy says who it's from and lets them answer back.
        self.assertEqual(kwargs["worker_id"], "w1")
        self.assertTrue(kwargs["recipient_is_office"])
        self.assertEqual(kwargs["sender_name"], "Sam Lee")

    async def test_office_reply_to_an_on_shift_message_reaches_the_worker(self):
        result, m = await self._reply(
            {"id": "n2", "event_type": "coordinator_message", "shift_id": "s1", "payload": {"worker_id": "w1"}},
            "support_coordinator", shift={"id": "s1", "organization_id": "o1", "participant_id": "p1"},
        )
        self.assertEqual(result, {"sent_to": "conversation"})
        self.assertEqual(m["create"].call_args.kwargs["worker_id"], "w1")
        self.assertEqual(m["create"].call_args.kwargs["coordinator_id"], "c1")
        self.assertEqual(m["notify_conv"].call_args.kwargs["recipient_id"], "w1")

    async def test_worker_reply_to_a_direct_message_goes_back_to_the_sender(self):
        result, m = await self._reply(
            {"id": "n3", "event_type": "coordinator_message", "payload": {"sender_id": "c5"}},
            "support_worker",
        )
        self.assertEqual(result, {"sent_to": "coordinator"})
        kwargs = m["notify"].call_args.kwargs
        self.assertEqual(kwargs["user_id"], "c5")
        self.assertEqual(kwargs["title"], "Reply from Sam Lee")
        self.assertEqual(kwargs["payload"]["worker_id"], "w1")

    async def test_office_answers_a_reply_with_a_direct_message(self):
        result, m = await self._reply(
            {"id": "n4", "event_type": "coordinator_message", "payload": {"worker_id": "w1"}},
            "managing_director",
        )
        self.assertEqual(result, {"sent_to": "worker"})
        self.assertEqual(m["notify_direct"].call_args.kwargs["user_id"], "w1")
        self.assertEqual(m["notify_direct"].call_args.kwargs["sender_id"], "c1")

    async def test_reply_with_no_known_sender_reaches_every_office_user(self):
        result, m = await self._reply(
            {"id": "n5", "event_type": "coordinator_message", "payload": {}}, "support_worker",
        )
        self.assertEqual(result, {"sent_to": "office"})
        self.assertEqual(sorted(c.kwargs["user_id"] for c in m["notify"].call_args_list), ["c1", "c2"])

    async def test_refuses_what_it_cannot_answer(self):
        with self.assertRaises(replies.ReplyNotPossible):
            await self._reply({"id": "n6", "event_type": "shift_reminder", "shift_id": "s1", "payload": {}}, "support_worker")
        with self.assertRaises(replies.ReplyNotPossible):
            await self._reply({"id": "n7", "event_type": "coordinator_message", "payload": {"worker_id": "w1"}}, "participant")
        with self.assertRaises(LookupError):
            await self._reply(None, "support_worker")


class ReplyApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        app.dependency_overrides[get_current_user] = lambda: {"id": "c1", "role": "support_coordinator", "organization_id": "o1"}

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_reply_endpoint_for_office_staff(self):
        with patch.object(replies, "reply_to_notification", new_callable=AsyncMock, return_value={"sent_to": "worker"}) as reply:
            response = self.client.post("/api/worker/notifications/n1/reply", json={"message": "Thanks"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(reply.call_args.kwargs["role"], "support_coordinator")

    def test_unanswerable_is_a_clear_error(self):
        with patch.object(replies, "reply_to_notification", new_callable=AsyncMock, side_effect=replies.ReplyNotPossible("There's no one to reply to on this notification.")):
            response = self.client.post("/api/worker/notifications/n1/reply", json={"message": "Thanks"})
        self.assertEqual(response.status_code, 422)
        self.assertIn("no one to reply to", response.json()["detail"])


@patch.object(ns, "notify_worker", new_callable=AsyncMock)
class MessageContentTests(unittest.IsolatedAsyncioTestCase):
    async def test_conversation_message_keeps_the_whole_text_and_names_the_sender(self, notify):
        text = "Jack's plan says no stairs but the venue only has stairs. " * 2
        await ns.notify_conversation_message(
            recipient_id="c1", org_id="o1", conversation_id="conv1", shift_id="s1",
            message_preview=text, sender_name="Tom Reid", worker_id="w1", recipient_is_office=True,
        )
        kwargs = notify.call_args.kwargs
        self.assertEqual(kwargs["message"], text)
        self.assertEqual(kwargs["title"], "Message from Tom Reid")
        self.assertTrue(kwargs["action_url"].endswith("/coordinator/rostering?openShift=s1"))
        self.assertEqual(kwargs["payload"], {"worker_id": "w1"})

    async def test_office_staff_notifications_no_longer_default_to_incidents(self, notify):
        with patch.object(ns, "_org_coordinator_user_ids", return_value=["c1"]):
            await ns._notify_office_staff(
                org_id="o1", title="Training request", message="m", reference_key="k",
                event="training_request", payload={"worker_id": "w1"},
            )
        kwargs = notify.call_args.kwargs
        self.assertIsNone(kwargs["action_url"])
        self.assertEqual(kwargs["payload"], {"worker_id": "w1"})

    async def test_on_shift_message_records_who_sent_it(self, notify):
        with patch.object(ns, "_org_coordinator_user_ids", return_value=["c1"]), patch.object(ns, "_user_display_name", return_value="Tom Reid"):
            await ns.notify_office_worker_message(org_id="o1", shift_id="s1", worker_id="w1", message="Can you call?")
        self.assertEqual(notify.call_args.kwargs["payload"], {"worker_id": "w1"})


@patch.object(ns.alert_service, "create_alert", new_callable=AsyncMock)
@patch.object(ns.notification_store, "create_user_notification", return_value={"id": "n1"})
@patch.object(ns, "_record_delivery")
@patch.object(ns, "_was_delivered", return_value=False)
@patch.object(ns, "_lookup_user_email", return_value=None)
@patch.object(ns, "get_effective_preferences", return_value=ns.default_notification_preferences())
@patch.object(ns, "send_push_to_user", new_callable=AsyncMock, return_value=False)
@patch.object(ns, "quiet_hours_active", return_value=False)
class StoredDetailTests(unittest.IsolatedAsyncioTestCase):
    async def test_participant_and_alert_type_are_kept_for_linking(self, *mocks):
        await ns.notify_worker(
            user_id="c1", org_id="o1", event="medication_alert", title="PRN limit reached", message="m",
            reference_key="k", participant_id="p1", alert_type="medication_prn_max_exceeded", shift_id="s1",
        )
        payload = mocks[6].call_args.kwargs["payload"]
        self.assertEqual(payload["participant_id"], "p1")
        self.assertEqual(payload["alert_type"], "medication_prn_max_exceeded")


if __name__ == "__main__":
    unittest.main()
