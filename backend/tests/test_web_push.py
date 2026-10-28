import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import jwt
from cryptography.hazmat.primitives.asymmetric import ec

from backend.app.services import push_service, web_push_service as wp
from backend.scripts.generate_vapid_keys import generate_vapid_keys


class _FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = json.dumps(self._payload)

    def json(self):
        return self._payload


def _fake_client(responses):
    """httpx.AsyncClient stand-in returning `responses` in order, recording posts."""
    client = MagicMock()
    client.post = AsyncMock(side_effect=list(responses))
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=client)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx, client


class EncryptionTests(unittest.TestCase):
    def test_matches_rfc8291_appendix_a(self):
        # The worked example from RFC 8291: same keys + salt must give the same bytes.
        sender = wp._private_key_from_b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")
        out = wp.encrypt_payload(
            b"When I grow up, I want to be a watermelon",
            ua_public_b64="BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
            auth_secret_b64="BTBZMqHH6r4Tts7J_aSIgg",
            sender_private=sender,
            salt=wp._b64url_decode("DGv6ra1nlYgDCS1FRnbzlw"),
        )
        self.assertEqual(
            wp._b64url_encode(out),
            "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8w"
            "EqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
        )

    def test_vapid_header_is_signed_for_the_push_service_origin(self):
        public, private = generate_vapid_keys()
        with patch.object(wp.settings, "web_push_vapid_public_key", public), patch.object(
            wp.settings, "web_push_vapid_private_key", private
        ):
            header = wp._vapid_authorization("https://fcm.googleapis.com/fcm/send/abc123")
        token = header.split("t=")[1].split(",")[0]
        self.assertTrue(header.endswith(f"k={public}"))
        verify_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), wp._b64url_decode(public))
        claims = jwt.decode(token, verify_key, algorithms=["ES256"], audience="https://fcm.googleapis.com")
        self.assertEqual(claims["sub"], wp.settings.web_push_subject)


class SubscriptionParsingTests(unittest.TestCase):
    def test_rejects_non_https_and_missing_keys(self):
        self.assertIsNone(wp.parse_subscription({"endpoint": "http://x.test/a", "keys": {"p256dh": "a", "auth": "b"}}))
        self.assertIsNone(wp.parse_subscription({"endpoint": "https://x.test/a", "keys": {"p256dh": "a"}}))
        self.assertIsNone(wp.parse_subscription("not json"))

    def test_keeps_label_and_accepts_stored_json(self):
        raw = json.dumps({"endpoint": "https://x.test/a", "keys": {"p256dh": "a", "auth": "b"}, "label": "Chrome on Windows"})
        self.assertEqual(wp.parse_subscription(raw)["label"], "Chrome on Windows")

    def test_device_id_is_stable_per_endpoint(self):
        self.assertEqual(wp.device_id_for_endpoint("https://x.test/a"), wp.device_id_for_endpoint("https://x.test/a"))
        self.assertNotEqual(wp.device_id_for_endpoint("https://x.test/a"), wp.device_id_for_endpoint("https://x.test/b"))


class WebPushSendTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        ua_key = ec.generate_private_key(ec.SECP256R1())
        self.keys = {"p256dh": wp._b64url_encode(wp._public_bytes(ua_key.public_key())), "auth": "BTBZMqHH6r4Tts7J_aSIgg"}
        public, private = generate_vapid_keys()
        self.patches = [
            patch.object(wp.settings, "web_push_vapid_public_key", public),
            patch.object(wp.settings, "web_push_vapid_private_key", private),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    async def test_counts_deliveries_and_drops_expired_subscriptions(self):
        subs = [
            {"endpoint": "https://push.test/live", "keys": self.keys, "device_id": "web:live"},
            {"endpoint": "https://push.test/gone", "keys": self.keys, "device_id": "web:gone"},
        ]
        ctx, client = _fake_client([_FakeResponse(201), _FakeResponse(410)])
        with patch.object(wp, "_lookup_subscriptions", return_value=subs), patch.object(
            wp.httpx, "AsyncClient", return_value=ctx
        ), patch.object(wp, "_remove_subscription") as remove:
            devices, delivered = await wp.send_web_push_to_user("u1", title="Shift cancelled", body="Tap for details", urgent=True)

        self.assertEqual((devices, delivered), (2, 1))
        remove.assert_called_once_with("u1", "web:gone")
        headers = client.post.await_args_list[0].kwargs["headers"]
        self.assertEqual(headers["Content-Encoding"], "aes128gcm")
        self.assertEqual(headers["Urgency"], "high")

    async def test_not_configured_reports_devices_without_sending(self):
        subs = [{"endpoint": "https://push.test/live", "keys": self.keys, "device_id": "web:live"}]
        with patch.object(wp.settings, "web_push_vapid_private_key", ""), patch.object(
            wp, "_lookup_subscriptions", return_value=subs
        ), patch.object(wp.httpx, "AsyncClient") as client_cls:
            self.assertEqual(await wp.send_web_push_to_user("u1", title="t", body="b"), (1, 0))
        client_cls.assert_not_called()

    def test_payload_tags_with_notification_id_and_fits_push_limit(self):
        payload = json.loads(
            wp.build_payload(title="T", body="x" * 5000, data={"notification_id": "n1", "action_url": "/my-shifts/s1"})
        )
        self.assertEqual(payload["tag"], "n1")
        self.assertEqual(payload["url"], "/my-shifts/s1")
        self.assertLessEqual(len(payload["body"]), 300)


class ExpoTicketTests(unittest.IsolatedAsyncioTestCase):
    async def test_ticket_errors_are_not_counted_and_dead_tokens_pruned(self):
        tickets = {"data": [{"status": "ok", "id": "1"}, {"status": "error", "details": {"error": "DeviceNotRegistered"}}]}
        ctx, _ = _fake_client([_FakeResponse(200, tickets)])
        with patch.object(push_service, "_lookup_tokens", return_value=["tokA", "tokB"]), patch.object(
            push_service.settings, "expo_push_enabled", True
        ), patch.object(push_service.httpx, "AsyncClient", return_value=ctx), patch.object(
            push_service, "_remove_token_value"
        ) as remove:
            result = await push_service._send_expo("u1", title="t", body="b", data=None, priority="default")

        self.assertEqual(result, (2, 1))
        remove.assert_called_once_with("u1", "tokB")

    async def test_send_push_reaches_browser_when_app_push_is_off(self):
        with patch.object(push_service, "_send_expo", new=AsyncMock(return_value=(0, 0))), patch.object(
            push_service.web_push_service, "send_web_push_to_user", new=AsyncMock(return_value=(1, 1))
        ) as web:
            self.assertTrue(await push_service.send_push_to_user("u1", title="t", body="b", priority="high"))
        self.assertTrue(web.await_args.kwargs["urgent"])


if __name__ == "__main__":
    unittest.main()
