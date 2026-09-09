"""Bug reporting: submission (backend/app/api/bug_reports.py) and the Super
Admin listing/status endpoints (backend/app/api/admin.py). Focused on the
authorization boundaries — org-scoping on submit, super_admin-only on the
admin side — since that's the part most worth a regression guard, mirroring
the pattern used in test_participant_shift_context.py (call the route
function directly with a mocked supabase client, no HTTP layer)."""

from __future__ import annotations

import base64
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from backend.app.api import admin, bug_reports
from backend.app.services import bug_report_service


@pytest.mark.asyncio
async def test_submit_bug_report_requires_organization():
    with pytest.raises(HTTPException) as exc:
        await bug_reports.submit_bug_report(
            body=bug_reports.BugReportCreate(description="Button does nothing"),
            current_user={"id": "u-1", "role": "support_worker", "organization_id": None},
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_submit_bug_report_creates_with_reporter_and_org_from_session():
    with patch(
        "backend.app.api.bug_reports.svc.create_bug_report",
        return_value={"id": "r-1", "status": "open"},
    ) as create:
        result = await bug_reports.submit_bug_report(
            body=bug_reports.BugReportCreate(description="Button does nothing", page_url="/settings"),
            current_user={"id": "u-1", "role": "support_worker", "organization_id": "org-1"},
        )
    create.assert_called_once_with("org-1", "u-1", "Button does nothing", "/settings", [], "low")
    assert result == {"id": "r-1", "status": "open"}


@pytest.mark.asyncio
async def test_submit_bug_report_passes_through_chosen_severity():
    with patch(
        "backend.app.api.bug_reports.svc.create_bug_report",
        return_value={"id": "r-1", "status": "open"},
    ) as create:
        await bug_reports.submit_bug_report(
            body=bug_reports.BugReportCreate(description="App is unusable", severity="urgent"),
            current_user={"id": "u-1", "role": "managing_director", "organization_id": "org-1"},
        )
    assert create.call_args.args[-1] == "urgent"


def test_bug_report_create_rejects_invalid_severity():
    with pytest.raises(ValueError):
        bug_reports.BugReportCreate(description="Whatever", severity="critical")


@pytest.mark.asyncio
async def test_list_bug_reports_requires_super_admin():
    with pytest.raises(HTTPException) as exc:
        await admin.list_bug_reports(current_user={"id": "u-1", "role": "managing_director"})
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_list_bug_reports_attaches_org_name():
    supabase = MagicMock()

    def _table(name: str):
        table = MagicMock()
        if name == "bug_reports":
            table.select.return_value.order.return_value.execute.return_value = MagicMock(
                data=[
                    {
                        "id": "r-1",
                        "organization_id": "org-1",
                        "page_url": "/settings",
                        "description": "Button does nothing",
                        "status": "open",
                        "created_at": "2026-09-01T00:00:00Z",
                        "updated_at": "2026-09-01T00:00:00Z",
                    }
                ]
            )
        elif name == "organizations":
            table.select.return_value.in_.return_value.execute.return_value = MagicMock(
                data=[{"organization_id": "org-1", "organization_name": "Sunshine Disability Services", "name": None}]
            )
        else:
            raise AssertionError(f"Unexpected table requested: {name}")
        return table

    supabase.table.side_effect = _table

    with patch("backend.app.api.admin.get_supabase_admin", return_value=supabase):
        result = await admin.list_bug_reports(current_user={"id": "admin-1", "role": "super_admin"})

    assert len(result) == 1
    assert result[0]["organization_name"] == "Sunshine Disability Services"


@pytest.mark.asyncio
async def test_list_bug_reports_never_exposes_reporter_identity():
    """CARECLIQV2-352 — a bug report is identified by which org hit it,
    never which staff member did. The response must carry no reporter
    field, and the users table must never even be queried for it — a
    _table side_effect raising on "users" proves that."""
    supabase = MagicMock()

    def _table(name: str):
        table = MagicMock()
        if name == "bug_reports":
            table.select.return_value.order.return_value.execute.return_value = MagicMock(
                data=[
                    {
                        "id": "r-1",
                        "organization_id": "org-1",
                        "description": "Button does nothing",
                        "status": "open",
                        "created_at": "2026-09-01T00:00:00Z",
                        "updated_at": "2026-09-01T00:00:00Z",
                    }
                ]
            )
        elif name == "organizations":
            table.select.return_value.in_.return_value.execute.return_value = MagicMock(data=[])
        else:
            raise AssertionError(f"Unexpected table requested: {name}")
        return table

    supabase.table.side_effect = _table

    with patch("backend.app.api.admin.get_supabase_admin", return_value=supabase):
        result = await admin.list_bug_reports(current_user={"id": "admin-1", "role": "super_admin"})

    assert "reporter_name" not in result[0]
    assert "reporter_id" not in result[0]


@pytest.mark.asyncio
async def test_update_bug_report_status_requires_super_admin():
    with pytest.raises(HTTPException) as exc:
        await admin.update_bug_report_status(
            report_id="r-1",
            body=admin.BugReportStatusUpdate(status="in_progress"),
            current_user={"id": "u-1", "role": "support_coordinator"},
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_update_bug_report_status_rejects_invalid_status():
    with pytest.raises(HTTPException) as exc:
        await admin.update_bug_report_status(
            report_id="r-1",
            body=admin.BugReportStatusUpdate(status="not_a_real_status"),
            current_user={"id": "admin-1", "role": "super_admin"},
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_update_bug_report_status_404_when_not_found():
    supabase = MagicMock()
    supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[])

    with patch("backend.app.api.admin.get_supabase_admin", return_value=supabase):
        with pytest.raises(HTTPException) as exc:
            await admin.update_bug_report_status(
                report_id="does-not-exist",
                body=admin.BugReportStatusUpdate(status="in_progress"),
                current_user={"id": "admin-1", "role": "super_admin"},
            )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_create_bug_report_links_jira_issue_when_created():
    supabase = MagicMock()

    def _table(name: str):
        table = MagicMock()
        if name == "bug_reports":
            table.insert.return_value.execute.return_value = MagicMock(data=[{"id": "r-1", "jira_issue_key": None}])
            table.update.return_value.eq.return_value.execute.return_value = MagicMock(
                data=[{"id": "r-1", "jira_issue_key": "BRS-99"}]
            )
        elif name == "organizations":
            table.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
                data={"organization_name": "Sunshine Disability Services", "name": None}
            )
        else:
            raise AssertionError(f"Unexpected table requested: {name}")
        return table

    supabase.table.side_effect = _table

    with patch("backend.app.services.bug_report_service.get_supabase_admin", return_value=supabase), patch(
        "backend.app.services.bug_report_service.jira_service.create_issue",
        AsyncMock(return_value="BRS-99"),
    ) as create_issue:
        row = await bug_report_service.create_bug_report("org-1", "u-1", "Button does nothing", "/settings")

    create_issue.assert_awaited_once()
    assert row["jira_issue_key"] == "BRS-99"
    # The org name — not the reporting staff member — is what identifies
    # the ticket, since Jira's Reporter field can't hold an org name.
    call_kwargs = create_issue.call_args.kwargs
    assert call_kwargs["summary"].startswith("[Sunshine Disability Services]")
    assert "Sunshine Disability Services" in call_kwargs["description"]


@pytest.mark.asyncio
async def test_create_bug_report_rejects_invalid_severity():
    with pytest.raises(ValueError, match="Invalid severity"):
        await bug_report_service.create_bug_report(
            "org-1", "u-1", "Button does nothing", "/settings", severity="critical"
        )


@pytest.mark.asyncio
async def test_create_bug_report_passes_severity_to_jira_as_priority():
    supabase = MagicMock()

    def _table(name: str):
        table = MagicMock()
        if name == "bug_reports":
            table.insert.return_value.execute.return_value = MagicMock(
                data=[{"id": "r-1", "severity": "urgent", "jira_issue_key": None}]
            )
            table.update.return_value.eq.return_value.execute.return_value = MagicMock(
                data=[{"id": "r-1", "severity": "urgent", "jira_issue_key": "BRS-99"}]
            )
        elif name == "organizations":
            table.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
                data={"organization_name": "Sunshine Disability Services", "name": None}
            )
        else:
            raise AssertionError(f"Unexpected table requested: {name}")
        return table

    supabase.table.side_effect = _table

    with patch("backend.app.services.bug_report_service.get_supabase_admin", return_value=supabase), patch(
        "backend.app.services.bug_report_service.jira_service.create_issue",
        AsyncMock(return_value="BRS-99"),
    ) as create_issue:
        row = await bug_report_service.create_bug_report(
            "org-1", "u-1", "App is unusable", "/settings", severity="urgent"
        )

    assert row["severity"] == "urgent"
    assert create_issue.call_args.kwargs["severity"] == "urgent"


