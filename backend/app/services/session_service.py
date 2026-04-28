from typing import List, Optional
from .supabase_client import get_supabase_admin
from ..schemas.session import SessionCreate, SessionUpdate
import logging
import json

logger = logging.getLogger(__name__)


async def get_sessions_by_participant(participant_id: str) -> List[dict]:
    supabase = get_supabase_admin()
    result = supabase.table("sessions").select("*").eq("patient_id", participant_id).order("session_date", desc=True).execute()
    return [_normalize(r) for r in (result.data or [])]


async def get_all_sessions(limit: int = 50) -> List[dict]:
    supabase = get_supabase_admin()
    result = supabase.table("sessions").select("*, patients(full_name)").order("session_date", desc=True).limit(limit).execute()
    return [_normalize_with_participant(r) for r in (result.data or [])]


async def get_session_by_id(session_id: str) -> Optional[dict]:
    supabase = get_supabase_admin()
    result = supabase.table("sessions").select("*, patients(full_name, ndis_number)").eq("id", session_id).single().execute()
    return _normalize_with_participant(result.data) if result.data else None


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
    result = supabase.table("sessions").select("*, patients(full_name)").order("created_at", desc=True).limit(limit).execute()
    return [_normalize_with_participant(r) for r in (result.data or [])]


async def get_compliance_report() -> List[dict]:
    supabase = get_supabase_admin()
    result = supabase.table("sessions").select("*, patients(full_name)").order("session_date", desc=True).limit(100).execute()
    sessions = result.data or []

    report = []
    for s in sessions:
        patient = s.get("patients") or {}
        participant_name = patient.get("full_name", "Unknown")
        score = s.get("compliance_score", 0) or 0
        checks = {
            "notes_present": bool(s.get("notes") and len(s.get("notes", "")) > 20),
            "duration_recorded": bool(s.get("duration_minutes", 0) > 0),
            "goals_linked": bool(s.get("goals_addressed") and s.get("goals_addressed") != "[]"),
            "session_type_set": bool(s.get("session_type")),
        }
        report.append({
            "session_id": s["id"],
            "participant_name": participant_name,
            "participant_id": s.get("patient_id"),
            "session_date": s.get("session_date"),
            "session_type": s.get("session_type"),
            "compliance_score": score,
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


def _normalize_with_participant(row: dict) -> dict:
    if not row:
        return row
    out = _normalize(row)
    patient = out.pop("patients", None)
    if patient and isinstance(patient, dict):
        out["participant_name"] = patient.get("full_name", "")
        out["participant_ndis"] = patient.get("ndis_number", "")
    return out
