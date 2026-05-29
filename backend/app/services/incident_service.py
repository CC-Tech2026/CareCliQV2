from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import logging

from .supabase_client import get_supabase_admin
from .documentation_normalization_service import normalize_documentation_for_legal_record
from .compliance_engine import BLOCKING_TRANSLATION_STATUSES, COMPLIANCE_BLOCKED_MESSAGE
from ..core.access import can_access_session, is_coordinator_role, user_id
from ..schemas.incident import (
    IncidentCreate,
    IncidentUpdate,
    NDIS_NOTIFICATION_HOURS,
    PRACTICE_STANDARD_MAP,
    is_ndis_reportable,
)

logger = logging.getLogger(__name__)

TABLE = "incidents"
LEGAL_TEXT_FIELDS = (
    "title",
    "description",
    "participant_impact",
    "worker_actions",
    "investigation_notes",
    "corrective_actions",
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

    enriched["overdue"] = overdue

    enriched["ndis_pending"] = bool(
        enriched["ndis_reportable"]
        and not enriched.get("ndis_reported_at")
        and status != "closed"
    )

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

    if org_id:
        query = query.eq("organization_id", org_id)

    if reporter_id:
        query = query.eq("user_id", reporter_id)

    result = query.execute()

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
        exclude_none=True
    )

    await _apply_legal_record_normalization(
        payload,
        payload,
        current_user={"sub": user_id, "organization_id": org_id} if user_id or org_id else None,
    )

    if org_id:
        payload["organization_id"] = org_id
    if user_id:
        payload["user_id"] = user_id
        payload["created_by"] = user_id

    # Convert date fields
    for key in (
        "incident_date",
        "follow_up_date",
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

    result = (
        supabase
        .table(TABLE)
        .insert(payload)
        .execute()
    )

    rows = _safe_rows(result.data)

    if not rows:
        raise ValueError(
            "Incident insert returned no rows"
        )

    return _enrich(rows[0])


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

    try:
        result = (
            supabase
            .table(TABLE)
            .update(payload)
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

        result = query.execute()

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
