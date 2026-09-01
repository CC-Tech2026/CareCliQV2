import * as Haptics from "@/lib/haptics";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ClockedInBanner } from "@/components/worker/ClockedInBanner";
import { ComplianceScoreBar } from "@/components/worker/ComplianceScoreBar";
import { LongShiftEngagementPanel } from "@/components/worker/LongShiftEngagementPanel";
import { WorkerMobileComposer } from "@/components/worker/WorkerMobileComposer";
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
  healthAlerts?: ShiftHealthAlert[];
  clockedInAt: string | null;
  sessionId: string | null;
  tasks: ShiftTask[];
  onTasksChange: (tasks: ShiftTask[]) => void;
  sessionNotes: SessionNoteRecord[];
  compliance: ComplianceEvaluation;
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

function sessionNoteTextsForTask(sessionNotes: SessionNoteRecord[], taskId: string): string[] {
  return sessionNotes
    .filter((n) => n.task_id === taskId && n.content?.trim())
    .map((n) => n.content!.trim());
}

function attachSessionNotesToTask(task: ShiftTask, sessionNotes: SessionNoteRecord[]): ShiftTask {
  const texts = sessionNoteTextsForTask(sessionNotes, task.task_id);
  if (!texts.length) return task;
  if ((task.note?.trim().length ?? 0) >= MIN_EVIDENCE_NOTE_CHARS) return task;
  const merged = texts.join("\n\n").slice(0, SESSION_NOTE_MAX);
  return { ...task, note: merged, has_text_notes: true };
}

function taskHasMobileDocumentation(task: ShiftTask, sessionNotes: SessionNoteRecord[]): boolean {
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
  healthAlerts = [],
  clockedInAt,
  sessionId,
  tasks,
  onTasksChange,
  sessionNotes,
  compliance,
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

  const activeTasks = useMemo(() => localTasks.filter((t) => !t.marked_na), [localTasks]);
  const mandatoryTasks = useMemo(
    () => activeTasks.filter((t) => isMandatoryTask(t)),
    [activeTasks],
  );
  const doneMandatory = mandatoryTasks.filter((t) => t.completed).length;
  const startedMandatory = mandatoryTasks.filter((t) => taskStarted(t, localSessionNotes)).length;
  const progressLabel =
    mandatoryTasks.length > 0
      ? doneMandatory > 0
        ? `${doneMandatory} of ${mandatoryTasks.length} required done`
        : `${startedMandatory} of ${mandatoryTasks.length} required started`
      : `${activeTasks.filter((t) => t.completed).length} of ${activeTasks.length} done`;

  const activeTask = activeTasks.find((t) => t.task_id === activeTaskId);

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
        Alert.alert("Save failed", err instanceof Error ? err.message : "Please try again.");
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
      const withEvidence = willComplete ? attachSessionNotesToTask(t, localSessionNotes) : t;
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
    const mergedNotes = [...localSessionNotes.filter((n) => n.note_id !== note.note_id), note];
    setLocalSessionNotes(mergedNotes);

    const taskId = note.task_id;
    if (taskId) {
      const task = localTasks.find((t) => t.task_id === taskId);
      if (task && !task.completed && taskHasMobileDocumentation(task, mergedNotes)) {
        Haptics.selectionAsync();
        const now = new Date().toISOString();
        const next = localTasks.map((t) => {
          if (t.task_id !== taskId) return t;
          const withEvidence = attachSessionNotesToTask(t, mergedNotes);
          return { ...withEvidence, completed: true, completed_at: now, checked_at: now };
        });
        await persist(next);
      }
    }

    onNotesRefresh();
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      // iOS never resizes the window for the keyboard - without this the
      // composer (pinned at the bottom, below the scrollable task/notes
      // list) sits directly under wherever the keyboard slides up to,
      // hiding both the input and whatever's being typed. Android already
      // handles this correctly via its default resize windowing, so this
      // is deliberately iOS-only rather than double-handling it.
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <WorkerMobileParticipantStrip participantName={participantName} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <WorkerMobileRiskStrip alerts={healthAlerts} />
        <ClockedInBanner clockedInAt={clockedInAt} participantName={participantName} />

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

        <View style={[styles.taskCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <View style={[styles.taskHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.taskHeaderTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              Tasks
            </Text>
            <Text style={[styles.taskHeaderCount, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
              {progressLabel}
            </Text>
          </View>
          <WorkerMobileTaskList
            tasks={localTasks}
            activeTaskId={activeTaskId}
            onSelectTask={setActiveTaskId}
            onToggleTask={toggleTask}
            taskCanComplete={(t) =>
              !isMandatoryTask(t) || taskHasMobileDocumentation(t, localSessionNotes)
            }
            disabled={disabled || busy}
          />
        </View>

        <WorkerMobileMedicationChecklist shiftId={shiftId} disabled={disabled || busy} />
        <WorkerMobilePrnMedications shiftId={shiftId} sessionId={sessionId} disabled={disabled || busy} />

        {(localSessionNotes.length > 0 || compliance.score > 0) && (
          <View style={styles.scoreWrap}>
            <ComplianceScoreBar score={compliance.score} />
          </View>
        )}

        {localSessionNotes.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
              NOTES
            </Text>
            {localSessionNotes.map((note) => {
              const task = localTasks.find((t) => t.task_id === note.task_id);
              const flag = compliance.noteFlags.find((f) => f.noteId === note.note_id);
              return (
                <WorkerMobileNoteBubble
                  key={note.note_id}
                  note={note}
                  participantName={participantName}
                  taskLabel={task?.label}
                  goalTitle={task?.goal_title ?? undefined}
                  flag={flag}
                  onIncidentReport={flag?.severity === "fail" ? onOpenIncidentReport : undefined}
                />
              );
            })}
          </>
        )}
      </ScrollView>

      <WorkerMobileComposer
        sessionId={sessionId}
        taskId={activeTask?.task_id}
        taskLabel={activeTask?.label}
        participantName={participantName}
        disabled={disabled || busy || !sessionId}
        onNoteSaved={handleNoteSaved}
      />
    </KeyboardAvoidingView>
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
    paddingBottom: 16,
    gap: 8,
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
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  taskHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  taskHeaderTitle: {
    fontSize: 14,
  },
  taskHeaderCount: {
    fontSize: 12,
  },
  scoreWrap: {
    marginTop: 12,
  },
});
