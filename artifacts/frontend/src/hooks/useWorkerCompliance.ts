import { useEffect, useMemo, useState } from "react";
import {
  evaluateWorkerCompliance,
  type ComplianceEvaluation,
  type ComplianceNote,
  type ComplianceTask,
} from "@/lib/worker-compliance-engine";
import { loadFiledNoteIds } from "@/lib/session-incident-reports";

type Options = {
  notes: ComplianceNote[];
  tasks: ComplianceTask[];
  participantFirstName?: string;
  shiftEndIso?: string | null;
  previousSessionNotes?: string[];
  sessionId?: string | null;
};

export function useWorkerCompliance({
  notes,
  tasks,
  participantFirstName,
  shiftEndIso,
  previousSessionNotes,
  sessionId,
}: Options) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [filedNoteIds, setFiledNoteIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (sessionId) setFiledNoteIds(loadFiledNoteIds(sessionId));
  }, [sessionId, notes]);

  const compliance: ComplianceEvaluation = useMemo(
    () =>
      evaluateWorkerCompliance({
        notes,
        tasks,
        participantFirstName,
        shiftEndIso,
        previousSessionNotes,
        incidentReportFiledNoteIds: filedNoteIds,
      }),
    [notes, tasks, participantFirstName, shiftEndIso, previousSessionNotes, filedNoteIds],
  );

  const visibleNotifications = compliance.notifications.filter((n) => !dismissedIds.has(n.id));

  const dismissNotification = (id: string) => {
    setDismissedIds((prev) => new Set(prev).add(id));
  };

  const flagForNote = (noteId: string) =>
    compliance.noteFlags.find((f) => f.noteId === noteId);

  const attentionCount = compliance.rules.filter((r) => r.status !== "pass").length;

  const refreshFiledNotes = () => {
    if (sessionId) setFiledNoteIds(loadFiledNoteIds(sessionId));
  };

  return {
    compliance,
    visibleNotifications,
    dismissNotification,
    flagForNote,
    attentionCount,
    refreshFiledNotes,
  };
}
