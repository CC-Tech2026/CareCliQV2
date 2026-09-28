"""Participant-scoped invoice reads and explicitly selected export files."""
from __future__ import annotations

import io
import json
import re
import pathlib
import zipfile
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException

from ..core.access import has_org_wide_access
from . import audit_service, billing_service, invoice_service
from .html_pdf_render import render_html_to_pdf
from .merge_fields import resolve_merge_context
from .participant_profile_export_service import render_participant_profile_pdf
from .supabase_client import get_supabase_admin

MAX_PERIOD_INVOICES = 100
MAX_EXPORT_SHIFTS = 500
_TEMPLATES_DIR = pathlib.Path(__file__).parent.parent / "templates"


def invoice_query(user: dict, participant_id: str):
    billing_service._require_billing_role(user)
    return billing_service._invoice_select_query(get_supabase_admin(), user).eq("participant_id", participant_id)


def _within_days(query, column: str, date_from: date | None, date_to: date | None):
    # Inclusive calendar-day bounds in UTC, matching the invoice list filter.
    if date_from:
        query = query.gte(column, f"{date_from.isoformat()}T00:00:00Z")
    if date_to:
        query = query.lt(column, f"{(date_to + timedelta(days=1)).isoformat()}T00:00:00Z")
    return query


BILLED_STATUSES = ("finalized", "issued", "sent", "paid", "overdue")
UNPAID_STATUSES = ("finalized", "issued", "sent", "overdue")


def invoice_summary(user: dict, participant_id: str, date_from: date | None, date_to: date | None) -> dict:
    """Totals for billed invoices in the period. Drafts, void and cancelled
    invoices are left out so the figures match what was actually charged."""
    query = _within_days(invoice_query(user, participant_id), "created_at", date_from, date_to)
    rows = query.in_("status", list(BILLED_STATUSES)).limit(5000).execute().data or []
    return {
        "count": len(rows),
        "total_cents": sum(int(r.get("total_cents") or 0) for r in rows),
        "unpaid_cents": sum(int(r.get("total_cents") or 0) for r in rows if r.get("status") in UNPAID_STATUSES),
        "overdue_count": sum(1 for r in rows if r.get("status") == "overdue"),
        "currency": next((r.get("currency") for r in rows if r.get("currency")), "AUD"),
    }


def period_label(date_from: date | None, date_to: date | None) -> str:
    def fmt(d: date) -> str:
        return f"{d.day} {d.strftime('%b %Y')}"
    if date_from and date_to:
        return f"{fmt(date_from)} to {fmt(date_to)}"
    if date_from:
        return f"From {fmt(date_from)}"
    if date_to:
        return f"Up to {fmt(date_to)}"
    return "All recorded shifts"


def render_shift_history_pdf(org_id: str, participant_id: str, date_from: date | None, date_to: date | None) -> bytes:
    from jinja2 import Environment, FileSystemLoader, select_autoescape
    from .session_service import _fetch_worker_name_map

    supabase = get_supabase_admin()
    query = (
        supabase.table("sessions")
        .select("id, session_date, session_type, duration_minutes, status, worker_id")
        .eq("patient_id", participant_id)
        .eq("organization_id", org_id)
    )
    rows = _within_days(query, "session_date", date_from, date_to).order("session_date").limit(MAX_EXPORT_SHIFTS + 1).execute().data or []
    if len(rows) > MAX_EXPORT_SHIFTS:
        raise HTTPException(status_code=422, detail=f"This period has more than {MAX_EXPORT_SHIFTS} shifts. Choose a shorter period, such as one financial year.")
    workers = _fetch_worker_name_map(supabase, list({str(r["worker_id"]) for r in rows if r.get("worker_id")}))
    years: dict[str, dict] = {}
    total_minutes = 0
    for row in rows:
        when = str(row.get("session_date") or "")[:10]
        minutes = row.get("duration_minutes") or 0
        total_minutes += minutes
        label = when[:4] or "Undated"
        year = years.setdefault(label, {"label": label, "shifts": [], "minutes": 0})
        year["minutes"] += minutes
        year["shifts"].append({
            "date": datetime.strptime(when, "%Y-%m-%d").strftime("%d %b %Y") if when else "-",
            "type": (row.get("session_type") or "Shift").replace("_", " ").capitalize(),
            "worker": workers.get(str(row.get("worker_id") or ""), "-"),
            "duration": f"{minutes // 60}h {minutes % 60:02d}m" if minutes else "-",
            "status": (row.get("status") or "-").replace("_", " ").capitalize(),
        })
    for year in years.values():
        year["hours"] = round(year["minutes"] / 60, 1)
    context = resolve_merge_context(org_id, participant_id=participant_id)
    env = Environment(loader=FileSystemLoader(str(_TEMPLATES_DIR)), autoescape=select_autoescape(["html"]))
    html = env.get_template("shift_history.html").render(
        **context,
        years=list(years.values()),
        shift_count=len(rows),
        total_hours=round(total_minutes / 60, 1),
        period_label=period_label(date_from, date_to),
    )
    return render_html_to_pdf(html, base_url=str(_TEMPLATES_DIR))


