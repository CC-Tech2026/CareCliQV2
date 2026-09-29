from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from .credential_status import live_status
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

# Required for every rostered shift regardless of the org's per-shift-type
# matrix. Without this, a worker holding any single valid credential (e.g. a
# driver licence) passed the gate whenever the org hadn't configured
# shift_credential_requirements for that shift type.
BASELINE_REQUIRED_CREDENTIALS: tuple[str, ...] = ("ndis_screening",)

# Pre-095 free-text labels that still turn up on older rows.
_CREDENTIAL_TYPE_ALIASES = {
    "ndis_worker_screening": "ndis_screening",
    "working_with_children": "wwcc",
    "driver_licence": "drivers_licence",
}


def canonical_credential_type(value: Any) -> str:
    """"NDIS Screening", "ndis-screening" and "ndis_screening" all compare equal."""
    key = "_".join(str(value or "").strip().lower().replace("-", " ").split())
    return _CREDENTIAL_TYPE_ALIASES.get(key, key)


@dataclass
class WorkerCredentialStatus:
    valid: bool
    missing_credentials: list[str] = field(default_factory=list)
    warning: str | None = None


async def verify_worker_credentials(
    worker_id: str,
    org_id: str,
    required_credential_types: list[str] | None = None,
    supabase: Any | None = None,
) -> WorkerCredentialStatus:
    """Validate whether a worker has at least one active credential.

        Rules:
    - Worker is valid if at least one credential is in `valid` status and not expired.
    - Credentials marked `expired` or `rejected` are treated as missing/invalid.
    - Credentials expiring within EXPIRING_WITHIN_DAYS (credential_status) trigger a
      warning but do not block assignment.
        - If required_credential_types is provided, worker must have all required
            credential types in valid/non-expired state.
    """
    client = supabase or get_supabase_admin()
    try:
        creds_resp = (
            client.table("credentials")
            .select("id, credential_type, status, expiry_date")
            .eq("user_id", worker_id)
            .eq("organization_id", org_id)
            .execute()
        )

        credentials = creds_resp.data or []
        if not credentials:
            return WorkerCredentialStatus(
                valid=False,
                missing_credentials=["No credentials found"],
                warning="Worker has no credentials on file",
            )

        valid_creds: list[str] = []
        expired_creds: list[str] = []
        expiring_soon_creds: list[str] = []

        # Same rules as every other screen (credential_status.live_status):
        # valid through the expiry date, "expiring" within the shared window.
        # This used to re-implement them with a 30-day window and treated a
        # credential as expired on its own expiry date.
        for cred in credentials:
            cred_type = cred.get("credential_type") or "Unknown"
            status = live_status(cred.get("expiry_date"), cred.get("status"))

            if status in ("valid", "expiring"):
                valid_creds.append(cred_type)
                if status == "expiring":
                    expiring_soon_creds.append(cred_type)
            elif status in ("expired", "rejected"):
                expired_creds.append(cred_type)

        valid_type_set = {canonical_credential_type(t) for t in valid_creds}
        required_missing = [
            t for t in (required_credential_types or [])
            if str(t).strip() and canonical_credential_type(t) not in valid_type_set
        ]

        warning = None
        if expiring_soon_creds:
            warning = f"Credentials expiring soon: {', '.join(expiring_soon_creds)}"
        if required_missing:
            missing_text = ", ".join(required_missing)
            requirement_warning = f"Missing required credentials for shift type: {missing_text}"
            warning = f"{warning}. {requirement_warning}" if warning else requirement_warning

        return WorkerCredentialStatus(
            valid=bool(valid_creds) and not required_missing,
            missing_credentials=expired_creds + required_missing,
            warning=warning,
        )

    except Exception as exc:
        logger.error("Error checking credentials for worker %s: %s", worker_id, exc)
        return WorkerCredentialStatus(
            valid=False,
            missing_credentials=["Error checking credentials"],
            warning=f"Could not verify credentials: {exc}",
        )


async def get_shift_credential_requirements(
    org_id: str,
    shift_type: str,
    supabase: Any | None = None,
) -> list[str]:
    """Return required credential types configured for an organization + shift type."""
    client = supabase or get_supabase_admin()
    normalized_shift_type = (shift_type or "standard_support").strip().lower()

    try:
        resp = (
            client.table("shift_credential_requirements")
            .select("required_credential_type, is_active")
            .eq("organization_id", org_id)
            .eq("shift_type", normalized_shift_type)
            .eq("is_active", True)
            .execute()
        )
        rows = resp.data or []
        reqs = []
        for row in rows:
            value = str(row.get("required_credential_type") or "").strip()
            if value:
                reqs.append(value)
        return reqs
    except Exception as exc:
        logger.warning(
            "Could not load shift credential requirements for org=%s shift_type=%s: %s",
            org_id,
            normalized_shift_type,
            exc,
        )
        return []


async def required_credentials_for_shift(
    org_id: str,
    shift_type: str,
    supabase: Any | None = None,
) -> list[str]:
    """Baseline credentials plus the org's configured matrix for this shift type."""
    configured = await get_shift_credential_requirements(org_id, shift_type, supabase=supabase)
    required = list(BASELINE_REQUIRED_CREDENTIALS)
    seen = {canonical_credential_type(t) for t in required}
    for value in configured:
        key = canonical_credential_type(value)
        if key not in seen:
            seen.add(key)
            required.append(value)
    return required
