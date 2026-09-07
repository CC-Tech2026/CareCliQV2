from __future__ import annotations

import base64
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from .object_storage import upload_evidence_bytes
from .supabase_client import get_supabase_admin
from .documentation_normalization_service import normalize_documentation_for_legal_record
from .compliance_engine import BLOCKING_TRANSLATION_STATUSES, COMPLIANCE_BLOCKED_MESSAGE
from ..core.access import can_access_session, is_coordinator_role, user_id
from ..schemas.incident import (
    IncidentCreate,
    IncidentUpdate,
    WorkerIncidentCreate,
    NDIS_NOTIFICATION_HOURS,
    PRACTICE_STANDARD_MAP,
    WORKER_REPORT_TYPE_TO_INCIDENT,
    is_ndis_reportable,
    map_worker_severity,
    worker_status_label,
)

logger = logging.getLogger(__name__)

TABLE = "incidents"
DATA_URL_RE = re.compile(r"^data:(image/[\w.+-]+);base64,(.+)$", re.DOTALL)
LEGAL_TEXT_FIELDS = (
    "title",
    "description",
    "participant_impact",
    "worker_actions",
    "investigation_notes",
    "corrective_actions",
)

OPTIONAL_INCIDENT_COLUMNS = frozenset({
    "original_language_input",
    "detected_language",
    "translated_english_report",
    "compliance_input_text",
    "translation_metadata",
    "translation_status",
    "translation_provider",
    "translation_confidence",
    "translation_error",
    "translation_completed_at",
})


def _strip_unsupported_incident_fields(payload: dict[str, Any]) -> dict[str, Any]:
    """Drop legal-record / optional fields so insert works on lean schemas."""
    return {k: v for k, v in payload.items() if k not in OPTIONAL_INCIDENT_COLUMNS}


def _insert_incident_payload(supabase: Any, payload: dict[str, Any]) -> Any:
    lean = _strip_unsupported_incident_fields(payload)
    try:
        return supabase.table(TABLE).insert(lean).execute()
    except Exception as exc:
        if not _is_missing_column_error(exc):
            raise
        # Last resort: drop shift photos/link columns if migration 041 not applied
        fallback = {
            k: v
            for k, v in lean.items()
            if k not in {"photo_urls", "photo_metadata", "shift_id", "escalate"}
        }
        logger.warning("Incident insert retry without shift/photo columns: %s", exc)
        return supabase.table(TABLE).insert(fallback).execute()


async def _log_incident_created(incident: dict[str, Any], *, org_id: Optional[str], user_id: Optional[str]) -> None:
    """Shared by every incident-creation path (coordinator report, worker
    report, and both medication-error/pattern-signal auto-creation paths,
    which call create_incident() directly) - logging lives here, at the
    point the row is actually written, rather than being something each
    caller has to remember to do separately."""
    from . import audit_service

    logged = await audit_service.log_action(
        action_type="incident.created",
        entity_type="incident",
        entity_id=str(incident.get("id") or ""),
        user_id=user_id,
        organization_id=org_id,
        after_state={
            "id": incident.get("id"),
            "title": incident.get("title"),
            "severity": incident.get("severity"),
            "participant_id": incident.get("participant_id"),
            "source_type": incident.get("source_type"),
        },
    )
    if not logged and incident.get("id"):
        try:
            get_supabase_admin().table("incidents").update(
                {"audit_log_pending": True}
            ).eq("id", incident["id"]).execute()
        except Exception as exc:
            logger.warning(
                "Could not set audit_log_pending on incident %s after a failed audit write: %s",
                incident.get("id"), exc,
            )


