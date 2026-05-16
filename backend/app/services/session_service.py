from typing import List, Optional
from .supabase_client import get_supabase_admin
from ..schemas.session import SessionCreate, SessionUpdate
import logging
import json

logger = logging.getLogger(__name__)


def _fetch_patient_name_map(supabase, patient_ids: List[str]) -> dict:
    """Batch-fetch patient names by IDs, returns {patient_id: full_name}."""
    if not patient_ids:
        return {}
    try:
        result = supabase.table("patients").select("id, full_name, ndis_number").in_("id", patient_ids).execute()
        return {r["id"]: r for r in (result.data or [])}
    except Exception as e:
        logger.warning(f"Could not fetch patient names: {e}")
        return {}


async def get_sessions_by_participant(participant_id: str) -> List[dict]:
    supabase = get_supabase_admin()
    result = supabase.table("sessions").select("*").eq("patient_id", participant_id).order("session_date", desc=True).execute()
    return [_normalize(r) for r in (result.data or [])]


async def get_all_sessions(limit: int = 50, org_id: Optional[str] = None) -> List[dict]:
    supabase = get_supabase_admin()
    q = supabase.table("sessions").select("*").order("session_date", desc=True).limit(limit)
    if org_id:
        q = q.eq("organization_id", org_id)
    sessions = q.execute().data or []

    patient_ids = list({s["patient_id"] for s in sessions if s.get("patient_id")})
    name_map = _fetch_patient_name_map(supabase, patient_ids)

    out = []
    for s in sessions:
        row = _normalize(s)
        patient = name_map.get(s.get("patient_id") or "", {})
        row["participants"] = {
            "full_name": patient.get("full_name", ""),
            "ndis_number": patient.get("ndis_number", ""),
        } if patient else None
        out.append(row)
    return out


async def get_session_by_id(session_id: str) -> Optional[dict]:
    supabase = get_supabase_admin()
    result = supabase.table("sessions").select("*").eq("id", session_id).single().execute()
    if not result.data:
        return None
    row = _normalize(result.data)
    pid = result.data.get("patient_id")
    if pid:
        name_map = _fetch_patient_name_map(supabase, [pid])
        patient = name_map.get(pid, {})
        row["participants"] = {
            "full_name": patient.get("full_name", ""),
            "ndis_number": patient.get("ndis_number", ""),
        }
    return row


async def create_session(data: SessionCreate, org_id: Optional[str] = None) -> dict:
    supabase = get_supabase_admin()
    payload = data.model_dump(exclude_none=True)
    if "session_date" in payload and payload["session_date"]:
        payload["session_date"] = str(payload["session_date"])
    if "tags" in payload and isinstance(payload["tags"], list):
        payload["tags"] = json.dumps(payload["tags"])
    if "goals_addressed" in payload and isinstance(payload["goals_addressed"], list):
        payload["goals_addressed"] = json.dumps(payload["goals_addressed"])

    participant_id = payload.pop("participant_id", None)
    if participant_id:
        payload["patient_id"] = participant_id

    if org_id:
        payload["organization_id"] = org_id

    result = supabase.table("sessions").insert(payload).execute()
    return _normalize(result.data[0]) if result.data else {}


def _prepare_session_payload(data: dict) -> dict:
    """Normalise a session data dict for Supabase (shared by create + update)."""
    out = dict(data)
    if "session_date" in out and out["session_date"]:
        out["session_date"] = str(out["session_date"])
    for list_field in ("tags", "goals_addressed", "photo_urls", "body_markers"):
        if list_field in out and isinstance(out[list_field], list):
            out[list_field] = json.dumps(out[list_field])
    if "participant_id" in out:
        out["patient_id"] = out.pop("participant_id")
    return out


