"""Server-side shift PDF export — CARECLIQV2-285 / CARECLIQV2-294."""

from __future__ import annotations

import io
import logging
import zipfile
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

ACK_STATEMENTS = [
    "I confirm all tasks have been documented accurately.",
    "I confirm participant safety protocols were followed throughout this shift.",
    "I confirm no incidents occurred that have not been reported.",
]


def _is_missing_schema(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg


def _format_duration(minutes: int | None) -> str:
    if minutes is None:
        return "—"
    h, m = divmod(max(0, int(minutes)), 60)
    if h and m:
        return f"{h}h {m}m"
    if h:
        return f"{h}h"
    return f"{m}m"


def _participant_display_id(detail: dict[str, Any]) -> str:
    pid = detail.get("participant_id")
    if pid:
        return str(pid)[:8].upper()
    return "—"


def _format_ts(value: str | None) -> str:
    if not value:
        return "—"
    text = str(value).replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    except ValueError:
        return str(value)[:19]


def _ack_statements_from_signature(sig: dict[str, Any] | None) -> list[tuple[str, bool]]:
    if not sig:
        return [(stmt, False) for stmt in ACK_STATEMENTS]
    flags = [
        bool(sig.get("confirm_tasks_accurate")),
        bool(sig.get("confirm_safety_followed")),
        bool(sig.get("confirm_no_unreported_incidents")),
    ]
    return list(zip(ACK_STATEMENTS, flags))


def _add_pdf_accessibility_markers(pdf_bytes: bytes) -> bytes:
    """Mark PDF as tagged for assistive tech (/Marked, /Lang on catalog)."""
    if b"/MarkInfo" in pdf_bytes:
        return pdf_bytes
    marker = b"/Type /Catalog"
    pos = pdf_bytes.find(marker)
    if pos < 0:
        return pdf_bytes
    insertion = b" /Lang (en-AU) /MarkInfo << /Marked true >>"
    return pdf_bytes[: pos + len(marker)] + insertion + pdf_bytes[pos + len(marker) :]


def _download_signature_png(signature: dict[str, Any] | None) -> bytes | None:
    if not signature:
        return None
    png_path = signature.get("signature_png_path")
    if not png_path:
        return None
    try:
        return get_supabase_admin().storage.from_("evidence-files").download(str(png_path))
    except Exception:
        try:
            return get_supabase_admin().storage.from_("shift-signatures").download(str(png_path))
        except Exception as exc:
            logger.debug("signature png download failed: %s", exc)
            return None


def _build_shift_pdf(detail: dict[str, Any], org_id: str, *, signature_png: bytes | None = None) -> bytes:
    try:
        from reportlab.lib import colors
        from reportlab.lib.colors import HexColor
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.platypus import (
            Flowable,
            Paragraph,
            SimpleDocTemplate,
            Spacer,
            Table,
            TableStyle,
        )
    except ImportError:
        return _minimal_shift_pdf(detail)

    class SignatureBlockFlowable(Flowable):
        """200×100px signature image with diagonal 'Digitally signed' watermark."""

        width = 200
        height = 110

        def __init__(self, signature_png: bytes, signer: str, signed_at: str) -> None:
            Flowable.__init__(self)
            self.signature_png = signature_png
            self.signer = signer
            self.signed_at = signed_at

        def draw(self) -> None:
            from reportlab.lib.utils import ImageReader

            canvas = self.canv
            img_y = 10
            try:
                canvas.drawImage(
                    ImageReader(io.BytesIO(self.signature_png)),
                    0,
                    img_y,
                    width=200,
                    height=100,
                    preserveAspectRatio=True,
                    anchor="sw",
                )
            except Exception:
                pass

            canvas.saveState()
            canvas.setFillColorRGB(0.55, 0.55, 0.55, alpha=0.35)
            canvas.setFont("Helvetica-Bold", 16)
            canvas.translate(100, img_y + 50)
            canvas.rotate(35)
            canvas.drawCentredString(0, 0, "Digitally signed")
            canvas.restoreState()

            canvas.setFont("Helvetica", 9)
            canvas.setFillColorRGB(0.2, 0.2, 0.2)
            canvas.drawString(0, 0, f"Signed by {self.signer} on {self.signed_at[:19]}")

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        title="CareCliQ Shift Summary",
        author="CareCliQ",
        subject="Shift Summary",
        lang="en-AU",
    )
    styles = getSampleStyleSheet()

    story: list[Any] = []
    try:
        from .organization_branding_service import build_pdf_letterhead

        letterhead_flowables, accent = build_pdf_letterhead(org_id)
        story.extend(letterhead_flowables)
    except Exception as exc:
        logger.warning("Could not build PDF letterhead for org %s: %s", org_id, exc)
        accent = "#1B1745"

    title_style = ParagraphStyle(
        "Title",
        parent=styles["Heading1"],
        fontSize=16,
        spaceAfter=8,
        textColor=HexColor(accent),
    )
    heading_style = ParagraphStyle(
        "Section",
        parent=styles["Heading2"],
        fontSize=12,
        spaceBefore=10,
        spaceAfter=4,
    )
    body_style = ParagraphStyle("Body", parent=styles["BodyText"], fontSize=10, leading=14)
    mandatory_style = ParagraphStyle(
        "Mandatory",
        parent=body_style,
        fontName="Helvetica-Bold",
    )

    story.append(Paragraph("Shift Summary", title_style))
    story.append(Spacer(1, 4 * mm))

    meta_rows = [
        ["Shift ID", str(detail.get("id") or "")[:8].upper() or "—"],
        ["Date", str(detail.get("shift_date") or "")[:10]],
        [
            "Participant",
            f"{detail.get('participant_first_name') or 'Participant'} ({_participant_display_id(detail)})",
        ],
        ["Worker", str(detail.get("worker_name") or "—")],
        [
            "Scheduled",
            f"{_format_ts(detail.get('scheduled_start'))} – {_format_ts(detail.get('scheduled_end'))}",
        ],
        [
            "Clock in / out",
            f"{_format_ts(detail.get('clocked_in_at'))} – {_format_ts(detail.get('clocked_out_at'))}",
        ],
        ["Duration", _format_duration(detail.get("duration_minutes"))],
        [
            "Compliance",
            f"{detail.get('compliance_score')}% ({detail.get('compliance_band') or '—'})",
        ],
    ]
    meta_table = Table(meta_rows, colWidths=[35 * mm, 130 * mm])
    meta_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(meta_table)

    explanation = detail.get("compliance_explanation") or ""
    if explanation:
        story.append(Spacer(1, 4 * mm))
        story.append(Paragraph(explanation, body_style))

    story.append(Paragraph("Tasks", heading_style))
    tasks = detail.get("tasks") or []
    if not tasks:
        story.append(Paragraph("No tasks recorded.", body_style))
    else:
        for task in tasks:
            mandatory = bool(task.get("mandatory", True))
            completed = bool(task.get("completed"))
            status = "Completed" if completed else "Incomplete"
            if task.get("marked_na"):
                status = "N/A"
            label = str(task.get("label") or "Task")
            prefix = "[Mandatory] " if mandatory else "[Optional] "
            style = mandatory_style if mandatory else body_style
            story.append(Paragraph(f"{prefix}{label}: {status}", style))

    evidence = detail.get("evidence") or []
    if evidence:
        story.append(Paragraph("Evidence (names only)", heading_style))
        for ev in evidence:
            story.append(
                Paragraph(
                    f"• {ev.get('label') or 'Evidence'} ({ev.get('type') or 'file'})",
                    body_style,
                )
            )

    notes = (detail.get("notes") or "").strip()
    if notes:
        story.append(Paragraph("Notes", heading_style))
        for line in notes.splitlines() or [notes]:
            story.append(Paragraph(line or " ", body_style))

    story.append(Paragraph("Compliance confirmation", heading_style))
    sig = detail.get("shift_signature")
    for stmt, checked in _ack_statements_from_signature(sig):
        mark = "☑" if checked else "☐"
        story.append(Paragraph(f"{mark} {stmt}", body_style))

    story.append(Paragraph("Worker signature", heading_style))
    if sig and signature_png:
        try:
            signer = sig.get("signer_name") or "Worker"
            signed_at = str(sig.get("signed_at") or "")
            story.append(SignatureBlockFlowable(signature_png, signer, signed_at))
        except Exception as exc:
            logger.debug("signature embed failed: %s", exc)
            story.append(Paragraph("No signature available", body_style))
    elif sig:
        signer = sig.get("signer_name") or "Worker"
        signed_at = str(sig.get("signed_at") or "")[:19]
        story.append(Paragraph(f"Signed by {signer} on {signed_at}", body_style))
        story.append(Paragraph("Signature image unavailable", body_style))
    else:
        story.append(Paragraph("No signature available", body_style))

    doc.build(story)
    return _add_pdf_accessibility_markers(buffer.getvalue())


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
        mandatory = "Mandatory" if task.get("mandatory", True) else "Optional"
        status = "Done" if task.get("completed") else "Incomplete"
        lines.append(f"  - [{mandatory}] {task.get('label')}: {status}")
    if detail.get("notes"):
        lines.extend(["", "Notes:", detail.get("notes")])
    if detail.get("evidence"):
        lines.extend(["", "Evidence:"])
        for ev in detail.get("evidence") or []:
            lines.append(f"  - {ev.get('label')} ({ev.get('type')})")
    sig = detail.get("shift_signature")
    if sig:
        lines.extend(
            [
                "",
                f"Signed by {sig.get('signer_name') or 'worker'} on {sig.get('signed_at')}",
            ]
        )
    else:
        lines.extend(["", "No signature available"])
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


