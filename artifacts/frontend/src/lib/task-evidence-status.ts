/**
 * CARECLIQV2-229 — Task completion + evidence status helpers.
 */

import type { ShiftTask } from "@/services/shiftService";

export type EvidenceStatus = "with_evidence" | "without_evidence";

export const QUICK_NOTE_MAX = 150;
export const QUICK_NOTE_PREVIEW = 50;
export const SESSION_NOTE_MAX = 500;
export const MIN_EVIDENCE_NOTE_CHARS = 20;

export function deriveEvidenceFlags(task: Partial<ShiftTask>) {
  const has_photo =
    Boolean(task.photo_evidence) || (task.photo_thumbnails?.length ?? 0) > 0;
  const has_voice = Boolean(task.voice_evidence) || Boolean(task.voice_duration_seconds);
  // Context notes (CARECLIQV2-231) are not evidence — only evidence-panel text counts.
  const has_text_notes = Boolean(task.note?.trim());
  return { has_photo, has_voice, has_text_notes };
}

export function hasStrongTaskEvidence(task: Partial<ShiftTask>) {
  const flags = deriveEvidenceFlags(task);
  return flags.has_photo || flags.has_voice;
}

/** Written note in the evidence thread (≥20 chars) satisfies mandatory tasks. */
export function hasQualifyingNoteEvidence(task: Partial<ShiftTask>) {
  return (task.note || "").trim().length >= MIN_EVIDENCE_NOTE_CHARS;
}

export function hasTaskEvidence(task: Partial<ShiftTask>) {
  return hasStrongTaskEvidence(task) || hasQualifyingNoteEvidence(task);
}

export function buildEvidenceIds(task: Partial<ShiftTask>) {
  const ids: string[] = [...(task.evidence_ids ?? [])];
  if (task.photo_evidence) ids.push(task.photo_evidence);
  if (task.voice_evidence) ids.push(task.voice_evidence);
  return [...new Set(ids.filter(Boolean))];
}

export function computeEvidenceStatus(
  task: Partial<ShiftTask>,
  completed: boolean,
): EvidenceStatus | null {
  if (!completed) return null;
  return hasTaskEvidence(task) ? "with_evidence" : "without_evidence";
}

export function applyTaskCompletion(task: ShiftTask, completed: boolean, now: string): ShiftTask {
  if (!completed) {
    return {
      ...task,
      completed: false,
      completed_at: null,
      checked_at: null,
      evidence_status: null,
    };
  }

  const flags = deriveEvidenceFlags(task);
  return {
    ...task,
    completed: true,
    checked_at: now,
    completed_at: task.completed_at ?? now,
    ...flags,
    evidence_ids: buildEvidenceIds(task),
    evidence_status: computeEvidenceStatus({ ...task, ...flags }, true),
  };
}

export function applyEvidencePatch(
  task: ShiftTask,
  patch: Partial<ShiftTask>,
  now: string,
): ShiftTask {
  const merged: ShiftTask = { ...task, ...patch };
  const flags = deriveEvidenceFlags(merged);
  const gainedStrong =
    hasStrongTaskEvidence({ ...task, ...flags }) && !hasStrongTaskEvidence(task);

  return {
    ...merged,
    ...flags,
    evidence_ids: buildEvidenceIds(merged),
    evidence_added_at: gainedStrong ? now : task.evidence_added_at ?? null,
    evidence_status: merged.completed ? computeEvidenceStatus({ ...merged, ...flags }, true) : null,
  };
}

export function taskComplianceEvidenceScore(tasks: ShiftTask[]) {
  if (!tasks.length) return { score: 100, label: "High" as const, strongCount: 0, total: 0 };
  const strongCount = tasks.filter((t) => hasStrongTaskEvidence(t)).length;
  const score = Math.round((strongCount / tasks.length) * 100);
  const label = score >= 80 ? ("High" as const) : score >= 50 ? ("Medium" as const) : ("Low" as const);
  return { score, label, strongCount, total: tasks.length };
}

export function countTasksWithoutEvidence(tasks: ShiftTask[]) {
  return tasks.filter((t) => t.completed && !hasTaskEvidence(t)).length;
}

/** CARECLIQV2-217 — mandatory/optional task visual state machine */
export type TaskVisualState = "not_started" | "in_progress" | "evidence_required" | "complete";

export const TASK_STATE_STYLES: Record<
  TaskVisualState,
  { border: string; bg: string; text: string; label: string }
> = {
  not_started: {
    border: "#E2DEF2",
    bg: "#FFFFFF",
    text: "#7A6A9E",
    label: "Not started",
  },
  in_progress: {
    border: "#FCD34D",
    bg: "#FFFBEB",
    text: "#92400E",
    label: "In progress",
  },
  evidence_required: {
    border: "#FB923C",
    bg: "#FFF7ED",
    text: "#C2410C",
    label: "Evidence required",
  },
  complete: {
    border: "#34D399",
    bg: "#ECFDF5",
    text: "#047857",
    label: "Complete",
  },
};

export function getTaskVisualState(
  task: ShiftTask,
  options: { panelOpen?: boolean; isMandatory?: boolean; canComplete?: boolean } = {},
): TaskVisualState {
  const mandatory = options.isMandatory ?? Boolean(task.mandatory);
  const panelOpen = options.panelOpen ?? false;
  const canComplete = options.canComplete ?? hasTaskEvidence(task);

  if (task.completed && hasTaskEvidence(task)) return "complete";
  if (task.completed && !hasTaskEvidence(task)) return "evidence_required";
  if (mandatory && !canComplete && panelOpen) return "in_progress";
  if (mandatory && !canComplete) return "evidence_required";
  if (panelOpen) return "in_progress";
  return "not_started";
}
