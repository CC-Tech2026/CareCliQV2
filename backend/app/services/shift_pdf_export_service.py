"""Server-side shift PDF export — CARECLIQV2-285."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from ..core.config import settings
from .email_service import queue_email_job, send_email
from .supabase_client import get_supabase_admin
from .worker_shift_history_service import get_shift_history_detail

logger = logging.getLogger(__name__)

EXPORT_TTL_DAYS = 30
SIGNED_URL_SECONDS = 60 * 60 * 24 * 7  # Supabase signed URLs are capped at ~7 days


def _is_missing_schema(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg


def _minimal_shift_pdf(detail: dict[str, Any]) -> bytes:
    lines = [
        "CareCliQ Shift Record",
        f"Date: {str(detail.get('shift_date') or '')[:10]}",
        f"Participant: {detail.get('participant_first_name') or 'Participant'}",
        f"Compliance: {detail.get('compliance_score')}% ({detail.get('compliance_band')})",
        "",
        detail.get("compliance_explanation") or "",
        "",
        "Tasks:",
    ]
    for task in detail.get("tasks") or []:
        status = "Done" if task.get("completed") else "Incomplete"
        lines.append(f"  - {task.get('label')}: {status}")
    if detail.get("notes"):
        lines.extend(["", "Notes:", detail.get("notes")])
    if detail.get("evidence"):
        lines.extend(["", "Evidence:"])
        for ev in detail.get("evidence") or []:
            lines.append(f"  - {ev.get('label')} ({ev.get('type')})")
    sig = detail.get("shift_signature")
    if sig:
        lines.extend([
            "",
            f"Signed by {sig.get('signer_name') or 'worker'} on {sig.get('signed_at')}",
        ])
    text = "\\n".join(lines).replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 11 Tf 50 750 Td ({text[:3500]}) Tj ET"
    pdf = (
        "%PDF-1.4\n"
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
        "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        "/Resources << /Font << /F1 5 0 R >> >> >> endobj\n"
        f"4 0 obj << /Length {len(stream)} >> stream\n{stream}\nendstream endobj\n"
        "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n"
        "xref\n0 6\n0000000000 65535 f \ntrailer << /Root 1 0 R /Size 6 >>\nstartxref\n0\n%%EOF\n"
    )
    return pdf.encode("utf-8")


def _get_user_email(user_id: str) -> str | None:
    try:
        resp = (
            get_supabase_admin()
            .table("users")
            .select("email")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
        return str(row.get("email") or "").strip() if row else None
    except Exception:
        return None


def _signed_export_url(bucket: Any, path: str) -> str | None:
    try:
        signed = bucket.create_signed_url(path, SIGNED_URL_SECONDS)
        if isinstance(signed, dict):
            return (
                signed.get("signedURL")
                or signed.get("signed_url")
                or signed.get("signedUrl")
                or (signed.get("data") or {}).get("signedUrl")
                or (signed.get("data") or {}).get("signedURL")
            )
    except Exception as exc:
        logger.warning("Signed URL generation failed for %s: %s", path, exc)
    return None


def _queue_shift_export_email(
    *,
    to_email: str,
    participant_name: str,
    shift_date: str,
    download_page: str,
) -> None:
    subject = "Your CareCliQ shift record is ready"
    text_body = (
        f"Your shift export for {participant_name} on {shift_date} is ready.\n\n"
        f"Download: {download_page}\n\n"
        f"This link is available for {EXPORT_TTL_DAYS} days."
    )
    queue_email_job(
        label=f"shift-export:{to_email}:{shift_date}",
        send=lambda: send_email(to_email=to_email, subject=subject, text_body=text_body),
    )


def create_shift_export(
    shift_id: str,
    user_id: str,
    organization_id: str,
    *,
    is_coordinator: bool = False,
    worker_id: str | None = None,
) -> dict[str, Any]:
    target_worker = worker_id or user_id
    detail = get_shift_history_detail(shift_id, target_worker, organization_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Completed shift not found.")

    if not is_coordinator and str(target_worker) != str(user_id):
        raise HTTPException(status_code=403, detail="Not authorized.")

    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=EXPORT_TTL_DAYS)
    export_id = str(uuid4())

    record = {
        "id": export_id,
        "shift_id": shift_id,
        "organization_id": organization_id,
        "requested_by": user_id,
        "status": "pending",
        "expires_at": expires.isoformat(),
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }

    try:
        get_supabase_admin().table("shift_export_requests").insert(record).execute()
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(
                status_code=503,
                detail="Shift export unavailable. Run migration 063_worker_performance.",
            ) from exc
        raise

    pdf_bytes = _minimal_shift_pdf(detail)
    path = f"{organization_id}/{shift_id}/{export_id}.pdf"
    file_url = None
    try:
        supabase = get_supabase_admin()
        supabase.storage.from_("shift-export-files").upload(
            path,
            pdf_bytes,
            {"content-type": "application/pdf", "upsert": "true"},
        )
        bucket = supabase.storage.from_("shift-export-files")
        file_url = _signed_export_url(bucket, path)
    except Exception as exc:
        get_supabase_admin().table("shift_export_requests").update({
            "status": "failed",
            "error_message": str(exc)[:500],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", export_id).execute()
        raise HTTPException(status_code=502, detail="PDF storage failed.") from exc

    get_supabase_admin().table("shift_export_requests").update({
        "status": "ready",
        "file_path": path,
        "file_url": file_url,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", export_id).execute()

    email = _get_user_email(user_id)
    if email and file_url:
        download_page = f"{settings.frontend_base_url.rstrip('/')}/worker/shift-history?export={export_id}"
        try:
            _queue_shift_export_email(
                to_email=email,
                participant_name=str(detail.get("participant_first_name") or "Participant"),
                shift_date=str(detail.get("shift_date") or "")[:10],
                download_page=download_page,
            )
            get_supabase_admin().table("shift_export_requests").update({
                "emailed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", export_id).execute()
        except Exception as exc:
            logger.warning("Shift export email failed for %s: %s", export_id, exc)

    return {
        "export_id": export_id,
        "status": "ready",
        "file_url": file_url,
        "download_url": f"/api/worker/shift-history/exports/{export_id}/file",
        "expires_at": expires.isoformat(),
        "download_available_days": EXPORT_TTL_DAYS,
    }


def stream_export_file(export_id: str, user_id: str) -> tuple[bytes, str]:
    try:
        resp = (
            get_supabase_admin()
            .table("shift_export_requests")
            .select("*")
            .eq("id", export_id)
            .eq("requested_by", user_id)
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Export service unavailable.") from exc
        raise

    if not row:
        raise HTTPException(status_code=404, detail="Export not found.")
    if row.get("status") != "ready":
        raise HTTPException(status_code=404, detail="Export is not ready.")

    expires = row.get("expires_at")
    if expires:
        try:
            exp_dt = datetime.fromisoformat(str(expires).replace("Z", "+00:00"))
            if exp_dt < datetime.now(timezone.utc):
                raise HTTPException(status_code=410, detail="Export link has expired.")
        except HTTPException:
            raise
        except ValueError:
            pass

    file_path = row.get("file_path")
    if not file_path:
        raise HTTPException(status_code=404, detail="Export file not found.")

    try:
        file_bytes = get_supabase_admin().storage.from_("shift-export-files").download(file_path)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Could not download export file.") from exc

    filename = f"shift-{str(row.get('shift_id') or export_id)[:8]}.pdf"
    return file_bytes, filename


def get_export_download(export_id: str, user_id: str) -> dict[str, Any]:
    try:
        resp = (
            get_supabase_admin()
            .table("shift_export_requests")
            .select("*")
            .eq("id", export_id)
            .eq("requested_by", user_id)
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(status_code=503, detail="Export service unavailable.") from exc
        raise

    if not row:
        raise HTTPException(status_code=404, detail="Export not found.")
    if row.get("status") != "ready":
        raise HTTPException(status_code=404, detail="Export is not ready.")

    expires = row.get("expires_at")
    if expires:
        try:
            exp_dt = datetime.fromisoformat(str(expires).replace("Z", "+00:00"))
            if exp_dt < datetime.now(timezone.utc):
                raise HTTPException(status_code=410, detail="Export link has expired.")
        except HTTPException:
            raise
        except ValueError:
            pass

    return {
        "export_id": export_id,
        "file_url": row.get("file_url"),
        "expires_at": row.get("expires_at"),
        "shift_id": row.get("shift_id"),
    }
