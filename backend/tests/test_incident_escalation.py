"""Escalating an existing incident: PATCH /api/incidents/{id} with {"escalate": true}.

It used to pass "escalate" through to the database update, where no such column exists, so
the write failed and nothing changed while the screen said "Incident escalated". Escalating
must raise the incident to critical, alert the office team and be audited as an escalation.
Run: python -m pytest backend/tests/test_incident_escalation.py -v
"""
from __future__ import annotations

from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

from backend.app.api import incidents as incidents_api
from backend.app.schemas.incident import IncidentUpdate

INCIDENT_ID = "incident-1"
ORG_ID = "org-1"
MD = {"sub": "md-1", "role": "managing_director", "organization_id": ORG_ID}
EXISTING = {
    "id": INCIDENT_ID,
    "user_id": "worker-1",
    "title": "Safety hazard",
    "description": "Wet floor in the hallway.",
    "severity": "medium",
    "status": "reported",
    "participant_id": "participant-1",
    "reference_number": "INC-1",
}


class EscalateIncidentTests(IsolatedAsyncioTestCase):
    @patch.object(incidents_api.audit_service, "log_action", new_callable=AsyncMock)
    @patch.object(incidents_api, "notify_incident_reported", new_callable=AsyncMock)
    @patch.object(incidents_api.incident_service, "update_incident", new_callable=AsyncMock)
    @patch.object(incidents_api.incident_service, "get_incident_by_id", new_callable=AsyncMock)
    async def test_escalate_raises_to_critical_alerts_and_audits(
        self, mock_get, mock_update, mock_notify, mock_audit,
    ):
        mock_get.return_value = dict(EXISTING)
        mock_update.return_value = {**EXISTING, "severity": "critical"}

        result = await incidents_api.update_incident(
            MagicMock(), INCIDENT_ID, IncidentUpdate(escalate=True), user=MD,
        )

        sent = mock_update.await_args.args[1]
        self.assertEqual(sent, {"severity": "critical"})
        self.assertNotIn("escalate", sent)
        self.assertEqual(result["severity"], "critical")

        mock_notify.assert_awaited_once()
        alert = mock_notify.await_args.kwargs
        self.assertEqual(alert["org_id"], ORG_ID)
        self.assertEqual(alert["severity"], "critical")
        self.assertTrue(alert["escalate"])
        self.assertIn("Safety hazard", alert["title"])

        self.assertEqual(mock_audit.await_args.kwargs["action_type"], "incident.escalated")

    @patch.object(incidents_api.audit_service, "log_action", new_callable=AsyncMock)
    @patch.object(incidents_api, "notify_incident_reported", new_callable=AsyncMock)
    @patch.object(incidents_api.incident_service, "update_incident", new_callable=AsyncMock)
    @patch.object(incidents_api.incident_service, "get_incident_by_id", new_callable=AsyncMock)
    async def test_ordinary_update_does_not_alert(
        self, mock_get, mock_update, mock_notify, mock_audit,
    ):
        mock_get.return_value = dict(EXISTING)
        mock_update.return_value = {**EXISTING, "investigation_notes": "Checked."}

        await incidents_api.update_incident(
            MagicMock(), INCIDENT_ID, IncidentUpdate(investigation_notes="Checked."), user=MD,
        )

        self.assertEqual(mock_update.await_args.args[1], {"investigation_notes": "Checked."})
        mock_notify.assert_not_awaited()
        self.assertEqual(mock_audit.await_args.kwargs["action_type"], "incident.updated")


class EscalateIsNeverWrittenTests(IsolatedAsyncioTestCase):
    @patch("backend.app.services.incident_service.get_incident_by_id", new_callable=AsyncMock)
    @patch("backend.app.services.incident_service._apply_legal_record_normalization", new_callable=AsyncMock)
    @patch("backend.app.services.incident_service.get_supabase_admin")
    async def test_service_drops_escalate_before_the_write(self, mock_admin, _normalise, mock_get):
        table = MagicMock()
        select_chain = MagicMock()
        select_chain.eq.return_value = select_chain
        select_chain.execute.return_value = MagicMock(data=[dict(EXISTING)])
        table.select.return_value = select_chain
        update_chain = MagicMock()
        update_chain.eq.return_value = update_chain
        update_chain.execute.return_value = MagicMock(data=[dict(EXISTING)])
        table.update.return_value = update_chain
        mock_admin.return_value.table.return_value = table
        mock_get.return_value = dict(EXISTING)

        from backend.app.services import incident_service

        await incident_service.update_incident(INCIDENT_ID, {"escalate": True, "severity": "critical"}, current_user=MD)

        written = table.update.call_args.args[0]
        self.assertNotIn("escalate", written)
        self.assertEqual(written["severity"], "critical")
