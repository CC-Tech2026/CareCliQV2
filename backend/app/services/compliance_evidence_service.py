"""Evidence chain-of-custody helpers — CARECLIQV2-271."""

from __future__ import annotations

import csv
import hashlib
import io
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException

from .object_storage import upload_evidence_bytes
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

DEFAULT_RETENTION_DAYS = 2555  # ~7 years


def parse_device_type(user_agent: Optional[str]) -> str:
    ua = (user_agent or "").lower()
    if not ua:
        return "Unknown"
    if "iphone" in ua or "ipad" in ua:
        return "iOS"
    if "android" in ua:
        return "Android"
    if "mobile" in ua:
        return "Mobile"
    if "windows" in ua:
        return "Windows"
    if "macintosh" in ua or "mac os" in ua:
        return "macOS"
    if "linux" in ua:
        return "Linux"
    return "Desktop"


def get_evidence_retention_days(organization_id: str) -> int:
    try:
        resp = (
            get_supabase_admin()
            .table("organization_data_policies")
            .select("evidence_retention_days")
            .eq("organization_id", organization_id)
            .maybe_single()
            .execute()
        )
        if resp and resp.data:
            return int(resp.data.get("evidence_retention_days") or DEFAULT_RETENTION_DAYS)
    except Exception as exc:
        logger.debug("organization_data_policies lookup failed: %s", exc)
    return DEFAULT_RETENTION_DAYS


def compute_retention_until(shift_date: Optional[date], organization_id: str) -> date:
    base = shift_date or date.today()
    days = get_evidence_retention_days(organization_id)
    return base + timedelta(days=days)


