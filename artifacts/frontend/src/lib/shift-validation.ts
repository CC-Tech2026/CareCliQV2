/**
 * CARECLIQV2-232 — Shift-end task/evidence validation.
 */

import type { ShiftTask } from "@/services/shiftService";
import { hasStrongTaskEvidence, hasTaskEvidence } from "@/lib/task-evidence-status";
import { isMandatoryTask } from "@/lib/shift-utils";

export type ShiftValidationFlagType = "incomplete" | "no_evidence" | "low_compliance";

export type ShiftValidationFlag = {
  task_id: string | null;
  label?: string;
  flag_type: ShiftValidationFlagType;
  marked_na: boolean;
};

export type ShiftValidationResult = {
  tasks_completed: number;
  tasks_total: number;
  tasks_with_evidence: number;
  tasks_without_evidence: number;
  tasks_not_completed: number;
  compliance_score: number;
  low_compliance: boolean;
  flagged_tasks: ShiftValidationFlag[];
};

export const NA_REASONS = [
  { value: "not_needed", label: "Not needed today" },
  { value: "refused", label: "Participant refused" },
  { value: "medical", label: "Medical reason" },
] as const;

export type NaReason = (typeof NA_REASONS)[number]["value"];

function activeTasks(tasks: ShiftTask[]) {
  return tasks.filter((t) => !t.marked_na);
}

export function computeShiftValidation(tasks: ShiftTask[]): ShiftValidationResult {
  const active = activeTasks(tasks);
  const total = active.length;
  const completed = active.filter((t) => t.completed);
  const withEvidence = completed.filter((t) => hasTaskEvidence(t));
  const withoutEvidence = completed.filter((t) => !hasTaskEvidence(t));
  const notCompleted = active.filter((t) => !t.completed);

  const strongCount = active.filter((t) => hasStrongTaskEvidence(t)).length;
  const complianceScore = total > 0 ? Math.round((strongCount / total) * 100) : 100;

  const flagged: ShiftValidationFlag[] = [];

  for (const task of notCompleted) {
    flagged.push({
      task_id: task.task_id,
      label: task.label,
      flag_type: "incomplete",
      marked_na: false,
    });
  }
  for (const task of withoutEvidence) {
    flagged.push({
      task_id: task.task_id,
      label: task.label,
      flag_type: "no_evidence",
      marked_na: false,
    });
  }
  if (complianceScore < 50) {
    flagged.push({
      task_id: null,
      label: "Overall compliance",
      flag_type: "low_compliance",
      marked_na: false,
    });
  }

  return {
    tasks_completed: completed.length,
    tasks_total: total,
    tasks_with_evidence: withEvidence.length,
    tasks_without_evidence: withoutEvidence.length,
    tasks_not_completed: notCompleted.length,
    compliance_score: complianceScore,
    low_compliance: complianceScore < 50,
    flagged_tasks: flagged,
  };
}

export function taskFlagsOnly(validation: ShiftValidationResult) {
  return validation.flagged_tasks.filter((f) => f.flag_type !== "low_compliance" && f.task_id);
}

export function hasValidationWarnings(validation: ShiftValidationResult) {
  return taskFlagsOnly(validation).length > 0 || validation.low_compliance;
}

export function markTaskNa(task: ShiftTask, reason: NaReason, now: string): ShiftTask {
  return {
    ...task,
    marked_na: true,
    na_reason: reason,
    na_marked_at: now,
    completed: false,
    completed_at: null,
    checked_at: null,
    evidence_status: null,
  };
}

export function mandatoryTasksBlocking(tasks: ShiftTask[]) {
  return tasks.some((t) => isMandatoryTask(t) && !t.marked_na && !t.completed);
}
