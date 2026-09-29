"""Single rostering gate shared by every path that puts a worker on a shift.

Shift creation used to be the only path that checked credentials, mandatory
training and induction; direct assign/reassign, bulk recurring creation and
the shift-offer queue each wrote worker_id without any of those checks. All
of them now call ensure_worker_can_be_rostered() so the rules can't drift.
"""

from __future__ import annotations

from typing import Any

from . import induction_service, worker_training_service
from .credential_verification_service import (
    WorkerCredentialStatus,
    required_credentials_for_shift,
    verify_worker_credentials,
)


class WorkerNotEligibleError(Exception):
    """The worker can't be rostered; str(exc) is the caller-facing reason."""


def normalize_shift_type(value: str | None) -> str:
    return (value or "standard_support").strip().lower()


async def check_worker_credentials(
    worker_id: str,
    org_id: str,
    shift_type: str | None,
    supabase: Any | None = None,
) -> WorkerCredentialStatus:
    required = await required_credentials_for_shift(
        org_id, normalize_shift_type(shift_type), supabase=supabase,
    )
    return await verify_worker_credentials(
        worker_id=worker_id,
        org_id=org_id,
        required_credential_types=required,
        supabase=supabase,
    )


async def ensure_worker_can_be_rostered(
    worker_id: str,
    org_id: str,
    shift_type: str | None,
    supabase: Any | None = None,
) -> WorkerCredentialStatus:
    """Raise WorkerNotEligibleError unless credentials, mandatory training and
    mandatory induction are all current. Returns the credential status so
    callers can surface expiring-soon warnings."""
    status = await check_worker_credentials(worker_id, org_id, shift_type, supabase=supabase)
    if not status.valid:
        raise WorkerNotEligibleError(
            f"Worker has invalid credentials: {', '.join(status.missing_credentials)}. "
            "Please ensure worker credentials are up to date before assigning shifts."
        )
    if worker_training_service.is_training_overdue(worker_id, org_id):
        raise WorkerNotEligibleError(
            "Worker has overdue mandatory training. "
            "Please ensure mandatory training is completed before assigning shifts."
        )
    if induction_service.is_induction_incomplete(worker_id, org_id):
        raise WorkerNotEligibleError(
            "Worker has incomplete mandatory induction. "
            "Please ensure induction is completed before assigning shifts."
        )
    return status