@pytest.mark.asyncio
async def test_create_bug_report_degrades_gracefully_when_severity_column_missing():
    supabase = MagicMock()
    table = MagicMock()
    # First insert (with severity) fails as it would against a DB that
    # hasn't run the migration adding the column yet; the retry without it
    # must still succeed so the report isn't lost.
    table.insert.return_value.execute.side_effect = [
        Exception('column "severity" of relation "bug_reports" does not exist'),
        MagicMock(data=[{"id": "r-1", "jira_issue_key": None}]),
    ]
    supabase.table.return_value = table

    with patch("backend.app.services.bug_report_service.get_supabase_admin", return_value=supabase), patch(
        "backend.app.services.bug_report_service.jira_service.create_issue",
        AsyncMock(return_value=None),
    ):
        row = await bug_report_service.create_bug_report(
            "org-1", "u-1", "Button does nothing", "/settings", severity="medium"
        )

    assert row["id"] == "r-1"
    assert table.insert.call_count == 2
    # The retried payload must not carry the column that doesn't exist yet.
    retried_payload = table.insert.call_args_list[1].args[0]
    assert "severity" not in retried_payload


@pytest.mark.asyncio
async def test_create_bug_report_saves_fine_when_jira_unavailable():
    supabase = MagicMock()
    supabase.table.return_value.insert.return_value.execute.return_value = MagicMock(
        data=[{"id": "r-1", "jira_issue_key": None}]
    )

    with patch("backend.app.services.bug_report_service.get_supabase_admin", return_value=supabase), patch(
        "backend.app.services.bug_report_service.jira_service.create_issue",
        AsyncMock(return_value=None),
    ):
        row = await bug_report_service.create_bug_report("org-1", "u-1", "Button does nothing", "/settings")

    assert row["id"] == "r-1"
    assert row["jira_issue_key"] is None
    # No update call — nothing to link when Jira didn't return an issue key.
    supabase.table.return_value.update.assert_not_called()


