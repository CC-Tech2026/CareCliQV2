"""Shift-end task/evidence validation (CARECLIQV2-232)."""

from __future__ import annotations

from typing import Any


def _has_photo_evidence(task: dict[str, Any]) -> bool:
    # has_photo is what the mobile client actually sends (see ShiftTask in
    # artifacts/mobile/lib/worker-api.ts) - photo_evidence/photo_thumbnails are a richer
    # legacy shape this function used to check exclusively, which meant every task
    # documented via the mobile per-task composer looked like it had zero evidence here
    # even when _mandatory_task_satisfied() (the gate for marking a task complete, in
    # shift_service.py) already recognized has_photo as valid. Keep both shapes.
    return bool(task.get("photo_evidence") or (task.get("photo_thumbnails") or []) or task.get("has_photo"))


def _has_voice_evidence(task: dict[str, Any]) -> bool:
    return bool(task.get("voice_evidence") or task.get("voice_duration_seconds") or task.get("has_voice"))


def _has_strong_evidence(task: dict[str, Any]) -> bool:
    return _has_photo_evidence(task) or _has_voice_evidence(task)


def _has_qualifying_note(task: dict[str, Any]) -> bool:
    return len(str(task.get("note") or "").strip()) >= 20


def _has_task_evidence(task: dict[str, Any]) -> bool:
    # A coordinator can configure a task's evidence_required as photo/notes/photo_and_notes
    # (task_models.EvidenceRequired) - honour that specific type instead of treating photo,
    # voice and a qualifying note as interchangeable. A task requiring a photo is not
    # satisfied by a text note, and vice versa. Tasks with no declared requirement ("none",
    # or missing on an older task shape) keep the original permissive behaviour: any of
    # photo, voice, or a qualifying note counts.
    required = str(task.get("evidence_required") or "none").strip().lower()
    if required == "photo":
        return _has_photo_evidence(task)
    if required == "notes":
        return _has_qualifying_note(task)
    if required == "photo_and_notes":
        return _has_photo_evidence(task) and _has_qualifying_note(task)
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

    # Same fix as mandatory_with_evidence below - a qualifying note counts,
    # not just photo/voice. Only used as the ticket_score fallback for shifts
    # with no mandatory tasks at all.
    evidence_count = sum(1 for t in active if _has_task_evidence(t))
    compliance_score = round((evidence_count / total) * 100) if total else 100

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
    # _has_task_evidence (strong evidence OR a qualifying ≥20-char note), not
    # _has_strong_evidence alone - this is the same bar _mandatory_task_
    # satisfied() in shift_service.py already uses to let a worker mark a
    # mandatory task complete in the first place. Scoring it against a
    # stricter "photo/voice only" bar here meant a worker could properly
    # document every mandatory task with a real note (exactly what the app
    # lets them do, and what its own MIN_EVIDENCE_NOTE_CHARS threshold is
    # built around) and still land on a 0% compliance score at the end.
    mandatory_with_evidence = [t for t in mandatory_completed if _has_task_evidence(t)]
    mandatory_without_evidence = [t for t in mandatory_completed if not _has_task_evidence(t)]

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
    mandatory_completed = int(validation.get("mandatory_completed") or 0)
    with_evidence = int(validation.get("mandatory_with_evidence") or 0)
    without_evidence = int(validation.get("mandatory_without_evidence") or 0)
    # Mandatory tasks specifically left incomplete - NOT tasks_not_completed,
    # which counts every incomplete task including optional ones. Using the
    # all-tasks count here previously mislabeled optional tasks as "mandatory
    # task(s) not completed", producing contradictory text like "6 of 6
    # mandatory tasks completed... 4 mandatory tasks not completed" in the
    # same sentence whenever only optional tasks were left undone.
    mandatory_not_completed = max(0, mandatory_total - mandatory_completed)

    if mandatory_total:
        parts = [
            f"Score: {score}% — {with_evidence} of {mandatory_total} mandatory tasks completed with evidence."
        ]
        if without_evidence:
            parts.append(
                f"{without_evidence} task{'s' if without_evidence != 1 else ''} "
                f"completed without evidence (-6pts each)."
            )
        if mandatory_not_completed:
            parts.append(
                f"{mandatory_not_completed} mandatory task{'s' if mandatory_not_completed != 1 else ''} not completed."
            )
        return " ".join(parts)

    total = int(validation.get("tasks_total") or 0)
    completed = int(validation.get("tasks_completed") or 0)
    return f"Score: {score}% — {completed} of {total} tasks completed."
