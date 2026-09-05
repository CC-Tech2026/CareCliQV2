"""MD Documents & Audit Vault.

Normalizes 17 record "folders" — 8 existing participant/worker record types
plus 9 new org-level governance folders — into one browsable, searchable,
shareable document list for the managing director. Most categories wrap
tables that already exist elsewhere in the app (sessions, incidents,
ndis_plans, medications, credentials, invoices, worker/applicant onboarding
docs, plan-meeting consent); governance_documents and audit_pack_exports are
new, purpose-built for this vault.

Two responsibilities per category, kept table-driven via _RECORD_LOADERS /
_RECORD_RENDERERS rather than one function per concern:
  - list: normalize rows into VaultDocument for the folder table/search.
  - render: produce real downloadable bytes for the ZIP pack — either a
    passthrough of an already-stored file, or (for DB-row-only categories
    with no backing file) a lightweight PDF rendered on demand.
"""

from __future__ import annotations

import io
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, TypedDict
from uuid import uuid4

from fastapi import HTTPException

from .organization_branding_service import build_pdf_letterhead
from .supabase_client import get_supabase_admin, signed_storage_url

logger = logging.getLogger(__name__)


class VaultDocument(TypedDict):
    id: str
    category: str
    folder_label: str
    title: str
    person_name: str
    person_type: str  # "Participant" | "Worker" | "Organisation"
    date: str
    status: str
    source_table: str
    source_id: str
    has_stored_file: bool


GOVERNANCE_FOLDER_KEYS = (
    "governance_operational",
    "risk_management",
    "quality_management",
    "information_management",
    "feedback_complaints",
    "incident_management_system",
    "human_resource_management",
    "continuity_of_supports",
    "emergency_disaster_management",
)

CATEGORY_META: dict[str, dict[str, str]] = {
    "session_notes": {"label": "Session & Progress Notes", "group": "record"},
    "incident_reports": {"label": "Incident Reports", "group": "record"},
    "ndis_plans": {"label": "NDIS Plans & Goals", "group": "record"},
    "medication_records": {"label": "Medication & Clinical Records", "group": "record"},
    "worker_credentials": {"label": "Worker Credentials & Certifications", "group": "record"},
    "invoices": {"label": "Invoices & Billing Records", "group": "record"},
    "audit_packs": {"label": "Audit Packs & Compliance Reports", "group": "record"},
    "consent_onboarding": {"label": "Signed Consent & Onboarding Docs", "group": "record"},
    "governance_operational": {"label": "Governance & Operational Management", "group": "governance"},
    "risk_management": {"label": "Risk Management", "group": "governance"},
    "quality_management": {"label": "Quality Management", "group": "governance"},
    "information_management": {"label": "Information Management", "group": "governance"},
    "feedback_complaints": {"label": "Feedback & Complaints Management", "group": "governance"},
    "incident_management_system": {"label": "Incident Management System", "group": "governance"},
    "human_resource_management": {"label": "Human Resource Management", "group": "governance"},
    "continuity_of_supports": {"label": "Continuity of Supports", "group": "governance"},
    "emergency_disaster_management": {"label": "Emergency & Disaster Management", "group": "governance"},
}

# Statuses across every source table that mean "needs an MD's attention" —
# used only to compute the Vault Home "flagged for review" stat.
FLAGGED_STATUSES = {
    "reported", "under_investigation", "expiring", "expired", "pending_review",
    "refused", "missed", "withheld", "overdue", "pending", "in-review",
}

# Field/section labels an MD can choose to leave out of a specific share,
# per category - only categories rendered on demand from structured DB rows
# have anything here; file-backed categories (credentials, governance docs,
# custom-folder uploads...) have no structured content to redact this way.
# Labels here must exactly match the meta/section labels each _render_*
# function actually builds.
CUSTOMIZABLE_FIELDS: dict[str, list[str]] = {
    "session_notes": [
        "Compliance score",
        "Support worker",
        "Activities performed",
        "Participant response and presentation",
        "Progress toward NDIS goals",
        "Notes",
        "Outcomes",
    ],
    "incident_reports": ["Severity", "Description", "Corrective actions"],
    "ndis_plans": ["Total funding"],
    "medication_records": ["Dose given", "Notes"],
    "invoices": ["Total"],
    "consent_onboarding": ["Consent method"],
}


def get_customizable_fields(category: str) -> list[str]:
    return CUSTOMIZABLE_FIELDS.get(category, [])

GOVERNANCE_BUCKET = "governance-documents"
GOVERNANCE_ALLOWED_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
}
GOVERNANCE_MAX_BYTES = 20 * 1024 * 1024

VALID_SHARE_METHODS = {"download_zip", "email_gmail", "email_outlook", "email_mailto"}


# ── Name-lookup helpers (batched per org, not per-row, to avoid N+1) ──────────

def _patient_name_map(org_id: str) -> dict[str, str]:
    try:
        resp = (
            get_supabase_admin().table("patients")
            .select("id, full_name")
            .eq("organization_id", org_id)
            .execute()
        )
        return {row["id"]: row.get("full_name") or "Unknown participant" for row in (resp.data or [])}
    except Exception:
        return {}


def _user_name_map(org_id: str) -> dict[str, str]:
    try:
        resp = (
            get_supabase_admin().table("users")
            .select("id, full_name")
            .eq("organization_id", org_id)
            .execute()
        )
        return {row["id"]: row.get("full_name") or "Unknown worker" for row in (resp.data or [])}
    except Exception:
        return {}


def _applicant_name_map(org_id: str) -> dict[str, str]:
    try:
        resp = (
            get_supabase_admin().table("applicants")
            .select("id, full_name")
            .eq("organization_id", org_id)
            .execute()
        )
        return {row["id"]: row.get("full_name") or "Unknown applicant" for row in (resp.data or [])}
    except Exception:
        return {}


def _org_name(org_id: str) -> str:
    try:
        resp = (
            get_supabase_admin().table("organizations")
            .select("organization_name")
            .eq("organization_id", org_id)
            .limit(1)
            .execute()
        )
        row = (resp.data or [None])[0]
        return (row or {}).get("organization_name") or "Organisation"
    except Exception:
        return "Organisation"


def _download_stored_file(bucket_name: str, file_path: str) -> bytes:
    try:
        return get_supabase_admin().storage.from_(bucket_name).download(file_path)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not retrieve stored file: {exc}")


# ── Lightweight per-record PDF rendering for DB-row-only categories ───────────
# Mirrors shift_pdf_export_service's reportlab pattern, without the
# signature-block machinery that's specific to shift PDFs.

def _filter_meta(meta_rows: list[tuple[str, str]], exclude: set[str] | None) -> list[tuple[str, str]]:
    if not exclude:
        return meta_rows
    return [(k, v) for k, v in meta_rows if k not in exclude]


def _filter_sections(sections: list[tuple[str, str]], exclude: set[str] | None) -> list[tuple[str, str]]:
    if not exclude:
        return [s for s in sections if s[1] and s[1].strip()]
    return [s for s in sections if s[0] not in exclude and s[1] and s[1].strip()]


