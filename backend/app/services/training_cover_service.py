"""Organisation-scoped course covers in the existing private resource bucket."""
import logging
import re
from uuid import uuid4

from fastapi import HTTPException
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)
MAX_COVER_BYTES = 5 * 1024 * 1024


def validate_cover(organization_id: str, fields: dict) -> None:
    color = fields.get("cover_color")
    if color is not None and not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise HTTPException(status_code=422, detail="Choose a valid cover colour.")
    path = fields.get("cover_path")
    if path is not None and not re.fullmatch(re.escape(organization_id) + r"/training-covers/[0-9a-f-]+\.(png|jpg|webp)", path):
        raise HTTPException(status_code=422, detail="Cover image must belong to your organisation.")


def upload_cover(organization_id: str, content: bytes, content_type: str) -> dict:
    if not content or len(content) > MAX_COVER_BYTES:
        raise HTTPException(status_code=422, detail="Choose a cover image smaller than 5 MB.")
    formats = {
        "image/png": ("png", content.startswith(b"\x89PNG\r\n\x1a\n")),
        "image/jpeg": ("jpg", content.startswith(b"\xff\xd8\xff")),
        "image/webp": ("webp", content.startswith(b"RIFF") and content[8:12] == b"WEBP"),
    }
    ext, valid = formats.get(content_type, (None, False))
    if not valid:
        raise HTTPException(status_code=422, detail="Use a PNG, JPEG or WebP image.")
    path = f"{organization_id}/training-covers/{uuid4()}.{ext}"
    get_supabase_admin().storage.from_("onboarding-resources").upload(
        path, content, file_options={"content-type": content_type})
    return {"cover_path": path}


def with_cover_url(module: dict) -> dict:
    module["cover_url"] = None
    if not module.get("cover_path"):
        return module
    try:
        validate_cover(str(module["organization_id"]), module)
        result = get_supabase_admin().storage.from_("onboarding-resources").create_signed_url(module["cover_path"], 3600)
        module["cover_url"] = result.get("signedURL") or result.get("signedUrl") or result.get("signed_url")
    except Exception:
        logger.warning("Unable to resolve training cover for module %s", module.get("id"))
    return module
