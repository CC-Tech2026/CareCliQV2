"""Live records in the vault's governance folders.

Governance folders used to list only files someone uploaded, so a folder
like Feedback & Complaints Management stayed empty even when the app held
complaints. This module adds what the app already records to the folder it
belongs in:

- Feedback & Complaints Management: the complaints register, each
  participant complaint, and each piece of staff feedback.
- Incident Management System: the incident register (each incident is also
  its own document under Incident Reports).
- Human Resource Management: the training register and the policy
  acknowledgement register.

Registers are always listed, even when empty: "no complaints recorded" is
itself evidence for an auditor. Every document is rendered to PDF on
demand from the live rows, so the folder can never drift from the app.

Document ids carry their kind ("complaint:<uuid>", "register:incidents")
so render_feed_document can tell them from uploaded governance files.
"""

from __future__ import annotations

import io
import logging
import re
from datetime import date, datetime
from typing import Any

from fastapi import HTTPException

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

FEED_PREFIXES = ("complaint:", "feedback:", "register:")

# Which folder each feed lands in.
FEED_FOLDERS: dict[str, tuple[str, ...]] = {
    "feedback_complaints": ("register:complaints", "complaints", "staff_feedback"),
    "incident_management_system": ("register:incidents",),
    "human_resource_management": ("register:training", "register:policy_acknowledgements"),
}

REGISTER_TITLES = {
    "complaints": "Complaints register",
    "incidents": "Incident register",
    "training": "Training register",
    "policy_acknowledgements": "Policy acknowledgement register",
}

STATUS_LABELS = {"open": "Open", "in_review": "In review", "resolved": "Resolved"}


def is_feed_document(document_id: str) -> bool:
    return str(document_id).startswith(FEED_PREFIXES)


def _rows(query: Any) -> list[dict[str, Any]]:
    try:
        return query.execute().data or []
    except Exception as exc:  # a table not migrated yet lists nothing, never breaks the folder
        logger.info("Vault feed query failed: %s", exc)
        return []


def _day(value: Any) -> str:
    text = str(value or "")
    if not text:
        return ""
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).strftime("%d %b %Y")
    except ValueError:
        return text[:10]


def _names(org_id: str, user_ids: set[str]) -> dict[str, str]:
    if not user_ids:
        return {}
    rows = _rows(
        get_supabase_admin().table("users").select("id, full_name, email")
        .in_("id", sorted(user_ids)).eq("organization_id", org_id)
    )
    return {str(r["id"]): r.get("full_name") or r.get("email") or "Staff member" for r in rows}


# ── Sources ───────────────────────────────────────────────────────────────

def _complaints(org_id: str) -> list[dict[str, Any]]:
    from .participant_complaint_service import list_complaints

    return list_complaints(org_id, raise_if_missing=False)


def _staff_feedback(org_id: str) -> list[dict[str, Any]]:
    rows = _rows(
        get_supabase_admin().table("operational_feedback")
        .select("id, reporter_id, category, title, description, status, resolution_notes, resolved_by, resolved_at, created_at")
        .eq("organization_id", org_id).order("created_at", desc=True).limit(1000)
    )
    names = _names(org_id, {str(r[k]) for r in rows for k in ("reporter_id", "resolved_by") if r.get(k)})
    for r in rows:
        r["reporter_name"] = names.get(str(r.get("reporter_id")), "Staff member")
        r["resolved_by_name"] = names.get(str(r.get("resolved_by"))) if r.get("resolved_by") else None
    return rows


def _incidents(org_id: str) -> list[dict[str, Any]]:
    rows = _rows(
        get_supabase_admin().table("incidents")
        .select("id, reference_number, title, incident_type, severity, status, incident_date, participant_id, ndis_reportable, resolved_date, created_at")
        .eq("organization_id", org_id).order("incident_date", desc=True).limit(2000)
    )
    ids = sorted({str(r["participant_id"]) for r in rows if r.get("participant_id")})
    names: dict[str, str] = {}
    if ids:
        names = {
            str(p["id"]): p.get("full_name") or "Participant"
            for p in _rows(get_supabase_admin().table("participants").select("id, full_name").in_("id", ids).eq("organization_id", org_id))
        }
    for r in rows:
        r["participant_name"] = names.get(str(r.get("participant_id")), "")
    return rows


