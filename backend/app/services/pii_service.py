"""AES-256 GCM field-level encryption for NDIS participant PII.

Privacy Act 2026 (Australia) — APP 11 Security of personal information.
"""

from __future__ import annotations

import base64
import logging
import os
import uuid
from typing import Any

logger = logging.getLogger(__name__)

# Fields treated as PII
PII_FIELDS: tuple[str, ...] = (
    "full_name",
    "date_of_birth",
    "email",
    "phone",
    "address",
)

_ENC_PREFIX = "ENC:"


# ---------------------------------------------------------------------------
# Feature flag
# ---------------------------------------------------------------------------

def _is_enabled() -> bool:
    return os.environ.get("PII_ENCRYPTION_ENABLED", "false").lower() == "true"


# ---------------------------------------------------------------------------
# Key helpers
# ---------------------------------------------------------------------------

def _get_key() -> bytes:
    """Return 32-byte AES-256 key from env."""
    raw = os.environ.get("PII_ENCRYPTION_KEY", "").strip()

    if not raw:
        raise RuntimeError(
            "PII_ENCRYPTION_KEY not set.\n"
            "Generate one with:\n"
            'python3 -c "import os,base64; '
            'print(base64.b64encode(os.urandom(32)).decode())"'
        )

    try:
        key = base64.b64decode(raw)
    except Exception as exc:
        raise ValueError("PII_ENCRYPTION_KEY is not valid base64") from exc

    if len(key) != 32:
        raise ValueError(
            "PII_ENCRYPTION_KEY must decode to exactly 32 bytes"
        )

    return key


# ---------------------------------------------------------------------------
# Encryption helpers
# ---------------------------------------------------------------------------

def is_encrypted(value: object) -> bool:
    return isinstance(value, str) and value.startswith(_ENC_PREFIX)


def encrypt_field(plaintext: str) -> str:
    """Encrypt a single field using AES-256-GCM."""

    if not plaintext:
        return plaintext

    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    aesgcm = AESGCM(_get_key())

    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(
        nonce,
        plaintext.encode("utf-8"),
        None,
    )

    payload = nonce + ciphertext

    return _ENC_PREFIX + base64.b64encode(payload).decode("ascii")


def decrypt_field(ciphertext: str) -> str:
    """Decrypt AES-256-GCM field."""

    if not is_encrypted(ciphertext):
        return ciphertext

    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    raw = base64.b64decode(ciphertext[len(_ENC_PREFIX):])

    nonce = raw[:12]
    encrypted = raw[12:]

    aesgcm = AESGCM(_get_key())

    plaintext = aesgcm.decrypt(
        nonce,
        encrypted,
        None,
    )

    return plaintext.decode("utf-8")


# ---------------------------------------------------------------------------
# Participant helpers
# ---------------------------------------------------------------------------

def encrypt_participant(record: dict[str, Any]) -> dict[str, Any]:
    """Encrypt participant PII fields."""

    if not _is_enabled():
        return record

    out: dict[str, Any] = dict(record)

    for field in PII_FIELDS:
        value = out.get(field)

        if value is None:
            continue

        try:
            value_str = str(value)

            if value_str and not is_encrypted(value_str):
                out[field] = encrypt_field(value_str)

        except Exception as exc:
            logger.warning(
                "Failed to encrypt field '%s': %s",
                field,
                exc,
            )

    out["pii_encrypted"] = True

    return out


def decrypt_participant(record: dict[str, Any] | None) -> dict[str, Any] | None:
    """Decrypt participant PII fields safely."""

    if not record:
        return record

    out: dict[str, Any] = dict(record)

    for field in PII_FIELDS:
        value = out.get(field)

        if value is None:
            continue

        try:
            value_str = str(value)

            if is_encrypted(value_str):
                out[field] = decrypt_field(value_str)

        except Exception as exc:
            logger.warning(
                "Failed to decrypt field '%s': %s",
                field,
                exc,
            )

    return out


# ---------------------------------------------------------------------------
# Pseudonym helpers
# ---------------------------------------------------------------------------

def generate_pseudonym() -> str:
    """Generate opaque participant pseudonym."""

    token = uuid.uuid4().hex[:8].upper()

    return f"PART-{token}"


def deidentify_participant(record: dict[str, Any]) -> dict[str, Any]:
    """Remove all personally identifiable information."""

    pseudonym = (
        record.get("external_pseudonym")
        or generate_pseudonym()
    )

    return {
        "full_name": f"[REDACTED-{pseudonym}]",
        "date_of_birth": None,
        "email": None,
        "phone": None,
        "address": None,
        "ndis_number": f"PURGED-{pseudonym}",
        "is_purged": True,
        "pii_encrypted": False,
        "external_pseudonym": pseudonym,
    }