async def update_session(session_id: str, data: dict) -> Optional[dict]:
    supabase = get_supabase_admin()

    # Extract clinical data fields.
    # structured_notes dict → also expand into individual DB columns for search/reporting.
    # activity_log → merged into ai_insights for audit persistence.
    clinical_structured_notes = data.pop("structured_notes", None)
    clinical_activity_log = data.pop("activity_log", None)

    # Expand camelCase structured_notes dict into snake_case DB columns
    if isinstance(clinical_structured_notes, dict):
        mapping = {
            "activitiesPerformed": "activities_performed",
            "outcomes": "outcomes",
            "participantResponse": "participant_response",
            "progressTowardGoals": "progress_toward_goals",
        }
        for camel, snake in mapping.items():
            val = clinical_structured_notes.get(camel)
            if val is not None and snake not in data:
                data[snake] = val

    if clinical_structured_notes is not None or clinical_activity_log is not None:
        try:
            existing_row = supabase.table("sessions").select("ai_insights").eq("id", session_id).single().execute()
            existing_ai: dict = {}
            if existing_row.data:
                raw_ai = existing_row.data.get("ai_insights") or {}
                if isinstance(raw_ai, str):
                    try:
                        raw_ai = json.loads(raw_ai)
                    except Exception:
                        raw_ai = {}
                if isinstance(raw_ai, dict):
                    existing_ai = raw_ai
        except Exception:
            existing_ai = {}

        if clinical_structured_notes is not None:
            existing_ai["structured_notes"] = clinical_structured_notes
        if clinical_activity_log is not None:
            existing_ai["activity_log"] = clinical_activity_log
        data["ai_insights"] = json.dumps(existing_ai)

    payload = _prepare_session_payload(data)

    # Structured note columns — strip from payload if they are not yet in the DB
    # (migration not yet applied). Data is still preserved in ai_insights.
    _STRUCTURED_COLS = {"activities_performed", "outcomes", "participant_response", "progress_toward_goals"}

    try:
        result = supabase.table("sessions").update(payload).eq("id", session_id).execute()
        if result.data:
            return _normalize(result.data[0])
        # Supabase UPDATE returns empty data when 0 rows matched (not an error)
        return None
    except Exception as e:
        err_str = str(e)
        # If the error is about our new structured note columns not existing,
        # retry without them — data is already preserved in ai_insights.
        # PostgREST returns PGRST204 when a column is missing from its schema cache;
        # PostgreSQL itself returns 42703 for "column does not exist".
        if any(col in err_str for col in _STRUCTURED_COLS) and (
            "42703" in err_str or "does not exist" in err_str or "PGRST204" in err_str
        ):
            logger.warning(
                "Structured note columns not yet in DB schema — retrying without them. "
                "Run backend/supabase_setup.sql in your Supabase SQL editor to add them."
            )
            fallback_payload = {k: v for k, v in payload.items() if k not in _STRUCTURED_COLS}
            try:
                result = supabase.table("sessions").update(fallback_payload).eq("id", session_id).execute()
                if result.data:
                    return _normalize(result.data[0])
                # If update returned no rows, fall through to delete-insert below
            except Exception as retry_e:
                retry_str = str(retry_e)
                if "updated_at" in retry_str or "42703" in retry_str:
                    # Trigger workaround for the fallback path too
                    logger.warning(f"UPDATE trigger error on fallback for session {session_id}. Using delete-insert.")
                    existing_result = supabase.table("sessions").select("*").eq("id", session_id).execute()
                    if not existing_result.data:
                        return None
                    existing = existing_result.data[0]
                    merged = {k: v for k, v in {**existing, **fallback_payload}.items() if k != "created_at"}
                    supabase.table("sessions").delete().eq("id", session_id).execute()
                    insert_result = supabase.table("sessions").insert(merged).execute()
                    return _normalize(insert_result.data[0]) if insert_result.data else None
                raise retry_e
            return None
        # Workaround: a Postgres trigger on sessions references NEW.updated_at which
        # does not exist as a column.  We cannot DROP the trigger via PostgREST, so
        # fall back to a READ → MERGE → DELETE → INSERT approach that avoids any
        # BEFORE UPDATE trigger while preserving all existing data.
        if "updated_at" in err_str or "42703" in err_str:
            logger.warning(
                f"UPDATE trigger error for session {session_id} ({e}). "
                "Falling back to delete-insert workaround."
            )
            try:
                existing_result = supabase.table("sessions").select("*").eq("id", session_id).execute()
                if not existing_result.data:
                    logger.error(f"Session {session_id} not found during fallback read.")
                    return None
                existing = existing_result.data[0]
                merged = {**existing, **payload}
                # Remove auto-managed columns so the INSERT doesn't conflict
                for col in ("created_at",):
                    merged.pop(col, None)
                # Delete the existing row
                supabase.table("sessions").delete().eq("id", session_id).execute()
                # Re-insert with merged data (preserving the original id)
                insert_result = supabase.table("sessions").insert(merged).execute()
                return _normalize(insert_result.data[0]) if insert_result.data else None
            except Exception as inner_e:
                logger.error(f"Fallback delete-insert also failed for session {session_id}: {inner_e}")
                raise inner_e
        raise