def _training(org_id: str) -> list[dict[str, Any]]:
    rows = _rows(
        get_supabase_admin().table("worker_training_completions")
        .select("id, worker_id, module_id, status, completed_at, reviewed_at, created_at")
        .eq("organization_id", org_id).order("created_at", desc=True).limit(5000)
    )
    modules = {
        str(m["id"]): m.get("title") or "Training module"
        for m in _rows(get_supabase_admin().table("training_modules").select("id, title").eq("organization_id", org_id))
    }
    names = _names(org_id, {str(r["worker_id"]) for r in rows if r.get("worker_id")})
    for r in rows:
        r["worker_name"] = names.get(str(r.get("worker_id")), "Worker")
        r["module_title"] = modules.get(str(r.get("module_id")), "Training module")
    return rows


def _policy_acknowledgements(org_id: str) -> list[dict[str, Any]]:
    rows = _rows(
        get_supabase_admin().table("policy_acknowledgements")
        .select("id, worker_id, document_id, acknowledged_at")
        .eq("organization_id", org_id).order("acknowledged_at", desc=True).limit(5000)
    )
    doc_ids = sorted({str(r["document_id"]) for r in rows if r.get("document_id")})
    titles: dict[str, str] = {}
    if doc_ids:
        titles = {
            str(d["id"]): d.get("title") or "Policy"
            for d in _rows(get_supabase_admin().table("governance_documents").select("id, title").in_("id", doc_ids).eq("organization_id", org_id))
        }
    names = _names(org_id, {str(r["worker_id"]) for r in rows if r.get("worker_id")})
    for r in rows:
        r["worker_name"] = names.get(str(r.get("worker_id")), "Worker")
        r["policy_title"] = titles.get(str(r.get("document_id")), "Policy")
    return rows


# Register: (title, source, intro, columns, row -> cells, empty message, newest date)
REGISTERS: dict[str, dict[str, Any]] = {
    "complaints": {
        "load": lambda org: _complaints(org),
        "intro": "Every complaint raised by or for a participant, how it was handled and what was done.",
        "columns": ["Filed", "Participant", "Subject", "Raised by", "Status", "Outcome"],
        "cells": lambda r: [
            _day(r.get("filed_at")), r.get("participant_name") or "", r.get("subject") or "",
            r.get("raised_by") or "", STATUS_LABELS.get(r.get("status"), r.get("status") or ""),
            r.get("resolution_notes") or "",
        ],
        "empty": "No complaints have been recorded.",
        "date_key": "filed_at",
    },
    "incidents": {
        "load": lambda org: _incidents(org),
        "intro": "Every incident recorded, with its reference, type, severity, status and whether it was NDIS reportable.",
        "columns": ["Date", "Reference", "Incident", "Participant", "Severity", "Status", "Reportable"],
        "cells": lambda r: [
            _day(r.get("incident_date") or r.get("created_at")), r.get("reference_number") or "",
            r.get("title") or (r.get("incident_type") or "").replace("_", " ").capitalize(),
            r.get("participant_name") or "", (r.get("severity") or "").capitalize(),
            (r.get("status") or "").replace("_", " ").capitalize(), "Yes" if r.get("ndis_reportable") else "No",
        ],
        "empty": "No incidents have been recorded.",
        "date_key": "incident_date",
    },
    "training": {
        "load": lambda org: _training(org),
        "intro": "Training completed by staff, from the training modules in CareCliQ.",
        "columns": ["Completed", "Worker", "Module", "Status"],
        "cells": lambda r: [
            _day(r.get("completed_at") or r.get("created_at")), r.get("worker_name") or "",
            r.get("module_title") or "", (r.get("status") or "").replace("_", " ").capitalize(),
        ],
        "empty": "No training completions have been recorded.",
        "date_key": "completed_at",
    },
    "policy_acknowledgements": {
        "load": lambda org: _policy_acknowledgements(org),
        "intro": "Which staff have read and acknowledged each policy shared with them.",
        "columns": ["Acknowledged", "Worker", "Policy"],
        "cells": lambda r: [_day(r.get("acknowledged_at")), r.get("worker_name") or "", r.get("policy_title") or ""],
        "empty": "No policy acknowledgements have been recorded.",
        "date_key": "acknowledged_at",
    },
}


