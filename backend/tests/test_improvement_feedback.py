"""Improvements & Feedback: submission (backend/app/api/improvement_feedback.py,
MD-only) and the Super Admin listing/status endpoints (backend/app/api/admin.py).
Mirrors test_bug_reports.py's approach — call the route function directly
with a mocked supabase client, no HTTP layer."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.api import admin, improvement_feedback
from backend.app.services import improvement_feedback_service


@pytest.mark.asyncio
async def test_submit_requires_managing_director():
    with pytest.raises(HTTPException) as exc:
        await improvement_feedback.submit_improvement_feedback(
            body=improvement_feedback.ImprovementFeedbackCreate(description="An idea"),
            current_user={"id": "u-1", "role": "support_coordinator", "organization_id": "org-1"},
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_submit_requires_organization():
    with pytest.raises(HTTPException) as exc:
        await improvement_feedback.submit_improvement_feedback(
            body=improvement_feedback.ImprovementFeedbackCreate(description="An idea"),
            current_user={"id": "u-1", "role": "managing_director", "organization_id": None},
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_submit_creates_with_org_and_submitter_from_session():
    with patch(
        "backend.app.api.improvement_feedback.svc.create_improvement_feedback",
        return_value={"id": "f-1", "status": "open"},
    ) as create:
        result = await improvement_feedback.submit_improvement_feedback(
            body=improvement_feedback.ImprovementFeedbackCreate(description="A better rostering view"),
            current_user={"id": "u-1", "role": "managing_director", "organization_id": "org-1"},
        )
    create.assert_called_once_with("org-1", "u-1", "A better rostering view")
    assert result == {"id": "f-1", "status": "open"}


@pytest.mark.asyncio
async def test_create_improvement_feedback_never_calls_jira():
    """CARECLIQV2-350 — feedback is a plain internal list, unlike bug
    reports: submitting it must never create/touch a Jira issue."""
    supabase = MagicMock()
    supabase.table.return_value.insert.return_value.execute.return_value = MagicMock(
        data=[{"id": "f-1", "status": "open"}]
    )

    with patch(
        "backend.app.services.improvement_feedback_service.get_supabase_admin", return_value=supabase
    ), patch("backend.app.services.jira_service.create_issue") as create_issue:
        row = await improvement_feedback_service.create_improvement_feedback("org-1", "u-1", "A better rostering view")

    create_issue.assert_not_called()
    assert row == {"id": "f-1", "status": "open"}
    assert "jira_issue_key" not in row


@pytest.mark.asyncio
async def test_list_improvement_feedback_requires_super_admin():
    with pytest.raises(HTTPException) as exc:
        await admin.list_improvement_feedback(current_user={"id": "u-1", "role": "managing_director"})
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_list_improvement_feedback_attaches_org_and_submitter_names():
    supabase = MagicMock()

    def _table(name: str):
        table = MagicMock()
        if name == "improvement_feedback":
            table.select.return_value.order.return_value.execute.return_value = MagicMock(
                data=[
                    {
                        "id": "f-1",
                        "organization_id": "org-1",
                        "submitted_by": "u-1",
                        "description": "A better rostering view",
                        "status": "open",
                        "created_at": "2026-09-08T00:00:00Z",
                        "updated_at": "2026-09-08T00:00:00Z",
                    }
                ]
            )
        elif name == "organizations":
            table.select.return_value.in_.return_value.execute.return_value = MagicMock(
                data=[{"organization_id": "org-1", "organization_name": "Sunshine Disability Services", "name": None}]
            )
        elif name == "users":
            table.select.return_value.in_.return_value.execute.return_value = MagicMock(
                data=[{"id": "u-1", "full_name": "Jamie MD", "email": "jamie@example.com"}]
            )
        else:
            raise AssertionError(f"Unexpected table requested: {name}")
        return table

    supabase.table.side_effect = _table

    with patch("backend.app.api.admin.get_supabase_admin", return_value=supabase):
        result = await admin.list_improvement_feedback(current_user={"id": "admin-1", "role": "super_admin"})

    assert len(result) == 1
    assert result[0]["organization_name"] == "Sunshine Disability Services"
    assert result[0]["reporter_name"] == "Jamie MD"
    # CARECLIQV2-350 — feedback has no Jira integration, so it never gets a link.
    assert result[0]["jira_url"] is None


@pytest.mark.asyncio
async def test_update_improvement_feedback_status_requires_super_admin():
    with pytest.raises(HTTPException) as exc:
        await admin.update_improvement_feedback_status(
            feedback_id="f-1",
            body=admin.ImprovementFeedbackStatusUpdate(status="in_progress"),
            current_user={"id": "u-1", "role": "managing_director"},
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_improvement_feedback_status_404_when_not_found():
    supabase = MagicMock()
    supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[])

    with patch("backend.app.api.admin.get_supabase_admin", return_value=supabase):
        with pytest.raises(HTTPException) as exc:
            await admin.update_improvement_feedback_status(
                feedback_id="does-not-exist",
                body=admin.ImprovementFeedbackStatusUpdate(status="in_progress"),
                current_user={"id": "admin-1", "role": "super_admin"},
            )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_update_improvement_feedback_status_never_syncs_jira():
    """CARECLIQV2-350 — even a legacy row that still carries a
    jira_issue_key (from before this integration was removed) must not
    trigger a Jira transition on status change."""
    supabase = MagicMock()
    supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{"id": "f-1", "jira_issue_key": "BRS-12"}]
    )

    with patch("backend.app.api.admin.get_supabase_admin", return_value=supabase), patch(
        "backend.app.api.admin.jira_service.transition_issue"
    ) as transition_issue:
        result = await admin.update_improvement_feedback_status(
            feedback_id="f-1",
            body=admin.ImprovementFeedbackStatusUpdate(status="in_progress"),
            current_user={"id": "admin-1", "role": "super_admin"},
        )

    transition_issue.assert_not_called()
    assert result == {"ok": True, "status": "in_progress"}
