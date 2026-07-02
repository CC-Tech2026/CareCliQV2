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
    has_org_wide_access,
    is_support_worker,
    owner_payload,
    record_assigned_to_user,
    record_belongs_to_user_org,
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
    "progress_delta",
    "shift_id",
}

LEGAL_RECORD_COLUMNS = {
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


async def _filter_sessions_for_user(
    sessions: List[Dict[str, Any]],
    current_user: Optional[dict],
) -> List[Dict[str, Any]]:
    """Filter session rows without loading the full participant catalog."""
    if not current_user:
        return []

    if has_org_wide_access(current_user):
        return [
            session
            for session in sessions
            if record_belongs_to_user_org(session, current_user)
        ]

    accessible: List[Dict[str, Any]] = []
    needs_participant: List[Dict[str, Any]] = []

    for session in sessions:
        if not record_belongs_to_user_org(session, current_user):
            continue
        if record_assigned_to_user(session, current_user, is_session=True):
            accessible.append(session)
        elif not is_support_worker(current_user):
            needs_participant.append(session)

    if not needs_participant:
        return accessible

    from . import participant_service

    patient_ids = list({
        str(session.get("patient_id") or session.get("participant_id"))
        for session in needs_participant
        if session.get("patient_id") or session.get("participant_id")
    })
    stub_map = await participant_service.get_participant_access_stubs(
        current_user,
        patient_ids,
    )

    for session in needs_participant:
        patient_id = str(session.get("patient_id") or session.get("participant_id") or "")
        participant = stub_map.get(patient_id)
        scoped_session = _annotate_session_from_participant(session, participant)
        if _can_access_legacy_session(scoped_session, current_user, participant):
            accessible.append(session)

    return accessible


_DASHBOARD_SESSION_COLUMNS = (
    "id, organization_id, patient_id, participant_id, worker_id, support_worker_id, "
    "owner_user_id, created_by, session_date, session_type, duration_minutes, status, "
    "compliance_score, translation_status, compliance_input_text, translated_english_note, notes"
)


async def get_sessions_for_dashboard(
    limit: int = 200,
    current_user: Optional[dict] = None,
) -> List[Dict[str, Any]]:
    """Lightweight session rows for dashboard aggregation (no full participant load)."""
    org_id = _user_org_or_none(current_user)
    if not org_id:
        return []

    supabase = get_supabase_admin()

    try:
        result = (
            supabase.table("sessions")
            .select(_DASHBOARD_SESSION_COLUMNS)
            .eq("organization_id", org_id)
            .order("session_date", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as exc:
        if _is_missing_column_error(exc):
            logger.warning("Dashboard session query failed closed: %s", exc)
            return []
        raise

    sessions = await _filter_sessions_for_user(_safe_rows(result.data), current_user)
    if not sessions:
        return []

    patient_ids = list({
        str(s.get("patient_id") or s.get("participant_id"))
        for s in sessions
        if s.get("patient_id") or s.get("participant_id")
    })
    name_map = _fetch_patient_name_map(supabase, patient_ids)

    output: List[Dict[str, Any]] = []
    for session in sessions:
        row = _normalize(session)
        patient_info = name_map.get(
            str(session.get("patient_id") or session.get("participant_id") or ""),
            {},
        )
        row["participants"] = {
            "full_name": patient_info.get("full_name", ""),
            "ndis_number": patient_info.get("ndis_number", ""),
        }
        output.append(row)
    return output


async def get_worker_sessions_grouped(
    participant_ids: List[str],
    worker_user_id: str,
    current_user: Optional[dict] = None,
    *,
    limit: int = 500,
    per_participant: int = 50,
) -> Dict[str, List[Dict[str, Any]]]:
    """Batch-fetch a worker's own sessions across participants (my-clients list)."""
    org_id = _user_org_or_none(current_user)
    if not org_id or not worker_user_id:
        return {}

    ids = list({str(pid) for pid in participant_ids if pid})
    if not ids:
        return {}

    supabase = get_supabase_admin()
    worker_id = str(worker_user_id)
    owner_keys = {worker_id}
    grouped: Dict[str, List[Dict[str, Any]]] = {pid: [] for pid in ids}

    try:
        result = (
            supabase.table("sessions")
            .select(_DASHBOARD_SESSION_COLUMNS)
            .eq("organization_id", org_id)
            .in_("patient_id", ids)
            .order("session_date", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as exc:
        if _is_missing_column_error(exc):
            logger.warning("Worker client session batch query failed closed: %s", exc)
            return grouped
        raise

    for row in _safe_rows(result.data):
        pid = str(row.get("patient_id") or row.get("participant_id") or "")
        if pid not in grouped:
            continue
        if len(grouped[pid]) >= per_participant:
            continue
        if str(row.get("worker_id") or "") not in owner_keys and str(
            row.get("support_worker_id") or ""
        ) not in owner_keys and str(row.get("owner_user_id") or "") not in owner_keys and str(
            row.get("created_by") or ""
        ) not in owner_keys:
            continue
        grouped[pid].append(_normalize(row))

    return grouped


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

    progress_delta = out.get("progress_delta")
    if isinstance(progress_delta, str):
        try:
            progress_delta = json.loads(progress_delta)
        except Exception:
            progress_delta = None
    if progress_delta is not None and not isinstance(progress_delta, list):
        progress_delta = [progress_delta] if isinstance(progress_delta, dict) else None
    out["progress_delta"] = progress_delta

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

    if "progress_delta" in out and isinstance(out["progress_delta"], list):
        out["progress_delta"] = json.dumps(out["progress_delta"])

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


def _needs_legal_record_repair(session: Dict[str, Any]) -> bool:
    legal_text = (
        session.get("compliance_input_text")
        or session.get("translated_english_note")
        or ""
    )
    if str(legal_text).strip():
        return False
    return bool(_build_legal_source_text(session).strip())


async def _ensure_legal_record_fields(
    session: Dict[str, Any],
    current_user: Optional[dict],
    session_id: str,
) -> Dict[str, Any]:
    """Backfill English legal-record columns from notes when missing (legacy rows)."""
    if not _needs_legal_record_repair(session):
        return session

    payload: Dict[str, Any] = {}
    try:
        await _apply_legal_record_normalization(
            payload,
            dict(session),
            current_user,
            session_id,
            session,
        )
    except ValueError:
        return session

    legal_text = payload.get("compliance_input_text") or payload.get("translated_english_note")
    if not str(legal_text or "").strip():
        return session
    if payload.get("translation_status") in BLOCKING_TRANSLATION_STATUSES:
        return session

    update_data = {key: payload[key] for key in LEGAL_RECORD_COLUMNS if key in payload}
    if not update_data:
        return session

    supabase = get_supabase_admin()
    try:
        supabase.table("sessions").update(update_data).eq("id", session_id).execute()
    except Exception as exc:
        if _is_missing_column_error(exc):
            logger.warning(
                "Session legal-record repair skipped; optional columns unavailable"
            )
            return session
        raise

    repaired = {**session, **update_data}
    return _normalize(repaired)


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


def _normalize_progress_delta_entries(raw: Any) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return []
    if isinstance(raw, dict):
        return [raw]
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, dict)]
    return []


async def get_prior_progress_sessions(
    participant_id: str,
    goal_ids: list[str],
    exclude_session_id: str | None,
    current_user: Optional[dict],
    limit: int = 5,
) -> dict[str, list[dict[str, Any]]]:
    """Last N completed sessions with progress_delta, keyed by goal_id (CARECLIQV2-79)."""
    sessions = await get_sessions_by_participant(participant_id, current_user)
    completed = [
        s for s in sessions
        if str(s.get("status") or "").lower() == "completed"
        and str(s.get("id") or "") != str(exclude_session_id or "")
        and s.get("progress_delta")
    ]
    completed.sort(key=lambda s: str(s.get("session_date") or ""), reverse=True)

    by_goal: dict[str, list[dict[str, Any]]] = {gid: [] for gid in goal_ids}
    for session in completed:
        session_id = str(session.get("id") or "")
        session_date = str(session.get("session_date") or "")
        goals_in_session = set(str(g) for g in (session.get("goals_addressed") or []))
        for entry in _normalize_progress_delta_entries(session.get("progress_delta")):
            goal_id = str(entry.get("goal_id") or "")
            if goal_ids and goal_id not in goal_ids and goal_id not in goals_in_session:
                continue
            target_goals = [goal_id] if goal_id else list(goal_ids)
            for gid in target_goals:
                if gid not in by_goal:
                    by_goal.setdefault(gid, [])
                if len(by_goal[gid]) >= limit:
                    continue
                by_goal[gid].append({
                    "session_id": session_id,
                    "session_date": session_date,
                    "progress_delta": entry,
                })
    return by_goal


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

    accessible_sessions = await _filter_sessions_for_user(sessions, current_user)

    output: List[Dict[str, Any]] = []

    for session in accessible_sessions:
        row = _normalize(session)

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

    return await _ensure_legal_record_fields(row, current_user, session_id)


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

    accessible_sessions = await _filter_sessions_for_user(sessions, current_user)

    for session in accessible_sessions:
        row = _normalize(session)

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
