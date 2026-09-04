from supabase import create_client, Client
from ..core.config import settings
from ..core.supabase_region import validate_supabase_region

_client: Client = None
_admin_client: Client = None
_region_validated = False


def _ensure_supabase_region() -> None:
    global _region_validated
    if _region_validated:
        return
    validate_supabase_region(
        supabase_url=settings.supabase_url,
        declared_region=settings.supabase_region or None,
        access_token=settings.supabase_access_token or None,
        region_check_mode=settings.supabase_region_check,
    )
    _region_validated = True


def get_supabase() -> Client:
    global _client
    _ensure_supabase_region()
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_anon_key)
    return _client


def get_supabase_admin() -> Client:
    global _admin_client
    _ensure_supabase_region()
    if _admin_client is None:
        _admin_client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _admin_client


def signed_storage_url(bucket: str, path: str | None, seconds: int = 60 * 60 * 24 * 7) -> str | None:
    """Fresh, short-lived signed URL for an object in a private bucket.

    Never persist the result on a row — the URL expires, so callers must
    regenerate it every time it's read and returned to a client.
    """
    if not path:
        return None
    try:
        signed = get_supabase_admin().storage.from_(bucket).create_signed_url(path, seconds)
    except Exception:
        return None
    if isinstance(signed, dict):
        return (
            signed.get("signedURL")
            or signed.get("signed_url")
            or signed.get("signedUrl")
            or (signed.get("data") or {}).get("signedUrl")
            or (signed.get("data") or {}).get("signedURL")
        )
    return str(signed) if signed else None
