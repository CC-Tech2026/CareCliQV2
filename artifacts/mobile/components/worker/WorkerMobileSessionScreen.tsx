import { TaskDocumentationReview } from "@/components/worker/TaskDocumentationReview";
import { FontFamily } from "@/constants/typography";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "@/lib/haptics";
import { useQuery } from "@tanstack/react-query";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { ClockedInBanner } from "@/components/worker/ClockedInBanner";
import { ComplianceScoreBar } from "@/components/worker/ComplianceScoreBar";
import { DocumentationComplianceBar } from "@/components/worker/DocumentationComplianceBar";
import { LongShiftEngagementPanel } from "@/components/worker/LongShiftEngagementPanel";
import { DuringShiftSupport } from "@/components/worker/DuringShiftSupport";
import { WorkerMobileNoteBubble } from "@/components/worker/WorkerMobileNoteBubble";
import { WorkerMobileMedicationChecklist } from "@/components/worker/WorkerMobileMedicationChecklist";
import { WorkerMobilePrnMedications } from "@/components/worker/WorkerMobilePrnMedications";
import { WorkerMobileTaskList } from "@/components/worker/WorkerMobileTaskList";
import {
  WorkerShiftTabBar,
  type ShiftTab,
} from "@/components/worker/WorkerShiftTabBar";
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
import {
  getMedicationChecklist,
  getPrnMedications,
  updateShiftTasks,
} from "@/lib/worker-api";
import {
  hasStrongTaskEvidence,
  isMandatoryTask,
  MIN_EVIDENCE_NOTE_CHARS,
  SESSION_NOTE_MAX,
  parseIsoMs,
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
  /** Participant's branch zone. */
  tz?: string | null;
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

type SessionTab = "tasks" | "medications" | "support" | "briefing" | "progress";

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
  tz,
}: Props) {
  const colors = useColors();
  const { isOnline, queueWorkerUpdate } = useOffline();
  const [localTasks, setLocalTasks] = useState(tasks);
  const [localSessionNotes, setLocalSessionNotes] = useState(sessionNotes);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [tab, setTab] = useState<SessionTab>("tasks");
  // A tab mounts on first visit and then stays mounted (hidden), so a half
  // written note or a scroll position survives a look at another tab.
  const [visited, setVisited] = useState<Set<SessionTab>>(
    () => new Set(["tasks"]),
  );
  const openTab = useCallback((next: SessionTab) => {
    setTab(next);
    setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
  }, []);

  // Same queries (and cache) as the medication components, read here for the
  // tab's count and to know whether there is anything to show.
  const { data: medicationData } = useQuery({
    queryKey: ["worker", "medication-checklist", shiftId],
    queryFn: () => getMedicationChecklist(shiftId),
    enabled: !!shiftId,
    refetchInterval: 5 * 60 * 1000,
  });
  const { data: prnData } = useQuery({
    queryKey: ["worker", "prn-medications", shiftId],
    queryFn: () => getPrnMedications(shiftId),
    enabled: !!shiftId,
    refetchInterval: 5 * 60 * 1000,
  });
  const scheduledDoses = medicationData?.checklist ?? [];
  const dosesToLog = scheduledDoses.filter((item) => !item.administration);
  const doseDueNow = dosesToLog.some(
    (item) => item.due_status === "due_now" || item.due_status === "overdue",
  );
  const hasMedications =
    scheduledDoses.length > 0 ||
    (prnData?.medications?.length ?? 0) > 0 ||
    (prnData?.pending_effects?.length ?? 0) > 0;

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
    () =>
      localSessionNotes
        .filter((n) => !n.task_id)
        .sort(
          (a, b) =>
            (parseIsoMs(a.created_at ?? a.auto_saved_at) ?? 0) -
            (parseIsoMs(b.created_at ?? b.auto_saved_at) ?? 0),
        ),
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
      openTab("tasks");
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

  const medicationTask = activeTasks.find((t) => t.category === "medication");
  const tasksBadge =
    mandatoryTasks.length > 0
      ? `${doneMandatory}/${mandatoryTasks.length}`
      : `${activeTasks.filter((t) => t.completed).length}/${activeTasks.length}`;

  const tabs: ShiftTab<SessionTab>[] = [
    {
      id: "tasks",
      label: "Tasks",
      badge: activeTasks.length > 0 ? tasksBadge : undefined,
      renderIcon: (color) => (
        <Feather name="check-square" size={20} color={color} />
      ),
    },
    {
      id: "medications",
      label: "Meds",
      badge: dosesToLog.length > 0 ? String(dosesToLog.length) : undefined,
      attention: doseDueNow,
      renderIcon: (color) => (
        <MaterialCommunityIcons name="pill" size={21} color={color} />
      ),
    },
    {
      id: "support",
      label: "Support",
      attention: healthAlerts.length > 0,
      renderIcon: (color) => <Feather name="shield" size={20} color={color} />,
    },
    {
      id: "briefing",
      label: "Briefing",
      renderIcon: (color) => (
        <Feather name="file-text" size={20} color={color} />
      ),
    },
    {
      id: "progress",
      label: "Progress",
      attention: Boolean(
        checkinStatus?.can_submit_checkin || checkinStatus?.checkin_overdue,
      ),
      renderIcon: (color) => (
        <Feather name="activity" size={20} color={color} />
      ),
    },
  ];

  // Each task's composer (WorkerMobileTaskList) can be expanded anywhere in
  // the list, including the last task at the very bottom - a plain
  // ScrollView + KeyboardAvoidingView doesn't auto-scroll a focused TextInput
  // above the keyboard. KeyboardAwareScrollView tracks the focused input and
  // scrolls it into view itself, and only for inputs inside its own tab.
  const panel = (id: SessionTab, children: React.ReactNode) =>
    visited.has(id) ? (
      <KeyboardAwareScrollViewCompat
        key={id}
        style={[styles.scroll, tab !== id && styles.hidden]}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        {children}
      </KeyboardAwareScrollViewCompat>
    ) : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <WorkerShiftTabBar tabs={tabs} activeTab={tab} onChange={openTab} />

      {panel(
        "tasks",
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
            tz={tz}
          />
        </View>,
      )}

      {panel(
        "medications",
        hasMedications ? (
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
                Medications
              </Text>
              {scheduledDoses.length > 0 ? (
                <Text
                  style={[
                    styles.taskHeaderCount,
                    {
                      color: colors.mutedForeground,
                      fontFamily: FontFamily.interMedium,
                    },
                  ]}
                >
                  {dosesToLog.length === 0
                    ? "All doses logged"
                    : `${dosesToLog.length} dose${dosesToLog.length === 1 ? "" : "s"} to log`}
                </Text>
              ) : null}
            </View>
            {medicationTask ? (
              <Text
                style={[
                  styles.medicationHint,
                  {
                    color: colors.mutedForeground,
                    fontFamily: FontFamily.interMedium,
                  },
                ]}
              >
                Logging every dose here also completes the{" "}
                {medicationTask.label} task.
              </Text>
            ) : null}
            {/* Only completes the task from this tab while it is open, and not
                while the same task is expanded on the Tasks tab, which already
                does it - two checklists answering at once would double up. */}
            <WorkerMobileMedicationChecklist
              shiftId={shiftId}
              disabled={disabled || busy}
              onStatusChange={
                medicationTask &&
                tab === "medications" &&
                activeTaskId !== medicationTask.task_id
                  ? (allLogged, hasScheduled) => {
                      if (
                        allLogged &&
                        hasScheduled &&
                        !medicationTask.completed
                      ) {
                        void toggleTask(medicationTask.task_id);
                      }
                    }
                  : undefined
              }
              tz={tz}
            />
            <WorkerMobilePrnMedications
              shiftId={shiftId}
              sessionId={sessionId}
              disabled={disabled || busy}
            />
          </View>
        ) : (
          <View
            style={[
              styles.emptyCard,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            <MaterialCommunityIcons
              name="pill"
              size={26}
              color={colors.mutedForeground}
            />
            <Text
              style={[
                styles.emptyTitle,
                {
                  color: colors.foreground,
                  fontFamily: FontFamily.interSemiBold,
                },
              ]}
            >
              No medications on this shift
            </Text>
            <Text
              style={[
                styles.emptyBody,
                {
                  color: colors.mutedForeground,
                  fontFamily: FontFamily.interMedium,
                },
              ]}
            >
              Scheduled doses and as needed (PRN) medications show here when{" "}
              {participantFirstName || participantName} has them.
            </Text>
          </View>
        ),
      )}

      {panel(
        "support",
        <View style={styles.participantWrap}>
          <DuringShiftSupport
            shiftId={shiftId}
            participantId={participantId}
            healthAlerts={healthAlerts}
          />
        </View>,
      )}

      {panel(
        "briefing",
        <View style={styles.participantWrap}>
          <DuringShiftSupport
            shiftId={shiftId}
            participantId={participantId}
            section="briefing"
          />
        </View>,
      )}

      {panel(
        "progress",
        <>
          <View
            style={[
              styles.progressCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.progressHeading}>
              <Text
                accessibilityRole="header"
                style={[styles.progressTitle, { color: colors.foreground }]}
              >
                Shift progress
              </Text>
              <Text
                style={[
                  styles.progressCaption,
                  { color: colors.mutedForeground },
                ]}
              >
                {sessionElapsed || "In progress"}
              </Text>
            </View>
            <View style={styles.progressStats}>
              {[
                {
                  label: "Tasks done",
                  value: `${activeTasks.filter((t) => t.completed).length}/${activeTasks.length}`,
                  target: "tasks" as const,
                },
                {
                  label: "Doses to log",
                  value: String(dosesToLog.length),
                  target: "medications" as const,
                },
              ].map((item) => (
                <Pressable
                  key={item.target}
                  accessibilityRole="button"
                  accessibilityLabel={
                    item.label + ": " + item.value + ". Open " + item.target
                  }
                  onPress={() => openTab(item.target)}
                  style={[
                    styles.progressStat,
                    { backgroundColor: colors.soft },
                  ]}
                >
                  <View style={styles.progressHeading}>
                    <Text
                      style={[
                        styles.progressValue,
                        { color: colors.foreground },
                      ]}
                    >
                      {item.value}
                    </Text>
                    <Feather
                      name="arrow-up-right"
                      size={14}
                      color={colors.primary}
                    />
                  </View>
                  <Text
                    style={[
                      styles.progressCaption,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <ClockedInBanner
            clockedInAt={clockedInAt}
            participantName={participantName}
            tz={tz}
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

          <TaskDocumentationReview
            tasks={localTasks}
            notes={localSessionNotes}
            compliance={compliance}
            participantFirstName={participantFirstName}
            onOpenTask={(id) => {
              setActiveTaskId(id);
              openTab("tasks");
            }}
          />

          {/* Task-scoped notes render inline in their own task's thread on the
              Tasks tab - this is only for notes with no task_id, e.g.
              long-shift check-ins, which would otherwise never be shown. */}
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
                SHIFT ACTIVITY
              </Text>
              {(showAllHistory
                ? untaskedNotes
                : untaskedNotes.filter(
                    (note, index) =>
                      index >= untaskedNotes.length - 2 ||
                      compliance.noteFlags.some(
                        (flag) =>
                          flag.noteId === note.note_id &&
                          flag.severity === "fail",
                      ),
                  )
              ).map((note) => {
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
                      flag?.severity === "fail"
                        ? onOpenIncidentReport
                        : undefined
                    }
                    tz={tz}
                  />
                );
              })}
              {untaskedNotes.length > 2 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showAllHistory }}
                  onPress={() => setShowAllHistory((v) => !v)}
                  style={[
                    styles.historyToggle,
                    { backgroundColor: colors.soft },
                  ]}
                >
                  <Text
                    style={[styles.progressCaption, { color: colors.primary }]}
                  >
                    {showAllHistory
                      ? "Show recent activity"
                      : "View all " + untaskedNotes.length + " entries"}
                  </Text>
                  <Feather
                    name={showAllHistory ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.primary}
                  />
                </Pressable>
              ) : null}
            </>
          )}
          {!untaskedNotes.length ? (
            <Text
              style={[styles.activityEmpty, { color: colors.mutedForeground }]}
            >
              No shift activity recorded yet. Task notes stay with their tasks.
            </Text>
          ) : null}
        </>,
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  progressCard: {
    marginHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  progressHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  progressTitle: {
    fontFamily: FontFamily.interSemiBold,
    fontSize: 14,
    lineHeight: 20,
  },
  progressCaption: {
    fontFamily: FontFamily.interMedium,
    fontSize: 12,
    lineHeight: 18,
  },
  progressStats: { flexDirection: "row", gap: 8 },
  progressStat: {
    flex: 1,
    minHeight: 64,
    borderRadius: 8,
    padding: 10,
    gap: 3,
  },
  progressValue: {
    fontFamily: FontFamily.interBold,
    fontSize: 18,
    lineHeight: 24,
  },
  historyToggle: {
    marginHorizontal: 14,
    paddingHorizontal: 12,
    minHeight: 44,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  activityEmpty: {
    marginHorizontal: 16,
    fontFamily: FontFamily.interRegular,
    fontSize: 12,
    lineHeight: 18,
  },
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  hidden: {
    display: "none",
  },
  participantWrap: {
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  medicationHint: {
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  emptyCard: {
    marginHorizontal: 14,
    marginTop: 16,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 28,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
  },
  emptyBody: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
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
    marginHorizontal: 14,
  },
});
