"""Shift-end task/evidence validation (CARECLIQV2-232)."""

from __future__ import annotations

from typing import Any


def _has_strong_evidence(task: dict[str, Any]) -> bool:
    if task.get("photo_evidence") or (task.get("photo_thumbnails") or []):
        return True
    if task.get("voice_evidence") or task.get("voice_duration_seconds"):
        return True
    return False


def _has_qualifying_note(task: dict[str, Any]) -> bool:
    return len(str(task.get("note") or "").strip()) >= 20


def _has_task_evidence(task: dict[str, Any]) -> bool:
    return _has_strong_evidence(task) or _has_qualifying_note(task)


def _is_mandatory(task: dict[str, Any]) -> bool:
    if task.get("mandatory") is True:
        return True
    if task.get("mandatory") is False:
        return False
    return task.get("type") == "default" and int(task.get("order") or 0) <= 4


def compute_shift_validation(tasks: list[dict[str, Any]]) -> dict[str, Any]:
    """Build validation payload stored on session end."""
    active = [t for t in tasks if not t.get("marked_na")]
    total = len(active)
    completed = [t for t in active if t.get("completed")]
    with_evidence = [t for t in completed if _has_task_evidence(t)]
    without_evidence = [t for t in completed if not _has_task_evidence(t)]
    not_completed = [t for t in active if not t.get("completed")]

    strong_count = sum(1 for t in active if _has_strong_evidence(t))
    compliance_score = round((strong_count / total) * 100) if total else 100

    flagged: list[dict[str, Any]] = []
    for task in not_completed:
        flagged.append({
            "task_id": task.get("task_id"),
            "label": task.get("label"),
            "flag_type": "incomplete",
            "marked_na": False,
        })
    for task in without_evidence:
        flagged.append({
            "task_id": task.get("task_id"),
            "label": task.get("label"),
            "flag_type": "no_evidence",
            "marked_na": False,
        })

    if compliance_score < 50:
        flagged.append({
            "task_id": None,
            "label": "Overall compliance",
            "flag_type": "low_compliance",
            "marked_na": False,
        })

    return {
        "tasks_completed": len(completed),
        "tasks_total": total,
        "tasks_with_evidence": len(with_evidence),
        "tasks_without_evidence": len(without_evidence),
        "tasks_not_completed": len(not_completed),
        "compliance_score": compliance_score,
        "low_compliance": compliance_score < 50,
        "flagged_tasks": flagged,
    }
