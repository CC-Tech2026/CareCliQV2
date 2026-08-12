"""Medication → Incident cross-link (Medication Safety Addendum step 4).

A medication event should never live only as a medication record once it rises to the
severity of an incident. Both entry points here go through incident_service.create_incident()
— never a raw insert — so the incident gets the same classification engine treatment
(ndis_reportable, practice_standard) as any other incident, and lands at the same 'reported'
status every incident starts at. This deliberately does not auto-submit anything to the NDIS
Commission or pre-classify reportability; it creates the starting point of an incident record,
pre-filled and correctly linked, and stops there — exactly where a coordinator already expects
to pick incidents up.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from ..schemas.incident import IncidentCreate
from .incident_service import create_incident
from .notification_service import notify_incident_reported

logger = logging.getLogger(__name__)

SOURCE_TYPE_ADMINISTRATION_ERROR = "medication_administration_error"
SOURCE_TYPE_PATTERN_SIGNAL = "medication_pattern_signal"


def _format_time(value: Any) -> str:
    if not value:
        return "an unknown time"
    return str(value)


async def _notify_coordinators(result: dict[str, Any], *, org_id: str | None, participant_id: str) -> None:
    """create_incident() itself never notifies — that only happens at the API layer for the
    human-reported paths (incidents.py). A system-generated incident needs the same alert or
    it just sits in the list until someone happens to browse it, which defeats the point of
    the cross-link. Best-effort: a failed notification must never undo the incident record."""
    if not org_id:
        return
    try:
        await notify_incident_reported(
            org_id=str(org_id),
            incident_id=str(result.get("id") or ""),
            title=str(result.get("title") or "Medication safety incident"),
            message=str(result.get("description") or "")[:500],
            severity=str(result.get("severity") or "medium"),
            participant_id=participant_id,
            reference_number=result.get("reference_number"),
        )
    except Exception as exc:
        logger.warning("Coordinator notification failed for auto-generated incident %s: %s", result.get("id"), exc)


async def create_incident_from_medication_error(
    administration: dict[str, Any],
    medication: dict[str, Any],
) -> dict[str, Any] | None:
    """Fires on every medication_administrations row logged with outcome ==
    'administration_error' — both the immediate self-report case and the later-discovered
    correction row (identifiable by corrects_administration_id being set)."""
    participant_id = administration.get("participant_id") or medication.get("participant_id")
    if not participant_id:
        logger.warning("Cannot create incident from medication error: no participant_id on administration %s", administration.get("id"))
        return None

    error_subtype = administration.get("error_subtype") or "unspecified"
    discovered_late = bool(administration.get("corrects_administration_id"))
    description_lines = [
        f"Medication: {medication.get('name')}" + (f" ({medication.get('strength')})" if medication.get("strength") else ""),
        f"Error type: {error_subtype.replace('_', ' ')}",
        f"Scheduled time: {_format_time(administration.get('scheduled_time'))}",
        f"Actual/logged time: {_format_time(administration.get('administered_time'))}",
    ]
    if discovered_late:
        description_lines.append(
            f"Discovered after the fact — this record corrects administration {administration.get('corrects_administration_id')}."
        )
    if administration.get("notes"):
        description_lines.append(f"Notes: {administration['notes']}")

    incident_date = administration.get("error_discovered_at") or administration.get("administered_time")
    body = IncidentCreate(
        participant_id=str(participant_id),
        shift_id=administration.get("shift_id"),
        title=f"Medication administration error — {medication.get('name') or 'unnamed medication'}",
        description="\n".join(description_lines),
        incident_type="medication_error",
        severity="medium",
        incident_date=incident_date or datetime.now(timezone.utc).isoformat(),
        identified_at=administration.get("error_discovered_at"),
        source_type=SOURCE_TYPE_ADMINISTRATION_ERROR,
        source_id=administration.get("id"),
    )
    actor_id = administration.get("error_discovered_by") or administration.get("administered_by")
    result = await create_incident(
        body,
        org_id=administration.get("organization_id"),
        user_id=actor_id,
    )
    await _notify_coordinators(result, org_id=administration.get("organization_id"), participant_id=str(participant_id))
    return result


async def create_incident_from_pattern_signal(
    signal: dict[str, Any],
    *,
    participant_id: str,
    medication_name: str | None,
) -> dict[str, Any] | None:
    """Fires only when refused_missed_triggered is set on a participant_reliability signal —
    a concentration of refused/missed doses on one specific medication, not the general
    late/early/missed rate threshold (that trend stays Compliance-Centre-facing only, per the
    addendum: a rate is worth reviewing, a concentrated refusal/missed pattern is closer to a
    genuine safety concern)."""
    if not signal.get("refused_missed_triggered"):
        return None

    description_lines = [
        f"Participant: {participant_id}",
        f"Medication: {medication_name or 'unspecified'}",
        f"Window: {signal.get('window_start')} to {signal.get('window_end')}",
        signal.get("trigger_reason") or "Refused/missed dose concentration threshold reached.",
    ]

    body = IncidentCreate(
        participant_id=str(participant_id),
        title=f"Medication reliability pattern — {medication_name or 'unspecified medication'}",
        description="\n".join(description_lines),
        incident_type="medication_error",
        severity="medium",
        incident_date=signal.get("calculated_at") or datetime.now(timezone.utc).isoformat(),
        identified_at=signal.get("calculated_at"),
        source_type=SOURCE_TYPE_PATTERN_SIGNAL,
        source_id=signal.get("id"),
    )
    result = await create_incident(
        body,
        org_id=signal.get("organization_id"),
        user_id=None,
    )
    await _notify_coordinators(result, org_id=signal.get("organization_id"), participant_id=str(participant_id))
    return result
