import { describe, expect, it } from "vitest";
import {
  applyEvidencePatch,
  applyTaskCompletion,
  computeEvidenceStatus,
  hasTaskEvidence,
  MIN_EVIDENCE_NOTE_CHARS,
} from "@/lib/task-evidence-status";
import type { ShiftTask } from "@/services/shiftService";

const baseTask = (): ShiftTask => ({
  task_id: "task-1",
  type: "default",
  label: "Personal Hygiene",
  completed: false,
  order: 1,
});

describe("CARECLIQV2-229 task evidence status", () => {
  it("marks completed task without photo/voice/note as without_evidence", () => {
    const now = "2026-01-15T14:45:00Z";
    const result = applyTaskCompletion(baseTask(), true, now);
    expect(result.completed).toBe(true);
    expect(result.checked_at).toBe(now);
    expect(result.evidence_status).toBe("without_evidence");
  });

  it("marks completed task with qualifying written note as with_evidence", () => {
    const task = { ...baseTask(), note: "a".repeat(MIN_EVIDENCE_NOTE_CHARS) };
    const result = applyTaskCompletion(task, true, "2026-01-15T14:45:00Z");
    expect(result.evidence_status).toBe("with_evidence");
    expect(result.has_text_notes).toBe(true);
    expect(hasTaskEvidence(result)).toBe(true);
  });

  it("short notes do not count as evidence", () => {
    const task = { ...baseTask(), note: "too short" };
    const result = applyTaskCompletion(task, true, "2026-01-15T14:45:00Z");
    expect(result.evidence_status).toBe("without_evidence");
  });

  it("marks completed task with photo as with_evidence", () => {
    const task = { ...baseTask(), photo_evidence: "evid-1", has_photo: true };
    const result = applyTaskCompletion(task, true, "2026-01-15T14:45:00Z");
    expect(result.evidence_status).toBe("with_evidence");
  });

  it("clears evidence_status when unchecked", () => {
    const task = applyTaskCompletion(baseTask(), true, "2026-01-15T14:45:00Z");
    const result = applyTaskCompletion(task, false, "2026-01-15T14:50:00Z");
    expect(result.completed).toBe(false);
    expect(result.evidence_status).toBeNull();
    expect(result.checked_at).toBeNull();
  });

  it("upgrades status when strong evidence is added later", () => {
    const completed = applyTaskCompletion(baseTask(), true, "2026-01-15T14:45:00Z");
    const patched = applyEvidencePatch(
      completed,
      { voice_evidence: "evid-voice", voice_duration_seconds: 12 },
      "2026-01-15T14:47:00Z",
    );
    expect(patched.evidence_status).toBe("with_evidence");
    expect(patched.evidence_added_at).toBe("2026-01-15T14:47:00Z");
    expect(computeEvidenceStatus(patched, true)).toBe("with_evidence");
  });
});
