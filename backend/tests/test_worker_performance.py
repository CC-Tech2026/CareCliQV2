"""Tests for shift validation and compliance helpers (CARECLIQV2-285)."""

from backend.app.services.shift_validation_service import (
    build_compliance_explanation,
    compliance_score_band,
    compute_shift_validation,
)


def test_compute_shift_validation_counts():
    tasks = [
        {"task_id": "a", "label": "A", "completed": True, "photo_evidence": "p1", "mandatory": True},
        {"task_id": "b", "label": "B", "completed": True, "note": "", "mandatory": True},
        {"task_id": "c", "label": "C", "completed": False, "mandatory": True},
    ]
    result = compute_shift_validation(tasks)
    assert result["tasks_total"] == 3
    assert result["tasks_completed"] == 2
    assert result["mandatory_total"] == 3
    assert result["mandatory_with_evidence"] == 1
    assert result["mandatory_without_evidence"] == 1
    assert result["compliance_score"] == 33  # 1/3 mandatory with strong evidence


def test_marked_na_excluded():
    tasks = [
        {"task_id": "a", "label": "A", "completed": False, "marked_na": True},
        {"task_id": "b", "label": "B", "completed": True, "photo_evidence": "p1"},
    ]
    result = compute_shift_validation(tasks)
    assert result["tasks_total"] == 1
    assert result["tasks_completed"] == 1


def test_compliance_score_band():
    assert compliance_score_band(95) == "green"
    assert compliance_score_band(80) == "amber"
    assert compliance_score_band(60) == "red"


def test_build_compliance_explanation():
    validation = {
        "compliance_score": 87,
        "mandatory_total": 15,
        "mandatory_with_evidence": 13,
        "mandatory_without_evidence": 2,
        "tasks_not_completed": 0,
    }
    text = build_compliance_explanation(validation)
    assert "87%" in text
    assert "13 of 15" in text
    assert "without evidence" in text


def test_minimal_shift_pdf_bytes():
    from backend.app.services.shift_pdf_export_service import _minimal_shift_pdf

    pdf = _minimal_shift_pdf(
        {
            "shift_date": "2026-06-26",
            "participant_first_name": "Olivia",
            "compliance_score": 100,
            "compliance_band": "green",
            "compliance_explanation": "All tasks completed with evidence.",
            "tasks": [{"label": "Personal Hygiene", "completed": True}],
        }
    )
    assert pdf.startswith(b"%PDF-1.4")


def test_build_shift_pdf_bytes():
    from backend.app.services.shift_pdf_export_service import _build_shift_pdf

    pdf = _build_shift_pdf(
        {
            "shift_date": "2026-06-26",
            "participant_first_name": "Olivia",
            "participant_last_name": "Smith",
            "compliance_score": 100,
            "compliance_band": "green",
            "compliance_explanation": "All tasks completed with evidence.",
            "tasks": [
                {"label": "Personal Hygiene", "completed": True, "mandatory": True},
                {"label": "Meal prep", "completed": False, "mandatory": False},
            ],
            "worker_name": "Alex Worker",
        },
        "11111111-1111-1111-1111-111111111111",
    )
    assert pdf.startswith(b"%PDF")
    assert b"/MarkInfo" in pdf or b"/Marked" in pdf
    assert pdf.count(b"/Lang (en-AU)") == 1


def test_shift_summary_email_subject_format():
    from backend.app.services.shift_pdf_export_service import _shift_summary_email_subject

    assert _shift_summary_email_subject("Olivia", "2026-06-26") == "Shift Summary – Olivia – 2026-06-26"


def test_coordinator_emails_for_shift_prefers_created_by(monkeypatch):
    from backend.app.services import shift_pdf_export_service as export_service

    monkeypatch.setattr(
        export_service,
        "_shift_coordinator_user_id",
        lambda _sid: "coord-user-1",
    )
    monkeypatch.setattr(export_service, "_get_user_email", lambda uid: "coord@example.com" if uid == "coord-user-1" else None)

    emails = export_service.coordinator_emails_for_shift("shift-1", "org-1")
    assert emails == ["coord@example.com"]


def test_get_or_create_auto_export_returns_existing(monkeypatch):
    from backend.app.services import shift_pdf_export_service as export_service

    existing = {
        "id": "exp-1",
        "status": "ready",
        "file_url": "https://example.com/s.pdf",
        "expires_at": None,
        "auto_generated": True,
    }
    monkeypatch.setattr(export_service, "_existing_auto_export", lambda _sid: existing)
    create_called = {"count": 0}

    def fake_create(*_a, **_kw):
        create_called["count"] += 1
        return {}

    monkeypatch.setattr(export_service, "create_shift_export", fake_create)
    result = export_service.get_or_create_auto_export("shift-1", "worker-1", "org-1")
    assert result["export_id"] == "exp-1"
    assert result["already_exists"] is True
    assert result["download_available_days"] is None
    assert create_called["count"] == 0


def test_task_evidence_includes_written_note():
    from backend.app.services.worker_shift_history_service import _task_evidence_items

    items = _task_evidence_items({
        "task_id": "t1",
        "label": "Meal prep",
        "context_note": "Participant ate full breakfast without assistance today.",
    })
    assert any(i.get("type") == "written note" for i in items)


def test_queue_shift_export_email_uses_queue_contract(monkeypatch):
    from backend.app.services import shift_pdf_export_service as export_service

    captured: dict[str, object] = {}

    def fake_queue_email_job(*, label: str, send):
        captured["label"] = label
        captured["send"] = send
        return {"status": "queued"}

    monkeypatch.setattr(export_service, "queue_email_job", fake_queue_email_job)
    monkeypatch.setattr(export_service, "send_email", lambda **kwargs: captured.setdefault("send_email", kwargs))

    export_service._queue_shift_export_email(
        to_email="worker@example.com",
        participant_name="Olivia",
        shift_date="2026-06-26",
        download_page="https://app.example/worker/shift-history?export=abc",
    )

    assert captured["label"] == "shift-export:worker@example.com:2026-06-26"
    captured["send"]()
    assert captured["send_email"]["to_email"] == "worker@example.com"
    assert "Olivia" in captured["send_email"]["text_body"]
