"""Tests for CARECLIQV2-326 billing period plan management lock."""

from __future__ import annotations

import unittest
from datetime import date
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from backend.app.models.billing_period import normalize_plan_management_type
from backend.app.services import billing_period_service

ORG_ID = "11111111-1111-1111-1111-111111111111"
PARTICIPANT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"


class NormalizePlanManagementTypeTests(unittest.TestCase):
    def test_canonical_values_unchanged(self):
        self.assertEqual(normalize_plan_management_type("NDIA-managed"), "NDIA-managed")
        self.assertEqual(normalize_plan_management_type("plan-managed"), "plan-managed")
        self.assertEqual(normalize_plan_management_type("self-managed"), "self-managed")

    def test_legacy_underscore_values(self):
        self.assertEqual(normalize_plan_management_type("plan_managed"), "plan-managed")
        self.assertEqual(normalize_plan_management_type("ndia_managed"), "NDIA-managed")

    def test_free_text_inference(self):
        self.assertEqual(
            normalize_plan_management_type("Plan-managed via My Plan Manager"),
            "plan-managed",
        )


class PeriodBoundsTests(unittest.TestCase):
    def test_calendar_month_bounds(self):
        start, end = billing_period_service.period_bounds_for_date(date(2026, 6, 15))
        self.assertEqual(start, date(2026, 6, 1))
        self.assertEqual(end, date(2026, 6, 30))


class BillingPeriodLockTests(unittest.TestCase):
    def test_rejects_invalid_type_update(self):
        with self.assertRaises(HTTPException) as ctx:
            billing_period_service.validate_plan_management_type_update("invalid-type")
        self.assertEqual(ctx.exception.status_code, 422)

    @patch("backend.app.services.billing_period_service.get_supabase_admin")
    def test_open_period_snapshots_current_type(self, mock_admin):
        mock_supabase = MagicMock()
        mock_admin.return_value = mock_supabase

        select_chain = MagicMock()
        select_chain.eq.return_value = select_chain
        select_chain.limit.return_value = select_chain
        select_chain.execute.return_value = MagicMock(data=[])

        insert_chain = MagicMock()
        insert_chain.execute.return_value = MagicMock(
            data=[{
                "id": "period-1",
                "participant_id": PARTICIPANT_ID,
                "organization_id": ORG_ID,
                "period_start": "2026-06-01",
                "period_end": "2026-06-30",
                "locked_plan_management_type": "plan-managed",
                "status": "open",
            }]
        )

        table_mock = MagicMock()
        table_mock.select.return_value = select_chain
        table_mock.insert.return_value = insert_chain
        mock_supabase.table.return_value = table_mock

        participant = {
            "id": PARTICIPANT_ID,
            "organization_id": ORG_ID,
            "plan_management_type": "plan-managed",
        }

        with patch(
            "backend.app.services.billing_period_service.app_today",
            return_value=date(2026, 6, 10),
        ):
            period = billing_period_service.get_or_open_billing_period(
                PARTICIPANT_ID,
                ORG_ID,
                participant=participant,
            )

        self.assertEqual(period["locked_plan_management_type"], "plan-managed")
        insert_payload = insert_chain.execute.call_args
        self.assertIsNotNone(insert_payload)

    @patch("backend.app.services.billing_period_service.get_supabase_admin")
    def test_existing_period_not_reopened_with_new_type(self, mock_admin):
        mock_supabase = MagicMock()
        mock_admin.return_value = mock_supabase

        existing_period = {
            "id": "period-1",
            "participant_id": PARTICIPANT_ID,
            "organization_id": ORG_ID,
            "period_start": "2026-06-01",
            "period_end": "2026-06-30",
            "locked_plan_management_type": "NDIA-managed",
            "status": "open",
        }

        select_chain = MagicMock()
        select_chain.eq.return_value = select_chain
        select_chain.limit.return_value = select_chain
        select_chain.execute.return_value = MagicMock(data=[existing_period])

        table_mock = MagicMock()
        table_mock.select.return_value = select_chain
        mock_supabase.table.return_value = table_mock

        participant = {
            "id": PARTICIPANT_ID,
            "organization_id": ORG_ID,
            "plan_management_type": "self-managed",
        }

        with patch(
            "backend.app.services.billing_period_service.app_today",
            return_value=date(2026, 6, 20),
        ):
            period = billing_period_service.get_or_open_billing_period(
                PARTICIPANT_ID,
                ORG_ID,
                participant=participant,
            )

        self.assertEqual(period["locked_plan_management_type"], "NDIA-managed")
        table_mock.insert.assert_not_called()

    @patch("backend.app.services.billing_period_service.get_supabase_admin")
    def test_missing_type_blocks_period_open(self, mock_admin):
        mock_supabase = MagicMock()
        mock_admin.return_value = mock_supabase

        select_chain = MagicMock()
        select_chain.eq.return_value = select_chain
        select_chain.limit.return_value = select_chain
        select_chain.execute.return_value = MagicMock(data=[])

        table_mock = MagicMock()
        table_mock.select.return_value = select_chain
        mock_supabase.table.return_value = table_mock

        participant = {
            "id": PARTICIPANT_ID,
            "organization_id": ORG_ID,
            "plan_management_type": None,
            "plan_management": None,
        }

        with patch(
            "backend.app.services.billing_period_service.app_today",
            return_value=date(2026, 6, 10),
        ):
            with self.assertRaises(HTTPException) as ctx:
                billing_period_service.get_or_open_billing_period(
                    PARTICIPANT_ID,
                    ORG_ID,
                    participant=participant,
                )
        self.assertEqual(ctx.exception.status_code, 422)


