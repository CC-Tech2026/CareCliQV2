import unittest
from datetime import date, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException

from backend.app.api.assignments import _worker_membership_profiles
from backend.app.core.access import can_access_participant, can_access_session
from backend.app.core.config import settings
from backend.app.core.security import create_access_token
from backend.app.api.security import require_recent_reauth
from backend.app.api.auth import _is_auth_user_email_verified
from backend.app.services import ai_service
from backend.app.services import billing_service
from backend.app.services import session_service
from backend.app.services.compliance_engine import COMPLIANCE_BLOCKED_MESSAGE, ComplianceBlockedError, run_compliance_check
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

    async def test_completed_session_update_uses_existing_status_for_compliance(self):
        original = ai_service.translate_to_english

        async def failing_translate(text: str, source_language: str = "auto"):
            raise RuntimeError("provider unavailable")

        ai_service.translate_to_english = failing_translate
        try:
            payload = {}
            with self.assertRaises(ValueError) as ctx:
                await session_service._apply_legal_record_normalization(
                    payload,
                    {"notes": "Bonjour"},
                    None,
                    None,
                    existing={"status": "completed", "notes": "Bonjour"},
                )
            self.assertEqual(str(ctx.exception), COMPLIANCE_BLOCKED_MESSAGE)
        finally:
            ai_service.translate_to_english = original

    async def test_create_session_retries_when_optional_columns_are_missing(self):
        supabase = MagicMock()
        sessions = MagicMock()
        supabase.table.return_value = sessions

        session_data = {"id": "s1", "organization_id": ORG_A, "patient_id": "p1"}
        insert_result = MagicMock()
        insert_result.data = [session_data]

        sessions.insert.return_value = sessions
        sessions.execute.side_effect = [
            RuntimeError("Could not find the 'compliance_input_text' column of 'sessions' in the schema cache"),
            insert_result,
        ]

        with patch.object(session_service, "get_supabase_admin", return_value=supabase), patch(
            "backend.app.services.participant_service.get_participant_by_id",
            AsyncMock(return_value={"id": "p1", "organization_id": ORG_A}),
        ):
            data = session_service.SessionCreate(
                participant_id="p1",
                session_date=date.today(),
                duration_minutes=30,
                session_type="support",
                notes="The participant completed the activity.",
            )
            result = await session_service.create_session(
                data,
                {"sub": WORKER_ID, "role": "support_worker", "organization_id": ORG_A},
            )

        self.assertEqual(result["id"], "s1")
        self.assertEqual(sessions.execute.call_count, 2)
        second_insert_payload = sessions.insert.call_args_list[1][0][0]
        self.assertNotIn("compliance_input_text", second_insert_payload)
        self.assertNotIn("translated_english_note", second_insert_payload)
        self.assertNotIn("translation_status", second_insert_payload)

    def test_raw_source_direct_compliance_is_rejected(self):
        with self.assertRaises(ComplianceBlockedError):
            run_compliance_check({"notes": "Bonjour", "translation_status": "pending"})

    async def test_ensure_legal_record_fields_backfills_from_notes(self):
        session = {
            "id": "s-legacy",
            "status": "completed",
            "notes": "The participant completed a meal preparation task with support.",
            "compliance_input_text": None,
            "translated_english_note": None,
            "translation_status": None,
        }
        update_payloads: list[dict] = []

        supabase = MagicMock()
        sessions = MagicMock()
        supabase.table.return_value = sessions
        sessions.update.return_value = sessions
        sessions.execute.return_value = MagicMock(data=[session])

        def capture_update(payload):
            update_payloads.append(payload)
            return sessions

        sessions.update.side_effect = capture_update

        with patch.object(session_service, "get_supabase_admin", return_value=supabase):
            repaired = await session_service._ensure_legal_record_fields(
                session,
                {"sub": WORKER_ID, "role": "support_worker", "organization_id": ORG_A},
                "s-legacy",
            )

        self.assertEqual(repaired["translation_status"], "not_required")
        self.assertTrue(repaired["compliance_input_text"])
        self.assertEqual(
            repaired["compliance_input_text"],
            repaired["translated_english_note"],
        )
        self.assertIn("compliance_input_text", update_payloads[0])


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
        from backend.app.services.email_queue import get_email_queue, start_email_queue, stop_email_queue

        settings.email_enabled = True
        settings.smtp_host = "smtp.gmail.com"
        settings.smtp_port = 587
        settings.smtp_username = "sender@example.com"
        settings.smtp_password = "app-password"
        settings.smtp_from_email = "sender@example.com"

        start_email_queue()
        try:
            result = queue_invitation_email(
                None,
                to_email="worker@example.com",
                invite_url="http://localhost:3000/accept-invite?token=test",
                organization_name="Sunshine Supports",
                role="support_worker",
            )

            self.assertEqual(result["status"], "queued")
            self.assertGreaterEqual(get_email_queue().pending(), 1)
        finally:
            stop_email_queue()


class AssignmentApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_worker_membership_profiles_returns_org_members(self):
        supabase = MagicMock()
        memberships = MagicMock()
        profiles = MagicMock()

        def table(name):
            if name == "organization_members":
                return memberships
            if name == "users":
                return profiles
            return MagicMock()

        supabase.table.side_effect = table

        memberships.select.return_value = memberships
        memberships.eq.return_value = memberships
        memberships.in_.return_value = memberships
        memberships.execute.return_value = MagicMock(data=[
            {
                "user_id": "worker-1",
                "role": "support_worker",
                "is_active": True,
                "joined_at": "2026-01-01",
            }
        ])

        profiles.select.return_value = profiles
        profiles.in_.return_value = profiles
        profiles.execute.return_value = MagicMock(data=[
            {
                "id": "worker-1",
                "full_name": "Jane Doe",
                "email": "jane.doe@example.com",
                "role": "support_worker",
                "account_type": "independent_worker",
                "is_active": True,
            }
        ])

        with patch("backend.app.api.assignments.get_supabase_admin", return_value=supabase):
            result = _worker_membership_profiles("org-1")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["id"], "worker-1")
        self.assertEqual(result[0]["full_name"], "Jane Doe")
        self.assertEqual(result[0]["role"], "support_worker")

    async def test_worker_membership_profiles_returns_empty_when_no_members(self):
        supabase = MagicMock()
        memberships = MagicMock()

        def table(name):
            return memberships

        supabase.table.side_effect = table
        memberships.select.return_value = memberships
        memberships.eq.return_value = memberships
        memberships.in_.return_value = memberships
        memberships.execute.return_value = MagicMock(data=[])

        with patch("backend.app.api.assignments.get_supabase_admin", return_value=supabase):
            result = _worker_membership_profiles("org-1")

        self.assertEqual(result, [])


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