async def export_records(
    user: dict,
    participant_id: str,
    sections: list[str],
    invoice_ids: list[str],
    output: str,
    *,
    all_invoices: bool = False,
    invoice_status: str | None = None,
    include_shifts: bool = False,
    date_from: date | None = None,
    date_to: date | None = None,
):
    if not has_org_wide_access(user):
        raise HTTPException(status_code=403, detail="Support coordinator access required.")
    ids = list(dict.fromkeys(invoice_ids))
    if all_invoices or ids:
        billing_service._require_billing_role(user)
    org_id = billing_service._require_org(user)
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="The end date must be on or after the start date.")
    if all_invoices and ids:
        raise HTTPException(status_code=422, detail="Choose either all invoices in the period or specific invoices, not both.")
    invoices = []
    skipped = []
    if all_invoices:
        query = _within_days(invoice_query(user, participant_id), "created_at", date_from, date_to)
        if invoice_status:
            query = query.eq("status", invoice_status)
        rows = query.order("created_at").order("id").limit(MAX_PERIOD_INVOICES + 1).execute().data or []
        if len(rows) > MAX_PERIOD_INVOICES:
            raise HTTPException(status_code=422, detail=f"This period has more than {MAX_PERIOD_INVOICES} invoices. Choose a shorter period.")
        # A bulk period export skips failed PDFs and lists them in Contents.txt
        # rather than blocking the whole download on one bad invoice.
        invoices = [row for row in rows if not row.get("pdf_generation_failed")]
        skipped = [row.get("invoice_number") or str(row["id"]) for row in rows if row.get("pdf_generation_failed")]
    elif ids:
        invoices = invoice_query(user, participant_id).in_("id", ids).execute().data or []
        if {str(row["id"]) for row in invoices} != set(ids):
            raise HTTPException(status_code=404, detail="One or more invoices are not linked to this participant or are no longer available.")
    if not sections and not invoices and not include_shifts:
        if all_invoices:
            raise HTTPException(status_code=422, detail="No invoices were found in this period.")
        raise HTTPException(status_code=422, detail="Choose at least one profile section, invoice or shift history.")
    if output == "pdf" and (bool(sections) + len(invoices) + include_shifts) != 1:
        raise HTTPException(status_code=422, detail="Choose a profile PDF, one invoice PDF, a shift history PDF, or a ZIP folder for multiple records.")
    files = {}
    if sections:
        _, content = await render_participant_profile_pdf(org_id, participant_id, sections=sections)
        files["Profile/participant-profile.pdf"] = content
    if include_shifts:
        files["Shift history/shift-history.pdf"] = render_shift_history_pdf(org_id, participant_id, date_from, date_to)
    invoice_files = {}
    for invoice in invoices:
        if invoice.get("pdf_generation_failed"):
            raise HTTPException(status_code=409, detail=f"Invoice {invoice['invoice_number']} has a failed PDF. Regenerate it in Invoicing before exporting.")
        path = invoice.get("pdf_path")
        if path:
            if not str(path).startswith(f"{org_id}/{invoice['id']}/") or ".." in str(path).split("/"):
                raise HTTPException(status_code=409, detail="The stored invoice file could not be verified.")
            content = get_supabase_admin().storage.from_(billing_service.INVOICE_FILES_BUCKET).download(path)
        else:
            # Render from the recorded invoice values. Exporting never changes its status.
            content = invoice_service.render_invoice_pdf(billing_service._build_template_data(invoice, get_supabase_admin()))
        if not content or not content.startswith(b"%PDF"):
            raise HTTPException(status_code=422, detail="An invoice PDF could not be prepared. No export was downloaded.")
        number = re.sub(r"[^A-Za-z0-9_-]+", "_", str(invoice.get("invoice_number") or "invoice"))[:80]
        filename = f"Invoices/{number}-{invoice['id']}.pdf"
        invoice_files[str(invoice["id"])] = filename
        files[filename] = content
    manifest = {
        "participant_id": participant_id,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "profile_sections": sections,
        "period": {"from": date_from.isoformat() if date_from else None, "to": date_to.isoformat() if date_to else None} if (all_invoices or include_shifts) else None,
        "invoices": [{"id": inv["id"], "invoice_number": inv.get("invoice_number"), "status": inv.get("status"), "file": invoice_files[str(inv["id"])]} for inv in invoices],
        "files": list(files),
        "skipped_invoices": skipped,
    }
    if output == "pdf":
        content = next(iter(files.values()))
        media_type, extension = "application/pdf", "pdf"
    else:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path, content in files.items():
                archive.writestr(path, content)
            archive.writestr("export-index.json", json.dumps(manifest, indent=2))
            archive.writestr("Contents.txt", "Participant records export\n" + f"Participant ID: {participant_id}\nGenerated: {manifest['exported_at']}\n\n" + "\n".join(files) + (f"\n\nSkipped (PDF failed, regenerate in Invoicing): {', '.join(skipped)}" if skipped else "") + "\n\nOnly selected records are included. Profile sections reflect the current record. Invoice PDFs may show the status recorded when originally generated.")
        content = buffer.getvalue()
        media_type, extension = "application/zip", "zip"
    await audit_service.log_action(action_type="participant.records_exported", entity_type="participant", entity_id=participant_id, organization_id=org_id, user_id=billing_service.get_user_id(user), details={"profile_sections": sections, "invoice_ids": [str(inv["id"]) for inv in invoices], "all_invoices": all_invoices, "include_shifts": include_shifts, "date_from": date_from.isoformat() if date_from else None, "date_to": date_to.isoformat() if date_to else None, "format": output})
    filename = next(iter(files)).split("/")[-1] if output == "pdf" and (invoices or include_shifts) else f"participant-{participant_id}-records.{extension}"
    return filename, content, media_type
