import { FontFamily } from "@/constants/typography";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/lib/haptics";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { ClockedInBanner } from "@/components/worker/ClockedInBanner";
import { ComplianceScoreBar } from "@/components/worker/ComplianceScoreBar";
import { DocumentationComplianceBar } from "@/components/worker/DocumentationComplianceBar";
import { LongShiftEngagementPanel } from "@/components/worker/LongShiftEngagementPanel";
import { WorkerMobileNoteBubble } from "@/components/worker/WorkerMobileNoteBubble";
import { WorkerMobileParticipantStrip } from "@/components/worker/WorkerMobileParticipantStrip";
import { WorkerMobileRiskStrip } from "@/components/worker/WorkerMobileRiskStrip";
import { WorkerMobileMedicationChecklist } from "@/components/worker/WorkerMobileMedicationChecklist";
import { WorkerMobilePrnMedications } from "@/components/worker/WorkerMobilePrnMedications";
import { WorkerMobileTaskList } from "@/components/worker/WorkerMobileTaskList";
import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";
import type {
  ActiveBreakStatus,
  CheckinWindowStatus,
  DocumentationComplianceCheck,
  SessionNoteRecord,
  ShiftHealthAlert,
  ShiftTask,
} from "@/lib/worker-api";
import { updateShiftTasks } from "@/lib/worker-api";
import {
  hasStrongTaskEvidence,
  isMandatoryTask,
  MIN_EVIDENCE_NOTE_CHARS,
  SESSION_NOTE_MAX,
} from "@/lib/shift-utils";
import type { ComplianceEvaluation } from "@workspace/worker-compliance";

type Props = {
  shiftId: string;
  participantName: string;
  participantFirstName?: string;
  participantId?: string | null;
  healthAlerts?: ShiftHealthAlert[];
  clockedInAt: string | null;
  sessionId: string | null;
  tasks: ShiftTask[];
  onTasksChange: (tasks: ShiftTask[]) => void;
  sessionNotes: SessionNoteRecord[];
  compliance: ComplianceEvaluation;
  /** Real backend 12-rule documentation-quality check, fetched periodically
   * by the parent - null while no check has completed yet. */
  documentationCompliance?: DocumentationComplianceCheck | null;
  onNotesRefresh: () => void;
  onOpenIncidentReport?: (noteId?: string, content?: string) => void;
  disabled?: boolean;
  sessionElapsed?: string;
  checkinStatus?: CheckinWindowStatus;
  breakStatus?: ActiveBreakStatus;
  onCheckin?: () => void;
};

function taskStarted(task: ShiftTask, notes: SessionNoteRecord[]): boolean {
  if (task.completed) return true;
  if (task.context_note?.trim()) return true;
  if (task.has_text_notes || task.has_photo || task.has_voice) return true;
  return notes.some((n) => n.task_id === task.task_id && n.content?.trim());
}

function sessionNoteTextsForTask(
  sessionNotes: SessionNoteRecord[],
  taskId: string,
): string[] {
  return sessionNotes
    .filter((n) => n.task_id === taskId && n.content?.trim())
    .map((n) => n.content!.trim());
}

/**
 * Reconciles a task's own evidence fields (note/has_text_notes/has_photo/
 * has_voice) against every session note attached to it. These fields - not
 * the session notes themselves - are what the backend's end-of-shift
 * compliance validation and audit summary read (compute_shift_validation in
 * shift_validation_service.py operates on the task list, not on
 * shift_visit_notes), so a task with real photo/voice/text documentation but
 * stale evidence fields shows up server-side as "no evidence" even though
 * the worker genuinely documented it. Returns the same object (no new
 * identity) when nothing actually changed, so callers can cheaply detect
 * "does this need to sync."
 */
