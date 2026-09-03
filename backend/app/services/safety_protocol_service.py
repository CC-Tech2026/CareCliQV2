from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from ..schemas.safety_protocol import SafetyProtocolUpdate
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

PROTOCOLS_TABLE = "participant_safety_protocols"
ACK_TABLE = "worker_safety_acknowledgements"
ORG_CONTENT_TABLE = "organization_acknowledgement_content"

_DEFAULT_ORG_ACKNOWLEDGEMENT_BODY = """Before starting this shift, you confirm:

- You will provide supports strictly within this participant's plan and your own training and scope of practice.
- You will treat the participant with respect and dignity, including their right to make their own choices and take on reasonable risk (dignity of risk) - you will not make decisions for them.
- You will keep all personal and health information about the participant confidential, and only discuss it in a professional context.
- You will act honestly and with integrity in all records and communications about this shift.
- You will not have unsupervised or one-on-one contact with the participant outside your rostered, approved duties without your coordinator's prior authorisation.
- You will report any incident, hazard, safeguarding concern, or suspected abuse, neglect, exploitation, or violence immediately through the organisation's reporting channels - never ignore or delay a concern.
- You understand this acknowledgement is in addition to, and does not replace, the NDIS Code of Conduct you separately confirmed during onboarding.

This is a starting draft - your organisation should review and adjust this wording before relying on it as a compliance record."""


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return (
        "does not exist" in err
        or "42703" in err
        or "pgrst" in err
        or "could not find" in err
    )


def _empty_protocol(participant_id: str, organization_id: str) -> dict[str, Any]:
    return {
        "participant_id": participant_id,
        "organization_id": organization_id,
        "safety_card_body": "",
        "scenarios": [],
        "deescalation_techniques": [],
        "physical_safety_notes": [],
        "escalation_contacts": [],
        "content_version": 1,
        "updated_at": None,
        "updated_by": None,
    }


def _has_safety_content(protocol: dict[str, Any]) -> bool:
    if (protocol.get("safety_card_body") or "").strip():
        return True
    for key in ("scenarios", "deescalation_techniques", "physical_safety_notes", "escalation_contacts"):
        if protocol.get(key):
            return True
    return False


def get_protocol(participant_id: str, organization_id: str) -> dict[str, Any]:
    try:
        resp = (
            get_supabase_admin()
            .table(PROTOCOLS_TABLE)
            .select("*")
            .eq("participant_id", participant_id)
            .eq("organization_id", organization_id)
            .maybe_single()
            .execute()
        )
        row = resp.data if resp else None
        if not isinstance(row, dict):
            row = None
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return _empty_protocol(participant_id, organization_id)
        raise
    if not row:
        return _empty_protocol(participant_id, organization_id)
    return row


def _empty_org_content(organization_id: str) -> dict[str, Any]:
    return {
        "organization_id": organization_id,
        "body": _DEFAULT_ORG_ACKNOWLEDGEMENT_BODY,
        "content_version": 1,
        "updated_at": None,
        "updated_by": None,
    }


def get_org_acknowledgement_content(organization_id: str) -> dict[str, Any]:
    """Standing per-shift acknowledgement content, org-wide. Same lazy-default
    pattern as get_protocol(): returns the starting draft in-memory until an
    org's row is first read-created or someone edits it - never blocks on a
    missing row."""
    try:
        resp = (
            get_supabase_admin()
            .table(ORG_CONTENT_TABLE)
            .select("*")
            .eq("organization_id", organization_id)
            .maybe_single()
            .execute()
        )
        row = resp.data if resp else None
        if not isinstance(row, dict):
            row = None
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return _empty_org_content(organization_id)
        raise
    if not row:
        return _empty_org_content(organization_id)
    return row


