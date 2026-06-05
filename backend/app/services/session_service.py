from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .supabase_client import get_supabase_admin
from .documentation_normalization_service import normalize_documentation_for_legal_record
from .compliance_engine import COMPLIANCE_BLOCKED_MESSAGE, BLOCKING_TRANSLATION_STATUSES
from ..schemas.session import SessionCreate
from ..core.access import (
    ACCESS_METADATA_FIELDS,
    can_access_session,
    get_user_role,
    get_user_id,
    get_user_organization_id,
    owner_payload,
)

logger = logging.getLogger(__name__)

OPTIONAL_SESSION_COLUMNS = {
    "original_language_input",
    "detected_language",
    "translated_english_note",
    "compliance_input_text",
    "translation_status",
    "translation_provider",
    "translation_confidence",
    "translation_metadata",
    "translation_error",
    "translation_completed_at",
    "legal_record_text",
    "display_notes",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_missing_column_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return (
        "pgrst" in err
        or "does not exist" in err
        or "42703" in err
        or "could not find" in err
        or "column of" in err
    )


def _remove_optional_session_columns(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in payload.items() if k not in OPTIONAL_SESSION_COLUMNS}


def _strip_access_columns(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        k: v
        for k, v in payload.items()
        if k not in ACCESS_METADATA_FIELDS
    }


def _safe_rows(data: Any) -> List[Dict[str, Any]]:
    """Ensure Supabase response data is always a list[dict]."""
    if not isinstance(data, list):
        return []

    return [row for row in data if isinstance(row, dict)]


def _safe_row(data: Any) -> Optional[Dict[str, Any]]:
    """Ensure Supabase response data is a dict."""
    return data if isinstance(data, dict) else None


def _can_access_legacy_session(
    row: Dict[str, Any],
    current_user: Optional[dict],
    patient: Optional[dict] = None,
) -> bool:
    if not current_user:
        return False

    return can_access_session(row, current_user, patient)


def _user_org_or_none(current_user: Optional[dict]) -> Optional[str]:
    if not current_user or not get_user_id(current_user) or not get_user_role(current_user):
        return None
    return get_user_organization_id(current_user)


def _annotate_session_from_participant(
    session: Dict[str, Any],
    participant: Optional[dict],
) -> Dict[str, Any]:
    if not participant:
        return session
    annotated = dict(session)
    if not annotated.get("organization_id") and participant.get("organization_id"):
        annotated["_access_organization_id"] = participant.get("organization_id")
    return annotated


def _fetch_patient_name_map(
    supabase,
    patient_ids: List[str],
) -> Dict[str, Dict[str, Any]]:
    """Batch fetch patient names."""
    if not patient_ids:
        return {}

    try:
        result = (
            supabase.table("patients")
            .select("id, full_name, ndis_number")
            .in_("id", patient_ids)
            .execute()
        )

        rows = _safe_rows(result.data)

        return {
            str(r.get("id")): r
            for r in rows
            if r.get("id")
        }

    except Exception as e:
        logger.warning(f"Could not fetch patient names: {e}")
        return {}


def _normalize(row: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize DB session row."""
    if not isinstance(row, dict):
        return {}

    out = dict(row)

    if "patient_id" in out and "participant_id" not in out:
        out["participant_id"] = out.get("patient_id")

    for field in (
        "tags",
        "goals_addressed",
        "photo_urls",
        "body_markers",
        "goal_progress_notes",
    ):
        value = out.get(field)

        if isinstance(value, str):
            try:
                value = json.loads(value)
            except Exception:
                value = []

        if not isinstance(value, list):
            value = []

        out[field] = value

    ai_insights = out.get("ai_insights")

    if isinstance(ai_insights, str):
        try:
            out["ai_insights"] = json.loads(ai_insights)
        except Exception:
            out["ai_insights"] = {}

    if out.get("status") is None:
        out["status"] = "draft"

    legal_record_text = (
        out.get("translated_english_note")
        or out.get("compliance_input_text")
        or ""
    )
    out["legal_record_text"] = legal_record_text
    out["display_notes"] = legal_record_text

    return out


def _prepare_session_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    """Prepare payload for Supabase."""
    out = dict(data)

    if out.get("session_date"):
        out["session_date"] = str(out["session_date"])

    for field in (
        "tags",
        "goals_addressed",
        "photo_urls",
        "body_markers",
        "goal_progress_notes",
    ):
        if field in out and isinstance(out[field], list):
            out[field] = json.dumps(out[field])

    if "participant_id" in out:
        out["patient_id"] = out.pop("participant_id")

    return out


def _build_legal_source_text(
    data: Dict[str, Any],
    existing: Optional[Dict[str, Any]] = None,
) -> str:
    source = {**(existing or {}), **data}
    structured_parts = [
        source.get("activities_performed") or "",
        source.get("outcomes") or "",
        source.get("participant_response") or "",
        source.get("progress_toward_goals") or "",
    ]
    structured_text = "\n".join(part.strip() for part in structured_parts if str(part).strip())
    notes = str(source.get("notes") or "").strip()
    if structured_text and notes:
        return f"{structured_text}\n\n{notes}".strip()
    return structured_text or notes


async def _apply_legal_record_normalization(
    payload: Dict[str, Any],
    source_data: Dict[str, Any],
    current_user: Optional[dict],
    session_id: Optional[str],
    existing: Optional[Dict[str, Any]] = None,
) -> None:
    effective_status = source_data.get("status") or (existing or {}).get("status")
    should_normalize = (
        effective_status == "completed"
        or bool(source_data.get("notes"))
        or any(
            source_data.get(field)
            for field in (
                "activities_performed",
                "outcomes",
                "participant_response",
                "progress_toward_goals",
                "transcription",
            )
        )
    )
    if not should_normalize:
        return

    source_text = _build_legal_source_text(source_data, existing)
    requested_language = (
        source_data.get("input_language")
        or source_data.get("detected_language")
        or (existing or {}).get("input_language")
        or (existing or {}).get("detected_language")
    )
    normalized = await normalize_documentation_for_legal_record(
        source_text=source_text,
        requested_language=requested_language,
        user=current_user,
        session_id=session_id,
    )

    payload.update(normalized)
    if normalized.get("translation_status") in {"translated", "not_required", "manually_confirmed"}:
        payload["translation_completed_at"] = datetime.now(timezone.utc).isoformat()

    if (
        effective_status == "completed"
        and normalized.get("translation_status") in BLOCKING_TRANSLATION_STATUSES
    ):
        raise ValueError(COMPLIANCE_BLOCKED_MESSAGE)


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------

async def get_sessions_by_participant(
    participant_id: str,
    current_user: Optional[dict] = None,
) -> List[Dict[str, Any]]:
    org_id = _user_org_or_none(current_user)
    if not org_id:
        return []

    supabase = get_supabase_admin()

    from . import participant_service

    participant = await participant_service.get_participant_by_id(
        participant_id,
        current_user,
    )

    if not participant:
        return []

    try:
        query = (
            supabase.table("sessions")
            .select("*")
            .eq("patient_id", participant_id)
            .eq("organization_id", org_id)
            .order("session_date", desc=True)
        )
        result = query.execute()
    except Exception as exc:
        if _is_missing_column_error(exc):
            logger.warning("Session access metadata missing; participant sessions failed closed")
            return []
        raise

    rows = [
        _annotate_session_from_participant(row, participant)
        for row in _safe_rows(result.data)
    ]

    rows = [
        row
        for row in rows
        if _can_access_legacy_session(row, current_user, participant)
    ]

    return [_normalize(r) for r in rows]


async def get_all_sessions(
    limit: int = 50,
    current_user: Optional[dict] = None,
) -> List[Dict[str, Any]]:
    org_id = _user_org_or_none(current_user)
    if not org_id:
        return []

    supabase = get_supabase_admin()

    try:
        result = (
            supabase.table("sessions")
            .select("*")
            .eq("organization_id", org_id)
            .order("session_date", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as exc:
        if _is_missing_column_error(exc):
            logger.warning("Session access metadata missing; list failed closed")
            return []
        raise

    sessions = _safe_rows(result.data)

    patient_ids = list({
        str(s.get("patient_id"))
        for s in sessions
        if s.get("patient_id")
    })

    name_map = _fetch_patient_name_map(supabase, patient_ids)

    participant_access_map: Dict[str, Dict[str, Any]] = {}

    from . import participant_service

    participants = await participant_service.get_all_participants(
        current_user
    )

    participant_access_map = {
        str(p["id"]): p
        for p in participants
        if p.get("id")
    }

    output: List[Dict[str, Any]] = []

    for session in sessions:
        patient = (
            participant_access_map.get(
                str(session.get("patient_id", ""))
            )
            if current_user
            else None
        )

        scoped_session = _annotate_session_from_participant(session, patient)

        if not _can_access_legacy_session(
            scoped_session,
            current_user,
            patient,
        ):
            continue

        row = _normalize(scoped_session)

        patient_info = name_map.get(
            str(session.get("patient_id", "")),
            {},
        )

        row["participants"] = {
            "full_name": patient_info.get("full_name", ""),
            "ndis_number": patient_info.get("ndis_number", ""),
        }

        output.append(row)

    return output


async def get_session_by_id(
    session_id: str,
    current_user: Optional[dict] = None,
) -> Optional[Dict[str, Any]]:
    org_id = _user_org_or_none(current_user)
    if not org_id:
        return None

    supabase = get_supabase_admin()

    try:
        result = (
            supabase.table("sessions")
            .select("*")
            .eq("id", session_id)
            .single()
            .execute()
        )
    except Exception as exc:
        if _is_missing_column_error(exc):
            logger.warning("Session access metadata missing; detail failed closed")
            return None
        raise

    raw = _safe_row(result.data)

    if not raw:
        return None

    participant = None

    patient_id = raw.get("patient_id")

    if patient_id:
        from . import participant_service

        participant = await participant_service.get_participant_by_id(
            str(patient_id),
            current_user,
        )

    scoped_raw = _annotate_session_from_participant(raw, participant)

    if not _can_access_legacy_session(
        scoped_raw,
        current_user,
        participant,
    ):
        return None

    row = _normalize(scoped_raw)

    if patient_id:
        name_map = _fetch_patient_name_map(
            supabase,
            [str(patient_id)],
        )

        patient = name_map.get(str(patient_id), {})

        row["participants"] = {
            "full_name": patient.get("full_name", ""),
            "ndis_number": patient.get("ndis_number", ""),
        }

    return row


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

async def create_session(
    data: SessionCreate,
    current_user: Optional[dict] = None,
) -> Dict[str, Any]:
    org_id = _user_org_or_none(current_user)
    if not org_id:
        raise PermissionError("Authenticated organization membership is required")

    supabase = get_supabase_admin()

    payload = data.model_dump(exclude_none=True)

    await _apply_legal_record_normalization(
        payload,
        payload,
        current_user,
        None,
    )

    payload = _prepare_session_payload(payload)

    participant_id = payload.get("patient_id")

    if participant_id:
        from . import participant_service

        participant = await participant_service.get_participant_by_id(
            str(participant_id),
            current_user,
        )

        if not participant:
            raise PermissionError(
                "Participant not found or inaccessible"
            )

    ownership = owner_payload(current_user)

    for key in (
        "created_by",
        "owner_user_id",
        "organization_id",
        "worker_id",
        "practitioner_id",
    ):
        if key in ownership:
            payload[key] = ownership[key]

    try:
        result = (
            supabase.table("sessions")
            .insert(payload)
            .execute()
        )
    except Exception as exc:
        if _is_missing_column_error(exc):
            logger.warning(
                "Session table missing optional columns; retrying insert without optional metadata"
            )
            result = (
                supabase.table("sessions")
                .insert(_remove_optional_session_columns(payload))
                .execute()
            )
        else:
            raise

    rows = _safe_rows(result.data)

    if not rows:
        return {}

    return _normalize(rows[0])


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

async def update_session(
    session_id: str,
    data: Dict[str, Any],
    current_user: Optional[dict] = None,
) -> Optional[Dict[str, Any]]:
    org_id = _user_org_or_none(current_user)
    if not org_id:
        return None

    supabase = get_supabase_admin()

    existing = await get_session_by_id(
        session_id,
        current_user,
    )

    if current_user and not existing:
        return None

    payload = _prepare_session_payload(data)
    await _apply_legal_record_normalization(
        payload,
        data,
        current_user,
        session_id,
        existing,
    )

    try:
        result = (
            supabase.table("sessions")
            .update(payload)
            .eq("id", session_id)
            .eq("organization_id", org_id)
            .execute()
        )
    except Exception as e:
        if _is_missing_column_error(e):
            logger.warning(
                "Session table missing optional columns; retrying update without optional metadata"
            )
            result = (
                supabase.table("sessions")
                .update(_remove_optional_session_columns(payload))
                .eq("id", session_id)
                .eq("organization_id", org_id)
                .execute()
            )
        else:
            logger.error(f"Failed to update session: {e}")
            raise

    rows = _safe_rows(result.data)

    if not rows:
        return None

    return _normalize(rows[0])


# ---------------------------------------------------------------------------
# Recent
# ---------------------------------------------------------------------------

async def get_recent_sessions(
    limit: int = 10,
    current_user: Optional[dict] = None,
) -> List[Dict[str, Any]]:
    org_id = _user_org_or_none(current_user)
    if not org_id:
        return []

    supabase = get_supabase_admin()

    try:
        result = (
            supabase.table("sessions")
            .select("*")
            .eq("organization_id", org_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as exc:
        if _is_missing_column_error(exc):
            logger.warning("Session access metadata missing; recent failed closed")
            return []
        raise

    sessions = _safe_rows(result.data)

    patient_ids = list({
        str(s.get("patient_id"))
        for s in sessions
        if s.get("patient_id")
    })

    name_map = _fetch_patient_name_map(
        supabase,
        patient_ids,
    )

    output: List[Dict[str, Any]] = []

    from . import participant_service
    participants = await participant_service.get_all_participants(current_user)
    participant_access_map = {
        str(p["id"]): p
        for p in participants
        if p.get("id")
    }

    for session in sessions:
        participant = participant_access_map.get(str(session.get("patient_id", "")))
        scoped_session = _annotate_session_from_participant(session, participant)
        if not _can_access_legacy_session(scoped_session, current_user, participant):
            continue

        row = _normalize(scoped_session)

        patient = name_map.get(
            str(session.get("patient_id", "")),
            {},
        )

        row["participants"] = {
            "full_name": patient.get("full_name", ""),
            "ndis_number": patient.get("ndis_number", ""),
        }

        output.append(row)

    return output


async def get_compliance_report(
    current_user: Optional[dict] = None,
    limit: int = 500,
) -> List[Dict[str, Any]]:
    """Return sessions visible to the user for compliance/reporting views."""
    sessions = await get_all_sessions(limit, current_user)
    report: List[Dict[str, Any]] = []

    for session in sessions:
        legal_note = (
            session.get("translated_english_note")
            or session.get("compliance_input_text")
            or ""
        )
        report.append(
            {
                **session,
                "session_id": session.get("id"),
                "notes": legal_note,
                "legal_record_text": legal_note,
                "participant_name": (session.get("participants") or {}).get("full_name"),
                "participant_ndis": (session.get("participants") or {}).get("ndis_number"),
            }
        )

    return report
