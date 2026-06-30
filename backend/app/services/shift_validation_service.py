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

    mandatory = [t for t in active if _is_mandatory(t)]
    mandatory_completed = [t for t in mandatory if t.get("completed")]
    mandatory_with_evidence = [t for t in mandatory_completed if _has_strong_evidence(t)]
    mandatory_without_evidence = [t for t in mandatory_completed if not _has_strong_evidence(t)]

    if mandatory:
        ticket_score = round((len(mandatory_with_evidence) / len(mandatory)) * 100)
    else:
        ticket_score = compliance_score

    if ticket_score < 70:
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
        "mandatory_total": len(mandatory),
        "mandatory_completed": len(mandatory_completed),
        "mandatory_with_evidence": len(mandatory_with_evidence),
        "mandatory_without_evidence": len(mandatory_without_evidence),
        "compliance_score": ticket_score,
        "low_compliance": ticket_score < 70,
        "flagged_tasks": flagged,
    }


def compliance_score_band(score: int | float | None) -> str:
    """Colour band per CARECLIQV2-285: green ≥90, amber 70–89, red <70."""
    if score is None:
        return "unknown"
    value = float(score)
    if value >= 90:
        return "green"
    if value >= 70:
        return "amber"
    return "red"


def build_compliance_explanation(validation: dict[str, Any]) -> str:
    """Plain-language compliance breakdown for worker shift history."""
    score = validation.get("compliance_score")
    if score is None:
        return "Compliance score is not available for this shift."

    mandatory_total = int(validation.get("mandatory_total") or 0)
    with_evidence = int(validation.get("mandatory_with_evidence") or 0)
    without_evidence = int(validation.get("mandatory_without_evidence") or 0)
    not_completed = int(validation.get("tasks_not_completed") or 0)

    if mandatory_total:
        parts = [
            f"Score: {score}% — {with_evidence} of {mandatory_total} mandatory tasks completed with evidence."
        ]
        if without_evidence:
            parts.append(
                f"{without_evidence} task{'s' if without_evidence != 1 else ''} "
                f"completed without evidence (-6pts each)."
            )
        if not_completed:
            parts.append(
                f"{not_completed} mandatory task{'s' if not_completed != 1 else ''} not completed."
            )
        return " ".join(parts)

    total = int(validation.get("tasks_total") or 0)
    completed = int(validation.get("tasks_completed") or 0)
    return f"Score: {score}% — {completed} of {total} tasks completed."