def upsert_org_acknowledgement_content(
    organization_id: str, body: str, updated_by: Optional[str],
) -> dict[str, Any]:
    existing = get_org_acknowledgement_content(organization_id)
    content_changed = body != (existing.get("body") or "")
    current_version = int(existing.get("content_version") or 1)
    payload = {
        "organization_id": organization_id,
        "body": body,
        "content_version": (current_version + 1) if (content_changed and existing.get("updated_at")) else current_version,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": updated_by,
    }
    try:
        resp = (
            get_supabase_admin()
            .table(ORG_CONTENT_TABLE)
            .upsert(payload, on_conflict="organization_id")
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else payload
    except Exception as exc:
        if _is_missing_schema_error(exc):
            raise ValueError("Acknowledgement content is not available — run database migrations.") from exc
        raise


def _has_shift_acknowledgement(worker_id: str, participant_id: str, shift_id: str) -> bool:
    try:
        resp = (
            get_supabase_admin()
            .table(ACK_TABLE)
            .select("id")
            .eq("worker_id", worker_id)
            .eq("participant_id", participant_id)
            .eq("shift_id", shift_id)
            .limit(1)
            .execute()
        )
        return bool(resp.data)
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return False
        logger.debug("Safety ack lookup failed: %s", exc)
        return False


def build_worker_safety_status(
    *,
    participant_id: str,
    organization_id: str,
    worker_id: str,
    shift_id: Optional[str] = None,
) -> dict[str, Any]:
    """Safety card status for a worker. Acknowledgement is scoped to a single shift -
    it's always required again on the next clock-in, never reused from a prior shift,
    and required even when the card has no content on file (nothing to skip on)."""
    protocol = get_protocol(participant_id, organization_id)
    content_version = int(protocol.get("content_version") or 1)
    has_content = _has_safety_content(protocol)
    acknowledged_for_shift = bool(shift_id) and _has_shift_acknowledgement(
        worker_id, participant_id, str(shift_id)
    )
    org_content = get_org_acknowledgement_content(organization_id)
    return {
        "content_version": content_version,
        "requires_safety_ack": not acknowledged_for_shift,
        "has_safety_content": has_content,
        "org_content_body": org_content.get("body") or _DEFAULT_ORG_ACKNOWLEDGEMENT_BODY,
        "org_content_version": int(org_content.get("content_version") or 1),
    }


def enrich_protocol_for_worker(
    protocol: dict[str, Any],
    *,
    worker_id: str,
    shift_id: Optional[str] = None,
) -> dict[str, Any]:
    participant_id = str(protocol.get("participant_id") or "")
    organization_id = str(protocol.get("organization_id") or "")
    status = build_worker_safety_status(
        participant_id=participant_id,
        organization_id=organization_id,
        worker_id=worker_id,
        shift_id=shift_id,
    )
    return {**protocol, **status}


def upsert_protocol(
    participant_id: str,
    organization_id: str,
    body: SafetyProtocolUpdate,
    updated_by: Optional[str],
) -> dict[str, Any]:
    existing = get_protocol(participant_id, organization_id)
    now = datetime.now(timezone.utc).isoformat()
    content_changed = False

    payload: dict[str, Any] = {
        "participant_id": participant_id,
        "organization_id": organization_id,
        "updated_at": now,
        "updated_by": updated_by,
    }

    if body.safety_card_body is not None:
        if body.safety_card_body != existing.get("safety_card_body"):
            content_changed = True
        payload["safety_card_body"] = body.safety_card_body
    else:
        payload["safety_card_body"] = existing.get("safety_card_body") or ""

    for field, attr in (
        ("scenarios", body.scenarios),
        ("deescalation_techniques", body.deescalation_techniques),
        ("physical_safety_notes", body.physical_safety_notes),
        ("escalation_contacts", body.escalation_contacts),
    ):
        if attr is not None:
            serialized = [item.model_dump() for item in attr]
            if serialized != (existing.get(field) or []):
                content_changed = True
            payload[field] = serialized
        else:
            payload[field] = existing.get(field) or []

    current_version = int(existing.get("content_version") or 1)
    if existing.get("updated_at") is None:
        payload["content_version"] = 1
    elif content_changed:
        payload["content_version"] = current_version + 1
    else:
        payload["content_version"] = current_version

    try:
        resp = (
            get_supabase_admin()
            .table(PROTOCOLS_TABLE)
            .upsert(payload, on_conflict="participant_id")
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else payload
    except Exception as exc:
        if _is_missing_schema_error(exc):
            raise ValueError("Safety protocols are not available — run database migrations.") from exc
        raise


def acknowledge_protocol(
    *,
    worker_id: str,
    participant_id: str,
    organization_id: str,
    content_version: int,
    org_content_version: Optional[int] = None,
    shift_id: Optional[str] = None,
) -> dict[str, Any]:
    protocol = get_protocol(participant_id, organization_id)
    current_version = int(protocol.get("content_version") or 1)
    if content_version != current_version:
        raise ValueError(
            "Safety content was updated. Please read the latest version before acknowledging."
        )
    if org_content_version is not None:
        current_org_version = int(get_org_acknowledgement_content(organization_id).get("content_version") or 1)
        if org_content_version != current_org_version:
            raise ValueError(
                "Acknowledgement content was updated. Please read the latest version before acknowledging."
            )
    # No has-content check here: acknowledgement is required every clock-in
    # regardless of whether a safety card has been filled in - the worker is
    # confirming they checked, not just clearing a rich-content prompt.

    now = datetime.now(timezone.utc).isoformat()
    row: dict[str, Any] = {
        "worker_id": worker_id,
        "participant_id": participant_id,
        "organization_id": organization_id,
        "content_version": content_version,
        "org_content_version": org_content_version,
        "acknowledged_at": now,
        "shift_id": shift_id,
    }
    try:
        if shift_id:
            get_supabase_admin().table(ACK_TABLE).upsert(
                row,
                on_conflict="worker_id,participant_id,shift_id",
            ).execute()
        else:
            get_supabase_admin().table(ACK_TABLE).insert(row).execute()
    except Exception as exc:
        if _is_missing_schema_error(exc):
            raise ValueError("Safety acknowledgements are not available — run database migrations.") from exc
        raise
    return {
        "participant_id": participant_id,
        "content_version": content_version,
        "org_content_version": org_content_version,
        "acknowledged_at": now,
        "requires_safety_ack": False,
    }


def get_on_call_phones(participant_id: str, organization_id: str) -> list[str]:
    protocol = get_protocol(participant_id, organization_id)
    phones: list[str] = []
    for contact in protocol.get("escalation_contacts") or []:
        if not isinstance(contact, dict):
            continue
        role = str(contact.get("role") or "").lower()
        phone = str(contact.get("phone") or "").strip()
        if role in ("coordinator", "on_call") and phone:
            phones.append(phone)
    return phones