def resolve_shift_id_for_session(session_id: str) -> Optional[str]:
    try:
        resp = (
            get_supabase_admin()
            .table("sessions")
            .select("shift_id")
            .eq("id", session_id)
            .maybe_single()
            .execute()
        )
        if resp and resp.data and resp.data.get("shift_id"):
            return str(resp.data["shift_id"])
    except Exception as exc:
        logger.debug("shift_id lookup for session %s failed: %s", session_id, exc)
    try:
        resp = (
            get_supabase_admin()
            .table("shifts")
            .select("id")
            .eq("session_id", session_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if rows:
            return str(rows[0]["id"])
    except Exception:
        pass
    return None


def resolve_shift_date(shift_id: Optional[str]) -> Optional[date]:
    if not shift_id:
        return None
    try:
        resp = (
            get_supabase_admin()
            .table("shifts")
            .select("scheduled_start, clocked_in_at")
            .eq("id", shift_id)
            .maybe_single()
            .execute()
        )
        if not resp or not resp.data:
            return None
        raw = resp.data.get("clocked_in_at") or resp.data.get("scheduled_start")
        if not raw:
            return None
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00")).date()
    except Exception:
        return None


def _is_missing_table(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg


def _user_name(user_id: str) -> str:
    try:
        resp = (
            get_supabase_admin()
            .table("users")
            .select("full_name, email")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        if resp and resp.data:
            return str(resp.data.get("full_name") or resp.data.get("email") or user_id)
    except Exception:
        pass
    return user_id


def enrich_metadata_row(row: dict[str, Any]) -> dict[str, Any]:
    uploaded_at = row.get("uploaded_at")
    uploaded_by = str(row.get("uploaded_by") or "")
    return {
        **row,
        "uploader_name": _user_name(uploaded_by) if uploaded_by else None,
        "device_type": row.get("device_type") or parse_device_type(row.get("user_agent")),
        "uploaded_at_utc": uploaded_at,
        "uploaded_at_local": uploaded_at,
        "file_hash": row.get("file_hash"),
        "retention_until": row.get("retention_until"),
        "is_deleted": bool(row.get("deleted_at")),
        "is_quarantined": bool(row.get("quarantined_at")),
    }


def list_session_evidence_metadata(
    session_id: str,
    organization_id: str,
    *,
    include_deleted: bool = False,
) -> list[dict[str, Any]]:
    try:
        query = (
            get_supabase_admin()
            .table("task_evidence_metadata")
            .select("*")
            .eq("session_id", session_id)
            .eq("organization_id", organization_id)
            .order("uploaded_at", desc=False)
        )
        if not include_deleted:
            query = query.is_("deleted_at", "null")
        resp = query.execute()
        return [enrich_metadata_row(r) for r in (resp.data or [])]
    except Exception as exc:
        if _is_missing_table(exc):
            return []
        raise


def get_evidence_metadata(evidence_id: str) -> Optional[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("task_evidence_metadata")
            .select("*")
            .eq("evidence_id", evidence_id)
            .maybe_single()
            .execute()
        )
        if resp and resp.data:
            return enrich_metadata_row(resp.data)
    except Exception as exc:
        if _is_missing_table(exc):
            return None
        raise
    return None


def coordinator_delete_evidence(
    evidence_id: str,
    coordinator_id: str,
    organization_id: str,
    reason: str,
) -> dict[str, Any]:
    reason = (reason or "").strip()
    if len(reason) < 3:
        raise ValueError("Deletion reason is required.")

    meta = get_evidence_metadata(evidence_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Evidence not found")
    if str(meta.get("organization_id")) != str(organization_id):
        raise HTTPException(status_code=403, detail="Not authorized")
    if meta.get("deleted_at"):
        raise HTTPException(status_code=409, detail="Evidence already deleted")

    now = datetime.now(timezone.utc).isoformat()
    supabase = get_supabase_admin()

    try:
        supabase.table("evidence_deletion_log").insert({
            "evidence_id": evidence_id,
            "session_id": meta["session_id"],
            "shift_id": meta.get("shift_id"),
            "organization_id": organization_id,
            "deleted_by": coordinator_id,
            "deletion_reason": reason,
            "file_hash": meta.get("file_hash"),
            "deleted_at": now,
        }).execute()
    except Exception as exc:
        if not _is_missing_table(exc):
            logger.warning("evidence_deletion_log insert failed: %s", exc)

    # Soft-delete metadata; quarantine file
    try:
        supabase.table("task_evidence_metadata").update({
            "deleted_at": now,
            "deleted_by": coordinator_id,
            "deletion_reason": reason,
            "quarantined_at": now,
            "quarantine_reason": f"Coordinator deletion: {reason}",
        }).eq("evidence_id", evidence_id).execute()
    except Exception as exc:
        logger.error("Failed to soft-delete evidence metadata: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to delete evidence") from exc

    try:
        supabase.table("evidence_access_audit_log").insert({
            "evidence_id": evidence_id,
            "session_id": meta["session_id"],
            "shift_id": meta.get("shift_id"),
            "organization_id": organization_id,
            "accessed_by": coordinator_id,
            "action": "quarantined",
            "notes": reason,
            "purpose": "coordinator_deletion",
        }).execute()
    except Exception:
        pass

    return {"success": True, "evidence_id": evidence_id, "deleted_at": now}


def export_shift_evidence_audit_csv(
    shift_id: str,
    organization_id: str,
) -> tuple[str, str]:
    """Return (filename, csv_content) for all audit log entries on a shift."""
    try:
        shift_resp = (
            get_supabase_admin()
            .table("shifts")
            .select("id, scheduled_start, organization_id")
            .eq("id", shift_id)
            .maybe_single()
            .execute()
        )
    except Exception as exc:
        if _is_missing_table(exc):
            raise HTTPException(status_code=404, detail="Shift not found") from exc
        raise

    if not shift_resp or not shift_resp.data:
        raise HTTPException(status_code=404, detail="Shift not found")
    if str(shift_resp.data.get("organization_id")) != str(organization_id):
        raise HTTPException(status_code=403, detail="Not authorized")

    scheduled = shift_resp.data.get("scheduled_start")
    if scheduled:
        try:
            shift_dt = datetime.fromisoformat(str(scheduled).replace("Z", "+00:00"))
            if (datetime.now(timezone.utc) - shift_dt).days > 90:
                raise HTTPException(
                    status_code=403,
                    detail="Audit export is only available within 90 days of the shift.",
                )
        except HTTPException:
            raise
        except Exception:
            pass

    try:
        resp = (
            get_supabase_admin()
            .table("evidence_access_audit_log")
            .select("*")
            .eq("shift_id", shift_id)
            .eq("organization_id", organization_id)
            .order("created_at", desc=False)
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:
        if _is_missing_table(exc):
            rows = []
        else:
            raise

    if not rows:
        try:
            session_resp = (
                get_supabase_admin()
                .table("sessions")
                .select("id")
                .eq("shift_id", shift_id)
                .execute()
            )
            session_ids = [r["id"] for r in (session_resp.data or [])]
            if session_ids:
                resp = (
                    get_supabase_admin()
                    .table("evidence_access_audit_log")
                    .select("*")
                    .in_("session_id", session_ids)
                    .eq("organization_id", organization_id)
                    .order("created_at", desc=False)
                    .execute()
                )
                rows = resp.data or []
        except Exception:
            rows = []

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["timestamp", "actor", "action", "evidence_item", "notes"])
    for row in rows:
        actor = _user_name(str(row.get("accessed_by") or ""))
        writer.writerow([
            row.get("created_at", ""),
            actor,
            row.get("action", ""),
            row.get("evidence_id", ""),
            row.get("notes") or row.get("purpose") or "",
        ])

    filename = f"shift-{shift_id[:8]}-evidence-audit.csv"
    return filename, buffer.getvalue()


def list_shift_audit_log(
    shift_id: str,
    organization_id: str,
    *,
    limit: int = 200,
) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("evidence_access_audit_log")
            .select("*")
            .eq("shift_id", shift_id)
            .eq("organization_id", organization_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        rows = resp.data or []
        for row in rows:
            row["actor_name"] = _user_name(str(row.get("accessed_by") or ""))
        return rows
    except Exception as exc:
        if _is_missing_table(exc):
            return []
        raise