def _is_missing_column_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return (
        "pgrst" in err
        or "does not exist" in err
        or "42703" in err
        or "could not find" in err
        or "column of" in err
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_rows(data: Any) -> List[dict]:
    """Ensure Supabase data is always a list of dicts."""
    if not isinstance(data, list):
        return []

    return [row for row in data if isinstance(row, dict)]


def _safe_row(data: Any) -> Optional[dict]:
    """Ensure Supabase row is a dict."""
    return data if isinstance(data, dict) else None


def _parse_datetime(value: Any) -> Optional[datetime]:
    """Safely parse datetime string."""
    if not value:
        return None

    try:
        return datetime.fromisoformat(
            str(value).replace("Z", "+00:00")
        )
    except Exception:
        return None


def _enrich(row: dict[str, Any]) -> dict[str, Any]:
    """Add computed fields to incident row."""

    if not row:
        return row

    enriched = dict(row)

    legal_record_text = (
        enriched.get("translated_english_report")
        or enriched.get("compliance_input_text")
        or ""
    )
    enriched["legal_record_text"] = legal_record_text
    enriched["display_description"] = legal_record_text
    if legal_record_text:
        enriched["original_description"] = enriched.get("description")
        enriched["description"] = legal_record_text

    incident_type = str(
        enriched.get("incident_type") or "other"
    )

    severity = str(
        enriched.get("severity") or "medium"
    )

    status = str(
        enriched.get("status") or "reported"
    )

    enriched["ndis_reportable"] = is_ndis_reportable(
        incident_type,
        severity,
    )

    enriched["practice_standard"] = PRACTICE_STANDARD_MAP.get(
        incident_type,
        "Standard 2.3 — Incident management",
    )

    # Overdue calculation
    overdue = False
    notification_due_at: Optional[str] = None

    if status in ("reported", "under_investigation"):
        incident_date = _parse_datetime(
            enriched.get("incident_date")
        )

        if incident_date:
            threshold_hours = NDIS_NOTIFICATION_HOURS.get(
                severity,
                240,
            )

            deadline = incident_date + timedelta(
                hours=threshold_hours
            )

            overdue = (
                datetime.now(timezone.utc) > deadline
            )
            notification_due_at = deadline.isoformat()

    enriched["overdue"] = overdue
    enriched["notification_due_at"] = notification_due_at

    enriched["ndis_pending"] = bool(
        enriched["ndis_reportable"]
        and not enriched.get("ndis_reported_at")
        and status != "closed"
    )

    enriched["worker_status_label"] = worker_status_label(status)
    sev = str(enriched.get("severity") or "medium").lower()
    enriched["worker_severity_label"] = "Emergency" if sev == "critical" else sev.capitalize()

    return enriched


def _build_legal_source_text(
    source_data: dict[str, Any],
    existing: Optional[dict[str, Any]] = None,
) -> str:
    source = {**(existing or {}), **source_data}
    sections: list[str] = []
    labels = {
        "title": "Title",
        "description": "Description",
        "participant_impact": "Participant impact",
        "worker_actions": "Worker actions",
        "investigation_notes": "Investigation notes",
        "corrective_actions": "Corrective actions",
    }
    for field in LEGAL_TEXT_FIELDS:
        value = str(source.get(field) or "").strip()
        if value:
            sections.append(f"{labels[field]}: {value}")
    return "\n\n".join(sections).strip()


async def _apply_legal_record_normalization(
    payload: dict[str, Any],
    source_data: dict[str, Any],
    existing: Optional[dict[str, Any]] = None,
    current_user: Optional[dict] = None,
    incident_id: Optional[str] = None,
) -> None:
    should_normalize = bool(source_data.get("status") in {"reported", "under_investigation", "resolved", "closed"}) or any(
        field in source_data for field in LEGAL_TEXT_FIELDS
    )
    if not should_normalize:
        return

    source_text = _build_legal_source_text(source_data, existing)
    normalized = await normalize_documentation_for_legal_record(
        source_text=source_text,
        requested_language=source_data.get("input_language") or source_data.get("detected_language"),
        user=current_user,
        session_id=incident_id,
    )
    payload.update(
        {
            "original_language_input": normalized.get("original_language_input"),
            "detected_language": normalized.get("detected_language"),
            "translated_english_report": normalized.get("translated_english_note"),
            "compliance_input_text": normalized.get("compliance_input_text"),
            "translation_status": normalized.get("translation_status"),
            "translation_provider": normalized.get("translation_provider"),
            "translation_confidence": normalized.get("translation_confidence"),
            "translation_metadata": normalized.get("translation_metadata"),
            "translation_error": normalized.get("translation_error"),
        }
    )
    if normalized.get("translation_status") not in BLOCKING_TRANSLATION_STATUSES:
        payload["translation_completed_at"] = datetime.now(timezone.utc).isoformat()
    else:
        raise ValueError(COMPLIANCE_BLOCKED_MESSAGE)


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------

async def get_all_incidents(
    limit: int = 100,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    participant_id: Optional[str] = None,
    shift_id: Optional[str] = None,
    org_id: Optional[str] = None,
    reporter_id: Optional[str] = None,
    current_user: Optional[dict] = None,
) -> List[dict[str, Any]]:
    supabase = get_supabase_admin()

    query = (
        supabase
        .table(TABLE)
        .select("*")
        .order("incident_date", desc=True)
        .limit(limit)
    )

    if status:
        query = query.eq("status", status)

    if severity:
        query = query.eq("severity", severity)

    if participant_id:
        query = query.eq("participant_id", participant_id)

    if shift_id:
        query = query.eq("shift_id", shift_id)

    if org_id:
        query = query.eq("organization_id", org_id)

    if reporter_id:
        query = query.eq("user_id", reporter_id)

    try:
        result = query.execute()
    except Exception as exc:
        if "42703" in str(exc) and reporter_id:
            # incidents.user_id column not yet in DB — retry without the column filter.
            # Workaround: until supabase_setup.sql is run, fall back to org-only scope
            # and let the visible_participant_ids pass do the filtering.
            logger.warning(
                "incidents.user_id column missing — retrying without reporter filter. "
                "Run supabase_setup.sql to add the column."
            )
            retry = (
                supabase
                .table(TABLE)
                .select("*")
                .order("incident_date", desc=True)
                .limit(limit)
            )
            if status:
                retry = retry.eq("status", status)
            if severity:
                retry = retry.eq("severity", severity)
            if participant_id:
                retry = retry.eq("participant_id", participant_id)
            if org_id:
                retry = retry.eq("organization_id", org_id)
            result = retry.execute()
        else:
            raise

    rows = _safe_rows(result.data)

    # Batch fetch participant names
    participant_ids: List[str] = [
        str(r["participant_id"])
        for r in rows
        if isinstance(r.get("participant_id"), str)
    ]

    participant_ids = list(set(participant_ids))

    name_map: Dict[str, str] = {}

    if participant_ids:
        try:
            participant_result = (
                supabase
                .table("patients")
                .select("id, full_name")
                .in_("id", participant_ids)
                .execute()
            )

            participant_rows = _safe_rows(
                participant_result.data
            )

            name_map = {
                str(p["id"]): str(
                    p.get("full_name") or ""
                )
                for p in participant_rows
                if p.get("id")
            }

        except Exception as exc:
            logger.warning(
                "Participant lookup failed: %s",
                exc,
            )

    enriched_rows: List[dict[str, Any]] = []
    visible_participant_ids: set[str] = set()
    if current_user:
        try:
            from . import participant_service
            visible_participants = await participant_service.get_all_participants(current_user)
            visible_participant_ids = {
                str(p.get("id"))
                for p in visible_participants
                if p.get("id")
            }
        except Exception:
            visible_participant_ids = set()

    for row in rows:
        if current_user and not is_coordinator_role(current_user):
            participant_id = row.get("participant_id")
            if not participant_id or str(participant_id) not in visible_participant_ids:
                continue

        participant_key = str(
            row.get("participant_id") or ""
        )

        row["participant_name"] = name_map.get(
            participant_key,
            "",
        )

        enriched_rows.append(_enrich(row))

    return enriched_rows


async def get_incident_by_id(
    incident_id: str,
    current_user: Optional[dict] = None,
) -> Optional[dict[str, Any]]:
    supabase = get_supabase_admin()

    try:
        result = (
            supabase
            .table(TABLE)
            .select("*")
            .eq("id", incident_id)
            .execute()
        )

        rows = _safe_rows(result.data)

        if not rows:
            return None

        row = rows[0]

        if current_user:
            org_id = current_user.get("organization_id")
            if not org_id or str(row.get("organization_id") or "") != str(org_id):
                return None

        participant_id = row.get("participant_id")

        if isinstance(participant_id, str):
            try:
                if current_user:
                    from . import participant_service
                    participant_access = await participant_service.get_participant_by_id(
                        participant_id,
                        current_user,
                    )
                    if not participant_access:
                        return None

                participant_result = (
                    supabase
                    .table("patients")
                    .select("full_name, ndis_number")
                    .eq("id", participant_id)
                    .execute()
                )

                participant_rows = _safe_rows(
                    participant_result.data
                )

                if participant_rows:
                    participant = participant_rows[0]

                    row["participant_name"] = str(
                        participant.get("full_name") or ""
                    )

                    row["participant_ndis"] = str(
                        participant.get("ndis_number") or ""
                    )

            except Exception as exc:
                logger.warning(
                    "Participant lookup failed: %s",
                    exc,
                )

        elif current_user and not is_coordinator_role(current_user):
            session_id = row.get("session_id")
            if not session_id:
                return None
            try:
                from . import session_service
                session = await session_service.get_session_by_id(str(session_id), current_user)
                if not session or not can_access_session(session, current_user):
                    return None
            except Exception:
                return None

        reporter_id = row.get("user_id")
        if isinstance(reporter_id, str):
            try:
                worker_result = (
                    supabase.table("users").select("full_name").eq("id", reporter_id).execute()
                )
                worker_rows = _safe_rows(worker_result.data)
                if worker_rows:
                    row["worker_name"] = str(worker_rows[0].get("full_name") or "")
            except Exception as exc:
                logger.warning("Reporting worker lookup failed: %s", exc)

        return _enrich(row)

    except Exception as exc:
        logger.error(
            "get_incident_by_id(%s) failed: %s",
            incident_id,
            exc,
        )

        return None


async def get_incidents_by_participant(
    participant_id: str,
    current_user: Optional[dict] = None,
) -> List[dict[str, Any]]:
    return await get_all_incidents(
        participant_id=participant_id,
        org_id=(current_user or {}).get("organization_id"),
        current_user=current_user,
    )


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

async def create_incident(
    data: IncidentCreate,
    org_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> dict[str, Any]:
    supabase = get_supabase_admin()

    payload: dict[str, Any] = data.model_dump(
        exclude_none=True,
        exclude={"photo_data", "photo_items"},
    )
    photo_data = list(data.photo_data or [])
    photo_items = list(data.photo_items or [])
    if photo_items and not photo_data:
        photo_data = [item.data for item in photo_items if item.data]

    # Shift incident reports: save core fields only. Legal-record / translation
    # columns are applied later on coordinator review (when present in DB).
    if org_id:
        payload["organization_id"] = org_id
    if user_id:
        payload["user_id"] = user_id
        payload["created_by"] = user_id

    # Convert date fields
    for key in (
        "incident_date",
        "follow_up_date",
        "identified_at",
    ):
        if payload.get(key) is not None:
            payload[key] = str(payload[key])

    incident_type = str(
        payload.get("incident_type") or "other"
    )

    severity = str(
        payload.get("severity") or "medium"
    )

    payload["ndis_reportable"] = is_ndis_reportable(
        incident_type,
        severity,
    )

    payload["practice_standard"] = PRACTICE_STANDARD_MAP.get(
        incident_type,
        "Standard 2.3 — Incident management",
    )

    payload["status"] = "reported"

    payload["reported_date"] = (
        datetime.now(timezone.utc).isoformat()
    )

    if data.escalate:
        payload["severity"] = "critical"

    incident_id = str(uuid.uuid4())
    payload["id"] = incident_id

    if photo_data and org_id:
        uploaded = _upload_incident_photos(
            photo_data, str(org_id), incident_id, photo_items=photo_items, max_photos=6,
        )
        if uploaded:
            payload["photo_urls"] = uploaded
            metadata: list[dict[str, Any]] = []
            for index, url in enumerate(uploaded):
                item = photo_items[index] if index < len(photo_items) else None
                meta: dict[str, Any] = {
                    "url": url,
                    "description": ((item.description if item else "") or "").strip() or None,
                    "captured_at": (
                        item.captured_at if item and item.captured_at
                        else datetime.now(timezone.utc).isoformat()
                    ),
                }
                if item and item.latitude is not None:
                    meta["latitude"] = item.latitude
                if item and item.longitude is not None:
                    meta["longitude"] = item.longitude
                metadata.append(meta)
            payload["photo_metadata"] = metadata

    result = _insert_incident_payload(supabase, payload)

    rows = _safe_rows(result.data)

    if not rows:
        raise ValueError(
            "Incident insert returned no rows"
        )

    enriched = _enrich(rows[0])
    await _log_incident_created(enriched, org_id=org_id, user_id=user_id)
    return enriched


def _generate_reference_number(supabase: Any) -> Optional[str]:
    try:
        resp = supabase.rpc("generate_incident_reference_number").execute()
        ref = resp.data
        if isinstance(ref, str) and ref.strip():
            return ref.strip()
    except Exception as exc:
        if not _is_missing_column_error(exc):
            logger.warning("Reference number generation failed: %s", exc)
    return None


def _worker_report_title(body: WorkerIncidentCreate) -> str:
    labels = {
        "safety_hazard": "Safety hazard",
        "participant_behaviour": "Participant behaviour",
        "equipment_damage": "Equipment damage",
        "travel_accident": "Travel accident",
        "other": "Incident",
    }
    base = labels.get(body.worker_report_type, "Incident")
    if body.behaviour_subtype:
        return f"{base} ({body.behaviour_subtype})"
    return base


async def create_worker_incident(
    body: WorkerIncidentCreate,
    *,
    org_id: str,
    user_id: str,
) -> dict[str, Any]:
    incident_type = WORKER_REPORT_TYPE_TO_INCIDENT.get(
        body.worker_report_type, "other",
    )
    internal_severity = map_worker_severity(body.severity)
    participant_impact = None
    if body.participant_harmed:
        participant_impact = f"Participant harmed: {body.participant_harmed}"

    create = IncidentCreate(
        participant_id=body.participant_id,
        session_id=body.session_id,
        shift_id=body.shift_id,
        title=_worker_report_title(body),
        description=body.description.strip(),
        incident_type=incident_type,
        severity=internal_severity,
        incident_date=body.incident_date,
        location=body.location,
        participant_impact=participant_impact,
        worker_actions=body.worker_actions,
        escalate=body.severity == "emergency",
        photo_items=body.photo_items[:3] if body.photo_items else None,
        worker_report_type=body.worker_report_type,
        behaviour_subtype=body.behaviour_subtype,
        participant_present=body.participant_present,
        participant_harmed=body.participant_harmed,
    )

    supabase = get_supabase_admin()
    payload: dict[str, Any] = create.model_dump(
        exclude_none=True,
        exclude={"photo_data", "photo_items"},
    )
    photo_items = list(create.photo_items or [])
    photo_data = [item.data for item in photo_items if item.data]

    payload["organization_id"] = org_id
    payload["user_id"] = user_id
    payload["created_by"] = user_id
    payload["worker_report_type"] = body.worker_report_type
    payload["behaviour_subtype"] = body.behaviour_subtype
    payload["participant_present"] = body.participant_present
    payload["participant_harmed"] = body.participant_harmed

    for key in ("incident_date",):
        if payload.get(key) is not None:
            payload[key] = str(payload[key])

    payload["ndis_reportable"] = is_ndis_reportable(incident_type, internal_severity)
    payload["practice_standard"] = PRACTICE_STANDARD_MAP.get(
        incident_type, "Standard 2.3 — Incident management",
    )
    payload["status"] = "reported"
    payload["reported_date"] = datetime.now(timezone.utc).isoformat()

    incident_id = str(uuid.uuid4())
    payload["id"] = incident_id

    ref = _generate_reference_number(supabase)
    if ref:
        payload["reference_number"] = ref

    if photo_data and org_id:
        uploaded = _upload_incident_photos(
            photo_data, org_id, incident_id, photo_items=photo_items, max_photos=3,
        )
        if uploaded:
            payload["photo_urls"] = uploaded
            metadata: list[dict[str, Any]] = []
            for index, url in enumerate(uploaded):
                item = photo_items[index] if index < len(photo_items) else None
                meta: dict[str, Any] = {
                    "url": url,
                    "captured_at": (
                        item.captured_at if item and item.captured_at
                        else datetime.now(timezone.utc).isoformat()
                    ),
                }
                if item and item.latitude is not None:
                    meta["latitude"] = item.latitude
                if item and item.longitude is not None:
                    meta["longitude"] = item.longitude
                metadata.append(meta)
            payload["photo_metadata"] = metadata

    result = _insert_incident_payload(supabase, payload)
    rows = _safe_rows(result.data)
    if not rows:
        raise ValueError("Incident insert returned no rows")
    enriched = _enrich(rows[0])
    await _log_incident_created(enriched, org_id=org_id, user_id=user_id)
    return enriched


async def add_incident_correction(
    incident_id: str,
    *,
    worker_id: str,
    org_id: str,
    note: str,
) -> dict[str, Any]:
    supabase = get_supabase_admin()
    existing = await get_incident_by_id(incident_id)
    if not existing:
        raise ValueError("Incident not found")
    if str(existing.get("user_id") or "") != str(worker_id):
        raise ValueError("Only the reporting worker can add a correction note")
    row = {
        "incident_id": incident_id,
        "worker_id": worker_id,
        "organization_id": org_id,
        "note": note.strip(),
    }
    try:
        resp = supabase.table("incident_corrections").insert(row).execute()
        rows = _safe_rows(resp.data)
        return rows[0] if rows else row
    except Exception as exc:
        if _is_missing_schema_error(exc):
            raise ValueError("Correction notes are not available — run database migrations.") from exc
        raise


async def list_incident_corrections(incident_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("incident_corrections")
            .select("*")
            .eq("incident_id", incident_id)
            .order("created_at", desc=False)
            .execute()
        )
        return _safe_rows(resp.data)
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return []
        raise


def _upload_incident_photos(
    photo_data: list[str],
    org_id: str,
    incident_id: str,
    *,
    photo_items: Optional[list[Any]] = None,
    max_photos: int = 6,
) -> list[str]:
    urls: list[str] = []
    for index, raw in enumerate(photo_data[:max_photos]):
        if not raw or not isinstance(raw, str):
            continue
        mime = "image/jpeg"
        payload = raw.strip()
        match = DATA_URL_RE.match(payload)
        if match:
            mime = match.group(1)
            payload = match.group(2)
        try:
            binary = base64.b64decode(payload, validate=False)
        except Exception:
            continue
        if not binary:
            continue
        ext = "jpg" if "jpeg" in mime or "jpg" in mime else "png"
        path = f"incidents/{org_id}/{incident_id}/{uuid.uuid4().hex}_{index}.{ext}"
        try:
            stored = upload_evidence_bytes(path, binary, mime)
            if stored.file_url:
                urls.append(stored.file_url)
        except Exception as exc:
            logger.warning("Incident photo upload failed: %s", exc)
    return urls


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

async def update_incident(
    incident_id: str,
    updates: dict[str, Any],
    current_user: Optional[dict] = None,
) -> Optional[dict[str, Any]]:
    supabase = get_supabase_admin()

    payload = dict(updates)

    existing = None
    try:
        existing_result = (
            supabase
            .table(TABLE)
            .select("*")
            .eq("id", incident_id)
            .execute()
        )
        existing_rows = _safe_rows(existing_result.data)
        existing = existing_rows[0] if existing_rows else None
    except Exception as exc:
        logger.warning("Could not fetch incident before normalization: %s", exc)

    await _apply_legal_record_normalization(
        payload,
        payload,
        existing=existing,
        current_user=current_user,
        incident_id=incident_id,
    )

    for key in (
        "incident_date",
        "resolved_date",
        "ndis_reported_at",
        "follow_up_date",
        "identified_at",
    ):
        if payload.get(key) is not None:
            payload[key] = str(payload[key])

    # Auto-set resolved timestamp
    if (
        payload.get("status") == "resolved"
        and "resolved_date" not in payload
    ):
        payload["resolved_date"] = (
            datetime.now(timezone.utc).isoformat()
        )

    # Recompute NDIS flags
    if (
        "incident_type" in payload
        or "severity" in payload
    ):
        incident_type = str(
            payload.get("incident_type") or "other"
        )

        severity = str(
            payload.get("severity") or "medium"
        )

        payload["ndis_reportable"] = (
            is_ndis_reportable(
                incident_type,
                severity,
            )
        )

        payload["practice_standard"] = (
            PRACTICE_STANDARD_MAP.get(
                incident_type,
                "Standard 2.3 — Incident management",
            )
        )

    lean_payload = _strip_unsupported_incident_fields(payload)

    try:
        try:
            result = (
                supabase
                .table(TABLE)
                .update(lean_payload)
                .eq("id", incident_id)
                .execute()
            )
        except Exception as exc:
            if not _is_missing_column_error(exc):
                raise
            # Same lean-schema fallback as _insert_incident_payload.
            fallback = {
                k: v
                for k, v in lean_payload.items()
                if k not in {"photo_urls", "photo_metadata", "shift_id", "escalate"}
            }
            logger.warning("Incident update retry without shift/photo columns: %s", exc)
            result = (
                supabase
                .table(TABLE)
                .update(fallback)
                .eq("id", incident_id)
                .execute()
            )

        rows = _safe_rows(result.data)

        if not rows:
            return None

        return await get_incident_by_id(
            incident_id,
            current_user=current_user,
        )

    except Exception as exc:
        logger.error(
            "update_incident(%s) failed: %s",
            incident_id,
            exc,
        )

        return None


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

async def get_incident_stats(
    org_id: Optional[str] = None,
    reporter_id: Optional[str] = None,
    current_user: Optional[dict] = None,
) -> dict[str, int]:
    supabase = get_supabase_admin()

    try:
        query = (
            supabase
            .table(TABLE)
            .select(
                "id, participant_id, status, severity, "
                "ndis_reportable, "
                "ndis_reported_at, "
                "incident_date"
            )
        )

        if org_id:
            query = query.eq("organization_id", org_id)

        # Support workers are pre-filtered to their own incidents at the SQL level
        if reporter_id:
            query = query.eq("user_id", reporter_id)

        try:
            result = query.execute()
        except Exception as col_exc:
            if "42703" in str(col_exc) and reporter_id:
                logger.warning(
                    "incidents.user_id column missing — retrying stats without reporter filter. "
                    "Run supabase_setup.sql to add the column."
                )
                retry = (
                    supabase
                    .table(TABLE)
                    .select(
                        "id, participant_id, status, severity, "
                        "ndis_reportable, "
                        "ndis_reported_at, "
                        "incident_date"
                    )
                )
                if org_id:
                    retry = retry.eq("organization_id", org_id)
                result = retry.execute()
            else:
                raise

        rows = _safe_rows(result.data)

    except Exception as exc:
        logger.warning(
            "Could not fetch incident stats: %s",
            exc,
        )

        return {
            "total": 0,
            "open": 0,
            "ndis_pending": 0,
            "overdue": 0,
            "critical": 0,
        }

    now = datetime.now(timezone.utc)

    # Allied health: filter to their allocated participants (support workers are
    # already filtered by reporter_id at SQL level so skip participant-scope pass)
    if current_user and not is_coordinator_role(current_user) and not reporter_id:
        visible_participant_ids: set[str] = set()
        try:
            from . import participant_service
            visible_participants = await participant_service.get_all_participants(current_user)
            visible_participant_ids = {
                str(p.get("id"))
                for p in visible_participants
                if p.get("id")
            }
        except Exception:
            visible_participant_ids = set()
        rows = [
            r
            for r in rows
            if r.get("participant_id") and str(r.get("participant_id")) in visible_participant_ids
        ]

    total = len(rows)

    open_count = sum(
        1
        for r in rows
        if r.get("status")
        in ("reported", "under_investigation")
    )

    critical_count = sum(
        1
        for r in rows
        if r.get("severity") == "critical"
    )

    ndis_pending = sum(
        1
        for r in rows
        if (
            r.get("ndis_reportable")
            and not r.get("ndis_reported_at")
            and r.get("status") != "closed"
        )
    )

    overdue = 0

    for row in rows:
        if row.get("status") in (
            "resolved",
            "closed",
        ):
            continue

        severity = str(
            row.get("severity") or "medium"
        )

        incident_date = _parse_datetime(
            row.get("incident_date")
        )

        if not incident_date:
            continue

        threshold = timedelta(
            hours=NDIS_NOTIFICATION_HOURS.get(
                severity,
                240,
            )
        )

        if now > incident_date + threshold:
            overdue += 1

    return {
        "total": total,
        "open": open_count,
        "ndis_pending": ndis_pending,
        "overdue": overdue,
        "critical": critical_count,
    }


# ---------------------------------------------------------------------------
# Reportability override (coordinator correction to the classification engine)
# ---------------------------------------------------------------------------

async def set_reportable_override(
    incident_id: str,
    is_reportable: bool,
    reason: str,
    overridden_by: str,
) -> dict[str, Any]:
    """Set once. The spec requires the reason be 'retained permanently... not editable
    afterward' — enforced here by refusing a second override rather than a DB trigger,
    since (unlike the medication ledger) the rest of this row stays mutable."""
    supabase = get_supabase_admin()
    existing_result = supabase.table(TABLE).select("id, ndis_reportable_override").eq("id", incident_id).execute()
    existing_rows = _safe_rows(existing_result.data)
    if not existing_rows:
        raise ValueError("Incident not found.")
    if existing_rows[0].get("ndis_reportable_override") is not None:
        raise ValueError("This incident's reportability has already been overridden and cannot be changed again.")

    update_payload = {
        "ndis_reportable_override": is_reportable,
        "ndis_reportable_override_reason": reason.strip(),
        "ndis_reportable_override_by": overridden_by,
        "ndis_reportable_override_at": datetime.now(timezone.utc).isoformat(),
    }
    result = supabase.table(TABLE).update(update_payload).eq("id", incident_id).execute()
    rows = _safe_rows(result.data)
    return rows[0] if rows else update_payload


# ---------------------------------------------------------------------------
# Subject of allegation — stored separately from any personnel-file view (RLS + service
# scoping, not a UI convention), per the Commission's explicit separation requirement.
# ---------------------------------------------------------------------------

async def create_subject_of_allegation(
    incident_id: str,
    organization_id: str,
    created_by: str,
    *,
    subject_type: str,
    subject_user_id: Optional[str],
    subject_name: Optional[str],
    subject_role: Optional[str],
    notes: Optional[str],
) -> dict[str, Any]:
    supabase = get_supabase_admin()
    payload = {
        "id": str(uuid.uuid4()),
        "incident_id": incident_id,
        "organization_id": organization_id,
        "subject_type": subject_type,
        "subject_user_id": subject_user_id,
        "subject_name": subject_name,
        "subject_role": subject_role,
        "notes": notes,
        "created_by": created_by,
    }
    try:
        result = supabase.table("incident_subject_of_allegation").insert(payload).execute()
    except Exception as exc:
        if _is_missing_column_error(exc):
            raise ValueError("Subject-of-allegation record is not available yet.") from exc
        raise
    rows = _safe_rows(result.data)
    return rows[0] if rows else payload


async def list_subject_of_allegation(incident_id: str, organization_id: str) -> List[dict[str, Any]]:
    supabase = get_supabase_admin()
    try:
        result = (
            supabase
            .table("incident_subject_of_allegation")
            .select("*")
            .eq("incident_id", incident_id)
            .eq("organization_id", organization_id)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        if _is_missing_column_error(exc):
            return []
        raise
    return _safe_rows(result.data)


# ---------------------------------------------------------------------------
# Investigation workflow — assigned investigator with conflict-of-interest gating,
# plus structured interview records.
# ---------------------------------------------------------------------------

async def assign_investigator(
    incident_id: str,
    organization_id: str,
    investigator_user_id: str,
    assigned_by: str,
) -> dict[str, Any]:
    """Refuses the assignment (rather than silently allowing it) when the candidate
    investigator is the reporter, the record creator, or a listed subject of allegation
    on this incident — the conflict-of-interest check the spec requires."""
    supabase = get_supabase_admin()
    existing_result = supabase.table(TABLE).select("id, user_id, created_by").eq("id", incident_id).execute()
    existing_rows = _safe_rows(existing_result.data)
    if not existing_rows:
        raise ValueError("Incident not found.")
    incident = existing_rows[0]

    if str(incident.get("user_id") or "") == str(investigator_user_id):
        raise ValueError("This person reported the incident and cannot investigate it (conflict of interest).")
    if str(incident.get("created_by") or "") == str(investigator_user_id):
        raise ValueError("This person created the incident record and cannot investigate it (conflict of interest).")

    subjects = await list_subject_of_allegation(incident_id, organization_id)
    if any(str(s.get("subject_user_id") or "") == str(investigator_user_id) for s in subjects):
        raise ValueError("This person is a subject of allegation on this incident and cannot investigate it (conflict of interest).")

    update_payload = {
        "assigned_investigator_id": investigator_user_id,
        "assigned_investigator_by": assigned_by,
        "assigned_investigator_at": datetime.now(timezone.utc).isoformat(),
    }
    result = supabase.table(TABLE).update(update_payload).eq("id", incident_id).execute()
    rows = _safe_rows(result.data)
    return rows[0] if rows else update_payload


async def create_interview(
    incident_id: str,
    organization_id: str,
    interviewed_by: str,
    *,
    interviewee_name: str,
    interviewee_type: str,
    interviewee_user_id: Optional[str],
    interviewed_at: Optional[str],
    notes: Optional[str],
) -> dict[str, Any]:
    supabase = get_supabase_admin()
    payload = {
        "id": str(uuid.uuid4()),
        "incident_id": incident_id,
        "organization_id": organization_id,
        "interviewee_name": interviewee_name,
        "interviewee_type": interviewee_type,
        "interviewee_user_id": interviewee_user_id,
        "interviewed_at": interviewed_at or datetime.now(timezone.utc).isoformat(),
        "notes": notes,
        "interviewed_by": interviewed_by,
    }
    try:
        result = supabase.table("incident_interviews").insert(payload).execute()
    except Exception as exc:
        if _is_missing_column_error(exc):
            raise ValueError("Interview records are not available yet.") from exc
        raise
    rows = _safe_rows(result.data)
    return rows[0] if rows else payload


async def list_interviews(incident_id: str, organization_id: str) -> List[dict[str, Any]]:
    supabase = get_supabase_admin()
    try:
        result = (
            supabase
            .table("incident_interviews")
            .select("*")
            .eq("incident_id", incident_id)
            .eq("organization_id", organization_id)
            .order("interviewed_at", desc=True)
            .execute()
        )
    except Exception as exc:
        if _is_missing_column_error(exc):
            return []
        raise
    return _safe_rows(result.data)
