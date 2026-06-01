import unittest
from datetime import timedelta

from fastapi import HTTPException

from backend.app.core.access import can_access_participant, can_access_session
from backend.app.core.config import settings
from backend.app.core.security import create_access_token
from backend.app.api.security import require_recent_reauth
from backend.app.api.auth import _is_auth_user_email_verified
from backend.app.api import ai as ai_api
from backend.app.services import ai_service
from backend.app.services import billing_service
from backend.app.services import google_translate_service
from backend.app.services.compliance_engine import ComplianceBlockedError, run_compliance_check
from backend.app.services.documentation_normalization_service import (
    normalize_documentation_for_legal_record,
)
from backend.app.services.email_service import delivery_state, queue_invitation_email
from backend.app.services.supported_languages import normalize_language_code, is_supported_language


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
    def setUp(self):
        self._project_id = settings.google_cloud_project_id
        self._credentials = settings.google_application_credentials
        self._google_translate = google_translate_service._translate_with_google_sync
        settings.google_cloud_project_id = "carecribe-test-project"
        settings.google_application_credentials = ""

    def tearDown(self):
        settings.google_cloud_project_id = self._project_id
        settings.google_application_credentials = self._credentials
        google_translate_service._translate_with_google_sync = self._google_translate

    def _mock_google(self, translated: str, detected: str):
        def fake_google(text: str, source_code: str | None, project_id: str, location: str):
            return {
                "translated": translated,
                "detected_language": detected or source_code,
                "response_metadata": {"mocked": True},
            }

        google_translate_service._translate_with_google_sync = fake_google

    async def test_english_note_becomes_legal_record(self):
        result = await normalize_documentation_for_legal_record(
            "The participant completed a meal preparation task with support."
        )
        self.assertEqual(result["translation_status"], "not_required")
        self.assertEqual(result["translated_english_note"], result["compliance_input_text"])

    async def test_hindi_note_is_translated_with_google_provider(self):
        self._mock_google("The participant completed the activity.", "hi")
        result = await normalize_documentation_for_legal_record(
            "प्रतिभागी ने गतिविधि पूरी की।",
            requested_language="hi",
        )

        self.assertEqual(result["original_language_input"], "प्रतिभागी ने गतिविधि पूरी की।")
        self.assertEqual(result["detected_language"], "hi")
        self.assertEqual(result["translated_english_note"], "The participant completed the activity.")
        self.assertEqual(result["translation_status"], "translated")
        self.assertEqual(result["translation_provider"], "google_cloud_translate")

    async def test_nepali_and_punjabi_are_supported(self):
        self.assertTrue(is_supported_language("nepali"))
        self.assertTrue(is_supported_language("punjabi"))
        self.assertEqual(normalize_language_code("nepali"), "ne")
        self.assertEqual(normalize_language_code("panjabi"), "pa")

    async def test_mandarin_normalizes_to_zh_cn(self):
        self.assertEqual(normalize_language_code("zh"), "zh-CN")
        self.assertEqual(normalize_language_code("zh_CN"), "zh-CN")
        self.assertEqual(normalize_language_code("mandarin"), "zh-CN")

    async def test_unsupported_language_blocks_compliance(self):
        result = await normalize_documentation_for_legal_record("Test", requested_language="xx")
        self.assertEqual(result["translation_status"], "unsupported")
        self.assertIsNone(result["compliance_input_text"])

    async def test_detected_unsupported_language_blocks_compliance(self):
        self._mock_google("Bonjour", "fr")
        result = await normalize_documentation_for_legal_record("नमस्ते", requested_language="auto")
        self.assertEqual(result["translation_status"], "unsupported")
        self.assertIsNone(result["compliance_input_text"])

    async def test_translation_failure_blocks_compliance(self):
        def failing_translate(text: str, source_code: str | None, project_id: str, location: str):
            raise RuntimeError("provider unavailable")

        google_translate_service._translate_with_google_sync = failing_translate
        result = await normalize_documentation_for_legal_record("नमस्ते", requested_language="hi")

        self.assertEqual(result["translation_status"], "failed")
        self.assertIsNone(result["compliance_input_text"])

    async def test_translate_endpoint_returns_google_provider(self):
        self._mock_google("The participant had lunch.", "hi")
        body = ai_api.TranslateRequest(text="प्रतिभागी ने दोपहर का भोजन किया।", source_language="hi")
        result = await ai_api.translate_text(body, current_user={"sub": WORKER_ID})
        self.assertEqual(result["provider"], "google_cloud_translate")
        self.assertEqual(result["model"], "google-cloud-translate-v3")

    def test_translation_path_is_google_service_only(self):
        self.assertEqual(
            ai_service.translate_to_english.__module__,
            "backend.app.services.google_translate_service",
        )

    def test_raw_source_direct_compliance_is_rejected(self):
        with self.assertRaises(ComplianceBlockedError):
            run_compliance_check({"notes": "Bonjour", "translation_status": "pending"})


class ClinicalRewriteTests(unittest.IsolatedAsyncioTestCase):
    async def test_placeholder_openai_key_uses_safe_formatter(self):
        original_key = settings.openai_api_key
        settings.openai_api_key = "your-openai-api-key"
        try:
            result = await ai_service.clinical_rewrite("Participant practised meal preparation.")
        finally:
            settings.openai_api_key = original_key

        self.assertEqual(result["provider"], "deterministic_ndis_formatter")
        self.assertTrue(result["fallback_used"])
        self.assertIn("Participant practised meal preparation.", result["clinical"])
        self.assertIn("Not specified in the source note.", result["clinical"])


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

    def test_expired_reauth_token_is_blocked(self):
        token = create_access_token(
            {
                "sub": WORKER_ID,
                "email": "worker@example.com",
                "role": "support_worker",
                "organization_id": ORG_A,
                "reauth": True,
            },
            expires_delta=timedelta(minutes=-1),
        )
        with self.assertRaises(HTTPException) as ctx:
            require_recent_reauth(self._request(token), self.user)
        self.assertEqual(ctx.exception.status_code, 403)


class AuthVerificationTests(unittest.TestCase):
    def test_auth_user_without_provider_confirmation_is_not_verified(self):
        class User:
            email_confirmed_at = None
            confirmed_at = None
            email_verified = False

        self.assertFalse(_is_auth_user_email_verified(User()))

    def test_auth_user_with_provider_confirmation_is_verified(self):
        class User:
            email_confirmed_at = "2026-05-28T00:00:00Z"
            confirmed_at = None
            email_verified = False

        self.assertTrue(_is_auth_user_email_verified(User()))


class SensitiveEndpointGuardTests(unittest.TestCase):
    def test_support_worker_cannot_access_billing_service(self):
        user = {"sub": WORKER_ID, "role": "support_worker", "organization_id": ORG_A}
        with self.assertRaises(HTTPException) as ctx:
            import asyncio

            asyncio.run(billing_service.list_invoices(user))
        self.assertEqual(ctx.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