@pytest.mark.asyncio
async def test_update_bug_report_status_syncs_linked_jira_issue():
    supabase = MagicMock()
    supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{"id": "r-1", "status": "resolved", "jira_issue_key": "BRS-99"}]
    )

    with patch("backend.app.api.admin.get_supabase_admin", return_value=supabase), patch(
        "backend.app.api.admin.jira_service.transition_issue", AsyncMock(return_value=True)
    ) as transition:
        await admin.update_bug_report_status(
            report_id="r-1",
            body=admin.BugReportStatusUpdate(status="resolved"),
            current_user={"id": "admin-1", "role": "super_admin"},
        )

    transition.assert_awaited_once_with("BRS-99", "resolved")


@pytest.mark.asyncio
async def test_update_bug_report_status_skips_jira_when_unlinked():
    supabase = MagicMock()
    supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{"id": "r-1", "status": "resolved", "jira_issue_key": None}]
    )

    with patch("backend.app.api.admin.get_supabase_admin", return_value=supabase), patch(
        "backend.app.api.admin.jira_service.transition_issue", AsyncMock()
    ) as transition:
        await admin.update_bug_report_status(
            report_id="r-1",
            body=admin.BugReportStatusUpdate(status="resolved"),
            current_user={"id": "admin-1", "role": "super_admin"},
        )

    transition.assert_not_awaited()


# ── Attachments (photos/short videos of the bug) ─────────────────────────────

_TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


def test_process_attachments_rejects_too_many_files():
    attachments = [{"mime_type": "image/png", "data": _TINY_PNG_B64}] * (bug_report_service.MAX_ATTACHMENTS + 1)
    with pytest.raises(ValueError, match="at most"):
        bug_report_service._process_attachments("org-1", "r-1", attachments)


def test_process_attachments_rejects_unsupported_mime_type():
    with pytest.raises(ValueError, match="Unsupported file type"):
        bug_report_service._process_attachments(
            "org-1", "r-1", [{"mime_type": "application/pdf", "data": _TINY_PNG_B64}]
        )


def test_process_attachments_rejects_oversized_file():
    oversized = base64.b64encode(b"x" * (bug_report_service.MAX_IMAGE_BYTES + 1)).decode()
    with pytest.raises(ValueError, match="exceeds"):
        bug_report_service._process_attachments("org-1", "r-1", [{"mime_type": "image/png", "data": oversized}])


def test_process_attachments_rejects_empty_file():
    with pytest.raises(ValueError, match="Empty file"):
        bug_report_service._process_attachments("org-1", "r-1", [{"mime_type": "image/png", "data": ""}])


def test_process_attachments_uploads_valid_image():
    stored_object = MagicMock(storage_path="org-1/bug-reports/r-1/0-abcd1234.png")
    with patch(
        "backend.app.services.bug_report_service.upload_evidence_bytes", return_value=stored_object
    ) as upload:
        result = bug_report_service._process_attachments(
            "org-1", "r-1", [{"mime_type": "image/png", "data": _TINY_PNG_B64}]
        )

    upload.assert_called_once()
    assert result == [
        {
            "storage_path": "org-1/bug-reports/r-1/0-abcd1234.png",
            "mime_type": "image/png",
            "file_size_bytes": len(base64.b64decode(_TINY_PNG_B64)),
        }
    ]


@pytest.mark.asyncio
async def test_submit_bug_report_400_for_invalid_attachment():
    with patch(
        "backend.app.api.bug_reports.svc.create_bug_report",
        AsyncMock(side_effect=ValueError("Unsupported file type: application/pdf")),
    ):
        with pytest.raises(HTTPException) as exc:
            await bug_reports.submit_bug_report(
                body=bug_reports.BugReportCreate(
                    description="Button does nothing",
                    attachments=[bug_reports.BugReportAttachment(mime_type="application/pdf", data="x")],
                ),
                current_user={"id": "u-1", "role": "support_worker", "organization_id": "org-1"},
            )
    assert exc.value.status_code == 400