# ── Listing ───────────────────────────────────────────────────────────────

def list_feed_documents(org_id: str, category: str, *, folder_label: str, org_name: str) -> list[dict[str, Any]]:
    """The live documents for a governance folder, as VaultDocument dicts."""
    docs: list[dict[str, Any]] = []
    for feed in FEED_FOLDERS.get(category, ()):
        if feed.startswith("register:"):
            name = feed.split(":", 1)[1]
            spec = REGISTERS[name]
            rows = spec["load"](org_id)
            newest = max((str(r.get(spec["date_key"]) or r.get("created_at") or "") for r in rows), default="")
            docs.append({
                "id": feed,
                "category": category,
                "folder_label": folder_label,
                "title": REGISTER_TITLES[name],
                "person_name": org_name,
                "person_type": "Organisation",
                "date": newest or date.today().isoformat(),
                "status": "live",
                "source_table": "vault_registers",
                "source_id": name,
                "has_stored_file": False,
                "detail": f"{len(rows)} {'entry' if len(rows) == 1 else 'entries'} · updates as records change",
            })
        elif feed == "complaints":
            for r in _complaints(org_id):
                docs.append({
                    "id": f"complaint:{r['id']}",
                    "category": category,
                    "folder_label": folder_label,
                    "title": f"Complaint: {r.get('subject') or 'Untitled'}",
                    "person_name": r.get("participant_name") or "Participant",
                    "person_type": "Participant",
                    "person_id": r.get("participant_id"),
                    "date": str(r.get("filed_at") or r.get("created_at") or ""),
                    "status": r.get("status") or "open",
                    "source_table": "participant_complaints",
                    "source_id": str(r["id"]),
                    "has_stored_file": False,
                    "detail": f"Raised by {r['raised_by']}" if r.get("raised_by") else None,
                })
        elif feed == "staff_feedback":
            for r in _staff_feedback(org_id):
                docs.append({
                    "id": f"feedback:{r['id']}",
                    "category": category,
                    "folder_label": folder_label,
                    "title": f"Staff feedback: {r.get('title') or 'Untitled'}",
                    "person_name": r.get("reporter_name") or "Staff member",
                    "person_type": "Worker",
                    "person_id": r.get("reporter_id"),
                    "date": str(r.get("created_at") or ""),
                    "status": r.get("status") or "open",
                    "source_table": "operational_feedback",
                    "source_id": str(r["id"]),
                    "has_stored_file": False,
                    "detail": (r.get("category") or "other").replace("_", " ").capitalize(),
                })
    return docs


# ── Rendering ─────────────────────────────────────────────────────────────

def _safe(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", text).strip("-") or "document"


def _register_pdf(org_id: str, title: str, intro: str, columns: list[str], rows: list[list[str]], empty: str) -> bytes:
    """A landscape table PDF with the organisation's letterhead."""
    try:
        from reportlab.lib.colors import HexColor
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    except ImportError:
        from .vault_service import _render_record_pdf

        sections = [(" · ".join(columns), "\n".join(" · ".join(r) for r in rows) or empty)]
        return _render_record_pdf(org_id, title, [("Entries", str(len(rows)))], sections)

    from .organization_branding_service import build_pdf_letterhead

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), title=title, author="CareCliQ", lang="en-AU",
                            leftMargin=36, rightMargin=36, topMargin=36, bottomMargin=36)
    styles = getSampleStyleSheet()
    story: list[Any] = []
    try:
        letterhead, accent = build_pdf_letterhead(org_id)
        story.extend(letterhead)
    except Exception as exc:
        logger.warning("Could not build PDF letterhead for org %s: %s", org_id, exc)
        accent = "#1B1745"
    story.append(Paragraph(title, ParagraphStyle("T", parent=styles["Heading1"], fontSize=15, textColor=HexColor(accent))))
    meta = ParagraphStyle("M", parent=styles["BodyText"], fontSize=9.5, textColor=HexColor("#64748b"))
    story.append(Paragraph(f"{intro} Generated {date.today().strftime('%d %b %Y')} from live records · {len(rows)} {'entry' if len(rows) == 1 else 'entries'}.", meta))
    story.append(Spacer(1, 10))
    if not rows:
        story.append(Paragraph(empty, styles["BodyText"]))
    else:
        cell = ParagraphStyle("C", parent=styles["BodyText"], fontSize=8.5, leading=11)
        head = ParagraphStyle("H", parent=cell, textColor=HexColor("#FFFFFF"), fontName="Helvetica-Bold")
        data = [[Paragraph(c, head) for c in columns]] + [[Paragraph(_escape(v), cell) for v in r] for r in rows]
        table = Table(data, repeatRows=1)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), HexColor(accent)),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LINEBELOW", (0, 0), (-1, -1), 0.25, HexColor("#E8E8EA")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#FFFFFF"), HexColor("#F7F7F9")]),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(table)
    doc.build(story)
    return buffer.getvalue()


