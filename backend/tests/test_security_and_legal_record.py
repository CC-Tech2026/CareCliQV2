import unittest
from datetime import timedelta

from fastapi import HTTPException

from backend.app.core.access import can_access_participant, can_access_session
from backend.app.core.config import settings
from backend.app.core.security import create_access_token
from backend.app.api.security import require_recent_reauth
from backend.app.services import ai_service
from backend.app.services.compliance_engine import ComplianceBlockedError, run_compliance_check
from backend.app.services.documentation_normalization_service import (
    normalize_documentation_for_legal_record,
)
from backend.app.services.email_service import delivery_state, queue_invitation_email


ORG_A = "11111111-1111-1111-1111-111111111111"
ORG_B = "22222222-2222-2222-2222-222222222222"
WORKER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
CLINICIAN_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"


class AccessControlTests(unittest.TestCase):
    def test_unauthenticated_user_cannot_access_participant(self):
        row = {"id": "p1", "organization_id": ORG_A}
        self.assertFalse(can_access_participant(row, None))

    def test_wrong_role_cannot_access_participant(self):
        user = {"sub": WORKER_ID, "role": "viewer", "organization_id": ORG_A}
        row = {"id": "p1", "organization_id": ORG_A}
        self.assertFalse(can_access_participant(row, user))

    def test_support_worker_cannot_view_unassigned_participant(self):
        user = {"sub": WORKER_ID, "role": "support_worker", "organization_id": ORG_A}
        row = {"id": "p1", "organization_id": ORG_A, "assigned_worker_id": "other"}
        self.assertFalse(can_access_participant(row, user))

    def test_allied_health_cannot_view_unassigned_participant(self):
        user = {"sub": CLINICIAN_ID, "role": "allied_health", "organization_id": ORG_A}
        row = {"id": "p1", "organization_id": ORG_A, "allied_health_id": "other"}
        self.assertFalse(can_access_participant(row, user))

    def test_coordinator_cannot_view_other_organization_participant(self):
        user = {"sub": WORKER_ID, "role": "support_coordinator", "organization_id": ORG_A}
        row = {"id": "p1", "organization_id": ORG_B}
        self.assertFalse(can_access_participant(row, user))

    def test_support_worker_can_view_assigned_participant(self):
        user = {"sub": WORKER_ID, "role": "support_worker", "organization_id": ORG_A}
        row = {"id": "p1", "organization_id": ORG_A, "assigned_worker_id": WORKER_ID}
        self.assertTrue(can_access_participant(row, user))

    def test_support_worker_cannot_view_unassigned_session_by_direct_id(self):
        user = {"sub": WORKER_ID, "role": "support_worker", "organization_id": ORG_A}
        session = {"id": "s1", "organization_id": ORG_A, "patient_id": "p1"}
        participant = {"id": "p1", "organization_id": ORG_A, "assigned_worker_id": "other"}
        self.assertFalse(can_access_session(session, user, participant))

    def test_support_worker_cannot_view_other_worker_session_for_assigned_participant(self):
        user = {"sub": WORKER_ID, "role": "support_worker", "organization_id": ORG_A}
        session = {
            "id": "s1",
            "organization_id": ORG_A,
            "patient_id": "p1",
            "worker_id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
        }
        participant = {"id": "p1", "organization_id": ORG_A, "assigned_worker_id": WORKER_ID}
        self.assertFalse(can_access_session(session, user, participant))

    def test_support_worker_can_view_own_session_for_assigned_participant(self):
        user = {"sub": WORKER_ID, "role": "support_worker", "organization_id": ORG_A}
        session = {"id": "s1", "organization_id": ORG_A, "patient_id": "p1", "worker_id": WORKER_ID}
        participant = {"id": "p1", "organization_id": ORG_A, "assigned_worker_id": WORKER_ID}
        self.assertTrue(can_access_session(session, user, participant))

    def test_missing_assignment_metadata_fails_closed(self):
        user = {"sub": WORKER_ID, "role": "support_worker", "organization_id": ORG_A}
        row = {"id": "p1", "organization_id": ORG_A}
        self.assertFalse(can_access_participant(row, user))


