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


async def get_all_sessions(limit: int = 50) -> List[dict]:
    supabase = get_supabase_admin()
    result = supabase.table("sessions").select("*").order("session_date", desc=True).limit(limit).execute()
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


async def create_session(data: SessionCreate) -> dict:
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

    result = supabase.table("sessions").insert(payload).execute()
    return _normalize(result.data[0]) if result.data else {}


async def update_session(session_id: str, data: dict) -> Optional[dict]:
    supabase = get_supabase_admin()
    if "session_date" in data and data["session_date"]:
        data["session_date"] = str(data["session_date"])
    if "tags" in data and isinstance(data["tags"], list):
        data["tags"] = json.dumps(data["tags"])
    if "goals_addressed" in data and isinstance(data["goals_addressed"], list):
        data["goals_addressed"] = json.dumps(data["goals_addressed"])
    if "photo_urls" in data and isinstance(data["photo_urls"], list):
        data["photo_urls"] = json.dumps(data["photo_urls"])

    if "participant_id" in data:
        data["patient_id"] = data.pop("participant_id")

    result = supabase.table("sessions").update(data).eq("id", session_id).execute()
    return _normalize(result.data[0]) if result.data else None


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
    for field in ["tags", "goals_addressed", "photo_urls", "ai_insights"]:
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
