"""Organisation branding for onboarding touchpoints — offer/invite emails and
the first-login welcome screen. A new hire applied to the provider, not to
CareCliQ, so those three surfaces read as coming from the employer.

Deliberately scoped: this does not extend to the rest of the product."""

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
