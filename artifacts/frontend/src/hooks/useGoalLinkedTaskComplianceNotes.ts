import { useCallback, useEffect, useMemo, useState } from "react";
import { listSessionEvidence } from "@/lib/task-evidence-storage";
import type { ComplianceNote } from "@/lib/worker-compliance-engine";
import { listSessionNotes, type SessionNoteRecord } from "@/services/sessionNotesService";
import type { ShiftTask } from "@/services/shiftService";

export function contextNoteComplianceId(taskId: string) {
  return `ctx-${taskId}`;
}

export function useGoalLinkedTaskComplianceNotes(
  sessionId: string | null | undefined,
  tasks: ShiftTask[],
) {
  const [sessionNotes, setSessionNotes] = useState<SessionNoteRecord[]>([]);
  const [evidenceTexts, setEvidenceTexts] = useState<
    { id: string; task_id: string; content: string }[]
  >([]);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setSessionNotes([]);
      setEvidenceTexts([]);
      return;
    }
    try {
      const [rows, evidence] = await Promise.all([
        listSessionNotes(sessionId),
        listSessionEvidence(sessionId),
      ]);
      setSessionNotes(rows ?? []);
      setEvidenceTexts(
        evidence
          .filter((record) => record.type === "text" && record.content?.trim())
          .map((record) => ({
            id: record.evidence_id,
            task_id: record.task_id,
            content: record.content,
          })),
      );
    } catch {
      /* keep optimistic state */
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh, tasks]);

  useEffect(() => {
    const onUpdate = () => void refresh();
    window.addEventListener("task-evidence-updated", onUpdate);
    return () => window.removeEventListener("task-evidence-updated", onUpdate);
  }, [refresh]);

  const notes: ComplianceNote[] = useMemo(() => {
    const fromSession = sessionNotes
      .filter((note) => note.content?.trim())
      .map((note) => ({
        note_id: note.note_id,
        content: note.content,
        task_id: note.task_id ?? null,
      }));

    const fromContext = tasks
      .filter((task) => task.context_note?.trim())
      .map((task) => ({
        note_id: contextNoteComplianceId(task.task_id),
        content: task.context_note!.trim(),
        task_id: task.task_id,
      }));

    const fromEvidence = evidenceTexts.map((record) => ({
      note_id: record.id,
      content: record.content,
      task_id: record.task_id,
    }));

    return [...fromSession, ...fromContext, ...fromEvidence];
  }, [sessionNotes, tasks, evidenceTexts]);

  return { notes, sessionNotes, refresh };
}