def _shift_summary_email_subject(participant_name: str, shift_date: str) -> str:
    return f"Shift Summary – {participant_name} – {shift_date}"


def _queue_shift_export_email(
    *,
    to_email: str,
    participant_name: str,
    shift_date: str,
    download_page: str,
    subject: str | None = None,
) -> None:
    subject_line = subject or _shift_summary_email_subject(participant_name, shift_date)
    text_body = (
        f"Your shift summary for {participant_name} on {shift_date} is ready.\n\n"
        f"Download: {download_page}\n"
    )
    queue_email_job(
        label=f"shift-export:{to_email}:{shift_date}",
        send=lambda: send_email(to_email=to_email, subject=subject_line, text_body=text_body),
    )


def _export_response(row: dict[str, Any], *, already_exists: bool = False) -> dict[str, Any]:
    export_id = row.get("id")
    expires = row.get("expires_at")
    auto = bool(row.get("auto_generated"))
    return {
        "export_id": export_id,
        "status": row.get("status"),
        "file_url": row.get("file_url"),
        "download_url": f"/api/worker/shift-history/exports/{export_id}/file",
        "expires_at": expires,
        "download_available_days": None if auto else EXPORT_TTL_DAYS,
        "auto_generated": auto,
        "already_exists": already_exists,
    }


