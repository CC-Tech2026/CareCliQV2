"""NDIS reportable-incident notification deadline + escalation.

Today `is_ndis_reportable` + `NDIS_NOTIFICATION_HOURS` already compute a reportability flag
and an ad-hoc `overdue` boolean at read time (see incident_service.py `_enrich`) — but nothing
was ever stored or escalated on a schedule; a coordinator only sees a static "overdue" badge if
they happen to open the incident. This module adds the missing piece: a periodic scan (mirroring
medication_reminder_service.py's pattern, wired into the same notification scheduler pass) that
escalates to coordinators at 12h and 4h before the deadline and again once it's overdue —
deliberately reusing the exact same deadline math as `_enrich` rather than inventing a new one.

Deliberately out of scope here (see the Incident Management spec's data-model/classification-
engine gaps): category-specific business-day timing, `connection_to_service`, and a dedicated
`incident_notifications` table — this reuses the existing `incidents.ndis_reportable` /
`ndis_reported_at` columns as the source of truth rather than duplicating them.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from ..schemas.incident import NDIS_NOTIFICATION_HOURS
from .notification_service import _org_coordinator_user_ids, notify_worker
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

# Escalation tiers, checked most-urgent first. Each fires once per incident via notify_worker's
# built-in reference_key delivery dedup — no separate "already sent" bookkeeping needed.
ESCALATION_TIERS = (
    ("overdue", timedelta(0)),
    ("4h", timedelta(hours=4)),
    ("12h", timedelta(hours=12)),
)


def _is_missing_schema_error(exc: Exception) -> bool:
    err = str(exc).lower()
    return "does not exist" in err or "42703" in err or "pgrst" in err or "could not find" in err


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def compute_notification_due_at(incident: dict[str, Any]) -> datetime | None:
    """Same deadline math as incident_service.py's `_enrich` — kept in sync deliberately so the
    stored/escalated deadline always matches what the UI's `overdue` badge already shows."""
    if not incident.get("ndis_reportable"):
        return None
    occurred = _parse_dt(incident.get("incident_date"))
    if not occurred:
        return None
    severity = str(incident.get("severity") or "medium")
    hours = NDIS_NOTIFICATION_HOURS.get(severity, 240)
    return occurred + timedelta(hours=hours)


async def _notify_coordinators_incident_deadline(
    *, org_id: str, incident: dict[str, Any], tier: str, due_at: datetime,
) -> int:
    incident_id = str(incident.get("id") or "")
    title = incident.get("title") or "Incident"
    ref = f"incident:{incident_id}:notification:{tier}"
    if tier == "overdue":
        message = f'"{title}" was due to be notified to the NDIS Commission by {due_at.strftime("%d %b %Y %H:%M")} UTC and has not been marked as reported.'
    else:
        message = f'"{title}" must be notified to the NDIS Commission by {due_at.strftime("%d %b %Y %H:%M")} UTC — {tier} remaining.'

    sent = 0
    for coord_id in _org_coordinator_user_ids(org_id):
        try:
            outcome = await notify_worker(
                user_id=coord_id,
                org_id=org_id,
                event="incident_notification_alert",
                alert_type="incident_notification_overdue" if tier == "overdue" else "incident_notification_due_soon",
                title="Overdue: NDIS incident notification" if tier == "overdue" else "NDIS incident notification due soon",
                message=message,
                reference_key=f"{ref}:{coord_id}",
                severity="high",
                action_url=f"/incidents/{incident_id}",
            )
            if outcome.get("in_app") or outcome.get("email") or outcome.get("push"):
                sent += 1
        except Exception as exc:
            logger.warning("Incident notification alert failed for coordinator %s: %s", coord_id, exc)
    return sent


async def run_incident_notification_pass() -> int:
    """Scan all open, reportable, not-yet-submitted incidents and escalate whichever tier applies."""
    try:
        resp = (
            get_supabase_admin()
            .table("incidents")
            .select("id, organization_id, title, incident_date, severity, status, ndis_reportable, ndis_reported_at")
            .eq("ndis_reportable", True)
            .is_("ndis_reported_at", "null")
            .neq("status", "closed")
            .execute()
        )
        rows = resp.data or []
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return 0
        logger.warning("Incident notification query failed: %s", exc)
        return 0

    now = datetime.now(timezone.utc)
    total = 0
    for incident in rows:
        org_id = str(incident.get("organization_id") or "")
        if not org_id:
            continue
        due_at = compute_notification_due_at(incident)
        if not due_at:
            continue
        remaining = due_at - now
        for tier, threshold in ESCALATION_TIERS:
            if remaining <= threshold:
                try:
                    total += await _notify_coordinators_incident_deadline(
                        org_id=org_id, incident=incident, tier=tier, due_at=due_at,
                    )
                except Exception as exc:
                    logger.warning("Incident notification escalation failed for %s: %s", incident.get("id"), exc)
                break  # only the single most-urgent tier that applies right now
    return total
