"""Worker privacy & data protection — CARECLIQV2-269."""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException

from .compliance_evidence_service import DEFAULT_RETENTION_DAYS, get_evidence_retention_days
from .email_service import queue_email_job, send_email
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

DATA_CATEGORIES = [
    {
        "id": "account",
        "title": "Account information",
        "description": "Your name, email, phone number, profile photo, and role within your organisation.",
        "retention": "Duration of employment plus 7 years",
    },
    {
        "id": "shifts",
        "title": "Shift records",
        "description": "Scheduled shifts, clock-in/out times, task completion, and shift signatures.",
        "retention": "7 years from shift date (NDIS record-keeping)",
    },
    {
        "id": "gps",
        "title": "GPS logs",
        "description": "Location data captured during shift check-in for verification purposes.",
        "retention": "7 years from capture date",
    },
    {
        "id": "messages",
        "title": "Messages",
        "description": "In-app messages between you and your coordinator or office.",
        "retention": "7 years from message date",
    },
    {
        "id": "incidents",
        "title": "Incident reports",
        "description": "Safety incidents and near-miss reports you submit during shifts.",
        "retention": "7 years from report date",
    },
    {
        "id": "evidence",
        "title": "Evidence uploads",
        "description": "Photos, voice notes, and files attached to shift tasks.",
        "retention": "Per organisation data policy (typically 7 years)",
    },
    {
        "id": "device",
        "title": "Device information",
        "description": "Device identifiers, browser type, and session history for security.",
        "retention": "90 days for session logs; trusted devices until revoked",
    },
]