def _render_record_pdf(
    org_id: str,
    title: str,
    meta_rows: list[tuple[str, str]],
    sections: list[tuple[str, str]] | None = None,
    *,
    exclude: set[str] | None = None,
) -> bytes:
    """Build a lightweight per-record PDF from labelled meta rows (a small
    key/value table) and labelled body sections. Both are filtered by
    `exclude` (field labels the MD chose to leave out of this particular
    share) before anything is rendered, so an excluded field never actually
    reaches the PDF bytes - not just hidden in a viewer."""
    meta_rows = _filter_meta(meta_rows, exclude)
    sections = _filter_sections(sections or [], exclude)

    try:
        from reportlab.lib.colors import HexColor
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    except ImportError:
        return _minimal_record_pdf(title, meta_rows, sections)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, title=title, author="CareCliQ", lang="en-AU")
    styles = getSampleStyleSheet()

    story: list[Any] = []
    try:
        letterhead_flowables, accent = build_pdf_letterhead(org_id)
        story.extend(letterhead_flowables)
    except Exception as exc:
        logger.warning("Could not build PDF letterhead for org %s: %s", org_id, exc)
        accent = "#1B1745"

    title_style = ParagraphStyle("Title", parent=styles["Heading1"], fontSize=15, spaceAfter=8, textColor=HexColor(accent))
    heading_style = ParagraphStyle("Section", parent=styles["Heading2"], fontSize=11, spaceBefore=8, spaceAfter=3)
    body_style = ParagraphStyle("Body", parent=styles["BodyText"], fontSize=10, leading=14)

    story.extend([Paragraph(title, title_style), Spacer(1, 3 * mm)])
    if meta_rows:
        table = Table([[k, v] for k, v in meta_rows], colWidths=[40 * mm, 125 * mm])
        table.setStyle(
            TableStyle(
                [
                    ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 10),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        story.append(table)
    for label, text_value in sections:
        story.append(Spacer(1, 3 * mm))
        story.append(Paragraph(label, heading_style))
        for line in text_value.splitlines() or [text_value]:
            story.append(Paragraph(line or " ", body_style))

    doc.build(story)
    return buffer.getvalue()


def _minimal_record_pdf(title: str, meta_rows: list[tuple[str, str]], sections: list[tuple[str, str]] | None = None) -> bytes:
    lines = [title, ""] + [f"{k}: {v}" for k, v in meta_rows]
    for label, text_value in sections or []:
        lines += ["", f"{label}:", text_value]
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


# ── Per-category list/render pairs ─────────────────────────────────────────

def _list_sessions(org_id: str) -> list[VaultDocument]:
    try:
        resp = (
            get_supabase_admin().table("sessions")
            .select("id, patient_id, session_date, session_type, status, created_at")
            .eq("organization_id", org_id)
            .order("session_date", desc=True)
            .limit(500)
            .execute()
        )
    except Exception:
        return []
    patients = _patient_name_map(org_id)
    return [
        VaultDocument(
            id=row["id"],
            category="session_notes",
            folder_label=CATEGORY_META["session_notes"]["label"],
            title=f"{(row.get('session_type') or 'Session').title()} note",
            person_name=patients.get(row.get("patient_id") or "", "Unknown participant"),
            person_type="Participant",
            date=str(row.get("session_date") or row.get("created_at") or ""),
            status=row.get("status") or "draft",
            source_table="sessions",
            source_id=row["id"],
            has_stored_file=False,
        )
        for row in (resp.data or [])
    ]


def _render_session(org_id: str, document_id: str, exclude_fields: set[str] | None = None) -> tuple[str, bytes]:
    resp = (
        get_supabase_admin()
        .table("sessions")
        .select(
            "id, patient_id, session_date, session_type, duration_minutes, status, "
            "worker_id, support_worker_id, notes, outcomes, activities_performed, "
            "participant_response, progress_toward_goals, goals_addressed, compliance_score"
        )
        .eq("id", document_id)
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    )
    row = (resp.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail="Session note not found.")
    patients = _patient_name_map(org_id)

    # Worker's name AND role - a progress note needs to say who provided the
    # support and in what capacity, not just link an id.
    worker_id = row.get("worker_id") or row.get("support_worker_id")
    worker_display = "—"
    if worker_id:
        try:
            wresp = (
                get_supabase_admin()
                .table("users")
                .select("full_name, role")
                .eq("id", worker_id)
                .limit(1)
                .execute()
            )
            wrow = (wresp.data or [None])[0]
            if wrow:
                name = wrow.get("full_name") or "Unknown worker"
                role = wrow.get("role")
                worker_display = f"{name} ({role.replace('_', ' ').title()})" if role else name
        except Exception:
            pass

    session_dt = str(row.get("session_date") or "")
    duration = row.get("duration_minutes")

    goals = row.get("goals_addressed")
    if isinstance(goals, list):
        goals_text = ", ".join(str(g) for g in goals)
    else:
        goals_text = str(goals or "")

    meta = [
        ("Participant", patients.get(row.get("patient_id") or "", "Unknown participant")),
        ("Date", session_dt[:10]),
        ("Time", session_dt[11:16] if len(session_dt) >= 16 else "—"),
        ("Duration", f"{duration} minutes" if duration else "—"),
        ("Support worker", worker_display),
        ("Type", row.get("session_type") or "—"),
        ("Status", row.get("status") or "—"),
        ("Compliance score", f"{row.get('compliance_score')}%" if row.get("compliance_score") is not None else "—"),
    ]
    sections = [
        ("Activities performed", (row.get("activities_performed") or "").strip()),
        ("Participant response and presentation", (row.get("participant_response") or "").strip()),
        ("Progress toward NDIS goals", (row.get("progress_toward_goals") or "").strip() or goals_text),
        ("Notes", (row.get("notes") or "").strip()),
        ("Outcomes", (row.get("outcomes") or "").strip()),
    ]
    pdf = _render_record_pdf(org_id, "Session Note", meta, sections, exclude=exclude_fields)
    return f"session-note-{document_id[:8]}.pdf", pdf


def _list_incidents(org_id: str) -> list[VaultDocument]:
    try:
        resp = (
            get_supabase_admin()
            .table("incidents")
            .select("id, participant_id, title, incident_type, severity, status, incident_date")
            .eq("organization_id", org_id)
            .order("incident_date", desc=True)
            .limit(500)
            .execute()
        )
    except Exception:
        return []
    patients = _patient_name_map(org_id)
    return [
        VaultDocument(
            id=row["id"],
            category="incident_reports",
            folder_label=CATEGORY_META["incident_reports"]["label"],
            title=row.get("title") or "Incident report",
            person_name=patients.get(row.get("participant_id") or "", "Unknown participant"),
            person_type="Participant",
            date=str(row.get("incident_date") or ""),
            status=row.get("status") or "reported",
            source_table="incidents",
            source_id=row["id"],
            has_stored_file=False,
        )
        for row in (resp.data or [])
    ]


def _render_incident(org_id: str, document_id: str, exclude_fields: set[str] | None = None) -> tuple[str, bytes]:
    resp = (
        get_supabase_admin()
        .table("incidents")
        .select("id, participant_id, title, description, incident_type, severity, status, incident_date, corrective_actions")
        .eq("id", document_id)
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    )
    row = (resp.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail="Incident report not found.")
    patients = _patient_name_map(org_id)
    meta = [
        ("Participant", patients.get(row.get("participant_id") or "", "Unknown participant")),
        ("Date", str(row.get("incident_date") or "")[:10]),
        ("Type", row.get("incident_type") or "—"),
        ("Severity", row.get("severity") or "—"),
        ("Status", row.get("status") or "—"),
    ]
    sections = [
        ("Description", (row.get("description") or "").strip()),
        ("Corrective actions", (row.get("corrective_actions") or "").strip()),
    ]
    pdf = _render_record_pdf(org_id, row.get("title") or "Incident Report", meta, sections, exclude=exclude_fields)
    return f"incident-{document_id[:8]}.pdf", pdf


def _list_ndis_plans(org_id: str) -> list[VaultDocument]:
    try:
        resp = (
            get_supabase_admin()
            .table("ndis_plans")
            .select("id, patient_id, plan_number, plan_start, plan_end, status")
            .eq("organization_id", org_id)
            .order("plan_start", desc=True)
            .limit(500)
            .execute()
        )
    except Exception:
        return []
    patients = _patient_name_map(org_id)
    return [
        VaultDocument(
            id=row["id"],
            category="ndis_plans",
            folder_label=CATEGORY_META["ndis_plans"]["label"],
            title=(f"NDIS plan {row.get('plan_number')}" if row.get("plan_number") else "NDIS plan"),
            person_name=patients.get(row.get("patient_id") or "", "Unknown participant"),
            person_type="Participant",
            date=str(row.get("plan_start") or ""),
            status=row.get("status") or "active",
            source_table="ndis_plans",
            source_id=row["id"],
            has_stored_file=False,
        )
        for row in (resp.data or [])
    ]


def _render_ndis_plan(org_id: str, document_id: str, exclude_fields: set[str] | None = None) -> tuple[str, bytes]:
    resp = (
        get_supabase_admin()
        .table("ndis_plans")
        .select("id, patient_id, plan_number, plan_start, plan_end, total_funding, status")
        .eq("id", document_id)
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    )
    row = (resp.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail="NDIS plan not found.")
    patients = _patient_name_map(org_id)
    meta = [
        ("Participant", patients.get(row.get("patient_id") or "", "Unknown participant")),
        ("Plan number", row.get("plan_number") or "—"),
        ("Plan period", f"{row.get('plan_start')} to {row.get('plan_end')}"),
        ("Total funding", f"${row.get('total_funding')}" if row.get("total_funding") is not None else "—"),
        ("Status", row.get("status") or "—"),
    ]
    pdf = _render_record_pdf(org_id, "NDIS Plan Summary", meta, exclude=exclude_fields)
    return f"ndis-plan-{document_id[:8]}.pdf", pdf


def _list_medication_records(org_id: str) -> list[VaultDocument]:
    docs: list[VaultDocument] = []
    patients = _patient_name_map(org_id)

    try:
        resp = (
            get_supabase_admin()
            .table("medication_documents")
            .select("id, participant_id, document_type, uploaded_at")
            .eq("organization_id", org_id)
            .order("uploaded_at", desc=True)
            .limit(300)
            .execute()
        )
        for row in resp.data or []:
            docs.append(
                VaultDocument(
                    id=row["id"],
                    category="medication_records",
                    folder_label=CATEGORY_META["medication_records"]["label"],
                    title=(row.get("document_type") or "medication_document").replace("_", " ").title(),
                    person_name=patients.get(row.get("participant_id") or "", "Unknown participant"),
                    person_type="Participant",
                    date=str(row.get("uploaded_at") or ""),
                    status="on_file",
                    source_table="medication_documents",
                    source_id=row["id"],
                    has_stored_file=True,
                )
            )
    except Exception:
        pass

    try:
        resp = (
            get_supabase_admin()
            .table("medication_administrations")
            .select("id, participant_id, status, administered_time")
            .eq("organization_id", org_id)
            .order("administered_time", desc=True)
            .limit(300)
            .execute()
        )
        for row in resp.data or []:
            docs.append(
                VaultDocument(
                    id=row["id"],
                    category="medication_records",
                    folder_label=CATEGORY_META["medication_records"]["label"],
                    title="Medication administration record",
                    person_name=patients.get(row.get("participant_id") or "", "Unknown participant"),
                    person_type="Participant",
                    date=str(row.get("administered_time") or ""),
                    status=row.get("status") or "given",
                    source_table="medication_administrations",
                    source_id=row["id"],
                    has_stored_file=False,
                )
            )
    except Exception:
        pass

    return docs


def _render_medication_record(org_id: str, document_id: str, exclude_fields: set[str] | None = None) -> tuple[str, bytes]:
    resp = (
        get_supabase_admin()
        .table("medication_documents")
        .select("id, file_path, file_name")
        .eq("id", document_id)
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    )
    row = (resp.data or [None])[0]
    if row and row.get("file_path"):
        data = _download_stored_file("medication-documents", row["file_path"])
        return row.get("file_name") or f"medication-doc-{document_id[:8]}", data

    resp = (
        get_supabase_admin()
        .table("medication_administrations")
        .select("id, participant_id, status, administered_time, dose_given, notes, prn_reason")
        .eq("id", document_id)
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    )
    row = (resp.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail="Medication record not found.")
    patients = _patient_name_map(org_id)
    meta = [
        ("Participant", patients.get(row.get("participant_id") or "", "Unknown participant")),
        ("Administered", str(row.get("administered_time") or "")[:19]),
        ("Status", row.get("status") or "—"),
        ("Dose given", row.get("dose_given") or "—"),
    ]
    sections = [("Notes", (row.get("notes") or row.get("prn_reason") or "").strip())]
    pdf = _render_record_pdf(org_id, "Medication Administration Record", meta, sections, exclude=exclude_fields)
    return f"medication-admin-{document_id[:8]}.pdf", pdf


def _list_credentials(org_id: str) -> list[VaultDocument]:
    try:
        resp = (
            get_supabase_admin()
            .table("credentials")
            .select("id, user_id, credential_type, title, status, issue_date, file_path")
            .eq("organization_id", org_id)
            .order("issue_date", desc=True)
            .limit(500)
            .execute()
        )
    except Exception:
        return []
    workers = _user_name_map(org_id)
    return [
        VaultDocument(
            id=row["id"],
            category="worker_credentials",
            folder_label=CATEGORY_META["worker_credentials"]["label"],
            title=row.get("title") or (row.get("credential_type") or "Credential"),
            person_name=workers.get(row.get("user_id") or "", "Unknown worker"),
            person_type="Worker",
            date=str(row.get("issue_date") or ""),
            status=row.get("status") or "pending_review",
            source_table="credentials",
            source_id=row["id"],
            has_stored_file=bool(row.get("file_path")),
        )
        for row in (resp.data or [])
    ]


def _render_credential(org_id: str, document_id: str, exclude_fields: set[str] | None = None) -> tuple[str, bytes]:
    resp = (
        get_supabase_admin()
        .table("credentials")
        .select("id, title, file_path")
        .eq("id", document_id)
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    )
    row = (resp.data or [None])[0]
    if not row or not row.get("file_path"):
        raise HTTPException(status_code=404, detail="Credential file not found.")
    data = _download_stored_file("credential-files", row["file_path"])
    ext = row["file_path"].rsplit(".", 1)[-1] if "." in row["file_path"] else "pdf"
    safe_title = re.sub(r"[^A-Za-z0-9._-]+", "-", row.get("title") or "credential").strip("-")
    return f"{safe_title}.{ext}", data


def _list_invoices(org_id: str) -> list[VaultDocument]:
    try:
        resp = (
            get_supabase_admin()
            .table("invoices")
            .select("id, participant_id, invoice_number, invoice_date, status")
            .eq("organization_id", org_id)
            .order("invoice_date", desc=True)
            .limit(500)
            .execute()
        )
    except Exception:
        return []
    patients = _patient_name_map(org_id)
    return [
        VaultDocument(
            id=row["id"],
            category="invoices",
            folder_label=CATEGORY_META["invoices"]["label"],
            title=(f"Invoice {row.get('invoice_number')}" if row.get("invoice_number") else "Invoice"),
            person_name=patients.get(row.get("participant_id") or "", "Unknown participant"),
            person_type="Participant",
            date=str(row.get("invoice_date") or ""),
            status=row.get("status") or "draft",
            source_table="invoices",
            source_id=row["id"],
            has_stored_file=False,
        )
        for row in (resp.data or [])
    ]


def _render_invoice(org_id: str, document_id: str, exclude_fields: set[str] | None = None) -> tuple[str, bytes]:
    resp = (
        get_supabase_admin()
        .table("invoices")
        .select("id, participant_id, invoice_number, invoice_date, period_start, period_end, total_amount, status")
        .eq("id", document_id)
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    )
    row = (resp.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail="Invoice not found.")
    patients = _patient_name_map(org_id)
    meta = [
        ("Participant", patients.get(row.get("participant_id") or "", "Unknown participant")),
        ("Invoice number", row.get("invoice_number") or "—"),
        ("Invoice date", str(row.get("invoice_date") or "")[:10]),
        ("Period", f"{row.get('period_start')} to {row.get('period_end')}"),
        ("Total", f"${row.get('total_amount')}" if row.get("total_amount") is not None else "—"),
        ("Status", row.get("status") or "—"),
    ]
    pdf = _render_record_pdf(org_id, "Invoice Summary", meta, exclude=exclude_fields)
    return f"invoice-{row.get('invoice_number') or document_id[:8]}.pdf", pdf


def _list_consent_onboarding(org_id: str) -> list[VaultDocument]:
    docs: list[VaultDocument] = []
    workers = _user_name_map(org_id)
    applicants = _applicant_name_map(org_id)
    patients = _patient_name_map(org_id)

    try:
        resp = (
            get_supabase_admin()
            .table("worker_onboarding_documents")
            .select("id, worker_id, document_type, title, created_at")
            .eq("organization_id", org_id)
            .order("created_at", desc=True)
            .limit(300)
            .execute()
        )
        for row in resp.data or []:
            docs.append(
                VaultDocument(
                    id=row["id"],
                    category="consent_onboarding",
                    folder_label=CATEGORY_META["consent_onboarding"]["label"],
                    title=row.get("title") or "Onboarding document",
                    person_name=workers.get(row.get("worker_id") or "", "Unknown worker"),
                    person_type="Worker",
                    date=str(row.get("created_at") or ""),
                    status="on_file",
                    source_table="worker_onboarding_documents",
                    source_id=row["id"],
                    has_stored_file=True,
                )
            )
    except Exception:
        pass

    try:
        resp = (
            get_supabase_admin()
            .table("applicant_documents")
            .select("id, applicant_id, document_type, title, created_at")
            .eq("organization_id", org_id)
            .order("created_at", desc=True)
            .limit(300)
            .execute()
        )
        for row in resp.data or []:
            docs.append(
                VaultDocument(
                    id=row["id"],
                    category="consent_onboarding",
                    folder_label=CATEGORY_META["consent_onboarding"]["label"],
                    title=row.get("title") or "Applicant document",
                    person_name=applicants.get(row.get("applicant_id") or "", "Unknown applicant"),
                    person_type="Worker",
                    date=str(row.get("created_at") or ""),
                    status="on_file",
                    source_table="applicant_documents",
                    source_id=row["id"],
                    has_stored_file=True,
                )
            )
    except Exception:
        pass

    try:
        resp = (
            get_supabase_admin()
            .table("plan_meeting_sessions")
            .select("id, participant_id, consent_given_by, consent_method, consent_confirmed_at")
            .eq("organization_id", org_id)
            .not_.is_("consent_confirmed_at", "null")
            .order("consent_confirmed_at", desc=True)
            .limit(300)
            .execute()
        )
        for row in resp.data or []:
            docs.append(
                VaultDocument(
                    id=row["id"],
                    category="consent_onboarding",
                    folder_label=CATEGORY_META["consent_onboarding"]["label"],
                    title="Plan meeting consent",
                    person_name=patients.get(row.get("participant_id") or "", "Unknown participant"),
                    person_type="Participant",
                    date=str(row.get("consent_confirmed_at") or ""),
                    status="on_file",
                    source_table="plan_meeting_sessions",
                    source_id=row["id"],
                    has_stored_file=False,
                )
            )
    except Exception:
        pass

    return docs


def _render_consent_onboarding(org_id: str, document_id: str, exclude_fields: set[str] | None = None) -> tuple[str, bytes]:
    resp = (
        get_supabase_admin()
        .table("worker_onboarding_documents")
        .select("id, title, file_path")
        .eq("id", document_id)
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    )
    row = (resp.data or [None])[0]
    if row and row.get("file_path"):
        data = _download_stored_file("worker-onboarding-files", row["file_path"])
        ext = row["file_path"].rsplit(".", 1)[-1] if "." in row["file_path"] else "pdf"
        safe = re.sub(r"[^A-Za-z0-9._-]+", "-", row.get("title") or "onboarding-document").strip("-")
        return f"{safe}.{ext}", data

    resp = (
        get_supabase_admin()
        .table("applicant_documents")
        .select("id, title, file_path")
        .eq("id", document_id)
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    )
    row = (resp.data or [None])[0]
    if row and row.get("file_path"):
        data = _download_stored_file("applicant-files", row["file_path"])
        ext = row["file_path"].rsplit(".", 1)[-1] if "." in row["file_path"] else "pdf"
        safe = re.sub(r"[^A-Za-z0-9._-]+", "-", row.get("title") or "applicant-document").strip("-")
        return f"{safe}.{ext}", data

    resp = (
        get_supabase_admin()
        .table("plan_meeting_sessions")
        .select("id, participant_id, consent_given_by, consent_method, consent_confirmed_at")
        .eq("id", document_id)
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    )
    row = (resp.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail="Consent/onboarding document not found.")
    patients = _patient_name_map(org_id)
    meta = [
        ("Participant", patients.get(row.get("participant_id") or "", "Unknown participant")),
        ("Consent given by", row.get("consent_given_by") or "—"),
        ("Consent method", row.get("consent_method") or "—"),
        ("Confirmed at", str(row.get("consent_confirmed_at") or "")[:19]),
    ]
    pdf = _render_record_pdf(org_id, "Plan Meeting Consent Record", meta, exclude=exclude_fields)
    return f"consent-{document_id[:8]}.pdf", pdf


def _list_audit_packs(org_id: str) -> list[VaultDocument]:
    try:
        resp = (
            get_supabase_admin()
            .table("audit_pack_exports")
            .select("id, label, created_at")
            .eq("organization_id", org_id)
            .order("created_at", desc=True)
            .limit(200)
            .execute()
        )
    except Exception:
        return []
    org_name = _org_name(org_id)
    return [
        VaultDocument(
            id=row["id"],
            category="audit_packs",
            folder_label=CATEGORY_META["audit_packs"]["label"],
            title=row.get("label") or "Audit pack",
            person_name=org_name,
            person_type="Organisation",
            date=str(row.get("created_at") or ""),
            status="generated",
            source_table="audit_pack_exports",
            source_id=row["id"],
            has_stored_file=True,
        )
        for row in (resp.data or [])
    ]


def _render_audit_pack(org_id: str, document_id: str, exclude_fields: set[str] | None = None) -> tuple[str, bytes]:
    resp = (
        get_supabase_admin()
        .table("audit_pack_exports")
        .select("id, label, file_path")
        .eq("id", document_id)
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    )
    row = (resp.data or [None])[0]
    if not row or not row.get("file_path"):
        raise HTTPException(status_code=404, detail="Audit pack not found.")
    data = _download_stored_file("audit-pack-files", row["file_path"])
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", row.get("label") or "audit-pack").strip("-")
    return f"{safe}.json", data


def _list_governance(org_id: str, folder_key: str) -> list[VaultDocument]:
    try:
        resp = (
            get_supabase_admin()
            .table("governance_documents")
            .select("id, title, created_at")
            .eq("organization_id", org_id)
            .eq("folder_key", folder_key)
            .is_("deleted_at", "null")
            .order("created_at", desc=True)
            .limit(300)
            .execute()
        )
    except Exception:
        return []
    org_name = _org_name(org_id)
    return [
        VaultDocument(
            id=row["id"],
            category=folder_key,
            folder_label=CATEGORY_META[folder_key]["label"],
            title=row.get("title") or "Policy document",
            person_name=org_name,
            person_type="Organisation",
            date=str(row.get("created_at") or ""),
            status="on_file",
            source_table="governance_documents",
            source_id=row["id"],
            has_stored_file=True,
        )
        for row in (resp.data or [])
    ]


def _render_governance_file(org_id: str, category: str, document_id: str) -> tuple[str, bytes]:
    resp = (
        get_supabase_admin()
        .table("governance_documents")
        .select("id, title, file_path")
        .eq("id", document_id)
        .eq("organization_id", org_id)
        .eq("folder_key", category)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    row = (resp.data or [None])[0]
    if not row or not row.get("file_path"):
        raise HTTPException(status_code=404, detail="Governance document not found.")
    data = _download_stored_file(GOVERNANCE_BUCKET, row["file_path"])
    ext = row["file_path"].rsplit(".", 1)[-1] if "." in row["file_path"] else "pdf"
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", row.get("title") or "policy-document").strip("-")
    return f"{safe}.{ext}", data


_RECORD_LOADERS = {
    "session_notes": _list_sessions,
    "incident_reports": _list_incidents,
    "ndis_plans": _list_ndis_plans,
    "medication_records": _list_medication_records,
    "worker_credentials": _list_credentials,
    "invoices": _list_invoices,
    "consent_onboarding": _list_consent_onboarding,
    "audit_packs": _list_audit_packs,
}

_RECORD_RENDERERS = {
    "session_notes": _render_session,
    "incident_reports": _render_incident,
    "ndis_plans": _render_ndis_plan,
    "medication_records": _render_medication_record,
    "worker_credentials": _render_credential,
    "invoices": _render_invoice,
    "consent_onboarding": _render_consent_onboarding,
    "audit_packs": _render_audit_pack,
}


# ── Filtering, folder listing, document rendering (public API) ────────────

CUSTOM_FOLDER_PREFIX = "custom:"
CUSTOM_FOLDER_BUCKET = "vault-custom-files"
CUSTOM_FOLDER_ALLOWED_TYPES = GOVERNANCE_ALLOWED_TYPES
CUSTOM_FOLDER_MAX_BYTES = GOVERNANCE_MAX_BYTES


def _custom_folder_category(folder_id: str) -> str:
    return f"{CUSTOM_FOLDER_PREFIX}{folder_id}"


def _custom_folder_id(category: str) -> str:
    return category[len(CUSTOM_FOLDER_PREFIX):]


def list_custom_folders(org_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("vault_custom_folders")
            .select("id, label, description, folder_group, created_at")
            .eq("organization_id", org_id)
            .is_("deleted_at", "null")
            .order("created_at")
            .execute()
        )
        return resp.data or []
    except Exception:
        return []


def create_custom_folder(
    org_id: str,
    label: str,
    description: str | None,
    created_by: str,
    group: str = "record",
) -> dict[str, Any]:
    if not label.strip():
        raise HTTPException(status_code=422, detail="Folder name is required.")
    if group not in ("record", "governance"):
        raise HTTPException(status_code=422, detail="Folder group must be 'record' or 'governance'.")
    payload = {
        "organization_id": org_id,
        "label": label.strip(),
        "description": (description or "").strip() or None,
        "folder_group": group,
        "created_by": created_by,
    }
    result = get_supabase_admin().table("vault_custom_folders").insert(payload).execute()
    row = result.data[0] if result.data else payload
    return {**row, "category": _custom_folder_category(row["id"])}


def _list_custom_folder_documents(org_id: str, folder_id: str) -> list[VaultDocument]:
    try:
        folder_resp = (
            get_supabase_admin()
            .table("vault_custom_folders")
            .select("label")
            .eq("id", folder_id)
            .eq("organization_id", org_id)
            .is_("deleted_at", "null")
            .limit(1)
            .execute()
        )
    except Exception:
        return []
    if not folder_resp.data:
        return []
    label = folder_resp.data[0].get("label") or "Folder"

    try:
        resp = (
            get_supabase_admin()
            .table("vault_custom_folder_documents")
            .select("id, title, created_at")
            .eq("folder_id", folder_id)
            .eq("organization_id", org_id)
            .is_("deleted_at", "null")
            .order("created_at", desc=True)
            .limit(300)
            .execute()
        )
    except Exception:
        return []
    org_name = _org_name(org_id)
    category = _custom_folder_category(folder_id)
    return [
        VaultDocument(
            id=row["id"],
            category=category,
            folder_label=label,
            title=row.get("title") or "Document",
            person_name=org_name,
            person_type="Organisation",
            date=str(row.get("created_at") or ""),
            status="on_file",
            source_table="vault_custom_folder_documents",
            source_id=row["id"],
            has_stored_file=True,
        )
        for row in (resp.data or [])
    ]


def _render_custom_folder_file(org_id: str, folder_id: str, document_id: str) -> tuple[str, bytes]:
    resp = (
        get_supabase_admin()
        .table("vault_custom_folder_documents")
        .select("id, title, file_path")
        .eq("id", document_id)
        .eq("folder_id", folder_id)
        .eq("organization_id", org_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    row = (resp.data or [None])[0]
    if not row or not row.get("file_path"):
        raise HTTPException(status_code=404, detail="Document not found.")
    data = _download_stored_file(CUSTOM_FOLDER_BUCKET, row["file_path"])
    ext = row["file_path"].rsplit(".", 1)[-1] if "." in row["file_path"] else "pdf"
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", row.get("title") or "document").strip("-")
    return f"{safe}.{ext}", data


async def upload_custom_folder_document(
    org_id: str,
    folder_id: str,
    title: str,
    uploaded_by: str,
    file_bytes: bytes,
    content_type: str,
) -> dict[str, Any]:
    existing = (
        get_supabase_admin()
        .table("vault_custom_folders")
        .select("id")
        .eq("id", folder_id)
        .eq("organization_id", org_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Folder not found.")
    if not title.strip():
        raise HTTPException(status_code=422, detail="Document title is required.")
    if content_type not in CUSTOM_FOLDER_ALLOWED_TYPES:
        raise HTTPException(status_code=422, detail="Document must be PDF or image (JPEG/PNG).")
    if len(file_bytes) > CUSTOM_FOLDER_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Document must be 20MB or smaller.")

    doc_id = str(uuid4())
    ext = CUSTOM_FOLDER_ALLOWED_TYPES[content_type]
    path = f"{org_id}/{folder_id}/{doc_id}-{uuid4().hex}{ext}"
    supabase = get_supabase_admin()
    try:
        supabase.storage.from_(CUSTOM_FOLDER_BUCKET).upload(
            path, file_bytes, {"content-type": content_type, "upsert": "true"}
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Document storage is not configured: {exc}")

    payload = {
        "id": doc_id,
        "folder_id": folder_id,
        "organization_id": org_id,
        "title": title.strip(),
        "file_path": path,
        "file_url": signed_storage_url(CUSTOM_FOLDER_BUCKET, path),
        "mime_type": content_type,
        "file_size_bytes": len(file_bytes),
        "uploaded_by": uploaded_by,
    }
    result = supabase.table("vault_custom_folder_documents").insert(payload).execute()
    return result.data[0] if result.data else payload


def delete_custom_folder_document(org_id: str, folder_id: str, document_id: str) -> None:
    supabase = get_supabase_admin()
    existing = (
        supabase.table("vault_custom_folder_documents")
        .select("id")
        .eq("id", document_id)
        .eq("folder_id", folder_id)
        .eq("organization_id", org_id)
        .is_("deleted_at", "null")
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Document not found.")
    supabase.table("vault_custom_folder_documents").update(
        {"deleted_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", document_id).execute()


def get_folder_order(org_id: str) -> dict[str, int]:
    try:
        resp = (
            get_supabase_admin()
            .table("vault_folder_layout")
            .select("folder_key, sort_order")
            .eq("organization_id", org_id)
            .execute()
        )
        return {row["folder_key"]: row["sort_order"] for row in (resp.data or [])}
    except Exception:
        return {}


def set_folder_order(org_id: str, ordered_keys: list[str]) -> None:
    # Only ever persist keys that genuinely belong to this org (a built-in
    # category, or one of this org's own custom folders) - silently drop
    # anything else rather than writing an ordering row that references
    # another organisation's folder id.
    valid_keys = set(CATEGORY_META) | {
        _custom_folder_category(f["id"]) for f in list_custom_folders(org_id)
    }
    rows = [
        {"organization_id": org_id, "folder_key": key, "sort_order": index}
        for index, key in enumerate(ordered_keys)
        if key in valid_keys
    ]
    if not rows:
        return
    try:
        get_supabase_admin().table("vault_folder_layout").upsert(
            rows, on_conflict="organization_id,folder_key"
        ).execute()
    except Exception as exc:
        logger.warning("Could not persist vault folder order: %s", exc)


def _apply_filters(
    docs: list[VaultDocument],
    *,
    search: str | None,
    person: str | None,
    date_from: str | None,
    date_to: str | None,
) -> list[VaultDocument]:
    out = docs
    if search and search.strip():
        q = search.strip().lower()
        out = [d for d in out if q in d["title"].lower() or q in d["person_name"].lower()]
    if person:
        out = [d for d in out if d["person_name"] == person]
    if date_from:
        out = [d for d in out if d["date"][:10] >= date_from]
    if date_to:
        out = [d for d in out if d["date"][:10] <= date_to]
    return sorted(out, key=lambda d: d["date"] or "", reverse=True)


def list_folder_documents(
    org_id: str,
    category: str,
    *,
    search: str | None = None,
    person: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> list[VaultDocument]:
    if category.startswith(CUSTOM_FOLDER_PREFIX):
        docs = _list_custom_folder_documents(org_id, _custom_folder_id(category))
        return _apply_filters(docs, search=search, person=person, date_from=date_from, date_to=date_to)
    if category not in CATEGORY_META:
        raise HTTPException(status_code=404, detail="Unknown vault category.")
    if category in GOVERNANCE_FOLDER_KEYS:
        docs = _list_governance(org_id, category)
    else:
        loader = _RECORD_LOADERS.get(category)
        docs = loader(org_id) if loader else []
    return _apply_filters(docs, search=search, person=person, date_from=date_from, date_to=date_to)


def render_document_file(
    org_id: str,
    category: str,
    document_id: str,
    exclude_fields: set[str] | None = None,
) -> tuple[str, bytes]:
    """`exclude_fields` only applies to categories rendered on demand from
    structured DB rows (session notes, incidents, etc.) - it lets an MD
    leave a specific field/section out of a particular share without
    touching the underlying record. Categories backed by an already-stored
    file (credentials, governance docs, custom-folder uploads...) have no
    structured content to redact this way, so the parameter is accepted
    for a uniform call signature but has no effect there."""
    if category.startswith(CUSTOM_FOLDER_PREFIX):
        return _render_custom_folder_file(org_id, _custom_folder_id(category), document_id)
    if category not in CATEGORY_META:
        raise HTTPException(status_code=404, detail="Unknown vault category.")
    if category in GOVERNANCE_FOLDER_KEYS:
        return _render_governance_file(org_id, category, document_id)
    renderer = _RECORD_RENDERERS.get(category)
    if not renderer:
        raise HTTPException(status_code=404, detail="Document not found.")
    return renderer(org_id, document_id, exclude_fields)


def list_folders(org_id: str) -> list[dict[str, Any]]:
    folders = []
    for key, meta in CATEGORY_META.items():
        docs = list_folder_documents(org_id, key)
        flagged = sum(1 for d in docs if d["status"] in FLAGGED_STATUSES)
        folders.append(
            {
                "category": key,
                "label": meta["label"],
                "group": meta["group"],
                "count": len(docs),
                "flagged_count": flagged,
                "updated_at": docs[0]["date"] if docs else None,
                "is_custom": False,
            }
        )

    for custom in list_custom_folders(org_id):
        category = _custom_folder_category(custom["id"])
        docs = list_folder_documents(org_id, category)
        folders.append(
            {
                "category": category,
                "label": custom["label"],
                "group": custom.get("folder_group") or "record",
                "count": len(docs),
                "flagged_count": 0,
                "updated_at": docs[0]["date"] if docs else custom.get("created_at"),
                "is_custom": True,
            }
        )

    order = get_folder_order(org_id)
    if order:
        folders.sort(key=lambda f: order.get(f["category"], len(order) + 1))
    return folders


def list_vault_stats(org_id: str) -> dict[str, Any]:
    total = 0
    flagged = 0
    for cat in CATEGORY_META:
        docs = list_folder_documents(org_id, cat)
        total += len(docs)
        flagged += sum(1 for d in docs if d["status"] in FLAGGED_STATUSES)
    for custom in list_custom_folders(org_id):
        total += len(list_folder_documents(org_id, _custom_folder_category(custom["id"])))

    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    shared = 0
    try:
        resp = (
            get_supabase_admin()
            .table("vault_share_events")
            .select("document_count")
            .eq("organization_id", org_id)
            .gte("created_at", since)
            .execute()
        )
        shared = sum(int(row.get("document_count") or 0) for row in (resp.data or []))
    except Exception:
        shared = 0

    return {"total_documents": total, "flagged_for_review": flagged, "shared_last_30_days": shared}


def resolve_pack_plan(org_id: str, refs: list[dict[str, str]]) -> list[dict[str, str]]:
    """Validate selected refs against real documents and return them with a
    display title — the frontend fetches each file's real bytes/filename
    itself, this just confirms the selection is real and MD-visible."""
    plan: list[dict[str, str]] = []
    cache: dict[str, list[VaultDocument]] = {}
    for ref in refs:
        category = ref.get("category")
        doc_id = ref.get("id")
        if not category or not doc_id or category not in CATEGORY_META:
            continue
        if category not in cache:
            cache[category] = list_folder_documents(org_id, category)
        match = next((d for d in cache[category] if d["id"] == doc_id), None)
        if not match:
            continue
        plan.append({"category": category, "id": doc_id, "title": match["title"]})
    return plan


# ── Chain-of-custody logging ────────────────────────────────────────────────

def log_share_event(
    org_id: str,
    user_id: str,
    *,
    method: str,
    folder_keys: list[str],
    document_refs: list[dict[str, str]],
    recipient_hint: str | None,
    ip_address: str | None,
    user_agent: str | None,
) -> None:
    if method not in VALID_SHARE_METHODS:
        raise HTTPException(status_code=422, detail="Invalid share method.")
    payload = {
        "organization_id": org_id,
        "shared_by": user_id,
        "share_method": method,
        "folder_keys": folder_keys,
        "document_refs": document_refs,
        "recipient_hint": (recipient_hint or "").strip() or None,
        "document_count": len(document_refs),
        "ip_address": ip_address,
        "user_agent": (user_agent or "")[:500] or None,
    }
    try:
        get_supabase_admin().table("vault_share_events").insert(payload).execute()
    except Exception as exc:
        logger.warning("Could not log vault share event: %s", exc)


# ── Governance document upload/list/delete ─────────────────────────────────

async def upload_governance_document(
    org_id: str,
    folder_key: str,
    title: str,
    description: str | None,
    uploaded_by: str,
    file_bytes: bytes,
    content_type: str,
) -> dict[str, Any]:
    if folder_key not in GOVERNANCE_FOLDER_KEYS:
        raise HTTPException(status_code=422, detail="Invalid governance folder.")
    if not title.strip():
        raise HTTPException(status_code=422, detail="Document title is required.")
    if content_type not in GOVERNANCE_ALLOWED_TYPES:
        raise HTTPException(status_code=422, detail="Document must be PDF or image (JPEG/PNG).")
    if len(file_bytes) > GOVERNANCE_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Document must be 20MB or smaller.")

    doc_id = str(uuid4())
    ext = GOVERNANCE_ALLOWED_TYPES[content_type]
    path = f"{org_id}/{folder_key}/{doc_id}-{uuid4().hex}{ext}"
    supabase = get_supabase_admin()
    try:
        supabase.storage.from_(GOVERNANCE_BUCKET).upload(
            path, file_bytes, {"content-type": content_type, "upsert": "true"}
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Governance document storage is not configured: {exc}")

    payload = {
        "id": doc_id,
        "organization_id": org_id,
        "folder_key": folder_key,
        "title": title.strip(),
        "description": (description or "").strip() or None,
        "file_path": path,
        "file_url": signed_storage_url(GOVERNANCE_BUCKET, path),
        "mime_type": content_type,
        "file_size_bytes": len(file_bytes),
        "uploaded_by": uploaded_by,
    }
    result = supabase.table("governance_documents").insert(payload).execute()
    return result.data[0] if result.data else payload


def delete_governance_document(org_id: str, document_id: str) -> None:
    supabase = get_supabase_admin()
    existing = (
        supabase.table("governance_documents")
        .select("id")
        .eq("id", document_id)
        .eq("organization_id", org_id)
        .is_("deleted_at", "null")
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Governance document not found.")
    supabase.table("governance_documents").update(
        {"deleted_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", document_id).execute()


# ── Audit pack generation ───────────────────────────────────────────────────
# A real, on-demand-computed snapshot (session compliance, incident, and
# credential-expiry counts over a trailing 90-day window), persisted so the
# vault's Audit Packs folder lists genuine past packs instead of always being
# empty — a leaner cousin of audit-pack.tsx's live client-side computation,
# not a byte-for-byte port of it.

def generate_audit_pack(org_id: str, user_id: str, *, label: str | None = None) -> dict[str, Any]:
    supabase = get_supabase_admin()
    now = datetime.now(timezone.utc)
    period_start = (now - timedelta(days=90)).date()
    period_end = now.date()

    snapshot: dict[str, Any] = {
        "organization_id": org_id,
        "generated_at": now.isoformat(),
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
    }

    try:
        resp = (
            supabase.table("sessions")
            .select("id, compliance_score, restrictive_practice_detected")
            .eq("organization_id", org_id)
            .gte("session_date", period_start.isoformat())
            .execute()
        )
        rows = resp.data or []
        scores = [r["compliance_score"] for r in rows if r.get("compliance_score") is not None]
        snapshot["session_count"] = len(rows)
        snapshot["average_compliance_score"] = round(sum(scores) / len(scores), 2) if scores else None
        snapshot["restrictive_practice_flags"] = sum(1 for r in rows if r.get("restrictive_practice_detected"))
    except Exception:
        snapshot["session_count"] = 0
        snapshot["average_compliance_score"] = None
        snapshot["restrictive_practice_flags"] = 0

    try:
        resp = (
            supabase.table("incidents")
            .select("id, status, ndis_reportable")
            .eq("organization_id", org_id)
            .gte("incident_date", period_start.isoformat())
            .execute()
        )
        rows = resp.data or []
        snapshot["incident_count"] = len(rows)
        snapshot["open_incidents"] = sum(1 for r in rows if r.get("status") in ("reported", "under_investigation"))
        snapshot["ndis_reportable_incidents"] = sum(1 for r in rows if r.get("ndis_reportable"))
    except Exception:
        snapshot["incident_count"] = 0
        snapshot["open_incidents"] = 0
        snapshot["ndis_reportable_incidents"] = 0

    try:
        resp = supabase.table("credentials").select("id, status").eq("organization_id", org_id).execute()
        rows = resp.data or []
        snapshot["credential_count"] = len(rows)
        snapshot["expiring_or_expired_credentials"] = sum(1 for r in rows if r.get("status") in ("expiring", "expired"))
    except Exception:
        snapshot["credential_count"] = 0
        snapshot["expiring_or_expired_credentials"] = 0

    body = json.dumps(snapshot, indent=2).encode("utf-8")
    pack_id = str(uuid4())
    pack_label = (label or f"Audit Pack — {period_end.isoformat()}").strip()
    path = f"{org_id}/{pack_id}.json"
    try:
        supabase.storage.from_("audit-pack-files").upload(
            path, body, {"content-type": "application/json", "upsert": "true"}
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Audit pack storage is not configured: {exc}")

    payload = {
        "id": pack_id,
        "organization_id": org_id,
        "generated_by": user_id,
        "label": pack_label,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "file_path": path,
        "file_url": signed_storage_url("audit-pack-files", path),
        "file_size_bytes": len(body),
    }
    result = supabase.table("audit_pack_exports").insert(payload).execute()
    return result.data[0] if result.data else payload


def list_audit_pack_exports(org_id: str) -> list[dict[str, Any]]:
    try:
        resp = (
            get_supabase_admin()
            .table("audit_pack_exports")
            .select("id, label, period_start, period_end, file_url, file_size_bytes, created_at")
            .eq("organization_id", org_id)
            .order("created_at", desc=True)
            .limit(200)
            .execute()
        )
        return resp.data or []
    except Exception:
        return []


# ── Quill ask-bar — deterministic parser, not the conversational chat agent ─
# The chat agent (services/chatbox/) is a multi-turn tool-calling agent built
# to converse; wrong shape (latency, cost, non-determinism) for "type a
# phrase, get a filtered table" on an audit tool where a silently
# hallucinated filter would be a real trust problem. This is a small,
# fully-deterministic closed grammar instead.

CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "session_notes": ["session", "progress note", "progress"],
    "incident_reports": ["incident"],
    "ndis_plans": ["plan", "goal", "funding"],
    "medication_records": ["medication", "meds", "clinical"],
    "worker_credentials": ["credential", "certificate", "certification", "qualification"],
    "invoices": ["invoice", "billing", "payment"],
    "audit_packs": ["audit pack", "audit"],
    "consent_onboarding": ["consent", "onboarding"],
    "governance_operational": ["governance", "operational management"],
    "risk_management": ["risk"],
    "quality_management": ["quality"],
    "information_management": ["information management", "privacy", "data management"],
    "feedback_complaints": ["complaint", "feedback"],
    "incident_management_system": ["incident policy", "incident management system"],
    "human_resource_management": ["hr", "human resource"],
    "continuity_of_supports": ["continuity"],
    "emergency_disaster_management": ["emergency", "disaster"],
}

_MONTHS_PATTERN = re.compile(r"\blast (\d+) months?\b")
_DAYS_PATTERN = re.compile(r"\blast (\d+) days?\b")
_YEAR_PATTERN = re.compile(r"\b(20\d{2})\b")


def _detect_date_window(query: str) -> tuple[str | None, str | None]:
    q = query.lower()

    year_match = _YEAR_PATTERN.search(q)
    if year_match:
        year = year_match.group(1)
        return f"{year}-01-01", f"{year}-12-31"

    days_match = _DAYS_PATTERN.search(q)
    if days_match:
        days = int(days_match.group(1))
        since = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
        return since, None

    months_match = _MONTHS_PATTERN.search(q)
    if months_match:
        days = int(months_match.group(1)) * 30
        since = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
        return since, None

    if "this month" in q:
        since = (datetime.now(timezone.utc) - timedelta(days=30)).date().isoformat()
        return since, None
    if "this quarter" in q or "quarter" in q:
        since = (datetime.now(timezone.utc) - timedelta(days=90)).date().isoformat()
        return since, None
    if "this year" in q:
        since = (datetime.now(timezone.utc) - timedelta(days=365)).date().isoformat()
        return since, None

    return None, None


def _detect_categories(query: str) -> list[str]:
    q = query.lower()
    return [cat for cat, keywords in CATEGORY_KEYWORDS.items() if any(kw in q for kw in keywords)]


def _detect_person(query: str, org_id: str) -> str | None:
    q = query.lower()
    names = set(_patient_name_map(org_id).values()) | set(_user_name_map(org_id).values())
    for name in names:
        if not name or "unknown" in name.lower():
            continue
        if name.lower() in q:
            return name
        for part in name.lower().split():
            if len(part) > 2 and re.search(rf"\b{re.escape(part)}\b", q):
                return name
    return None


def search_documents(org_id: str, query: str) -> tuple[str, list[VaultDocument]]:
    query = (query or "").strip()
    if not query:
        return "Type a question to search the vault.", []

    categories = _detect_categories(query)
    person = _detect_person(query, org_id)
    date_from, date_to = _detect_date_window(query)

    target_categories = categories or list(CATEGORY_META.keys())
    results: list[VaultDocument] = []
    for cat in target_categories:
        results.extend(
            list_folder_documents(org_id, cat, person=person, date_from=date_from, date_to=date_to)
        )

    if not categories and not person and not date_from:
        q = query.lower()
        results = [d for d in results if q in d["title"].lower() or q in d["person_name"].lower()]

    results.sort(key=lambda d: d["date"] or "", reverse=True)
    results = results[:200]

    parts = []
    if categories:
        parts.append(", ".join(CATEGORY_META[c]["label"] for c in categories))
    if person:
        parts.append(f"for {person}")
    if date_from:
        parts.append(f"since {date_from}")
    if parts:
        answer = f"Found {len(results)} document(s) — {' '.join(parts)}."
    else:
        answer = f'Found {len(results)} document(s) matching "{query}".'
    return answer, results