function attachSessionNotesToTask(
  task: ShiftTask,
  sessionNotes: SessionNoteRecord[],
): ShiftTask {
  const forTask = sessionNotes.filter((n) => n.task_id === task.task_id);
  if (!forTask.length) return task;

  const hasPhoto =
    task.has_photo || forTask.some((n) => n.note_type === "photo");
  const hasVoice =
    task.has_voice || forTask.some((n) => n.note_type === "voice");

  let note = task.note;
  let hasTextNotes = task.has_text_notes;
  if ((task.note?.trim().length ?? 0) < MIN_EVIDENCE_NOTE_CHARS) {
    const texts = sessionNoteTextsForTask(sessionNotes, task.task_id);
    if (texts.length) {
      note = texts.join("\n\n").slice(0, SESSION_NOTE_MAX);
      hasTextNotes = true;
    }
  }

  if (
    note === task.note &&
    hasTextNotes === task.has_text_notes &&
    hasPhoto === task.has_photo &&
    hasVoice === task.has_voice
  ) {
    return task;
  }
  return {
    ...task,
    note,
    has_text_notes: hasTextNotes,
    has_photo: hasPhoto,
    has_voice: hasVoice,
  };
}

function taskHasMobileDocumentation(
  task: ShiftTask,
  sessionNotes: SessionNoteRecord[],
): boolean {
  if (hasStrongTaskEvidence(task)) return true;
  const combined = [
    ...sessionNoteTextsForTask(sessionNotes, task.task_id),
    task.note?.trim(),
    task.context_note?.trim(),
  ]
    .filter(Boolean)
    .join("\n");
  return combined.length >= MIN_EVIDENCE_NOTE_CHARS;
}

