from unittest.mock import AsyncMock, MagicMock, patch
from io import BytesIO
from zipfile import ZipFile
import pytest
from fastapi import HTTPException
from backend.app.services import participant_records_service as service
from backend.app.services import participant_profile_export_service as profile
from backend.app.api import participants

USER = {"id": "coordinator", "role": "support_coordinator", "organization_id": "org-1"}

@pytest.mark.asyncio
async def test_export_rejects_invoice_not_linked_to_participant():
    with patch.object(service, "invoice_query") as query, patch.object(service, "render_participant_profile_pdf", new_callable=AsyncMock) as render:
        query.return_value.in_.return_value.execute.return_value.data = []
        with pytest.raises(HTTPException) as error:
            await service.export_records(USER, "p-1", ["details"], ["foreign-invoice"], "zip")
        assert error.value.status_code == 404
        query.assert_called_once_with(USER, "p-1")
        render.assert_not_awaited()

@pytest.mark.asyncio
async def test_zip_contains_only_selected_profile_sections_and_invoices():
    with patch.object(service, "invoice_query") as query, patch.object(service, "render_participant_profile_pdf", new_callable=AsyncMock) as render, patch.object(service.billing_service, "_build_template_data", return_value={}), patch.object(service.invoice_service, "render_invoice_pdf", return_value=b"%PDF-test-invoice"), patch.object(service, "get_supabase_admin"), patch.object(service.audit_service, "log_action", new_callable=AsyncMock) as audit:
        query.return_value.in_.return_value.execute.return_value.data = [{"id": "i-1", "invoice_number": "INV/123", "status": "paid"}]
        render.return_value = ("profile.pdf", b"%PDF-test-profile")
        filename, content, media = await service.export_records(USER, "p-1", ["goals"], ["i-1"], "zip")
        render.assert_awaited_once_with("org-1", "p-1", sections=["goals"])
        with ZipFile(BytesIO(content)) as archive:
            assert set(archive.namelist()) == {"Profile/participant-profile.pdf", "Invoices/INV_123-i-1.pdf", "export-index.json", "Contents.txt"}
            assert archive.read("Invoices/INV_123-i-1.pdf") == b"%PDF-test-invoice"
        assert media == "application/zip"
        audit.assert_awaited_once()

@pytest.mark.asyncio
async def test_export_rejects_stored_file_from_another_organisation():
    with patch.object(service, "invoice_query") as query, patch.object(service, "get_supabase_admin") as database:
        query.return_value.in_.return_value.execute.return_value.data = [{"id": "i-1", "invoice_number": "INV1", "pdf_path": "other-org/i-1/invoice.pdf"}]
        with pytest.raises(HTTPException) as error:
            await service.export_records(USER, "p-1", [], ["i-1"], "pdf")
        assert error.value.status_code == 409
        database.assert_not_called()

@pytest.mark.asyncio
async def test_unselected_details_are_absent_from_rendered_profile():
    context = {"participant": {"full_name": "Test Person", "ndis_number": "SECRET-NDIS", "email": "private@example.test"}, "org": {}, "generated": {}, "plan": {"total_funding": 1234}}
    with patch.object(profile, "resolve_merge_context", return_value=context), patch.object(profile, "_load_goals", return_value=[{"name": "Selected goal"}]), patch.object(profile, "_load_allergies") as allergies, patch.object(profile, "render_html_to_pdf", return_value=b"%PDF-test") as render:
        await profile.render_participant_profile_pdf("org-1", "p-1", sections=["goals"])
        html = render.call_args.args[0]
        assert "Selected goal" in html
        assert "SECRET-NDIS" not in html and "private@example.test" not in html
        assert 'class="section-title">NDIS Plan' not in html
        assert 'class="section-title">Contacts' not in html
        allergies.assert_not_called()

@pytest.mark.asyncio
async def test_records_route_checks_participant_access_before_export():
    with patch.object(participants, "_require_participant_access", new_callable=AsyncMock) as access, patch.object(service, "export_records", new_callable=AsyncMock) as export:
        access.side_effect = HTTPException(status_code=404)
        with pytest.raises(HTTPException):
            await participants.export_participant_records("foreign-person", participants.ParticipantRecordsExport(sections=["goals"]), USER)
        export.assert_not_awaited()

@pytest.mark.asyncio
async def test_worker_cannot_export_billing_records():
    with pytest.raises(HTTPException) as error:
        await service.export_records({**USER, "role": "support_worker"}, "p-1", ["details"], [], "pdf")
    assert error.value.status_code == 403

@pytest.mark.asyncio
async def test_period_export_includes_all_invoices_and_shift_history():
    from datetime import date
    with patch.object(service, "invoice_query") as query, patch.object(service, "render_shift_history_pdf", return_value=b"%PDF-shifts") as shifts, patch.object(service.billing_service, "_build_template_data", return_value={}), patch.object(service.invoice_service, "render_invoice_pdf", return_value=b"%PDF-invoice"), patch.object(service, "get_supabase_admin"), patch.object(service.audit_service, "log_action", new_callable=AsyncMock):
        chain = query.return_value.gte.return_value.lt.return_value
        chain.order.return_value.order.return_value.limit.return_value.execute.return_value.data = [
            {"id": "i-1", "invoice_number": "INV1"},
            {"id": "i-2", "invoice_number": "INV2", "pdf_generation_failed": True},
        ]
        _, content, _ = await service.export_records(USER, "p-1", [], [], "zip", all_invoices=True, include_shifts=True, date_from=date(2025, 7, 1), date_to=date(2026, 6, 30))
        query.return_value.gte.assert_called_once_with("created_at", "2025-07-01T00:00:00Z")
        query.return_value.gte.return_value.lt.assert_called_once_with("created_at", "2026-07-01T00:00:00Z")
        shifts.assert_called_once_with("org-1", "p-1", date(2025, 7, 1), date(2026, 6, 30))
        with ZipFile(BytesIO(content)) as archive:
            names = set(archive.namelist())
            assert {"Invoices/INV1-i-1.pdf", "Shift history/shift-history.pdf"} <= names
            assert not any("i-2" in name for name in names)
            assert "INV2" in archive.read("Contents.txt").decode()

