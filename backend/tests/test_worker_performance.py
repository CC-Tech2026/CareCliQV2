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
