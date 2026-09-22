""""Fill it later" on Log Incident: the long written-summary fields (description,
participant_impact, worker_actions, injury_nature — see DEFERRABLE_FIELDS in schemas/incident.py)
can be deferred instead of blocking submission. A deferred incident gets a 6-hour window
(incidents.pending_deadline_at, set at creation in incident_service.create_incident):

  - While inside the window: nudge the reporting worker/coordinator once per hour
    (pending_last_reminded_at gates re-firing — this pass runs every
    NOTIFICATION_SCHEDULER_INTERVAL_MINUTES, typically 15, so it only actually notifies once
    an hour has actually elapsed since the last nudge).
  - Once the window lapses with pending_fields still non-empty: stop nudging the worker and
    escalate once to the org's coordinators/MD instead (pending_escalated_at gates re-firing —
    mirrors overdue_documentation_escalation_service.py's shift-documentation pattern).

pending_fields is cleared (and pending_completed_at set) by incident_service.update_incident
the moment the worker/coordinator finishes the deferred fields — this pass simply stops seeing
the incident once that happens, since its queries filter on pending_fields being non-empty.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from .notification_service import _org_coordinator_user_ids, notify_worker
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

FIELD_LABELS = {
    "description": "What happened?",
    "participant_impact": "Participant Impact",
    "worker_actions": "Immediate Actions Taken",
    "injury_nature": "Nature of injury or harm",
}


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


def _field_list(row: dict[str, Any]) -> list[str]:
    return [FIELD_LABELS.get(f, f) for f in (row.get("pending_fields") or [])]


async def run_incident_pending_completion_pass() -> dict[str, int]:
    now = datetime.now(timezone.utc)
    supabase = get_supabase_admin()

    try:
        resp = (
            supabase.table("incidents")
            .select(
                "id, organization_id, created_by, title, pending_fields, "
                "pending_deadline_at, pending_last_reminded_at, pending_escalated_at"
            )
            .not_.is_("pending_deadline_at", "null")
            .is_("pending_completed_at", "null")
            .execute()
        )
        # pending_deadline_at is only ever set when pending_fields was non-empty at creation,
        # but filter defensively in Python too — array-column equality filters are fragile
        # across postgrest versions, and this list is small (open incidents only).
        rows: list[dict[str, Any]] = [
            r for r in (resp.data or []) if r.get("pending_fields")
        ]
    except Exception as exc:
        if _is_missing_schema_error(exc):
            return {"reminders": 0, "escalations": 0}
        logger.warning("Incident pending-completion query failed: %s", exc)
        return {"reminders": 0, "escalations": 0}

    reminders = 0
    escalations = 0

    for row in rows:
        incident_id = row["id"]
        org_id = row.get("organization_id")
        reporter_id = row.get("created_by")
        deadline = _parse_dt(row.get("pending_deadline_at"))
        if not org_id or not deadline:
            continue

        fields_text = ", ".join(_field_list(row)) or "some fields"
        overdue = now >= deadline

        if overdue:
            if row.get("pending_escalated_at"):
                continue  # already escalated once — don't re-fire every pass
            try:
                result = (
                    supabase.table("incidents")
                    .update({"pending_escalated_at": now.isoformat()})
                    .eq("id", incident_id)
                    .is_("pending_escalated_at", "null")
                    .execute()
                )
            except Exception as exc:
                logger.warning("Pending-incident escalation update failed for %s: %s", incident_id, exc)
                continue
            if not result.data:
                continue  # concurrent pass already claimed it, or it was completed in the gap

            for coordinator_id in _org_coordinator_user_ids(org_id):
                try:
                    await notify_worker(
                        user_id=coordinator_id,
                        org_id=org_id,
                        event="incident_pending_overdue",
                        title="Incident report overdue",
                        message=(
                            f"\"{row.get('title') or 'An incident report'}\" is missing {fields_text} "
                            f"and the 6-hour window to complete it has passed."
                        ),
                        reference_key=f"incident:{incident_id}:pending_overdue:{coordinator_id}",
                        severity="high",
                        action_url=f"/incidents/{incident_id}",
                    )
                except Exception as exc:
                    logger.warning("Overdue pending-incident notify failed for %s: %s", incident_id, exc)
            escalations += 1
            continue

        if not reporter_id:
            continue
        last_reminded = _parse_dt(row.get("pending_last_reminded_at"))
        if last_reminded and now - last_reminded < timedelta(hours=1):
            continue  # nudged within the last hour already

        try:
            result = (
                supabase.table("incidents")
                .update({"pending_last_reminded_at": now.isoformat()})
                .eq("id", incident_id)
                .execute()
            )
        except Exception as exc:
            logger.warning("Pending-incident reminder update failed for %s: %s", incident_id, exc)
            continue
        if not result.data:
            continue

        minutes_left = max(0, int((deadline - now).total_seconds() // 60))
        try:
            await notify_worker(
                user_id=reporter_id,
                org_id=org_id,
                event="incident_pending_reminder",
                title="Finish your incident report",
                message=(
                    f"\"{row.get('title') or 'Your incident report'}\" is still missing {fields_text}. "
                    f"You have about {minutes_left} minutes left to complete it."
                ),
                reference_key=f"incident:{incident_id}:pending_reminder:{now.strftime('%Y%m%d%H')}",
                severity="medium",
                action_url=f"/incidents/{incident_id}",
            )
        except Exception as exc:
            logger.warning("Pending-incident reminder notify failed for %s: %s", incident_id, exc)
            continue
        reminders += 1

    return {"reminders": reminders, "escalations": escalations}
