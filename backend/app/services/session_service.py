from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from .supabase_client import get_supabase_admin
from ..schemas.session import SessionCreate
from ..core.access import (
    ACCESS_METADATA_FIELDS,
    can_access_session,
    owner_payload,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_missing_column_error(exc: Exception) -> bool:
    err = str(exc)
    return (
        "PGRST" in err
        or "does not exist" in err
        or "42703" in err
    )


def _strip_access_columns(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        k: v
        for k, v in payload.items()
        if k not in ACCESS_METADATA_FIELDS
    }


def _safe_rows(data: Any) -> List[Dict[str, Any]]:
    if not isinstance(data, list):
        return []
    return [row for row in data if isinstance(row, dict)]


def _safe_row(data: Any) -> Optional[Dict[str, Any]]:
    return data if isinstance(data, dict) else None


def _can_access_legacy_session(
    row: Dict[str, Any],
    current_user: Optional[dict],
    patient: Optional[dict] = None,
) -> bool:
    if not current_user:
        return True
    return can_access_session(row, current_user, patient)


def _fetch_patient_name_map(
    supabase,
    patient_ids: List[str],
) -> Dict[str, Dict[str, Any]]:
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
    if not isinstance(row, dict):
        return {}

    out = dict(row)

    if "patient_id" in out and "participant_id" not in out:
        out["participant_id"] = out.get("patient_id")

    for field in ("tags", "goals_addressed", "photo_urls", "body_markers"):
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

    return out


def _prepare_session_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(data)

    if out.get("session_date"):
        out["session_date"] = str(out["session_date"])

    for field in ("tags", "goals_addressed", "photo_urls", "body_markers"):
        if field in out and isinstance(out[field], list):
            out[field] = json.dumps(out[field])

    if "participant_id" in out:
        out["patient_id"] = out.pop("participant_id")

    return out


# ---------------------------------------------------------------------------
# CORE SESSION FUNCTIONS
# ---------------------------------------------------------------------------

async def get_sessions_by_participant(
    participant_id: str,
    current_user: Optional[dict] = None,
) -> List[Dict[str, Any]]:
    supabase = get_supabase_admin()

    result = (
        supabase.table("sessions")
        .select("*")
        .eq("patient_id", participant_id)
        .order("session_date", desc=True)
        .execute()
    )

    rows = _safe_rows(result.data)

    if current_user:
        from . import participant_service

        participant = await participant_service.get_participant_by_id(
            participant_id,
            current_user,
        )

        if not participant:
            return []

        rows = [
            r for r in rows
            if _can_access_legacy_session(r, current_user, participant)
        ]

    return [_normalize(r) for r in rows]


async def get_all_sessions(
    limit: int = 50,
    current_user: Optional[dict] = None,
) -> List[Dict[str, Any]]:
    supabase = get_supabase_admin()

    result = (
        supabase.table("sessions")
        .select("*")
        .order("session_date", desc=True)
        .limit(limit)
        .execute()
    )

    sessions = _safe_rows(result.data)

    patient_ids = list({
        str(s.get("patient_id"))
        for s in sessions
        if s.get("patient_id")
    })

    name_map = _fetch_patient_name_map(supabase, patient_ids)

    output: List[Dict[str, Any]] = []

    for session in sessions:
        if current_user:
            from . import participant_service

            participant = await participant_service.get_participant_by_id(
                str(session.get("patient_id", "")),
                current_user,
            )

            if not participant:
                continue

        row = _normalize(session)

        patient_info = name_map.get(str(session.get("patient_id", "")), {})

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
    supabase = get_supabase_admin()

    result = (
        supabase.table("sessions")
        .select("*")
        .eq("id", session_id)
        .single()
        .execute()
    )

    raw = _safe_row(result.data)

    if not raw:
        return None

    if current_user:
        from . import participant_service

        participant = None

        patient_id = raw.get("patient_id")

        if patient_id:
            participant = await participant_service.get_participant_by_id(
                str(patient_id),
                current_user,
            )

        if not _can_access_legacy_session(raw, current_user, participant):
            return None

    row = _normalize(raw)

    patient_id = raw.get("patient_id")

    if patient_id:
        name_map = _fetch_patient_name_map(supabase, [str(patient_id)])
        patient = name_map.get(str(patient_id), {})

        row["participants"] = {
            "full_name": patient.get("full_name", ""),
            "ndis_number": patient.get("ndis_number", ""),
        }

    return row


# ---------------------------------------------------------------------------
# CREATE / UPDATE
# ---------------------------------------------------------------------------

async def create_session(
    data: SessionCreate,
    current_user: Optional[dict] = None,
) -> Dict[str, Any]:
    supabase = get_supabase_admin()

    payload = _prepare_session_payload(data.model_dump(exclude_none=True))

    if current_user:
        ownership = owner_payload(current_user)

        for key in ("created_by", "organization_id", "worker_id", "practitioner_id"):
            if key in ownership:
                payload[key] = ownership[key]

    try:
        result = supabase.table("sessions").insert(payload).execute()

    except Exception as exc:
        if not _is_missing_column_error(exc):
            raise

        result = supabase.table("sessions").insert(
            _strip_access_columns(payload)
        ).execute()

    rows = _safe_rows(result.data)

    return _normalize(rows[0]) if rows else {}


async def update_session(
    session_id: str,
    data: Dict[str, Any],
    current_user: Optional[dict] = None,
) -> Optional[Dict[str, Any]]:
    supabase = get_supabase_admin()

    existing = await get_session_by_id(session_id, current_user)

    if current_user and not existing:
        return None

    payload = _prepare_session_payload(data)

    result = (
        supabase.table("sessions")
        .update(payload)
        .eq("id", session_id)
        .execute()
    )

    rows = _safe_rows(result.data)

    return _normalize(rows[0]) if rows else None


async def get_recent_sessions(
    limit: int = 10,
    current_user: Optional[dict] = None,
) -> List[Dict[str, Any]]:
    supabase = get_supabase_admin()

    result = (
        supabase.table("sessions")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )

    sessions = _safe_rows(result.data)

    output = []

    for session in sessions:
        if current_user:
            from . import participant_service

            participant = await participant_service.get_participant_by_id(
                str(session.get("patient_id", "")),
                current_user,
            )

            if not participant:
                continue

        output.append(_normalize(session))

    return output


# ---------------------------------------------------------------------------
# COMPLIANCE REPORT
# ---------------------------------------------------------------------------

async def get_compliance_report() -> Dict[str, Any]:
    supabase = get_supabase_admin()

    result = (
        supabase.table("sessions")
        .select("id, compliance_flags, outcomes, activities_performed, progress_toward_goals")
        .limit(200)
        .execute()
    )

    sessions = _safe_rows(result.data)

    if not sessions:
        return {
            "total_sessions": 0,
            "compliant_sessions": 0,
            "compliance_score": 0.0,
            "flags": [],
        }

    compliant = 0
    flags = []

    for s in sessions:
        has_outcomes = bool(s.get("outcomes"))
        has_notes = bool(
            s.get("activities_performed") or s.get("progress_toward_goals")
        )
        has_flags = bool(s.get("compliance_flags"))

        if has_flags:
            flags.append({
                "session_id": s.get("id"),
                "flags": s.get("compliance_flags"),
            })

        if has_outcomes and has_notes and not has_flags:
            compliant += 1

    total = len(sessions)

    return {
        "total_sessions": total,
        "compliant_sessions": compliant,
        "compliance_score": round((compliant / total) * 100, 2) if total else 0.0,
        "flags": flags,
    }