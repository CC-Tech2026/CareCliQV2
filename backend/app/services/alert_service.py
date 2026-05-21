from typing import List, Optional
from .supabase_client import get_supabase_admin
from ..core import rbac
from ..schemas.alert import AlertCreate
import logging

logger = logging.getLogger(__name__)

TABLE = "alerts"


async def get_all_alerts(limit: int = 50) -> List[dict]:
    supabase = get_supabase_admin()
    try:
        result = supabase.table(TABLE).select("*, patients(full_name)").order("created_at", desc=True).limit(limit).execute()
        return [_normalize(r) for r in (result.data or [])]
    except Exception as e:
        logger.warning(f"alerts table not available: {e}")
        return []


async def get_scoped_alerts(user: dict, limit: int = 50, unread_only: bool = False) -> List[dict]:
    role = rbac.canonical_role(user)
    org_id = rbac.organization_id(user)
    uid = rbac.user_id(user)
    if not role or not org_id:
        return []

    supabase = get_supabase_admin()
    try:
        query = (
            supabase.table(TABLE)
            .select("*, patients(full_name, organization_id)")
            .order("created_at", desc=True)
            .limit(limit)
        )
        if unread_only:
            query = query.eq("is_read", False)
        if role in rbac.COORDINATOR_ROLES:
            result = query.eq("organization_id", org_id).execute()
            return [_normalize(r) for r in (result.data or [])]

        if role not in rbac.ASSIGNED_ACCESS_ROLES or not uid:
            return []

        allocations = (
            supabase.table("practitioner_allocations")
            .select("patient_id")
            .eq("user_id", uid)
            .eq("organization_id", org_id)
            .eq("is_active", True)
            .execute()
        )
        patient_ids = [row.get("patient_id") for row in (allocations.data or []) if row.get("patient_id")]
        if not patient_ids:
            return []
        result = query.eq("organization_id", org_id).in_("patient_id", patient_ids).execute()
        return [_normalize(r) for r in (result.data or [])]
    except Exception as e:
        logger.warning("scoped alerts query failed: %s", e)
        return []


async def get_alert_by_id(alert_id: str) -> Optional[dict]:
    supabase = get_supabase_admin()
    try:
        result = supabase.table(TABLE).select("*, patients(full_name, organization_id)").eq("id", alert_id).maybe_single().execute()
        return _normalize(result.data) if result and result.data else None
    except Exception as e:
        logger.warning("alert lookup failed: %s", e)
        return None


async def can_access_alert(user: dict, alert: Optional[dict]) -> bool:
    if not alert:
        return False
    org_id = alert.get("organization_id") or (alert.get("patients") or {}).get("organization_id")
    if rbac.is_coordinator(user):
        return bool(org_id and str(org_id) == rbac.organization_id(user))
    participant_id = alert.get("participant_id") or alert.get("patient_id")
    if not participant_id:
        return False
    return await rbac.has_active_participant_assignment(user, str(participant_id))


async def get_unread_alerts() -> List[dict]:
    supabase = get_supabase_admin()
    try:
        result = supabase.table(TABLE).select("*, patients(full_name)").eq("is_read", False).order("created_at", desc=True).execute()
        return [_normalize(r) for r in (result.data or [])]
    except Exception as e:
        logger.warning(f"alerts table not available: {e}")
        return []


async def create_alert(data: AlertCreate) -> dict:
    supabase = get_supabase_admin()
    payload = data.model_dump(exclude_none=True)
    if "participant_id" in payload:
        payload["patient_id"] = payload.pop("participant_id")
    result = supabase.table(TABLE).insert(payload).execute()
    return result.data[0] if result.data else {}


async def mark_alert_read(alert_id: str) -> Optional[dict]:
    supabase = get_supabase_admin()
    result = supabase.table(TABLE).update({"is_read": True}).eq("id", alert_id).execute()
    return result.data[0] if result.data else None


async def mark_all_read() -> bool:
    supabase = get_supabase_admin()
    supabase.table(TABLE).update({"is_read": True}).eq("is_read", False).execute()
    return True


async def mark_all_read_for_org(org_id: str) -> bool:
    supabase = get_supabase_admin()
    supabase.table(TABLE).update({"is_read": True}).eq("is_read", False).eq("organization_id", org_id).execute()
    return True


def _normalize(row: dict) -> dict:
    if not row:
        return row
    out = dict(row)
    patient = out.pop("patients", None)
    if patient and isinstance(patient, dict):
        out["participant_name"] = patient.get("full_name", "")
        out.setdefault("organization_id", patient.get("organization_id"))
    if "patient_id" in out and "participant_id" not in out:
        out["participant_id"] = out.get("patient_id")
    return out
