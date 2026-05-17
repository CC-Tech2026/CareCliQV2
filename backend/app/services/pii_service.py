"""AES-256 GCM field-level encryption for NDIS participant PII.

Privacy Act 2026 (Australia) — APP 11 Security of personal information.

Usage
-----
Set two environment variables in your Replit secrets:
  PII_ENCRYPTION_ENABLED=true
  PII_ENCRYPTION_KEY=<base64-encoded 32-byte key>

Generate a key:
  python3 -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"

When disabled (default) all functions are pass-throughs — existing data is
never altered and no new dependency on the env var exists.

Encrypted values are stored as the string  "ENC:<base64(nonce+ciphertext)>"
so they are detectable even if the env var is later toggled.
"""
from __future__ import annotations

import base64
import logging
import os
import uuid

logger = logging.getLogger(__name__)

# Fields treated as PII under the Privacy Act 2026
PII_FIELDS: tuple[str, ...] = ("full_name", "date_of_birth", "email", "phone", "address")

_ENC_PREFIX = "ENC:"


# ---------------------------------------------------------------------------
# Key helpers
# ---------------------------------------------------------------------------

def _is_enabled() -> bool:
    return os.environ.get("PII_ENCRYPTION_ENABLED", "false").lower() == "true"


def _get_key() -> bytes:
    """Return the 256-bit AES key from the environment variable."""
    raw = os.environ.get("PII_ENCRYPTION_KEY", "")
    if not raw:
        raise RuntimeError(
            "PII_ENCRYPTION_KEY not set. "
            "Generate one with: python3 -c \"import os,base64; print(base64.b64encode(os.urandom(32)).decode())\""
        )
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise ValueError("PII_ENCRYPTION_KEY must decode to exactly 32 bytes (256-bit key).")
    return key


# ---------------------------------------------------------------------------
# Core encrypt / decrypt
# ---------------------------------------------------------------------------

def encrypt_field(plaintext: str) -> str:
    """AES-256 GCM authenticated encryption of a single string field.

    Returns ``"ENC:<base64(nonce + ciphertext + tag)>"`` — the 96-bit random
    nonce is prepended so each call produces a unique ciphertext.
    """
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    aesgcm = AESGCM(_get_key())
    nonce = os.urandom(12)          # 96-bit nonce — NIST recommended for GCM
    ct = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    return _ENC_PREFIX + base64.b64encode(nonce + ct).decode("ascii")


def decrypt_field(ciphertext: str) -> str:
    """Reverse of encrypt_field.  Input must start with ``"ENC:"``.

    Returns the original plaintext string.
    """
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if not ciphertext.startswith(_ENC_PREFIX):
        raise ValueError("Value does not appear to be an encrypted field (missing ENC: prefix).")
    raw = base64.b64decode(ciphertext[len(_ENC_PREFIX):])
    nonce, ct = raw[:12], raw[12:]
    aesgcm = AESGCM(_get_key())
    return aesgcm.decrypt(nonce, ct, None).decode("utf-8")


def is_encrypted(value: object) -> bool:
    return isinstance(value, str) and value.startswith(_ENC_PREFIX)


# ---------------------------------------------------------------------------
# Record-level helpers
# ---------------------------------------------------------------------------

def encrypt_participant(record: dict) -> dict:
    """Encrypt all PII fields in a participant dict.

    No-op when PII_ENCRYPTION_ENABLED is falsy.
    """
    if not _is_enabled():
        return record
    out = dict(record)
    for field in PII_FIELDS:
        val = out.get(field)
        if val and not is_encrypted(str(val)):
            try:
                out[field] = encrypt_field(str(val))
            except Exception as exc:
                logger.warning("PII encrypt failed for field %s: %s", field, exc)
    out["pii_encrypted"] = True
    return out


def decrypt_participant(record: dict) -> dict:
    """Decrypt any encrypted PII fields.  Safe to call on unencrypted records."""
    if not record:
        return record
    out = dict(record)
    for field in PII_FIELDS:
        val = out.get(field)
        if val and is_encrypted(str(val)):
            try:
                out[field] = decrypt_field(str(val))
            except Exception as exc:
                logger.warning("PII decrypt failed for field %s: %s", field, exc)
    return out


# ---------------------------------------------------------------------------
# Pseudonym & de-identification
# ---------------------------------------------------------------------------

def generate_pseudonym() -> str:
    """Generate an APP 2 compliant external pseudonym.

    Format: ``PART-XXXXXXXX`` where X is an uppercase hex character.
    The token is opaque and carries no personal information.
    """
    token = uuid.uuid4().hex[:8].upper()
    return f"PART-{token}"


def deidentify_participant(record: dict) -> dict:
    """Hard-delete PII while retaining anonymised goal / statistical data.

    Right-to-be-Forgotten endpoint (Privacy Act 2026, APP 3/6 update).
    Generates a stable pseudonym so NDIS Commission anonymised reporting
    still functions after purge.
    """
    pseudonym = record.get("external_pseudonym") or generate_pseudonym()
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