def _escape(text: str) -> str:
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def render_feed_document(org_id: str, category: str, document_id: str) -> tuple[str, bytes]:
    from .vault_service import _render_record_pdf

    if category not in FEED_FOLDERS:
        raise HTTPException(status_code=404, detail="Document not found.")
    kind, _, key = str(document_id).partition(":")

    if kind == "register":
        if f"register:{key}" not in FEED_FOLDERS[category] or key not in REGISTERS:
            raise HTTPException(status_code=404, detail="Document not found.")
        spec = REGISTERS[key]
        rows = [spec["cells"](r) for r in spec["load"](org_id)]
        title = REGISTER_TITLES[key]
        return f"{_safe(title)}.pdf", _register_pdf(org_id, title, spec["intro"], spec["columns"], rows, spec["empty"])

    if kind == "complaint" and "complaints" in FEED_FOLDERS[category]:
        from .participant_complaint_service import get_complaint

        r = get_complaint(org_id, key)
        if not r:
            raise HTTPException(status_code=404, detail="Complaint not found.")
        responder = _names(org_id, {str(r["responded_by"])}).get(str(r["responded_by"])) if r.get("responded_by") else None
        meta = [
            ("Participant", r.get("participant_name") or ""),
            ("Raised by", r.get("raised_by") or "Not recorded"),
            ("Filed", _day(r.get("filed_at"))),
            ("Status", STATUS_LABELS.get(r.get("status"), r.get("status") or "")),
            ("Last response", f"{_day(r.get('responded_at'))}{f' by {responder}' if responder else ''}" if r.get("responded_at") else "None yet"),
        ]
        sections = [("Complaint", r.get("description") or "")]
        if r.get("resolution_notes"):
            sections.append(("What was done", r["resolution_notes"]))
        title = f"Complaint: {r.get('subject') or 'Untitled'}"
        return f"{_safe(title)}.pdf", _render_record_pdf(org_id, title, meta, sections)

    if kind == "feedback" and "staff_feedback" in FEED_FOLDERS[category]:
        r = next((x for x in _staff_feedback(org_id) if str(x["id"]) == key), None)
        if not r:
            raise HTTPException(status_code=404, detail="Feedback not found.")
        meta = [
            ("Raised by", r.get("reporter_name") or ""),
            ("Category", (r.get("category") or "other").replace("_", " ").capitalize()),
            ("Raised", _day(r.get("created_at"))),
            ("Status", STATUS_LABELS.get(r.get("status"), r.get("status") or "")),
        ]
        if r.get("resolved_at"):
            meta.append(("Resolved", f"{_day(r['resolved_at'])}{' by ' + r['resolved_by_name'] if r.get('resolved_by_name') else ''}"))
        sections = [("Feedback", r.get("description") or "")]
        if r.get("resolution_notes"):
            sections.append(("Resolution", r["resolution_notes"]))
        title = f"Staff feedback: {r.get('title') or 'Untitled'}"
        return f"{_safe(title)}.pdf", _render_record_pdf(org_id, title, meta, sections)

    raise HTTPException(status_code=404, detail="Document not found.")

