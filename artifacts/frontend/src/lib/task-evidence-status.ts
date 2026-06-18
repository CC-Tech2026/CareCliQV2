/**
 * CARECLIQV2-229 — Task completion + evidence status helpers.
 */

import type { ShiftTask } from "@/services/shiftService";

export type EvidenceStatus = "with_evidence" | "without_evidence";

export const QUICK_NOTE_MAX = 150;

export function deriveEvidenceFlags(task: Partial<ShiftTask>) {
  const has_photo =
    Boolean(task.photo_evidence) || (task.photo_thumbnails?.length ?? 0) > 0;
  const has_voice = Boolean(task.voice_evidence) || Boolean(task.voice_duration_seconds);
  const has_text_notes = Boolean(task.context_note?.trim()) || Boolean(task.note?.trim());
  return { has_photo, has_voice, has_text_notes };
}

export function hasStrongTaskEvidence(task: Partial<ShiftTask>) {
  const flags = deriveEvidenceFlags(task);
  return flags.has_photo || flags.has_voice;
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
  return hasStrongTaskEvidence(task) ? "with_evidence" : "without_evidence";
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
    evidence_status: hasStrongTaskEvidence({ ...task, ...flags })
      ? "with_evidence"
      : "without_evidence",
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
  return tasks.filter((t) => t.completed && t.evidence_status === "without_evidence").length;
}