@pytest.mark.asyncio
async def test_period_export_rejects_too_many_invoices():
    with patch.object(service, "invoice_query") as query:
        query.return_value.order.return_value.order.return_value.limit.return_value.execute.return_value.data = [{"id": str(n)} for n in range(service.MAX_PERIOD_INVOICES + 1)]
        with pytest.raises(HTTPException) as error:
            await service.export_records(USER, "p-1", [], [], "zip", all_invoices=True)
        assert error.value.status_code == 422

@pytest.mark.asyncio
async def test_shift_history_alone_can_download_as_pdf():
    with patch.object(service, "render_shift_history_pdf", return_value=b"%PDF-shifts"), patch.object(service.audit_service, "log_action", new_callable=AsyncMock):
        filename, content, media = await service.export_records(USER, "p-1", [], [], "pdf", include_shifts=True)
        assert (filename, content, media) == ("shift-history.pdf", b"%PDF-shifts", "application/pdf")

def test_shift_history_pdf_groups_shifts_by_year():
    from datetime import date
    rows = [
        {"session_date": "2025-12-30T09:00:00Z", "session_type": "personal_care", "duration_minutes": 90, "status": "completed", "worker_id": "w-1"},
        {"session_date": "2026-01-02T09:00:00Z", "session_type": None, "duration_minutes": 60, "status": "completed", "worker_id": None},
    ]
    with patch.object(service, "get_supabase_admin") as db, patch("backend.app.services.session_service._fetch_worker_name_map", return_value={"w-1": "Sam Worker"}), patch.object(service, "resolve_merge_context", return_value={"org": {"provider_name": "Org", "brand_accent_color": "#333"}, "participant": {"full_name": "Test Person"}, "generated": {"generated_at": "today"}}), patch.object(service, "render_html_to_pdf", return_value=b"%PDF") as render:
        db.return_value.table.return_value.select.return_value.eq.return_value.eq.return_value.gte.return_value.lt.return_value.order.return_value.limit.return_value.execute.return_value.data = rows
        service.render_shift_history_pdf("org-1", "p-1", date(2025, 7, 1), date(2026, 6, 30))
        html = render.call_args.args[0]
        assert "Sam Worker" in html and "Personal care" in html and "1h 30m" in html
        assert "2025" in html and "2026" in html and "2.5 recorded hours" in html
        assert "1 Jul 2025 to 30 Jun 2026" in html

def test_invoice_summary_counts_only_billed_invoices_in_period():
    from datetime import date
    with patch.object(service, "invoice_query") as query:
        chain = query.return_value.gte.return_value.lt.return_value.in_.return_value
        chain.limit.return_value.execute.return_value.data = [
            {"status": "paid", "total_cents": 10000, "currency": "AUD"},
            {"status": "overdue", "total_cents": 2500, "currency": "AUD"},
            {"status": "sent", "total_cents": 500, "currency": "AUD"},
        ]
        summary = service.invoice_summary(USER, "p-1", date(2026, 7, 1), date(2027, 6, 30))
        query.return_value.gte.return_value.lt.return_value.in_.assert_called_once_with("status", list(service.BILLED_STATUSES))
        assert summary == {"count": 3, "total_cents": 13000, "unpaid_cents": 3000, "overdue_count": 1, "currency": "AUD"}

def test_profile_agreements_add_item_names_and_signed_document():
    from backend.app.services import service_agreement_service as sas
    agreements = [
        {"id": "new", "start_date": "2026-07-01", "service_agreement_supports": [{"support_item_code": "01_011_0107_1_1"}]},
        {"id": "old", "start_date": "2025-07-01", "service_agreement_supports": []},
    ]
    db = MagicMock()
    prices = db.table.return_value.select.return_value.in_.return_value.order.return_value.execute.return_value
    prices.data = [{"item_code": "01_011_0107_1_1", "name": "Self-Care Weekday", "unit": "H", "price_national": 73.58}]
    intake = db.table.return_value.select.return_value.eq.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value
    intake.data = [{"signed_document_path": "org/i/doc.pdf", "signed_document_name": "doc.pdf", "provider_signed_name": "Patience MD", "family_signed_name": "Mia"}]
    db.storage.from_.return_value.create_signed_url.return_value = {"signedURL": "https://signed/doc.pdf"}
    with patch.object(sas, "list_service_agreements", return_value=agreements), patch.object(sas, "get_supabase_admin", return_value=db):
        result = sas.list_service_agreements_for_profile("p-1", "org-1")
    support = result[0]["service_agreement_supports"][0]
    assert (support["item_name"], support["standard_rate"]) == ("Self-Care Weekday", 73.58)
    assert result[0]["signed_document"]["url"] == "https://signed/doc.pdf"
    assert result[1]["signed_document"] is None