async def get_recent_sessions(limit: int = 10) -> List[dict]:
    supabase = get_supabase_admin()
    result = supabase.table("sessions").select("*").order("created_at", desc=True).limit(limit).execute()
    sessions = result.data or []

    patient_ids = list({s["patient_id"] for s in sessions if s.get("patient_id")})
    name_map = _fetch_patient_name_map(supabase, patient_ids)

    out = []
    for s in sessions:
        row = _normalize(s)
        patient = name_map.get(s.get("patient_id") or "", {})
        row["participants"] = {
            "full_name": patient.get("full_name", ""),
            "ndis_number": patient.get("ndis_number", ""),
        } if patient else None
        out.append(row)
    return out


async def get_compliance_report() -> List[dict]:
    supabase = get_supabase_admin()
    result = supabase.table("sessions").select("*").order("session_date", desc=True).limit(100).execute()
    sessions = result.data or []

    patient_ids = list({s["patient_id"] for s in sessions if s.get("patient_id")})
    name_map = _fetch_patient_name_map(supabase, patient_ids)

    report = []
    for s in sessions:
        patient = name_map.get(s.get("patient_id") or "", {})
        participant_name = patient.get("full_name", "Unknown")
        score = s.get("compliance_score", 0) or 0
        notes = s.get("notes") or ""
        goals = s.get("goals_addressed") or ""
        if isinstance(goals, str):
            try:
                goals_list = json.loads(goals)
            except Exception:
                goals_list = []
        else:
            goals_list = goals if isinstance(goals, list) else []

        checks = {
            "notes_present": bool(notes and len(notes) > 20),
            "duration_recorded": bool(s.get("duration_minutes", 0) > 0),
            "goals_linked": bool(goals_list),
            "session_type_set": bool(s.get("session_type")),
        }
        report.append({
            "session_id": s["id"],
            "participant_name": participant_name,
            "participant_id": s.get("patient_id"),
            "session_date": s.get("session_date"),
            "session_type": s.get("session_type"),
            "duration_minutes": s.get("duration_minutes", 0),
            "notes_length": len(notes),
            "goals_linked": checks["goals_linked"],
            "compliance_score": score,
            "compliance_status": s.get("compliance_status", "draft"),
            "checks": checks,
            "status": s.get("status", "draft"),
        })

    return report


def _normalize(row: dict) -> dict:
    if not row:
        return row
    out = dict(row)
    if "patient_id" in out and "participant_id" not in out:
        out["participant_id"] = out.get("patient_id")
    for field in ["tags", "goals_addressed", "photo_urls", "ai_insights", "body_markers"]:
        val = out.get(field)
        if isinstance(val, str):
            try:
                out[field] = json.loads(val)
            except Exception:
                out[field] = []
        if not isinstance(out.get(field), (list, dict)) and field != "ai_insights":
            out[field] = []
    if out.get("status") is None:
        out["status"] = "draft"
    return out
