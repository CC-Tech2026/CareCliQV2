"""Worker financial details — bank, super and tax details captured once during
onboarding. bank_account_number and tax_file_number are encrypted at rest via
pii_service.encrypt_field/decrypt_field (AES-256-GCM) when PII_ENCRYPTION_ENABLED
is set — this is that module's first real consumer.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from . import pii_service
from .supabase_client import get_supabase_admin

_ENCRYPTED_FIELDS = ("bank_account_number", "tax_file_number")


def _encrypt(payload: dict[str, Any]) -> dict[str, Any]:
    if not pii_service._is_enabled():
        return payload
    out = dict(payload)
    for field in _ENCRYPTED_FIELDS:
        value = out.get(field)
        if value:
            out[field] = pii_service.encrypt_field(value)
    return out


def _decrypt(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    for field in _ENCRYPTED_FIELDS:
        value = out.get(field)
        if value and pii_service.is_encrypted(value):
            out[field] = pii_service.decrypt_field(value)
    return out


def get_financial_details(worker_id: str) -> dict[str, Any] | None:
    result = (
        get_supabase_admin()
        .table("worker_financial_details")
        .select("*")
        .eq("worker_id", worker_id)
        .maybe_single()
        .execute()
    )
    if not result or not result.data:
        return None
    return _decrypt(result.data)


def upsert_financial_details(worker_id: str, organization_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    payload = _encrypt({k: v for k, v in fields.items() if v is not None})
    payload.update({
        "worker_id": worker_id,
        "organization_id": organization_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    result = (
        get_supabase_admin()
        .table("worker_financial_details")
        .upsert(payload, on_conflict="worker_id")
        .execute()
    )
    row = result.data[0] if result.data else payload
    return _decrypt(row)