export function WorkerMobileSessionScreen({
  shiftId,
  participantName,
  participantFirstName,
  participantId,
  healthAlerts = [],
  clockedInAt,
  sessionId,
  tasks,
  onTasksChange,
  sessionNotes,
  compliance,
  documentationCompliance,
  onNotesRefresh,
  onOpenIncidentReport,
  disabled,
  sessionElapsed,
  checkinStatus,
  breakStatus,
  onCheckin,
}: Props) {
  const colors = useColors();
  const { isOnline, queueWorkerUpdate } = useOffline();
  const [localTasks, setLocalTasks] = useState(tasks);
  const [localSessionNotes, setLocalSessionNotes] = useState(sessionNotes);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

  useEffect(() => {
    setLocalSessionNotes(sessionNotes);
  }, [sessionNotes]);

  const activeTasks = useMemo(
    () => localTasks.filter((t) => !t.marked_na),
    [localTasks],
  );
  const mandatoryTasks = useMemo(
    () => activeTasks.filter((t) => isMandatoryTask(t)),
    [activeTasks],
  );
  const doneMandatory = mandatoryTasks.filter((t) => t.completed).length;
  const startedMandatory = mandatoryTasks.filter((t) =>
    taskStarted(t, localSessionNotes),
  ).length;
  const progressLabel =
    mandatoryTasks.length > 0
      ? doneMandatory > 0
        ? `${doneMandatory} of ${mandatoryTasks.length} required done`
        : `${startedMandatory} of ${mandatoryTasks.length} required started`
      : `${activeTasks.filter((t) => t.completed).length} of ${activeTasks.length} done`;

  const untaskedNotes = useMemo(
    () => localSessionNotes.filter((n) => !n.task_id),
    [localSessionNotes],
  );

  const persist = useCallback(
    async (next: ShiftTask[]) => {
      setLocalTasks(next);
      onTasksChange(next);
      setBusy(true);
      try {
        if (!isOnline) {
          await queueWorkerUpdate({
            type: "update_tasks",
            id: `${shiftId}-${Date.now()}`,
            shiftId,
            tasks: next,
            timestamp: Date.now(),
          });
          return;
        }
        await updateShiftTasks(shiftId, next);
      } catch (err) {
        Alert.alert(
          "Save failed",
          err instanceof Error ? err.message : "Please try again.",
        );
      } finally {
        setBusy(false);
      }
    },
    [shiftId, onTasksChange, isOnline, queueWorkerUpdate],
  );

  const toggleTask = async (taskId: string) => {
    const task = localTasks.find((t) => t.task_id === taskId);
    if (!task) return;

    if (
      !task.completed &&
      isMandatoryTask(task) &&
      !taskHasMobileDocumentation(task, localSessionNotes)
    ) {
      Alert.alert(
        "Evidence required",
        "Add a note (20+ characters) or photo/voice before marking complete.",
      );
      setActiveTaskId(taskId);
      return;
    }

    Haptics.selectionAsync();
    const now = new Date().toISOString();
    const next = localTasks.map((t) => {
      if (t.task_id !== taskId) return t;
      const willComplete = !t.completed;
      const withEvidence = willComplete
        ? attachSessionNotesToTask(t, localSessionNotes)
        : t;
      return {
        ...withEvidence,
        completed: willComplete,
        completed_at: willComplete ? now : null,
        checked_at: now,
      };
    });
    await persist(next);
  };

  const handleNoteSaved = async (note: SessionNoteRecord) => {
    const mergedNotes = [
      ...localSessionNotes.filter((n) => n.note_id !== note.note_id),
      note,
    ];
    setLocalSessionNotes(mergedNotes);

    const taskId = note.task_id;
    if (taskId) {
      const task = localTasks.find((t) => t.task_id === taskId);
      if (task) {
        const withEvidence = attachSessionNotesToTask(task, mergedNotes);
        const evidenceChanged = withEvidence !== task;
        const shouldAutoComplete =
          !task.completed &&
          taskHasMobileDocumentation(withEvidence, mergedNotes);
        // Sync on every note, not just the one that happens to cross the
        // auto-complete threshold - a task already marked complete, or a
        // second/third note on the same task, previously never made it back
        // to the server, so the end-of-shift compliance report and the
        // coordinator/MD's view of what happened during the shift saw stale
        // (often empty) evidence despite everything the worker actually wrote.
        if (evidenceChanged || shouldAutoComplete) {
          Haptics.selectionAsync();
          const now = new Date().toISOString();
          const next = localTasks.map((t) => {
            if (t.task_id !== taskId) return t;
            return {
              ...withEvidence,
              completed: shouldAutoComplete ? true : t.completed,
              completed_at: shouldAutoComplete ? now : t.completed_at,
              checked_at: shouldAutoComplete ? now : t.checked_at,
            };
          });
          await persist(next);
        }
      }
    }

    onNotesRefresh();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <WorkerMobileParticipantStrip participantName={participantName} />

      {/* Each task's composer (WorkerMobileTaskList) can be expanded anywhere
          in this list, including the last task at the very bottom - a plain
          ScrollView + KeyboardAvoidingView doesn't auto-scroll a focused
          TextInput above the keyboard, so a note composer deep in the list
          got hidden behind the keyboard the moment the worker started typing.
          KeyboardAwareScrollView tracks the focused input and scrolls it into
          view itself, correctly on both iOS and Android. */}
      <KeyboardAwareScrollViewCompat
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        <WorkerMobileRiskStrip alerts={healthAlerts} />
        <ClockedInBanner
          clockedInAt={clockedInAt}
          participantName={participantName}
        />

        <LongShiftEngagementPanel
          shiftId={shiftId}
          sessionId={sessionId}
          checkinStatus={checkinStatus}
          breakStatus={breakStatus}
          sessionElapsed={sessionElapsed}
          onCheckin={onCheckin}
          onReportIncident={
            onOpenIncidentReport ? () => onOpenIncidentReport() : undefined
          }
          disabled={disabled || busy}
        />

        <View
          style={[
            styles.taskCard,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
        >
          <View
            style={[styles.taskHeader, { borderBottomColor: colors.border }]}
          >
            <Text
              style={[
                styles.taskHeaderTitle,
                {
                  color: colors.foreground,
                  fontFamily: FontFamily.interSemiBold,
                },
              ]}
            >
              Tasks
            </Text>
            <Text
              style={[
                styles.taskHeaderCount,
                {
                  color: colors.mutedForeground,
                  fontFamily: FontFamily.interMedium,
                },
              ]}
            >
              {progressLabel}
            </Text>
          </View>
          <WorkerMobileTaskList
            tasks={localTasks}
            activeTaskId={activeTaskId}
            onSelectTask={setActiveTaskId}
            onToggleTask={toggleTask}
            taskCanComplete={(t) =>
              !isMandatoryTask(t) ||
              taskHasMobileDocumentation(t, localSessionNotes)
            }
            disabled={disabled || busy}
            shiftId={shiftId}
            sessionId={sessionId}
            participantName={participantName}
            participantId={participantId}
            sessionNotes={localSessionNotes}
            compliance={compliance}
            onNoteSaved={handleNoteSaved}
            onOpenIncidentReport={onOpenIncidentReport}
          />
        </View>

        {/* Medications normally live inside the "Medication Administration" task above.
            This is a safety net only — shown when the shift's task list has no
            medication-category task, so scheduled/PRN doses are never unreachable. */}
        {!localTasks.some((t) => t.category === "medication") && (
          <View
            style={[
              styles.taskCard,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            <View
              style={[
                styles.medicationsTitleRow,
                { borderBottomColor: colors.border },
              ]}
            >
              <Feather name="clipboard" size={14} color={colors.foreground} />
              <Text
                style={[
                  styles.medicationsTitle,
                  {
                    color: colors.foreground,
                    fontFamily: FontFamily.interSemiBold,
                  },
                ]}
              >
                Medications
              </Text>
            </View>
            <WorkerMobileMedicationChecklist
              shiftId={shiftId}
              disabled={disabled || busy}
            />
            <WorkerMobilePrnMedications
              shiftId={shiftId}
              sessionId={sessionId}
              disabled={disabled || busy}
            />
          </View>
        )}

        {(localSessionNotes.length > 0 || compliance.score > 0) && (
          <View style={styles.scoreWrap}>
            <ComplianceScoreBar score={compliance.score} />
          </View>
        )}

        {documentationCompliance && (
          <View style={styles.scoreWrap}>
            <DocumentationComplianceBar check={documentationCompliance} />
          </View>
        )}

        {/* Task-scoped notes render inline in their own task's thread above
            (WorkerMobileTaskList) - this is only for notes with no task_id,
            e.g. long-shift check-ins, which would otherwise never be shown
            anywhere now that there's no single flat notes list. */}
        {untaskedNotes.length > 0 && (
          <>
            <Text
              style={[
                styles.sectionLabel,
                {
                  color: colors.mutedForeground,
                  fontFamily: FontFamily.interSemiBold,
                },
              ]}
            >
              CHECK-INS
            </Text>
            {untaskedNotes.map((note) => {
              const flag = compliance.noteFlags.find(
                (f) => f.noteId === note.note_id,
              );
              return (
                <WorkerMobileNoteBubble
                  key={note.note_id}
                  note={note}
                  participantName={participantName}
                  flag={flag}
                  onIncidentReport={
                    flag?.severity === "fail" ? onOpenIncidentReport : undefined
                  }
                />
              );
            })}
          </>
        )}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
    paddingBottom: 16,
    gap: 12,
  },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  taskCard: {
    marginHorizontal: 14,
    marginTop: 12,
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
  },
  medicationsTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  medicationsTitle: {
    fontSize: 14,
  },
  taskHeader: {
    flexWrap: "wrap",
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  taskHeaderTitle: {
    fontSize: 18,
  },
  taskHeaderCount: {
    fontSize: 14,
  },
  scoreWrap: {
    marginTop: 12,
  },
});
