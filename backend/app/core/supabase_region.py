"""Supabase region validation for Australian data residency (ap-southeast-2 / Sydney)."""

from __future__ import annotations

import logging
import os
import re
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

REQUIRED_SUPABASE_REGION = "ap-southeast-2"
REQUIRED_SUPABASE_REGION_LABEL = "Oceania (Sydney)"
SUPABASE_MANAGEMENT_API = "https://api.supabase.com/v1"

_LOCAL_HOSTS = frozenset(
    {
        "localhost",
        "127.0.0.1",
        "host.docker.internal",
        "kong",
    }
)


class SupabaseRegionError(Exception):
    """Raised when Supabase is not configured for the required Sydney region."""

    def __init__(self, message: str, *, detected_region: str | None = None) -> None:
        super().__init__(message)
        self.detected_region = detected_region


def is_region_check_disabled(region_check_mode: str | None = None) -> bool:
    mode = (region_check_mode or os.environ.get("SUPABASE_REGION_CHECK", "enabled")).strip().lower()
    return mode in {"disabled", "skip", "off", "false", "0"}


def is_local_supabase_url(supabase_url: str) -> bool:
    if not supabase_url.strip():
        return True
    host = (urlparse(supabase_url.strip()).hostname or "").lower()
    return host in _LOCAL_HOSTS or host.endswith(".local")


def extract_project_ref(supabase_url: str) -> str | None:
    host = (urlparse(supabase_url.strip()).hostname or "").lower()
    match = re.fullmatch(r"([a-z0-9]+)\.supabase\.co", host)
    return match.group(1) if match else None


def fetch_project_region(project_ref: str, access_token: str) -> str:
    """Return the hosted Supabase project region via the Management API."""
    headers = {"Authorization": f"Bearer {access_token}"}
    with httpx.Client(timeout=15.0) as client:
        response = client.get(f"{SUPABASE_MANAGEMENT_API}/projects/{project_ref}", headers=headers)
        if response.status_code == 401:
            raise SupabaseRegionError(
                "Supabase region validation failed: SUPABASE_ACCESS_TOKEN is invalid or expired."
            )
        if response.status_code == 404:
            raise SupabaseRegionError(
                f"Supabase region validation failed: project '{project_ref}' was not found."
            )
        response.raise_for_status()
        payload = response.json()
    region = (payload.get("region") or payload.get("region_code") or "").strip()
    if not region:
        raise SupabaseRegionError(
            f"Supabase region validation failed: Management API did not return a region for '{project_ref}'."
        )
    return region


def _format_region_mismatch(project_ref: str, detected_region: str) -> str:
    return (
        f"Supabase region validation failed: project '{project_ref}' is in '{detected_region}' "
        f"but '{REQUIRED_SUPABASE_REGION}' ({REQUIRED_SUPABASE_REGION_LABEL}) is required for "
        "Australian data residency. Use a Sydney-hosted Supabase project or update your environment."
    )


def validate_supabase_region(
    *,
    supabase_url: str,
    declared_region: str | None = None,
    access_token: str | None = None,
    region_check_mode: str | None = None,
) -> None:
    """
    Ensure hosted Supabase projects are in ap-southeast-2 (Sydney).

    Skips validation for local Supabase URLs and when SUPABASE_REGION_CHECK=disabled.
    When SUPABASE_ACCESS_TOKEN is set, verifies the live project region via Management API.
    Otherwise requires SUPABASE_REGION=ap-southeast-2 in the environment.
    """
    if is_region_check_disabled(region_check_mode):
        logger.info("Supabase region check disabled (SUPABASE_REGION_CHECK).")
        return

    if is_local_supabase_url(supabase_url):
        logger.info("Skipping Supabase region check for local URL: %s", supabase_url or "<empty>")
        return

    project_ref = extract_project_ref(supabase_url)
    if not project_ref:
        raise SupabaseRegionError(
            "Supabase region validation failed: SUPABASE_URL must be a hosted "
            "*.supabase.co project URL or a local Supabase URL."
        )

    token = (
        os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
        if access_token is None
        else access_token.strip()
    )
    declared = (
        os.environ.get("SUPABASE_REGION", "").strip()
        if declared_region is None
        else declared_region.strip()
    )

    if token:
        detected_region = fetch_project_region(project_ref, token)
        if detected_region != REQUIRED_SUPABASE_REGION:
            raise SupabaseRegionError(
                _format_region_mismatch(project_ref, detected_region),
                detected_region=detected_region,
            )
        if declared and declared != REQUIRED_SUPABASE_REGION:
            raise SupabaseRegionError(
                f"SUPABASE_REGION is '{declared}' but must be '{REQUIRED_SUPABASE_REGION}'."
            )
        logger.info(
            "Supabase region OK: project '%s' is in %s (%s).",
            project_ref,
            REQUIRED_SUPABASE_REGION,
            REQUIRED_SUPABASE_REGION_LABEL,
        )
        return

    if declared != REQUIRED_SUPABASE_REGION:
        raise SupabaseRegionError(
            "Supabase region validation failed: set SUPABASE_REGION="
            f"{REQUIRED_SUPABASE_REGION} for project '{project_ref}', or set SUPABASE_ACCESS_TOKEN "
            "to verify the live project region via the Supabase Management API before deployment."
        )

    logger.info(
        "Supabase region declared OK for project '%s' (%s).",
        project_ref,
        REQUIRED_SUPABASE_REGION,
    )
