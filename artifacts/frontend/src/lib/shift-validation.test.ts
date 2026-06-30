import { describe, expect, it } from "vitest";
import { computeShiftValidation, markTaskNa } from "@/lib/shift-validation";
import type { ShiftTask } from "@/services/shiftService";

const baseTask = (overrides: Partial<ShiftTask>): ShiftTask => ({
  task_id: "t1",
  type: "default",
  label: "Task",
  completed: false,
  order: 1,
  ...overrides,
});

describe("computeShiftValidation", () => {
  it("returns clean validation when all tasks have evidence", () => {
    const tasks = [
      baseTask({
        task_id: "a",
        completed: true,
        photo_evidence: "photo-1",
        has_photo: true,
      }),
      baseTask({
        task_id: "b",
        completed: true,
        note: "A long enough written note for evidence",
        has_text_notes: true,
      }),
    ];
    const result = computeShiftValidation(tasks);
    expect(result.tasks_completed).toBe(2);
    expect(result.tasks_with_evidence).toBe(2);
    expect(result.flagged_tasks.filter((f) => f.task_id)).toHaveLength(0);
  });

  it("flags incomplete and no-evidence tasks", () => {
    const tasks = [
      baseTask({ task_id: "a", completed: true }),
      baseTask({ task_id: "b", completed: false }),
    ];
    const result = computeShiftValidation(tasks);
    expect(result.tasks_without_evidence).toBe(1);
    expect(result.tasks_not_completed).toBe(1);
    expect(result.flagged_tasks.some((f) => f.flag_type === "no_evidence")).toBe(true);
    expect(result.flagged_tasks.some((f) => f.flag_type === "incomplete")).toBe(true);
  });

  it("excludes marked N/A tasks from totals", () => {
    const tasks = [
      baseTask({ task_id: "a", completed: false }),
      markTaskNa(baseTask({ task_id: "b", completed: false }), "not_needed", "2026-01-01T00:00:00Z"),
    ];
    const result = computeShiftValidation(tasks);
    expect(result.tasks_total).toBe(1);
    expect(result.tasks_not_completed).toBe(1);
  });
});
