"""Tests for shift-end validation (CARECLIQV2-232)."""

from backend.app.services.shift_validation_service import compute_shift_validation


def test_compute_shift_validation_counts():
    tasks = [
        {"task_id": "a", "label": "A", "completed": True, "photo_evidence": "p1"},
        {"task_id": "b", "label": "B", "completed": True, "note": ""},
        {"task_id": "c", "label": "C", "completed": False},
    ]
    result = compute_shift_validation(tasks)
    assert result["tasks_total"] == 3
    assert result["tasks_completed"] == 2
    assert result["tasks_with_evidence"] == 1
    assert result["tasks_without_evidence"] == 1
    assert result["tasks_not_completed"] == 1
    assert any(f["flag_type"] == "no_evidence" for f in result["flagged_tasks"])
    assert any(f["flag_type"] == "incomplete" for f in result["flagged_tasks"])


def test_marked_na_excluded():
    tasks = [
        {"task_id": "a", "label": "A", "completed": False, "marked_na": True},
        {"task_id": "b", "label": "B", "completed": True, "photo_evidence": "p1"},
    ]
    result = compute_shift_validation(tasks)
    assert result["tasks_total"] == 1
    assert result["tasks_completed"] == 1


def test_evidence_required_photo_not_satisfied_by_note():
    # A task a coordinator configured as evidence_required="photo" must not be counted as
    # having evidence just because a qualifying text note was submitted instead.
    tasks = [
        {"task_id": "a", "label": "A", "completed": True, "evidence_required": "photo",
         "note": "A" * 25},
    ]
    result = compute_shift_validation(tasks)
    assert result["tasks_with_evidence"] == 0
    assert result["tasks_without_evidence"] == 1
    assert any(f["flag_type"] == "no_evidence" for f in result["flagged_tasks"])


def test_evidence_required_photo_satisfied_by_photo():
    tasks = [
        {"task_id": "a", "label": "A", "completed": True, "evidence_required": "photo",
         "has_photo": True},
    ]
    result = compute_shift_validation(tasks)
    assert result["tasks_with_evidence"] == 1
    assert result["tasks_without_evidence"] == 0


def test_evidence_required_notes_not_satisfied_by_photo():
    tasks = [
        {"task_id": "a", "label": "A", "completed": True, "evidence_required": "notes",
         "has_photo": True},
    ]
    result = compute_shift_validation(tasks)
    assert result["tasks_with_evidence"] == 0
    assert result["tasks_without_evidence"] == 1


def test_evidence_required_photo_and_notes_needs_both():
    tasks = [
        {"task_id": "a", "label": "A", "completed": True, "evidence_required": "photo_and_notes",
         "has_photo": True, "note": "A" * 25},
        {"task_id": "b", "label": "B", "completed": True, "evidence_required": "photo_and_notes",
         "has_photo": True},
    ]
    result = compute_shift_validation(tasks)
    assert result["tasks_with_evidence"] == 1
    assert result["tasks_without_evidence"] == 1


def test_evidence_required_none_keeps_permissive_behaviour():
    # No declared requirement (or an older task shape without the field) keeps the original
    # any-of-photo/voice/note behaviour.
    tasks = [
        {"task_id": "a", "label": "A", "completed": True, "note": "A" * 25},
    ]
    result = compute_shift_validation(tasks)
    assert result["tasks_with_evidence"] == 1