def _is_missing_table(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg


def get_privacy_overview(user_id: str, organization_id: Optional[str]) -> dict[str, Any]:
    prefs = get_privacy_preferences(user_id)
    policy = get_current_privacy_policy()
    retention_days = get_evidence_retention_days(organization_id or "")
    categories = []
    for cat in DATA_CATEGORIES:
        entry = dict(cat)
        if cat["id"] == "evidence" and organization_id:
            entry["retention"] = f"{retention_days} days from shift date"
        categories.append(entry)
    return {
        "data_categories": categories,
        "analytics_opt_out": prefs.get("analytics_opt_out", False),
        "privacy_policy": policy,
    }


def get_privacy_preferences(user_id: str) -> dict[str, Any]:
    try:
        resp = (
            get_supabase_admin()
            .table("worker_privacy_preferences")
            .select("analytics_opt_out, updated_at")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        if resp and resp.data:
            return resp.data
    except Exception as exc:
        if not _is_missing_table(exc):
            logger.debug("privacy preferences lookup: %s", exc)
    return {"analytics_opt_out": False, "updated_at": None}


def set_analytics_opt_out(user_id: str, opt_out: bool) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    row = {"user_id": user_id, "analytics_opt_out": opt_out, "updated_at": now}
    try:
        get_supabase_admin().table("worker_privacy_preferences").upsert(row).execute()
    except Exception as exc:
        if _is_missing_table(exc):
            raise HTTPException(
                status_code=503,
                detail="Privacy preferences unavailable. Run migration 058_compliance_privacy_signature.sql",
            ) from exc
        raise
    return row


def get_current_privacy_policy() -> dict[str, Any]:
    try:
        resp = (
            get_supabase_admin()
            .table("privacy_policy_versions")
            .select("version, summary_text, full_pdf_path, published_at")
            .eq("is_current", True)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if rows:
            return rows[0]
    except Exception as exc:
        if not _is_missing_table(exc):
            logger.debug("privacy policy lookup: %s", exc)
    return {
        "version": "1.0",
        "summary_text": "CareCliQ protects your personal information in line with the Australian Privacy Act 1988.",
        "full_pdf_path": None,
        "published_at": None,
    }


def list_privacy_policy_versions() -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("privacy_policy_versions")
            .select("version, summary_text, published_at, is_current")
            .order("published_at", desc=True)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        if _is_missing_table(exc):
            return []
        raise


def _build_export_payload(user_id: str, organization_id: Optional[str]) -> dict[str, Any]:
    supabase = get_supabase_admin()
    user_resp = supabase.table("users").select(
        "id, email, full_name, phone, role, organization_id, created_at, preferred_contact_method"
    ).eq("id", user_id).maybe_single().execute()
    profile = user_resp.data if user_resp else {}

    shifts: list[dict] = []
    if organization_id:
        try:
            s_resp = (
                supabase.table("shifts")
                .select("id, scheduled_start, scheduled_end, status, clocked_in_at, clocked_out_at, participant_id")
                .eq("worker_id", user_id)
                .eq("organization_id", organization_id)
                .order("scheduled_start", desc=True)
                .limit(500)
                .execute()
            )
            shifts = s_resp.data or []
        except Exception:
            pass

    devices: list[dict] = []
    sessions: list[dict] = []
    try:
        d_resp = supabase.table("trusted_devices").select("*").eq("user_id", user_id).execute()
        devices = d_resp.data or []
    except Exception:
        pass
    try:
        s_resp = supabase.table("user_sessions").select("*").eq("user_id", user_id).limit(100).execute()
        sessions = s_resp.data or []
    except Exception:
        pass

    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "user_id": user_id,
        "profile": profile,
        "shifts": shifts,
        "trusted_devices": devices,
        "sessions": sessions,
        "data_categories_included": [c["id"] for c in DATA_CATEGORIES],
    }


def request_data_export(user_id: str, organization_id: Optional[str], email: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    request_id = None
    try:
        resp = (
            get_supabase_admin()
            .table("data_export_requests")
            .insert({
                "user_id": user_id,
                "organization_id": organization_id,
                "status": "processing",
                "requested_at": now.isoformat(),
            })
            .execute()
        )
        rows = resp.data or []
        request_id = rows[0]["id"] if rows else None
    except Exception as exc:
        if _is_missing_table(exc):
            raise HTTPException(status_code=503, detail="Data export unavailable. Run migration 058.") from exc
        raise

    payload = _build_export_payload(user_id, organization_id)
    export_json = json.dumps(payload, indent=2, default=str)
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expires_at = now + timedelta(hours=48)
    file_path = f"privacy-exports/{user_id}/{request_id or 'latest'}.json"

    try:
        from .object_storage import upload_evidence_bytes

        upload_evidence_bytes(file_path, export_json.encode("utf-8"), "application/json")
    except Exception as exc:
        logger.warning("Could not store export file: %s", exc)
        file_path = None

    if request_id:
        try:
            get_supabase_admin().table("data_export_requests").update({
                "status": "ready",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "download_token_hash": token_hash,
                "expires_at": expires_at.isoformat(),
                "file_path": file_path,
            }).eq("id", request_id).execute()
        except Exception:
            pass

    download_path = f"/api/worker/privacy/export/{request_id}/download?token={token}" if request_id else None

    def _send_export_email() -> None:
        if not email:
            return
        body = (
            "Your CareCliQ personal data export is ready.\n\n"
            f"Download link (expires in 48 hours):\n{download_path or 'Available in the app under Your data & privacy.'}\n"
        )
        send_email(to_email=email, subject="Your CareCliQ data export is ready", text_body=body)

    try:
        queue_email_job(label="privacy_data_export", send=_send_export_email)
    except Exception:
        pass

    return {
        "request_id": request_id,
        "status": "ready",
        "message": "Your export has been generated. Check your email for a secure download link.",
        "expires_at": expires_at.isoformat(),
        "download_path": download_path,
    }


def download_export(
    request_id: str,
    user_id: str,
    token: str,
) -> tuple[bytes, str]:
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    try:
        resp = (
            get_supabase_admin()
            .table("data_export_requests")
            .select("*")
            .eq("id", request_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
    except Exception as exc:
        if _is_missing_table(exc):
            raise HTTPException(status_code=404, detail="Export not found") from exc
        raise

    if not resp or not resp.data:
        raise HTTPException(status_code=404, detail="Export not found")
    row = resp.data
    if row.get("download_token_hash") != token_hash:
        raise HTTPException(status_code=403, detail="Invalid download token")
    expires = row.get("expires_at")
    if expires and datetime.fromisoformat(str(expires).replace("Z", "+00:00")) < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Download link has expired")

    file_path = row.get("file_path")
    if file_path:
        try:
            from .object_storage import get_evidence_storage_backend

            backend = get_evidence_storage_backend()
            if hasattr(backend, "_bucket"):
                data = backend._bucket.download(file_path)  # noqa: SLF001
                return data, f"carecliq-export-{user_id[:8]}.json"
        except Exception as exc:
            logger.warning("export download from storage failed: %s", exc)

    payload = _build_export_payload(user_id, row.get("organization_id"))
    return json.dumps(payload, indent=2, default=str).encode("utf-8"), f"carecliq-export-{user_id[:8]}.json"


def request_worker_deletion_by_admin(worker_id: str, organization_id: str) -> dict[str, Any]:
    """A managing director removing a staff member's account from staff
    management - unlike request_account_deletion (a worker asking their
    coordinator to review), the MD already has that authority, so this just
    queues the same pending request without a "please review" notification."""
    now = datetime.now(timezone.utc).isoformat()
    try:
        resp = (
            get_supabase_admin()
            .table("account_deletion_requests")
            .insert({
                "user_id": worker_id,
                "organization_id": organization_id,
                "confirmation_text": "Requested by managing director",
                "status": "pending",
                "requested_at": now,
            })
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else {"status": "pending"}
    except Exception as exc:
        if _is_missing_table(exc):
            raise HTTPException(status_code=503, detail="Deletion requests unavailable. Run migration 058.") from exc
        raise


def request_account_deletion(
    user_id: str,
    organization_id: Optional[str],
    confirmation_text: str,
) -> dict[str, Any]:
    if confirmation_text.strip() != "DELETE MY ACCOUNT":
        raise ValueError('You must type "DELETE MY ACCOUNT" to confirm.')

    now = datetime.now(timezone.utc).isoformat()
    try:
        resp = (
            get_supabase_admin()
            .table("account_deletion_requests")
            .insert({
                "user_id": user_id,
                "organization_id": organization_id,
                "confirmation_text": confirmation_text.strip(),
                "status": "pending",
                "requested_at": now,
            })
            .execute()
        )
        rows = resp.data or []
        request_row = rows[0] if rows else {}
    except Exception as exc:
        if _is_missing_table(exc):
            raise HTTPException(status_code=503, detail="Deletion requests unavailable. Run migration 058.") from exc
        raise

    if organization_id:
        try:
            coord_resp = (
                get_supabase_admin()
                .table("organization_members")
                .select("user_id")
                .eq("organization_id", organization_id)
                .in_("role", ["support_coordinator", "coordinator", "admin"])
                .limit(5)
                .execute()
            )
            for coord in coord_resp.data or []:
                coord_id = coord.get("user_id")
                if coord_id:
                    get_supabase_admin().table("alerts").insert({
                        "organization_id": organization_id,
                        "user_id": str(coord_id),
                        "alert_type": "coordinator_message",
                        "title": "Account deletion request",
                        "message": "A support worker has requested account deletion. Review within 30 days.",
                        "severity": "warning",
                        "is_read": False,
                    }).execute()
            get_supabase_admin().table("account_deletion_requests").update({
                "coordinator_notified_at": now,
            }).eq("id", request_row.get("id")).execute()
        except Exception as exc:
            logger.warning("coordinator notification for deletion failed: %s", exc)

    return {
        "success": True,
        "message": "Your request has been received and will be processed within 30 days.",
        "request_id": request_row.get("id"),
    }
