from typing import List, Optional
from datetime import datetime, timezone, timedelta
from .supabase_client import get_supabase_admin
from ..schemas.incident import (
    IncidentCreate, IncidentUpdate,
    is_ndis_reportable, PRACTICE_STANDARD_MAP, NDIS_NOTIFICATION_HOURS,
)
import logging

logger = logging.getLogger(__name__)
TABLE = "incidents"


def _enrich(row: dict) -> dict:
    """Add computed fields to an incident row."""
    if not row:
        return row

    itype = row.get("incident_type") or "other"
    severity = row.get("severity") or "medium"

    row["ndis_reportable"] = is_ndis_reportable(itype, severity)
    row["practice_standard"] = PRACTICE_STANDARD_MAP.get(itype, "Standard 2.3 — Incident management")

    # Compute overdue flag
    status = row.get("status") or "reported"
    incident_date_raw = row.get("incident_date")
    if status in ("reported", "under_investigation") and incident_date_raw:
        try:
            incident_date = datetime.fromisoformat(str(incident_date_raw).replace("Z", "+00:00"))
            threshold_hours = NDIS_NOTIFICATION_HOURS.get(severity, 240)
            deadline = incident_date + timedelta(hours=threshold_hours)
            row["overdue"] = datetime.now(timezone.utc) > deadline
        except Exception:
            row["overdue"] = False
    else:
        row["overdue"] = False

    # NDIS notification pending
    row["ndis_pending"] = (
        row["ndis_reportable"] and
        not row.get("ndis_reported_at") and
        status not in ("closed",)
    )

    return row


async def get_all_incidents(
    limit: int = 100,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    participant_id: Optional[str] = None,
    org_id: Optional[str] = None,
    reporter_id: Optional[str] = None,
) -> List[dict]:
    supabase = get_supabase_admin()
    q = supabase.table(TABLE).select("*").order("incident_date", desc=True).limit(limit)
    if status:
        q = q.eq("status", status)
    if severity:
        q = q.eq("severity", severity)
    if participant_id:
        q = q.eq("participant_id", participant_id)
    if org_id:
        q = q.eq("organization_id", org_id)
    if reporter_id:
        q = q.eq("user_id", reporter_id)
    result = q.execute()
    rows = result.data or []

    # Batch-fetch participant names
    pids = list({r.get("participant_id") for r in rows if r.get("participant_id")})
    name_map: dict = {}
    if pids:
        try:
            pr = supabase.table("patients").select("id, full_name").in_("id", pids).execute()
            name_map = {p["id"]: p.get("full_name", "") for p in (pr.data or [])}
        except Exception as e:
            logger.warning(f"Participant name lookup failed: {e}")

    enriched = []
    for r in rows:
        r["participant_name"] = name_map.get(r.get("participant_id") or "", "")
        enriched.append(_enrich(r))
    return enriched


async def get_incident_by_id(incident_id: str) -> Optional[dict]:
    supabase = get_supabase_admin()
    try:
        result = supabase.table(TABLE).select("*").eq("id", incident_id).execute()
        rows = result.data or []
        if not rows:
            return None
        row = rows[0]

        # Fetch participant name
        if row.get("participant_id"):
            try:
                pr = supabase.table("patients").select("full_name, ndis_number").eq("id", row["participant_id"]).execute()
                if pr.data:
                    row["participant_name"] = pr.data[0].get("full_name", "")
                    row["participant_ndis"] = pr.data[0].get("ndis_number", "")
            except Exception:
                pass

        return _enrich(row)
    except Exception as e:
        logger.error(f"get_incident_by_id({incident_id}) failed: {e}")
        return None


async def get_incidents_by_participant(participant_id: str) -> List[dict]:
    return await get_all_incidents(participant_id=participant_id)


async def get_scoped_incidents(
    user: dict,
    limit: int = 100,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    participant_id: Optional[str] = None,
) -> List[dict]:
    role = user.get("role", "")
    org_id = user.get("organization_id")
    uid = user.get("sub")

    if role in ("support_coordinator", "admin"):
        return await get_all_incidents(limit, status, severity, participant_id, org_id=org_id)

    if role not in ("support_worker", "allied_health") or not uid or not org_id:
        return []

    supabase = get_supabase_admin()
    try:
        alloc = (
            supabase.table("practitioner_allocations")
            .select("patient_id")
            .eq("user_id", uid)
            .eq("organization_id", org_id)
            .eq("is_active", True)
            .execute()
        )
        patient_ids = [r["patient_id"] for r in (alloc.data or [])]
    except Exception as exc:
        logger.warning("get_scoped_incidents allocation query failed (%s); denying list", exc)
        return []

    if not patient_ids:
        return []
    if participant_id:
        if participant_id not in patient_ids:
            return []
        patient_ids = [participant_id]

    q = supabase.table(TABLE).select("*").order("incident_date", desc=True).limit(limit)
    if status:
        q = q.eq("status", status)
    if severity:
        q = q.eq("severity", severity)
    q = q.eq("organization_id", org_id).in_("participant_id", patient_ids)
    rows = q.execute().data or []
    return [_enrich(r) for r in rows]


