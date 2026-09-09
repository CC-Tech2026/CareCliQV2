"""Private, organisation-scoped files for training modules."""
import logging
import re
from uuid import uuid4
from fastapi import HTTPException
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)
MAX_MATERIAL_BYTES = 50 * 1024 * 1024


def material_access_url(org_id: str, module_id: str, resource_id: str) -> dict:
    db = get_supabase_admin()
    module = (db.table("training_modules").select("id").eq("organization_id", org_id)
              .eq("id", module_id).maybe_single().execute())
    if not module.data:
        raise HTTPException(status_code=404, detail="Training module not found.")
    resource = (db.table("training_resources").select("*").eq("module_id", module_id)
                .eq("id", resource_id).maybe_single().execute())
    if not resource.data:
        raise HTTPException(status_code=404, detail="Material not found.")
    resolved = with_material_url(resource.data)
    url = resolved.get("access_url") or resolved.get("external_url")
    if not url:
        raise HTTPException(status_code=502, detail="This material could not be opened. Please try again.")
    return {"url": url}


def validate_material_path(org_id: str, module_id: str, path: str, resource_type: str):
    pattern = re.escape(f"{org_id}/training-materials/{module_id}/") + r"[0-9a-f-]+\.(pdf|mp4|webm)"
    match = re.fullmatch(pattern, path)
    if not match or resource_type != ("pdf" if match[1] == "pdf" else "video"):
        raise HTTPException(status_code=422, detail="The uploaded file must belong to this module and match the material type.")


def with_material_url(resource: dict) -> dict:
    resource["access_url"] = None
    if resource.get("storage_path"):
        try:
            result = get_supabase_admin().storage.from_("onboarding-resources").create_signed_url(resource["storage_path"], 300)
            resource["access_url"] = result.get("signedURL") or result.get("signedUrl") or result.get("signed_url")
        except Exception:
            logger.warning("Could not sign training material %s", resource.get("id"))
    return resource


def upload_material(org_id: str, module_id: str, title: str, content: bytes, content_type: str,
                    sort_order: int = 0, resource_id: str | None = None) -> dict:
    from .worker_training_service import manage_training_resource
    db = get_supabase_admin()
    module = (db.table("training_modules").select("id").eq("organization_id", org_id)
              .eq("id", module_id).maybe_single().execute())
    if not module.data:
        raise HTTPException(status_code=404, detail="Training module not found.")
    if not title.strip() or sort_order < 0:
        raise HTTPException(status_code=422, detail="Enter a material title and a valid position.")
    if not content or len(content) > MAX_MATERIAL_BYTES:
        raise HTTPException(status_code=422, detail="Choose a file smaller than 50 MB.")
    formats = {"application/pdf": ("pdf", content.startswith(b"%PDF-")),
               "video/mp4": ("mp4", content[4:8] == b"ftyp"),
               "video/webm": ("webm", content.startswith(b"\x1a\x45\xdf\xa3"))}
    ext, valid = formats.get(content_type, (None, False))
    if not valid:
        raise HTTPException(status_code=422, detail="Upload a PDF, MP4 or WebM file.")
    path = f"{org_id}/training-materials/{module_id}/{uuid4()}.{ext}"
    storage = db.storage.from_("onboarding-resources")
    storage.upload(path, content, file_options={"content-type": content_type})
    try:
        return manage_training_resource(org_id, module_id, {
            "title": title.strip(), "storage_path": path, "external_url": None,
            "resource_type": "pdf" if ext == "pdf" else "video", "sort_order": sort_order,
        }, resource_id)
    except Exception:
        try:
            storage.remove([path])
        except Exception:
            logger.warning("Unable to remove unlinked training upload %s", path)
        raise