class SuggestRecipientTests(unittest.TestCase):
    def test_ndia_managed_routes_to_ndia(self):
        name, email = billing_period_service.suggest_invoice_recipient(
            {"full_name": "Jane"},
            "NDIA-managed",
        )
        self.assertEqual(name, "NDIA")
        self.assertIsNone(email)

    def test_plan_managed_uses_case_manager(self):
        name, email = billing_period_service.suggest_invoice_recipient(
            {
                "full_name": "Jane",
                "case_manager_name": "Priya Nair",
                "case_manager_email": "priya@example.com",
            },
            "plan-managed",
        )
        self.assertEqual(name, "Priya Nair")
        self.assertEqual(email, "priya@example.com")

    def test_self_managed_uses_participant(self):
        name, email = billing_period_service.suggest_invoice_recipient(
            {"full_name": "Jane Smith", "email": "jane@example.com"},
            "self-managed",
        )
        self.assertEqual(name, "Jane Smith")
        self.assertEqual(email, "jane@example.com")


class CloseStalePeriodTests(unittest.TestCase):
    @patch("backend.app.services.billing_period_service.get_supabase_admin")
    def test_close_stale_open_periods(self, mock_admin):
        mock_supabase = MagicMock()
        mock_admin.return_value = mock_supabase

        select_chain = MagicMock()
        select_chain.eq.return_value = select_chain
        select_chain.lt.return_value = select_chain
        select_chain.execute.return_value = MagicMock(
            data=[{"id": "old-period", "period_start": "2026-05-01", "status": "open"}]
        )

        update_chain = MagicMock()
        update_chain.eq.return_value = update_chain
        update_chain.execute.return_value = MagicMock(data=[{"id": "old-period"}])

        table_mock = MagicMock()
        table_mock.select.return_value = select_chain
        table_mock.update.return_value = update_chain
        mock_supabase.table.return_value = table_mock

        closed = billing_period_service.close_stale_open_periods(
            PARTICIPANT_ID,
            ORG_ID,
            as_of_date=date(2026, 6, 15),
        )
        self.assertEqual(closed, 1)
        table_mock.update.assert_called_once()


if __name__ == "__main__":
    unittest.main()