class LegalRecordNormalizationTests(unittest.IsolatedAsyncioTestCase):
    async def test_english_note_becomes_legal_record(self):
        result = await normalize_documentation_for_legal_record(
            "The participant completed a meal preparation task with support."
        )
        self.assertEqual(result["translation_status"], "not_required")
        self.assertEqual(result["translated_english_note"], result["compliance_input_text"])

    async def test_supported_non_english_note_is_translated(self):
        original = ai_service.translate_to_english

        async def fake_translate(text: str, source_language: str = "auto"):
            return {
                "translated": "The participant completed the activity.",
                "detected_language": "fr",
                "confidence": 0.96,
                "provider": "openai",
                "model": "gpt-4o-mini",
            }

        ai_service.translate_to_english = fake_translate
        try:
            result = await normalize_documentation_for_legal_record(
                "Le participant a termine l'activite.",
                requested_language="fr",
            )
        finally:
            ai_service.translate_to_english = original

        self.assertEqual(result["original_language_input"], "Le participant a termine l'activite.")
        self.assertEqual(result["detected_language"], "fr")
        self.assertEqual(result["translated_english_note"], "The participant completed the activity.")
        self.assertEqual(result["translation_status"], "translated")

    async def test_unsupported_language_blocks_compliance(self):
        result = await normalize_documentation_for_legal_record("Test", requested_language="xx")
        self.assertEqual(result["translation_status"], "unsupported")
        self.assertIsNone(result["compliance_input_text"])

    async def test_translation_failure_blocks_compliance(self):
        original = ai_service.translate_to_english

        async def failing_translate(text: str, source_language: str = "auto"):
            raise RuntimeError("provider unavailable")

        ai_service.translate_to_english = failing_translate
        try:
            result = await normalize_documentation_for_legal_record("Bonjour", requested_language="fr")
        finally:
            ai_service.translate_to_english = original

        self.assertEqual(result["translation_status"], "failed")
        self.assertIsNone(result["compliance_input_text"])

    def test_raw_source_direct_compliance_is_rejected(self):
        with self.assertRaises(ComplianceBlockedError):
            run_compliance_check({"notes": "Bonjour", "translation_status": "pending"})


class EmailDeliveryTests(unittest.TestCase):
    def setUp(self):
        self._original = {
            "email_enabled": settings.email_enabled,
            "smtp_host": settings.smtp_host,
            "smtp_port": settings.smtp_port,
            "smtp_username": settings.smtp_username,
            "smtp_password": settings.smtp_password,
            "smtp_from_email": settings.smtp_from_email,
        }

    def tearDown(self):
        for key, value in self._original.items():
            setattr(settings, key, value)

    def test_email_delivery_disabled_by_default(self):
        settings.email_enabled = False
        state = delivery_state()
        self.assertEqual(state.status, "disabled")

    def test_email_delivery_detects_missing_smtp_config(self):
        settings.email_enabled = True
        settings.smtp_username = ""
        settings.smtp_password = ""
        settings.smtp_from_email = ""
        state = delivery_state()
        self.assertEqual(state.status, "not_configured")

    def test_invitation_email_is_queued_when_smtp_configured(self):
        class FakeBackgroundTasks:
            def __init__(self):
                self.tasks = []

            def add_task(self, fn, **kwargs):
                self.tasks.append((fn, kwargs))

        settings.email_enabled = True
        settings.smtp_host = "smtp.gmail.com"
        settings.smtp_port = 587
        settings.smtp_username = "sender@example.com"
        settings.smtp_password = "app-password"
        settings.smtp_from_email = "sender@example.com"

        tasks = FakeBackgroundTasks()
        result = queue_invitation_email(
            tasks,
            to_email="worker@example.com",
            invite_url="http://localhost:3000/accept-invite?token=test",
            organization_name="Sunshine Supports",
            role="support_worker",
        )

        self.assertEqual(result["status"], "queued")
        self.assertEqual(len(tasks.tasks), 1)


class RecentReauthTests(unittest.TestCase):
    def setUp(self):
        self.user = {
            "sub": WORKER_ID,
            "email": "worker@example.com",
            "role": "support_worker",
            "organization_id": ORG_A,
        }

    def _request(self, token=None):
        class FakeRequest:
            headers = {"x-reauth-token": token} if token else {}

        return FakeRequest()

    def test_missing_reauth_token_is_blocked(self):
        with self.assertRaises(HTTPException) as ctx:
            require_recent_reauth(self._request(), self.user)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_matching_reauth_token_is_allowed(self):
        token = create_access_token(
            {
                "sub": WORKER_ID,
                "email": "worker@example.com",
                "role": "support_worker",
                "organization_id": ORG_A,
                "reauth": True,
            },
            expires_delta=timedelta(minutes=settings.reauth_token_expire_minutes),
        )
        require_recent_reauth(self._request(token), self.user)

    def test_reauth_token_for_other_user_is_blocked(self):
        token = create_access_token(
            {"sub": "other", "reauth": True},
            expires_delta=timedelta(minutes=settings.reauth_token_expire_minutes),
        )
        with self.assertRaises(HTTPException) as ctx:
            require_recent_reauth(self._request(token), self.user)
        self.assertEqual(ctx.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