async def create_incident(data: IncidentCreate, org_id: Optional[str] = None) -> dict:
    supabase = get_supabase_admin()
    payload = data.model_dump(exclude_none=True)
    if org_id:
        payload["organization_id"] = org_id

    # Coerce datetimes/dates to strings for PostgREST
    for key in ("incident_date", "follow_up_date"):
        if key in payload and payload[key] is not None:
            payload[key] = str(payload[key])

    # Auto-derive computed fields
    itype = payload.get("incident_type", "other")
    severity = payload.get("severity", "medium")
    payload["ndis_reportable"] = is_ndis_reportable(itype, severity)
    payload["practice_standard"] = PRACTICE_STANDARD_MAP.get(itype, "Standard 2.3 — Incident management")
    payload["status"] = "reported"
    payload["reported_date"] = datetime.now(timezone.utc).isoformat()

    result = supabase.table(TABLE).insert(payload).execute()
    rows = result.data or []
    if not rows:
        raise ValueError("Insert returned no data")
    return _enrich(rows[0])


async def update_incident(incident_id: str, updates: dict) -> Optional[dict]:
    supabase = get_supabase_admin()

    # Coerce dates to strings
    for key in ("incident_date", "resolved_date", "ndis_reported_at", "follow_up_date"):
        if key in updates and updates[key] is not None:
            updates[key] = str(updates[key])

    # If status changes to resolved, auto-set resolved_date
    if updates.get("status") == "resolved" and "resolved_date" not in updates:
        updates["resolved_date"] = datetime.now(timezone.utc).isoformat()

    # Recompute ndis_reportable if type/severity changed
    if "incident_type" in updates or "severity" in updates:
        itype = updates.get("incident_type") or "other"
        severity = updates.get("severity") or "medium"
        updates["ndis_reportable"] = is_ndis_reportable(itype, severity)
        updates["practice_standard"] = PRACTICE_STANDARD_MAP.get(itype, "Standard 2.3 — Incident management")

    try:
        result = supabase.table(TABLE).update(updates).eq("id", incident_id).execute()
        rows = result.data or []
        if not rows:
            return None
        return await get_incident_by_id(incident_id)
    except Exception as e:
        logger.error(f"update_incident({incident_id}) failed: {e}")
        return None


async def get_incident_stats(org_id: Optional[str] = None) -> dict:
    supabase = get_supabase_admin()
    try:
        q = supabase.table(TABLE).select("id, status, severity, ndis_reportable, ndis_reported_at, incident_date")
        if org_id:
            q = q.eq("organization_id", org_id)
        result = q.execute()
        rows = result.data or []
    except Exception as e:
        logger.warning(f"Could not fetch incident stats: {e}")
        return {"total": 0, "open": 0, "ndis_pending": 0, "overdue": 0, "critical": 0}

    now = datetime.now(timezone.utc)
    total = len(rows)
    open_count = sum(1 for r in rows if r.get("status") in ("reported", "under_investigation"))
    critical_count = sum(1 for r in rows if r.get("severity") == "critical")
    ndis_pending = sum(
        1 for r in rows
        if r.get("ndis_reportable") and not r.get("ndis_reported_at") and r.get("status") != "closed"
    )

    overdue = 0
    for r in rows:
        if r.get("status") in ("resolved", "closed"):
            continue
        severity = r.get("severity") or "medium"
        raw_date = r.get("incident_date")
        if raw_date:
            try:
                dt = datetime.fromisoformat(str(raw_date).replace("Z", "+00:00"))
                threshold = timedelta(hours=NDIS_NOTIFICATION_HOURS.get(severity, 240))
                if now > dt + threshold:
                    overdue += 1
            except Exception:
                pass

    return {
        "total": total,
        "open": open_count,
        "ndis_pending": ndis_pending,
        "overdue": overdue,
        "critical": critical_count,
    }
