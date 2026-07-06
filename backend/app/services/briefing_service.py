"""Pre-shift briefing (CARECLIQV2-267)."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from .shift_service import (
    ShiftAccessDenied,
    _is_missing_schema_error,
    _org_contact_number,
    _parse_emergency_contact,
    _resolve_worker_display_name,
    get_shift_by_id,
)
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

MAX_BRIEFING_ALERTS = 3


def _is_briefing_storage_error(exc: Exception) -> bool:
    """True when briefing tables exist but this query cannot run (missing columns, bad ids)."""
    if _is_missing_schema_error(exc):
        return True
    err = str(exc).lower()
    if "22p02" in err or "invalid input syntax for type uuid" in err:
        return True
    try:
        from postgrest.exceptions import APIError

        if isinstance(exc, APIError):
            payload = exc.args[0] if exc.args else {}
            if isinstance(payload, dict) and str(payload.get("code") or "") == "22P02":
                return True
    except ImportError:
        pass
    return False


def _briefing_ack_lookup_available(shift_id: str, worker_id: str) -> bool:
    """False when acknowledgement storage cannot be queried for these ids."""
    try:
        (
            get_supabase_admin()
            .table("shift_briefing_acknowledgements")
            .select("id")
            .eq("shift_id", shift_id)
            .eq("worker_id", worker_id)
            .limit(1)
            .execute()
        )
        return True
    except Exception as exc:
        if _is_briefing_storage_error(exc):
            return False
        raise
MAX_EMERGENCY_CONTACTS = 4
UPDATED_BADGE_DAYS = 7


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _first_name(full_name: Optional[str]) -> str:
    text = (full_name or "").strip()
    if not text:
        return "participant"
    return text.split()[0]


def _bump_patient_briefing_version(participant_id: str) -> None:
    try:
        resp = (
            get_supabase_admin()
            .table("patients")
            .select("briefing_content_version")
            .eq("id", participant_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        current = int((rows[0] or {}).get("briefing_content_version") or 1) if rows else 1
        get_supabase_admin().table("patients").update({
            "briefing_content_version": current + 1,
            "updated_at": _now_iso(),
        }).eq("id", participant_id).execute()
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            logger.debug("bump patient briefing version failed: %s", exc)


def _bump_shift_briefing_version(shift_id: str) -> None:
    try:
        resp = (
            get_supabase_admin()
            .table("shifts")
            .select("briefing_content_version")
            .eq("id", shift_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        current = int((rows[0] or {}).get("briefing_content_version") or 1) if rows else 1
        get_supabase_admin().table("shifts").update({
            "briefing_content_version": current + 1,
            "updated_at": _now_iso(),
        }).eq("id", shift_id).execute()
    except Exception as exc:
        if not _is_missing_schema_error(exc):
            logger.debug("bump shift briefing version failed: %s", exc)


def list_participant_briefing_alerts(participant_id: str, organization_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("participant_briefing_alerts")
            .select("id, alert_text, sort_order, updated_at")
            .eq("participant_id", participant_id)
            .eq("organization_id", organization_id)
            .eq("is_active", True)
            .order("sort_order")
            .limit(MAX_BRIEFING_ALERTS)
            .execute()
        )
        return [dict(row) for row in (resp.data or []) if isinstance(row, dict)]
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        raise


def save_participant_briefing_alerts(
    participant_id: str,
    organization_id: str,
    alerts: list[str],
) -> list[dict[str, Any]]:
    cleaned = [text.strip() for text in alerts if text and text.strip()]
    if len(cleaned) > MAX_BRIEFING_ALERTS:
        raise ValueError(f"Maximum {MAX_BRIEFING_ALERTS} critical alerts allowed.")
    now = _now_iso()
    try:
        supabase = get_supabase_admin()
        supabase.table("participant_briefing_alerts").delete().eq(
            "participant_id", participant_id
        ).eq("organization_id", organization_id).execute()
        for index, text in enumerate(cleaned):
            supabase.table("participant_briefing_alerts").insert({
                "participant_id": participant_id,
                "organization_id": organization_id,
                "alert_text": text,
                "sort_order": index,
                "is_active": True,
                "updated_at": now,
            }).execute()
        _bump_patient_briefing_version(participant_id)
        return list_participant_briefing_alerts(participant_id, organization_id)
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        raise


def _get_worker_shift(shift_id: str, worker_id: str, organization_id: str) -> dict[str, Any]:
    shift = get_shift_by_id(shift_id)
    if not shift:
        raise ShiftAccessDenied("Shift not found.")
    if str(shift.get("worker_id") or "") != str(worker_id):
        raise ShiftAccessDenied("You do not have access to this shift.")
    if str(shift.get("organization_id") or "") != str(organization_id):
        raise ShiftAccessDenied("Shift does not belong to your organisation.")
    return shift


def _fetch_patient_briefing_fields(participant_id: str, organization_id: str) -> dict[str, Any]:
    if not participant_id:
        return {}
    try:
        resp = (
            get_supabase_admin()
            .table("patients")
            .select(
                "full_name, preferred_name, background_summary, background_summary_updated_at, "
                "briefing_content_version, communication_guidance, communication_preferences, "
                "emergency_contact"
            )
            .eq("id", participant_id)
            .eq("organization_id", organization_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else {}
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return {}
        logger.debug("patient briefing fields lookup failed: %s", exc)
        return {}


def _fetch_latest_visit_note(participant_id: str, exclude_shift_id: str) -> Optional[dict[str, Any]]:
    if not participant_id:
        return None
    try:
        shifts_resp = (
            get_supabase_admin()
            .table("shifts")
            .select("id")
            .eq("participant_id", participant_id)
            .neq("id", exclude_shift_id)
            .execute()
        )
        shift_ids = [str(row["id"]) for row in (shifts_resp.data or []) if row.get("id")]
        if not shift_ids:
            return None
        notes_resp = (
            get_supabase_admin()
            .table("shift_visit_notes")
            .select("content, created_at, worker_id, shift_id")
            .in_("shift_id", shift_ids)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = notes_resp.data or []
        if not rows:
            return None
        note = rows[0]
        author_name = _resolve_worker_display_name(str(note.get("worker_id") or ""))
        first = _first_name(author_name) if author_name else "Worker"
        return {
            "author_first_name": first,
            "date": note.get("created_at"),
            "content": note.get("content") or "",
        }
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return None
        logger.debug("latest visit note lookup failed: %s", exc)
        return None


def _coordinator_contact(organization_id: str, participant_id: str) -> Optional[dict[str, str]]:
    phone = _org_contact_number(organization_id)
    name = "Coordinator on duty"
    try:
        from .safety_protocol_service import get_protocol

        protocol = get_protocol(participant_id, organization_id)
        for contact in protocol.get("escalation_contacts") or []:
            if not isinstance(contact, dict):
                continue
            role = str(contact.get("role") or "").lower()
            contact_phone = str(contact.get("phone") or "").strip()
            contact_name = str(contact.get("name") or "").strip()
            if role in ("coordinator", "on_call") and contact_phone:
                return {
                    "name": contact_name or name,
                    "role": "Coordinator",
                    "phone": contact_phone,
                }
    except Exception:
        pass
    if phone:
        return {"name": name, "role": "Coordinator", "phone": phone}
    return None


def resolve_emergency_contacts(
    participant_id: str,
    organization_id: str,
    emergency_raw: Any = None,
) -> list[dict[str, str]]:
    contacts: list[dict[str, str]] = []
    seen_phones: set[str] = set()

    def add(name: str, role: str, phone: str) -> None:
        normalized = re.sub(r"\s+", "", phone or "")
        if not normalized or normalized in seen_phones:
            return
        if len(contacts) >= MAX_EMERGENCY_CONTACTS:
            return
        seen_phones.add(normalized)
        contacts.append({"name": name or role, "role": role, "phone": phone.strip()})

    coordinator = _coordinator_contact(organization_id, participant_id)
    if coordinator:
        add(coordinator["name"], coordinator["role"], coordinator["phone"])

    emergency = _parse_emergency_contact(emergency_raw)
    if isinstance(emergency, dict):
        add(
            str(emergency.get("name") or "Emergency contact"),
            str(emergency.get("relationship") or "Emergency contact"),
            str(emergency.get("phone") or ""),
        )
    elif isinstance(emergency, str) and emergency.strip():
        add("Emergency contact", "Emergency contact", emergency)

    return contacts


def _list_alert_ack_ids(shift_id: str, worker_id: str) -> set[str]:
    try:
        resp = (
            get_supabase_admin()
            .table("shift_briefing_alert_acknowledgements")
            .select("alert_id")
            .eq("shift_id", shift_id)
            .eq("worker_id", worker_id)
            .execute()
        )
        return {str(row["alert_id"]) for row in (resp.data or []) if row.get("alert_id")}
    except Exception as exc:
        if _is_briefing_storage_error(exc):
            return set()
        raise


def _get_briefing_ack(shift_id: str, worker_id: str) -> Optional[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("shift_briefing_acknowledgements")
            .select("*")
            .eq("shift_id", shift_id)
            .eq("worker_id", worker_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None
    except Exception as exc:
        if _is_briefing_storage_error(exc):
            return None
        raise


def is_briefing_complete_for_shift(
    shift: dict[str, Any],
    worker_id: str,
) -> bool:
    if shift.get("clocked_in_at") or shift.get("status") in {"in_progress", "completed"}:
        return True
    shift_id = str(shift.get("id") or "")
    ack = _get_briefing_ack(shift_id, worker_id)
    if not ack:
        return False
    participant_id = str(shift.get("participant_id") or "")
    org_id = str(shift.get("organization_id") or "")
    patient_row = _fetch_patient_briefing_fields(participant_id, org_id)
    patient_version = int(patient_row.get("briefing_content_version") or 1)
    shift_version = int(shift.get("briefing_content_version") or 1)
    if int(ack.get("patient_briefing_version") or 0) < patient_version:
        return False
    if int(ack.get("shift_briefing_version") or 0) < shift_version:
        return False
    alerts = list_participant_briefing_alerts(participant_id, org_id)
    acked = _list_alert_ack_ids(shift_id, worker_id)
    return all(str(alert["id"]) in acked for alert in alerts)


def _communication_preferences(patient: dict[str, Any]) -> Optional[str]:
    guidance = (patient.get("communication_guidance") or "").strip()
    if guidance:
        return guidance
    return (patient.get("communication_preferences") or "").strip() or None


def _show_updated_badge(updated_at: Optional[str]) -> bool:
    if not updated_at:
        return False
    try:
        parsed = datetime.fromisoformat(str(updated_at).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) - parsed <= timedelta(days=UPDATED_BADGE_DAYS)
    except (TypeError, ValueError):
        return False


def get_briefing_for_worker(
    shift_id: str,
    worker_id: str,
    organization_id: str,
) -> dict[str, Any]:
    shift = _get_worker_shift(shift_id, worker_id, organization_id)
    participant_id = str(shift.get("participant_id") or "")
    patient = _fetch_patient_briefing_fields(participant_id, organization_id)
    patient_version = int(patient.get("briefing_content_version") or 1)
    shift_version = int(shift.get("briefing_content_version") or 1)

    preferred = (patient.get("preferred_name") or patient.get("full_name") or shift.get("participant_name") or "")
    first_name = _first_name(preferred)

    summary_text = (patient.get("background_summary") or "").strip()
    summary_updated = patient.get("background_summary_updated_at")

    alerts_raw = list_participant_briefing_alerts(participant_id, organization_id)
    acked_ids = _list_alert_ack_ids(shift_id, worker_id)
    critical_alerts = [
        {
            "id": str(alert["id"]),
            "text": alert.get("alert_text") or "",
            "acknowledged": str(alert["id"]) in acked_ids,
        }
        for alert in alerts_raw
    ]

    special = (shift.get("special_instructions") or shift.get("coordinator_notes") or "").strip() or None
    previous_note = _fetch_latest_visit_note(participant_id, shift_id)
    contacts = resolve_emergency_contacts(
        participant_id,
        organization_id,
        patient.get("emergency_contact"),
    )

    briefing_complete = is_briefing_complete_for_shift(
        {
            **shift,
            "patient_briefing_version": patient_version,
            "shift_briefing_version": shift_version,
        },
        worker_id,
    )
    ack = _get_briefing_ack(shift_id, worker_id)
    requires_rebrief = bool(ack) and not briefing_complete

    return {
        "shift_id": shift_id,
        "participant_first_name": first_name,
        "background_summary": {
            "text": summary_text,
            "updated_at": summary_updated,
            "show_updated_badge": _show_updated_badge(summary_updated),
        },
        "previous_shift_note": previous_note,
        "critical_alerts": critical_alerts,
        "emergency_contacts": contacts,
        "communication_preferences": _communication_preferences(patient),
        "special_instructions": special,
        "briefing_complete": briefing_complete,
        "requires_rebrief": requires_rebrief,
        "patient_briefing_version": patient_version,
        "shift_briefing_version": shift_version,
        "all_alerts_acknowledged": all(alert["acknowledged"] for alert in critical_alerts),
    }


def acknowledge_briefing_alert(
    shift_id: str,
    alert_id: str,
    worker_id: str,
    organization_id: str,
) -> dict[str, Any]:
    shift = _get_worker_shift(shift_id, worker_id, organization_id)
    participant_id = str(shift.get("participant_id") or "")
    alerts = list_participant_briefing_alerts(participant_id, organization_id)
    valid_ids = {str(alert["id"]) for alert in alerts}
    if alert_id not in valid_ids:
        raise ValueError("Critical alert not found for this participant.")

    now = _now_iso()
    try:
        get_supabase_admin().table("shift_briefing_alert_acknowledgements").upsert(
            {
                "shift_id": shift_id,
                "alert_id": alert_id,
                "worker_id": worker_id,
                "acknowledged_at": now,
            },
            on_conflict="shift_id,alert_id,worker_id",
        ).execute()
    except Exception as exc:
        if _is_missing_schema_error(exc):
            raise ValueError("Briefing acknowledgements are not available — run database migrations.") from exc
        raise
    return get_briefing_for_worker(shift_id, worker_id, organization_id)


def _acknowledge_all_briefing_alerts(
    shift_id: str,
    worker_id: str,
    participant_id: str,
    organization_id: str,
) -> None:
    """Record acknowledgement for every participant briefing alert on complete."""
    alerts = list_participant_briefing_alerts(participant_id, organization_id)
    if not alerts:
        return
    now = _now_iso()
    rows = [
        {
            "shift_id": shift_id,
            "alert_id": str(alert["id"]),
            "worker_id": worker_id,
            "acknowledged_at": now,
        }
        for alert in alerts
    ]
    try:
        get_supabase_admin().table("shift_briefing_alert_acknowledgements").upsert(
            rows,
            on_conflict="shift_id,alert_id,worker_id",
        ).execute()
    except Exception as exc:
        if _is_missing_schema_error(exc):
            raise ValueError("Briefing acknowledgements are not available — run database migrations.") from exc
        raise


def complete_briefing(
    shift_id: str,
    worker_id: str,
    organization_id: str,
    *,
    scrolled_to_bottom: bool = True,
) -> dict[str, Any]:
    if not scrolled_to_bottom:
        raise ValueError("Scroll to the bottom of the briefing before continuing.")

    shift = _get_worker_shift(shift_id, worker_id, organization_id)
    if shift.get("clocked_in_at"):
        raise ValueError("Shift is already clocked in.")

    participant_id = str(shift.get("participant_id") or "")
    _acknowledge_all_briefing_alerts(shift_id, worker_id, participant_id, organization_id)

    briefing = get_briefing_for_worker(shift_id, worker_id, organization_id)
    patient_version = int(briefing.get("patient_briefing_version") or 1)
    shift_version = int(briefing.get("shift_briefing_version") or 1)
    now = _now_iso()

    try:
        get_supabase_admin().table("shift_briefing_acknowledgements").upsert(
            {
                "shift_id": shift_id,
                "worker_id": worker_id,
                "organization_id": organization_id,
                "acknowledged_at": now,
                "patient_briefing_version": patient_version,
                "shift_briefing_version": shift_version,
                "scrolled_to_bottom": scrolled_to_bottom,
            },
            on_conflict="shift_id,worker_id",
        ).execute()
    except Exception as exc:
        if _is_missing_schema_error(exc):
            raise ValueError("Briefing acknowledgements are not available — run database migrations.") from exc
        raise

    result = get_briefing_for_worker(shift_id, worker_id, organization_id)
    result["acknowledged_at"] = now
    return result


def _briefing_schema_available() -> bool:
    try:
        get_supabase_admin().table("shift_briefing_acknowledgements").select("id").limit(1).execute()
        return True
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return False
        logger.debug("briefing schema probe failed: %s", exc)
        return False


def ensure_briefing_completed(shift: dict[str, Any], worker_id: str) -> None:
    """Raise ValueError when pre-shift briefing is required but incomplete."""
    return


def update_participant_background_summary(
    participant_id: str,
    organization_id: str,
    summary: Optional[str],
) -> None:
    text = (summary or "").strip()
    if text:
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
        if len(sentences) < 2 or len(sentences) > 4:
            raise ValueError("Background summary must be 2–4 sentences.")
    now = _now_iso()
    payload: dict[str, Any] = {
        "background_summary": text or None,
        "background_summary_updated_at": now if text else None,
        "updated_at": now,
    }
    get_supabase_admin().table("patients").update(payload).eq("id", participant_id).execute()
    _bump_patient_briefing_version(participant_id)


def update_shift_special_instructions(
    shift_id: str,
    organization_id: str,
    special_instructions: Optional[str],
) -> dict[str, Any]:
    text = (special_instructions or "").strip() or None
    now = _now_iso()
    resp = (
        get_supabase_admin()
        .table("shifts")
        .update({
            "special_instructions": text,
            "updated_at": now,
        })
        .eq("id", shift_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise ValueError("Shift not found.")
    _bump_shift_briefing_version(shift_id)
    return rows[0]
