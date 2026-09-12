"""Participant profile PDF export.

Assembles the merge-field context (org/participant/plan, via
merge_fields.resolve_merge_context) plus goals and allergies, and renders
them through participant_profile.html — the same
Environment/FileSystemLoader/render_html_to_pdf chain invoice_service.py's
render_invoice_pdf uses for invoices.
"""
from __future__ import annotations

import pathlib
from typing import Any

from .html_pdf_render import HtmlPdfRenderError, render_html_to_pdf
from .merge_fields import resolve_merge_context
from .supabase_client import get_supabase_admin

_TEMPLATES_DIR = pathlib.Path(__file__).parent.parent / "templates"


class ParticipantProfileExportError(Exception):
    pass


def _load_goals(organization_id: str, participant_id: str) -> list[dict[str, Any]]:
    resp = (
        get_supabase_admin()
        .table("ndis_goals")
        .select("name, goal_area, description, target_date, status, support_category, priority, why_it_matters")
        .eq("participant_id", participant_id)
        .eq("organization_id", organization_id)
        .neq("status", "archived")
        .order("target_date", desc=False)
        .execute()
    )
    return resp.data or []


def _load_allergies(organization_id: str, participant_id: str) -> list[dict[str, Any]]:
    resp = (
        get_supabase_admin()
        .table("participant_allergies")
        .select("allergen, severity, notes")
        .eq("participant_id", participant_id)
        .eq("organization_id", organization_id)
        .execute()
    )
    return resp.data or []


async def render_participant_profile_pdf(org_id: str, participant_id: str) -> tuple[str, bytes]:
    """Returns (filename, pdf_bytes). Raises ParticipantProfileExportError if
    the participant doesn't belong to org_id or rendering fails."""
    context = resolve_merge_context(org_id, participant_id=participant_id)
    if not context.get("participant"):
        raise ParticipantProfileExportError("Participant not found for this organisation")

    context["goals"] = _load_goals(org_id, participant_id)
    context["allergies"] = _load_allergies(org_id, participant_id)

    try:
        from jinja2 import Environment, FileSystemLoader, select_autoescape
    except ImportError as exc:
        raise ParticipantProfileExportError(f"PDF rendering requires jinja2: {exc}")

    env = Environment(
        loader=FileSystemLoader(str(_TEMPLATES_DIR)),
        autoescape=select_autoescape(["html"]),
    )
    template = env.get_template("participant_profile.html")
    html_str = template.render(**context)

    try:
        pdf_bytes = render_html_to_pdf(html_str, base_url=str(_TEMPLATES_DIR))
    except HtmlPdfRenderError as exc:
        raise ParticipantProfileExportError(str(exc)) from exc

    full_name = (context["participant"] or {}).get("full_name") or "participant"
    safe_name = "".join(c for c in full_name if c.isalnum() or c in " -_").strip().replace(" ", "_")
    filename = f"participant-profile-{safe_name or participant_id}.pdf"
    return filename, pdf_bytes