def _existing_auto_export(shift_id: str) -> dict[str, Any] | None:
    try:
        resp = (
            get_supabase_admin()
            .table("shift_export_requests")
            .select("*")
            .eq("shift_id", shift_id)
            .eq("auto_generated", True)
            .in_("status", ["pending", "ready"])
            .limit(1)
            .execute()
        )
        return (resp.data or [None])[0]
    except Exception as exc:
        if _is_missing_schema(exc):
            return None
        raise


def create_shift_export(
    shift_id: str,
    user_id: str,
    organization_id: str,
    *,
    is_coordinator: bool = False,
    worker_id: str | None = None,
    auto_generated: bool = False,
) -> dict[str, Any]:
    target_worker = worker_id or user_id
    detail = get_shift_history_detail(shift_id, target_worker, organization_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Completed shift not found.")

    if not is_coordinator and str(target_worker) != str(user_id):
        raise HTTPException(status_code=403, detail="Not authorized.")

    if auto_generated:
        existing = _existing_auto_export(shift_id)
        if existing and existing.get("status") == "ready":
            return _export_response(existing, already_exists=True)

    now = datetime.now(timezone.utc)
    expires = None if auto_generated else (now + timedelta(days=EXPORT_TTL_DAYS))
    export_id = str(uuid4())

    record: dict[str, Any] = {
        "id": export_id,
        "shift_id": shift_id,
        "organization_id": organization_id,
        "requested_by": target_worker if auto_generated else user_id,
        "status": "pending",
        "auto_generated": auto_generated,
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    if expires:
        record["expires_at"] = expires.isoformat()

    try:
        get_supabase_admin().table("shift_export_requests").insert(record).execute()
    except Exception as exc:
        if _is_missing_schema(exc):
            raise HTTPException(
                status_code=503,
                detail="Shift export unavailable. Run migration 064_shift_summary.",
            ) from exc
        if auto_generated and "uq_shift_export_auto_per_shift" in str(exc).lower():
            existing = _existing_auto_export(shift_id)
            if existing:
                return _export_response(existing, already_exists=True)
        raise

    signature_png = _download_signature_png(detail.get("shift_signature"))
    pdf_bytes = _build_shift_pdf(detail, organization_id, signature_png=signature_png)
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

    row = {
        "id": export_id,
        "status": "ready",
        "file_url": file_url,
        "expires_at": expires.isoformat() if expires else None,
        "auto_generated": auto_generated,
    }
    return _export_response(row)


def build_shift_pdf_export(shift_id: str, worker_id: str, organization_id: str) -> tuple[str, bytes] | None:
    """Build a shift-summary PDF in memory as (filename, pdf_bytes), without
    creating a storage object or shift_export_requests row — used for
    bulk/zip exports (see create_bulk_shift_export) where persisting one
    export per shift would be wasteful. Returns None if the shift can't be
    found."""
    detail = get_shift_history_detail(shift_id, worker_id, organization_id)
    if not detail:
        return None
    signature_png = _download_signature_png(detail.get("shift_signature"))
    pdf_bytes = _build_shift_pdf(detail, organization_id, signature_png=signature_png)

    date_part = str(detail.get("shift_date") or "")[:10] or "unknown-date"
    participant = str(detail.get("participant_first_name") or "participant")
    worker = str(detail.get("worker_name") or "worker")

    def _safe(s: str) -> str:
        return "".join(c if c.isalnum() or c in "-_" else "-" for c in s) or "x"

    filename = f"{date_part}_{_safe(participant)}_{_safe(worker)}_{shift_id[:8]}.pdf"
    return filename, pdf_bytes


def create_bulk_shift_export(
    shift_refs: list[tuple[str, str]],
    organization_id: str,
    *,
    zip_label: str,
) -> dict[str, Any]:
    """Bundle multiple shift-summary PDFs (shift_id, worker_id) into a
    single ZIP, store it in the same bucket single-shift exports use, and
    return a signed download URL. Used by the chatbox's bulk progress-note
    tools (see chatbox/tools.py) — the caller is responsible for scoping
    shift_refs to what the requesting user is allowed to see; this function
    does not re-check access itself."""
    buffer = io.BytesIO()
    included = 0
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        used_names: set[str] = set()
        for shift_id, worker_id in shift_refs:
            built = build_shift_pdf_export(shift_id, worker_id, organization_id)
            if not built:
                continue
            filename, pdf_bytes = built
            while filename in used_names:
                filename = f"{shift_id[:8]}-{filename}"
            used_names.add(filename)
            zf.writestr(filename, pdf_bytes)
            included += 1

    if included == 0:
        return {"error": "No matching shift progress notes were found for that request."}

    export_id = str(uuid4())
    path = f"{organization_id}/bulk/{export_id}.zip"
    try:
        supabase = get_supabase_admin()
        supabase.storage.from_("shift-export-files").upload(
            path,
            buffer.getvalue(),
            {"content-type": "application/zip", "upsert": "true"},
        )
        bucket = supabase.storage.from_("shift-export-files")
        file_url = _signed_export_url(bucket, path)
    except Exception as exc:
        logger.warning("Bulk shift export upload failed: %s", exc)
        return {"error": "Could not prepare that download right now."}

    return {"file_url": file_url, "shift_count": included, "label": zip_label}


async def notify_shift_summary_ready(worker_id: str, shift_id: str) -> None:
    from .push_service import send_push_to_user

    await send_push_to_user(
        worker_id,
        title="Shift summary ready",
        body="Your shift summary is ready to download.",
        data={"type": "shift_summary_ready", "shift_id": shift_id},
    )


def get_or_create_auto_export(
    shift_id: str,
    user_id: str,
    organization_id: str,
    *,
    is_coordinator: bool = False,
    worker_id: str | None = None,
) -> dict[str, Any]:
    """Return indefinite-retention auto summary PDF, creating if needed."""
    target_worker = worker_id or user_id
    existing = _existing_auto_export(shift_id)
    if existing and existing.get("status") == "ready":
        return _export_response(existing, already_exists=True)
    return create_shift_export(
        shift_id,
        user_id,
        organization_id,
        is_coordinator=is_coordinator,
        worker_id=target_worker,
        auto_generated=True,
    )


def run_auto_shift_summary_export(
    shift_id: str,
    worker_id: str,
    organization_id: str,
) -> dict[str, Any]:
    """Generate auto shift summary after sign-off (CARECLIQV2-294)."""
    return get_or_create_auto_export(
        shift_id,
        worker_id,
        organization_id,
        worker_id=worker_id,
    )


def _shift_coordinator_user_id(shift_id: str) -> str | None:
    from .shift_service import get_shift_by_id

    shift = get_shift_by_id(shift_id)
    if not shift:
        return None
    created_by = str(shift.get("created_by") or "").strip()
    if created_by:
        return created_by
    return None


def coordinator_emails_for_shift(shift_id: str, organization_id: str) -> list[str]:
    """Coordinator email from shift record (created_by), with org fallback."""
    emails: list[str] = []
    coord_id = _shift_coordinator_user_id(shift_id)
    if coord_id:
        email = _get_user_email(coord_id)
        if email:
            emails.append(email)
    if not emails:
        from .notification_service import _org_coordinator_user_ids

        for cid in _org_coordinator_user_ids(organization_id):
            email = _get_user_email(cid)
            if email and email not in emails:
                emails.append(email)
    return emails


def _coordinator_emails(organization_id: str) -> list[str]:
    from .notification_service import _org_coordinator_user_ids

    emails: list[str] = []
    for coord_id in _org_coordinator_user_ids(organization_id):
        email = _get_user_email(coord_id)
        if email:
            emails.append(email)
    return emails


def share_shift_export(
    shift_id: str,
    user_id: str,
    organization_id: str,
    *,
    email_self: bool = False,
    email_coordinator: bool = False,
    additional_recipients: list[str] | None = None,
) -> dict[str, Any]:
    detail = get_shift_history_detail(shift_id, user_id, organization_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Completed shift not found.")

    export = _existing_auto_export(shift_id)
    if not export or export.get("status") != "ready":
        export_result = get_or_create_auto_export(shift_id, user_id, organization_id)
        export_id = export_result.get("export_id")
    else:
        export_id = export.get("id")

    participant_name = str(detail.get("participant_first_name") or "Participant")
    shift_date = str(detail.get("shift_date") or "")[:10]
    subject = _shift_summary_email_subject(participant_name, shift_date)
    download_page = (
        f"{settings.frontend_base_url.rstrip('/')}/worker/shift-history"
        f"?export={export_id}&shift={shift_id}"
    )

    recipients: list[str] = []
    if email_self:
        self_email = _get_user_email(user_id)
        if self_email:
            recipients.append(self_email)
    if email_coordinator:
        recipients.extend(coordinator_emails_for_shift(shift_id, organization_id))
    for raw in additional_recipients or []:
        email = str(raw or "").strip().lower()
        if email and "@" in email and email not in recipients:
            recipients.append(email)

    if not recipients:
        raise HTTPException(status_code=422, detail="No valid recipients selected.")

    for to_email in recipients:
        _queue_shift_export_email(
            to_email=to_email,
            participant_name=participant_name,
            shift_date=shift_date,
            download_page=download_page,
            subject=subject,
        )

    try:
        get_supabase_admin().table("shift_export_requests").update({
            "shared_recipients": recipients,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", export_id).execute()
    except Exception as exc:
        logger.debug("share recipients audit failed: %s", exc)

    return {
        "export_id": export_id,
        "recipients": recipients,
        "subject": subject,
        "coordinator_emails": coordinator_emails_for_shift(shift_id, organization_id),
        "download_url": f"/api/worker/shift-history/exports/{export_id}/file",
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
    if expires and not row.get("auto_generated"):
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

    filename = f"shift-summary-{str(row.get('shift_id') or export_id)[:8]}.pdf"
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
    if expires and not row.get("auto_generated"):
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
        "auto_generated": row.get("auto_generated", False),
    }


def backfill_shift_summaries(organization_id: str, *, limit: int = 50) -> dict[str, Any]:
    """Retroactive PDF generation for completed shifts (CARECLIQV2-294)."""
    try:
        resp = (
            get_supabase_admin()
            .table("shifts")
            .select("id, worker_id")
            .eq("organization_id", organization_id)
            .eq("status", "completed")
            .order("clocked_out_at", desc=True)
            .limit(limit)
            .execute()
        )
        shifts = resp.data or []
    except Exception as exc:
        if _is_missing_schema(exc):
            return {"generated": 0, "skipped": 0}
        raise

    generated = 0
    skipped = 0
    for row in shifts:
        shift_id = str(row.get("id") or "")
        worker_id = str(row.get("worker_id") or "")
        if not shift_id or not worker_id:
            continue
        if _existing_auto_export(shift_id):
            skipped += 1
            continue
        try:
            get_or_create_auto_export(
                shift_id,
                worker_id,
                organization_id,
                worker_id=worker_id,
            )
            generated += 1
        except Exception as exc:
            logger.warning("backfill export failed for %s: %s", shift_id, exc)
            skipped += 1
    return {"generated": generated, "skipped": skipped}
