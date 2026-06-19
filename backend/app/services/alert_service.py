from typing import List, Optional
from .supabase_client import get_supabase_admin
from ..schemas.alert import AlertCreate
import logging

logger = logging.getLogger(__name__)

TABLE = "alerts"


async def get_all_alerts(
    org_id: Optional[str] = None,
    limit: int = 50,
    *,
    user_id: Optional[str] = None,
    org_wide: bool = False,
) -> List[dict]:
    supabase = get_supabase_admin()
    try:
        query = supabase.table(TABLE).select("*, patients(full_name)").order("created_at", desc=True).limit(limit)
        if org_id:
            query = query.eq("organization_id", org_id)
        if user_id and not org_wide:
            query = query.eq("recipient_user_id", user_id)
        result = query.execute()
        return [_normalize(r) for r in (result.data or [])]
    except Exception as e:
        logger.warning(f"alerts table not available: {e}")
        return []


async def get_unread_alerts(
    org_id: Optional[str] = None,
    *,
    user_id: Optional[str] = None,
    org_wide: bool = False,
) -> List[dict]:
    supabase = get_supabase_admin()
    try:
        query = supabase.table(TABLE).select("*, patients(full_name)").eq("is_read", "false").order("created_at", desc=True)
        if org_id:
            query = query.eq("organization_id", org_id)
        if user_id and not org_wide:
            query = query.eq("recipient_user_id", user_id)
        result = query.execute()
        return [_normalize(r) for r in (result.data or [])]
    except Exception as e:
        logger.warning(f"alerts table not available: {e}")
        return []


async def create_alert(data: AlertCreate, org_id: Optional[str] = None) -> dict:
    supabase = get_supabase_admin()
    payload = data.model_dump(exclude_none=True)
    if "participant_id" in payload:
        payload["patient_id"] = payload.pop("participant_id")
    if org_id:
        payload["organization_id"] = org_id
    result = supabase.table(TABLE).insert(payload).execute()
    return result.data[0] if result.data else {}


async def mark_alert_read(alert_id: str, org_id: Optional[str] = None) -> Optional[dict]:
    supabase = get_supabase_admin()
    query = supabase.table(TABLE).update({"is_read": True}).eq("id", alert_id)
    if org_id:
        query = query.eq("organization_id", org_id)
    result = query.execute()
    return result.data[0] if result.data else None


async def mark_all_read(org_id: Optional[str] = None) -> bool:
    supabase = get_supabase_admin()
    query = supabase.table(TABLE).update({"is_read": True}).eq("is_read", "false")
    if org_id:
        query = query.eq("organization_id", org_id)
    query.execute()
    return True


def _normalize(row: dict) -> dict:
    if not row:
        return row
    out = dict(row)
    patient = out.pop("patients", None)
    if patient and isinstance(patient, dict):
        out["participant_name"] = patient.get("full_name", "")
    if "patient_id" in out and "participant_id" not in out:
        out["participant_id"] = out.get("patient_id")
    return out
