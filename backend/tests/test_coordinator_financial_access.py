"""Support coordinators work with invoices (checking and verifying them) but
never see organisation revenue or organisation-wide financial statistics."""
import asyncio
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.services import billing_service

COORDINATOR = {"id": "c-1", "role": "support_coordinator", "organization_id": "org-1"}
MD = {"id": "m-1", "role": "managing_director", "organization_id": "org-1"}


def test_coordinator_cannot_read_revenue_report():
    with patch.object(billing_service, "get_supabase_admin") as db:
        with pytest.raises(HTTPException) as error:
            asyncio.run(billing_service.get_revenue_report(COORDINATOR))
    assert error.value.status_code == 403
    db.assert_not_called()


def test_managing_director_can_read_revenue_report():
    db = MagicMock()
    chain = db.table.return_value.select.return_value
    chain.eq.return_value = chain
    chain.order.return_value = chain
    chain.execute.return_value = MagicMock(data=[])
    with patch.object(billing_service, "get_supabase_admin", return_value=db):
        result = asyncio.run(billing_service.get_revenue_report(MD))
    assert isinstance(result, dict)


def test_coordinator_keeps_invoice_access():
    billing_service._require_billing_role(COORDINATOR)  # does not raise


def test_support_worker_has_no_invoice_access():
    with pytest.raises(HTTPException):
        billing_service._require_billing_role({**COORDINATOR, "role": "support_worker"})


def _tool_names(user):
    from backend.app.services.chatbox import tools
    return {t.name for t in tools.build_tools_for_user(user, "thread-1")}


def test_assistant_offers_revenue_only_to_managing_director():
    assert "get_revenue_summary" not in _tool_names(COORDINATOR)
    assert "get_revenue_summary" in _tool_names(MD)


def test_managing_director_can_check_participant_goals_and_tasks():
    from backend.app.api import coordinator
    db = MagicMock()
    chain = db.table.return_value.select.return_value
    chain.eq.return_value = chain
    chain.execute.return_value = MagicMock(data=[{"id": "g1"}], count=3)
    with patch.object(coordinator, "get_supabase_admin", return_value=db):
        result = asyncio.run(coordinator.check_goals_and_tasks("p-1", MD))
    assert result["has_valid"] is True


def test_support_worker_cannot_check_participant_goals_and_tasks():
    from backend.app.api import coordinator
    with pytest.raises(HTTPException):
        asyncio.run(coordinator.check_goals_and_tasks("p-1", {**MD, "role": "support_worker"}))
