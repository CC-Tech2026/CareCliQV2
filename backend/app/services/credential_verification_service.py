from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)


@dataclass
class WorkerCredentialStatus:
    valid: bool
    missing_credentials: list[str] = field(default_factory=list)
    warning: str | None = None


def _parse_expiry(expiry_date: Any) -> date | None:
    if not expiry_date:
        return None
    try:
        return datetime.fromisoformat(str(expiry_date)).date()
    except (ValueError, TypeError):
        return None


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
    - Credentials expiring within 30 days trigger a warning but do not block assignment.
        - If required_credential_types is provided, worker must have all required
            credential types in valid/non-expired state.
    """
    client = supabase or get_supabase_admin()
    # UTC, not the server's local system date — expiry_date is UTC-anchored,
    # and comparing it against a local-timezone "today" makes a credential
    # expiring "tomorrow" read as already-expired whenever the server's local
    # date has rolled over ahead of UTC's (e.g. ACST is UTC+9:30).
    today = datetime.now(timezone.utc).date()

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

        for cred in credentials:
            cred_type = cred.get("credential_type") or "Unknown"
            status = cred.get("status") or "pending_review"
            expiry = _parse_expiry(cred.get("expiry_date"))

            if status == "valid":
                if expiry is None or expiry > today:
                    valid_creds.append(cred_type)
                else:
                    expired_creds.append(cred_type)
            elif status in ("expired", "rejected"):
                expired_creds.append(cred_type)
            elif status == "expiring" or (expiry and (expiry - today).days <= 30):
                expiring_soon_creds.append(cred_type)

        required_types = [t.strip().lower() for t in (required_credential_types or []) if str(t).strip()]
        valid_type_set = {t.strip().lower() for t in valid_creds}

        required_missing: list[str] = []
        if required_types:
            missing_keys = [t for t in required_types if t not in valid_type_set]
            required_missing = [t for t in (required_credential_types or []) if t.strip().lower() in missing_keys]

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
