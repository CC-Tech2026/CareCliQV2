"""Browser push (Web Push + VAPID) so laptops, desktops and Android/iOS
browsers get an OS notification even when no CareCliQ tab is open.

Payloads are encrypted per RFC 8291 (aes128gcm) and requests are signed
per RFC 8292 (VAPID), using the cryptography + pyjwt packages we already
ship, so there's no extra dependency. A subscription is stored in
user_push_tokens with token_type='webpush' and the browser's
PushSubscription JSON in push_token.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import time
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
import jwt
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from ..core.config import settings
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

# Push services cap the encrypted body at 4096 bytes; keep the JSON well under.
_MAX_BODY_CHARS = 300
_RECORD_SIZE = 4096


def _b64url_decode(value: str) -> bytes:
    value = value.strip()
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _public_bytes(key: ec.EllipticCurvePublicKey) -> bytes:
    return key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def _private_key_from_b64(raw_b64: str) -> ec.EllipticCurvePrivateKey:
    return ec.derive_private_key(int.from_bytes(_b64url_decode(raw_b64), "big"), ec.SECP256R1())


def is_configured() -> bool:
    return bool(settings.web_push_vapid_public_key and settings.web_push_vapid_private_key)


def public_key() -> str:
    return settings.web_push_vapid_public_key


def encrypt_payload(
    plaintext: bytes,
    *,
    ua_public_b64: str,
    auth_secret_b64: str,
    sender_private: Optional[ec.EllipticCurvePrivateKey] = None,
    salt: Optional[bytes] = None,
) -> bytes:
    """RFC 8291 message encryption. sender_private/salt are only passed by tests."""
    ua_public_raw = _b64url_decode(ua_public_b64)
    auth_secret = _b64url_decode(auth_secret_b64)
    ua_public = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public_raw)

    as_private = sender_private or ec.generate_private_key(ec.SECP256R1())
    as_public_raw = _public_bytes(as_private.public_key())
    salt = salt or os.urandom(16)

    ecdh_secret = as_private.exchange(ec.ECDH(), ua_public)
    ikm = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=auth_secret,
        info=b"WebPush: info\x00" + ua_public_raw + as_public_raw,
    ).derive(ecdh_secret)
    cek = HKDF(
        algorithm=hashes.SHA256(), length=16, salt=salt, info=b"Content-Encoding: aes128gcm\x00"
    ).derive(ikm)
    nonce = HKDF(
        algorithm=hashes.SHA256(), length=12, salt=salt, info=b"Content-Encoding: nonce\x00"
    ).derive(ikm)

    # Single record: plaintext + 0x02 delimiter (last record), no padding.
    ciphertext = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)
    header = salt + _RECORD_SIZE.to_bytes(4, "big") + bytes([len(as_public_raw)]) + as_public_raw
    return header + ciphertext


def _vapid_authorization(endpoint: str) -> str:
    parsed = urlparse(endpoint)
    claims = {
        "aud": f"{parsed.scheme}://{parsed.netloc}",
        "exp": int(time.time()) + 12 * 3600,
        "sub": settings.web_push_subject,
    }
    token = jwt.encode(
        claims,
        _private_key_from_b64(settings.web_push_vapid_private_key),
        algorithm="ES256",
    )
    return f"vapid t={token}, k={settings.web_push_vapid_public_key}"


def device_id_for_endpoint(endpoint: str) -> str:
    return "web:" + hashlib.sha256(endpoint.encode("utf-8")).hexdigest()[:40]


def parse_subscription(raw: Any) -> Optional[dict[str, Any]]:
    """Accepts a PushSubscription JSON (dict or string); None if it's unusable."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return None
    if not isinstance(raw, dict):
        return None
    endpoint = str(raw.get("endpoint") or "").strip()
    keys = raw.get("keys") or {}
    p256dh = str(keys.get("p256dh") or "").strip()
    auth = str(keys.get("auth") or "").strip()
    if not endpoint.startswith("https://") or not p256dh or not auth:
        return None
    sub: dict[str, Any] = {"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}}
    label = str(raw.get("label") or "").strip()
    if label:
        sub["label"] = label[:80]
    return sub


def _lookup_subscriptions(user_id: str) -> list[dict[str, Any]]:
    try:
        result = (
            get_supabase_admin()
            .table("user_push_tokens")
            .select("device_id, push_token")
            .eq("user_id", user_id)
            .eq("token_type", "webpush")
            .execute()
        )
    except Exception as exc:
        logger.debug("Web push subscription lookup failed: %s", exc)
        return []
    subs = []
    for row in result.data or []:
        sub = parse_subscription(row.get("push_token"))
        if sub:
            subs.append({**sub, "device_id": row.get("device_id")})
    return subs


def _remove_subscription(user_id: str, device_id: str) -> None:
    try:
        (
            get_supabase_admin()
            .table("user_push_tokens")
            .delete()
            .eq("user_id", user_id)
            .eq("device_id", device_id)
            .execute()
        )
    except Exception:
        pass


def build_payload(
    *,
    title: str,
    body: str,
    data: Optional[dict[str, Any]] = None,
    urgent: bool = False,
) -> bytes:
    data = data or {}
    tag = data.get("notification_id") or data.get("tag") or data.get("reference_key")
    payload = {
        "title": title[:120],
        "body": body[:_MAX_BODY_CHARS],
        "url": data.get("action_url") or "/",
        "tag": str(tag) if tag else None,
        "urgent": urgent,
        "event": data.get("event") or data.get("type"),
    }
    return json.dumps({k: v for k, v in payload.items() if v is not None}).encode("utf-8")


async def send_web_push_to_user(
    user_id: str,
    *,
    title: str,
    body: str,
    data: Optional[dict[str, Any]] = None,
    urgent: bool = False,
) -> tuple[int, int]:
    """Push to every browser this user subscribed. Returns (devices, delivered)."""
    subs = _lookup_subscriptions(user_id)
    if not subs:
        return 0, 0
    if not is_configured():
        logger.info("Web push not configured — would push to %s browser(s) for user %s", len(subs), user_id)
        return len(subs), 0

    plaintext = build_payload(title=title, body=body, data=data, urgent=urgent)
    delivered = 0
    async with httpx.AsyncClient(timeout=10.0) as client:
        for sub in subs:
            try:
                encrypted = encrypt_payload(
                    plaintext,
                    ua_public_b64=sub["keys"]["p256dh"],
                    auth_secret_b64=sub["keys"]["auth"],
                )
                resp = await client.post(
                    sub["endpoint"],
                    content=encrypted,
                    headers={
                        "Authorization": _vapid_authorization(sub["endpoint"]),
                        "Content-Encoding": "aes128gcm",
                        "Content-Type": "application/octet-stream",
                        "TTL": "3600" if urgent else "86400",
                        "Urgency": "high" if urgent else "normal",
                    },
                )
            except Exception as exc:
                logger.warning("Web push request failed for user %s: %s", user_id, exc)
                continue
            if resp.status_code in (200, 201, 202):
                delivered += 1
            elif resp.status_code in (404, 410):
                # The browser unsubscribed or the subscription expired.
                _remove_subscription(user_id, str(sub["device_id"]))
            else:
                logger.warning("Web push rejected (%s) for user %s: %s", resp.status_code, user_id, resp.text[:200])
    return len(subs), delivered
