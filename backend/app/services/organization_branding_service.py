"""Organisation branding.

Two things live here:
  - Visual identity (logo, accent colour, display name) — originally scoped
    to onboarding touchpoints only (offer/invite emails, first-login welcome
    screen), so a new hire sees their employer, not CareCliQ.
  - get_letterhead(): combines that visual identity with the org's legal
    business details (name, ABN, address, phone, email, NDIS provider
    number — already used by invoice generation) into one lookup, for any
    generated PDF/document that wants a real letterhead instead of a bare
    title. Uses organization_id as the lookup column deliberately — querying
    organizations by its `id` column is unreliable via PostgREST in this
    deployment (a known, previously-confirmed quirk); organization_id is
    the column every other live query in this codebase already relies on.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

ALLOWED_LOGO_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/svg+xml": ".svg",
    "image/webp": ".webp",
}
MAX_LOGO_BYTES = 5 * 1024 * 1024
BUCKET = "organization-branding"


def get_branding(organization_id: str) -> dict[str, Any]:
    resp = (
        get_supabase_admin()
        .table("organizations")
        .select("organization_id, organization_name, display_name, logo_url, brand_accent_color")
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Organisation not found.")
    row = resp.data[0]
    return {
        "display_name": row.get("display_name") or row.get("organization_name"),
        "logo_url": row.get("logo_url"),
        "brand_accent_color": row.get("brand_accent_color"),
    }


def update_branding(
    organization_id: str,
    *,
    display_name: str | None = None,
    brand_accent_color: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    if display_name is not None:
        payload["display_name"] = display_name.strip() or None
    if brand_accent_color is not None:
        color = brand_accent_color.strip()
        if color and not (color.startswith("#") and len(color) in (4, 7)):
            raise HTTPException(status_code=422, detail="Accent color must be a hex value like #5533CC.")
        payload["brand_accent_color"] = color or None

    if not payload:
        raise HTTPException(status_code=422, detail="No supported fields to update.")

    get_supabase_admin().table("organizations").update(payload).eq(
        "organization_id", organization_id
    ).execute()
    return get_branding(organization_id)


def upload_logo(organization_id: str, file_bytes: bytes, content_type: str) -> dict[str, Any]:
    if content_type not in ALLOWED_LOGO_TYPES:
        raise HTTPException(status_code=422, detail="Logo must be PNG, JPEG, SVG, or WebP.")
    if len(file_bytes) > MAX_LOGO_BYTES:
        raise HTTPException(status_code=413, detail="Logo must be 5MB or smaller.")

    ext = ALLOWED_LOGO_TYPES[content_type]
    path = f"{organization_id}/logo-{uuid4().hex}{ext}"
    supabase = get_supabase_admin()
    try:
        supabase.storage.from_(BUCKET).upload(path, file_bytes, {"content-type": content_type, "upsert": "true"})
        public_url = supabase.storage.from_(BUCKET).get_public_url(path)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Logo storage is not configured: {exc}")

    supabase.table("organizations").update({"logo_url": public_url}).eq(
        "organization_id", organization_id
    ).execute()
    return get_branding(organization_id)


def remove_logo(organization_id: str) -> dict[str, Any]:
    get_supabase_admin().table("organizations").update({"logo_url": None}).eq(
        "organization_id", organization_id
    ).execute()
    return get_branding(organization_id)


DEFAULT_ACCENT_COLOR = "#C27803"

# WeasyPrint/xhtml2pdf fetch logo_url themselves at render time (it's a
# plain public HTTP URL, both engines handle that natively). ReportLab has
# no equivalent - it needs raw image bytes handed to it - so fetch_logo_bytes()
# exists only for ReportLab-based generators (shift PDFs, vault PDFs).
_RASTER_LOGO_TYPES = {"image/png", "image/jpeg", "image/webp"}


def get_letterhead(organization_id: str) -> dict[str, Any]:
    """Everything a generated document's header needs: legal business
    details (already relied on by invoice generation) plus visual identity
    (logo/accent colour, so far only used by onboarding surfaces). One
    lookup, `organization_id`-scoped, so every PDF generator in the app can
    share it instead of re-deriving its own org query."""
    resp = (
        get_supabase_admin()
        .table("organizations")
        .select(
            "organization_name, display_name, logo_url, brand_accent_color, "
            "abn, org_address, contact_number, email, ndis_provider_number"
        )
        .eq("organization_id", organization_id)
        .limit(1)
        .execute()
    )
    row = (resp.data or [{}])[0] if resp.data else {}
    return {
        "provider_name": row.get("display_name") or row.get("organization_name") or "",
        "logo_url": row.get("logo_url"),
        "brand_accent_color": row.get("brand_accent_color") or DEFAULT_ACCENT_COLOR,
        "abn": row.get("abn"),
        "address": row.get("org_address"),
        "phone": row.get("contact_number"),
        "email": row.get("email"),
        "ndis_provider_number": row.get("ndis_provider_number"),
    }


def build_pdf_letterhead(org_id: str) -> tuple[list[Any], str]:
    """ReportLab flowables for a document letterhead — logo (if the org has
    uploaded a raster one) or its name as a text wordmark, plus ABN/address/
    contact/NDIS provider number, and an accent-coloured rule underneath.
    Shared by every ReportLab-based PDF generator in the app (shift exports,
    vault documents) so they all render one consistent letterhead instead of
    each inventing its own. Returns (flowables, accent_color) so the caller
    can also tint the title/headings that follow it."""
    from reportlab.lib.colors import HexColor
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    from reportlab.platypus import HRFlowable, Image, Paragraph, Spacer
    import io as _io

    letterhead = get_letterhead(org_id)
    accent = letterhead["brand_accent_color"]
    styles = getSampleStyleSheet()
    org_style = ParagraphStyle("OrgName", parent=styles["Heading2"], fontSize=13, textColor=HexColor(accent), spaceAfter=1)
    detail_style = ParagraphStyle("OrgDetail", parent=styles["BodyText"], fontSize=8, textColor=HexColor("#475569"), leading=11)

    flowables: list[Any] = []
    logo_bytes = fetch_logo_bytes(letterhead["logo_url"])
    if logo_bytes:
        try:
            reader = ImageReader(_io.BytesIO(logo_bytes))
            iw, ih = reader.getSize()
            max_h = 14 * mm
            flowables.append(Image(reader, width=iw * (max_h / ih), height=max_h))
            flowables.append(Spacer(1, 1 * mm))
        except Exception:
            logo_bytes = None
    if not logo_bytes:
        flowables.append(Paragraph(letterhead["provider_name"] or "CareCliQ", org_style))

    detail_lines = []
    if letterhead["address"]:
        detail_lines.append(letterhead["address"])
    contact_bits = [b for b in (letterhead["email"], letterhead["phone"]) if b]
    if contact_bits:
        detail_lines.append(" | ".join(contact_bits))
    id_bits = []
    if letterhead["abn"]:
        id_bits.append(f"ABN: {letterhead['abn']}")
    if letterhead["ndis_provider_number"]:
        id_bits.append(f"NDIS Provider: {letterhead['ndis_provider_number']}")
    if id_bits:
        detail_lines.append(" | ".join(id_bits))
    for line in detail_lines:
        flowables.append(Paragraph(line, detail_style))

    flowables.append(Spacer(1, 2 * mm))
    flowables.append(HRFlowable(width="100%", thickness=1.5, color=HexColor(accent), spaceAfter=4 * mm))
    return flowables, accent


def fetch_logo_bytes(logo_url: str | None) -> bytes | None:
    """Raw bytes for a raster logo (PNG/JPEG/WebP), for ReportLab generators
    that need to embed an image directly rather than pointing at a URL.
    Returns None for a missing/unset logo, an SVG (ReportLab can't embed one
    without the svglib dependency, which isn't installed), or any fetch
    failure - callers fall back to a text wordmark in all those cases."""
    if not logo_url:
        return None
    try:
        import httpx

        with httpx.Client(timeout=5.0) as client:
            resp = client.get(logo_url)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "").split(";")[0].strip().lower()
            if content_type not in _RASTER_LOGO_TYPES:
                return None
            return resp.content
    except Exception as exc:
        logger.warning("Could not fetch org logo for PDF letterhead: %s", exc)
        return None
