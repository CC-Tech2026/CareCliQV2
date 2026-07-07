import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { WM } from "@/lib/worker-mobile-tokens";
import { applyTaskCompletion, MIN_EVIDENCE_NOTE_CHARS, SESSION_NOTE_MAX } from "@/lib/task-evidence-status";
import { hasStrongTaskEvidence } from "@/lib/shift-utils";
import {
  saveTasksLocally,
  updateShiftTasks,
  type ShiftTask,
  type ShiftHealthAlert,
} from "@/services/shiftService";
import type { ComplianceEvaluation, ComplianceNotification } from "@/lib/worker-compliance-engine";
import type { SessionNoteRecord } from "@/services/sessionNotesService";
import { ClockedInBanner } from "./ClockedInBanner";
import { ComplianceNotificationStack } from "./ComplianceNotificationStack";
import { ComplianceScoreBar } from "./ComplianceScoreBar";
import { WorkerMobileComposer } from "./WorkerMobileComposer";
import { WorkerMobileNoteBubble } from "./WorkerMobileNoteBubble";
import { WorkerMobileParticipantStrip } from "./WorkerMobileParticipantStrip";
import { WorkerMobileRiskStrip } from "./WorkerMobileRiskStrip";
import { WorkerMobileTaskList } from "./WorkerMobileTaskList";
import { LongShiftEngagementPanel } from "@/components/shifts/LongShiftEngagementPanel";
import { BreakStatusBanner } from "@/components/shifts/BreakStatusBanner";
import { useLongShiftBreak } from "@/hooks/useLongShiftBreak";
import type { CheckinWindowStatus } from "@/services/longShiftService";

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
  visibleNotifications?: ComplianceNotification[];
  onDismissNotification?: (id: string) => void;
  onOpenIncidentReport?: (noteId?: string, content?: string) => void;
  onNotesRefresh: () => void;
  tutorialDemo?: boolean;
  disabled?: boolean;
  sessionElapsed?: string;
  longShiftBreak?: ReturnType<typeof useLongShiftBreak>;
  initialCheckinStatus?: CheckinWindowStatus | null;
  focusTaskId?: string | null;
};

function taskStarted(task: ShiftTask, notes: SessionNoteRecord[]) {
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

function attachSessionNotesToTask(
  task: ShiftTask,
  sessionNotes: SessionNoteRecord[],
): ShiftTask {
  const texts = sessionNoteTextsForTask(sessionNotes, task.task_id);
  if (!texts.length) return task;
  const merged = texts.join("\n\n").slice(0, SESSION_NOTE_MAX);
  if ((task.note?.trim().length ?? 0) >= MIN_EVIDENCE_NOTE_CHARS) return task;
  return { ...task, note: merged, has_text_notes: true };
}

/** Mobile: every task needs a note (20+ chars) or photo/voice before marking complete. */
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
  healthAlerts = [],
  clockedInAt,
  sessionId,
  tasks,
  onTasksChange,
  sessionNotes,
  compliance,
  visibleNotifications = [],
  onDismissNotification,
  onOpenIncidentReport,
  onNotesRefresh,
  tutorialDemo,
  disabled,
  sessionElapsed,
  longShiftBreak,
  initialCheckinStatus,
  focusTaskId,
}: Props) {
  const { toast } = useToast();
  const { translate } = useAccessibility();
  const [localTasks, setLocalTasks] = useState(tasks);
  const [localSessionNotes, setLocalSessionNotes] = useState(sessionNotes);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

  useEffect(() => {
    if (!focusTaskId) return;
    setActiveTaskId(focusTaskId);
    requestAnimationFrame(() => {
      document.getElementById(`wm-shift-task-${focusTaskId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, [focusTaskId]);

  useEffect(() => {
    setLocalSessionNotes(sessionNotes);
  }, [sessionNotes]);

  const activeTasks = useMemo(
    () => localTasks.filter((t) => !t.marked_na),
    [localTasks],
  );

  const doneCount = activeTasks.filter((t) => t.completed).length;
  const startedCount = activeTasks.filter((t) => taskStarted(t, localSessionNotes)).length;
  const progressLabel =
    doneCount > 0
      ? `${doneCount} of ${activeTasks.length} done`
      : `${startedCount} of ${activeTasks.length} started`;

  const activeTask = activeTasks.find((t) => t.task_id === activeTaskId);
  const composerPlaceholder = activeTask
    ? participantFirstName
      ? `What did ${participantFirstName} do during ${activeTask.label.toLowerCase()}?`
      : `Document: ${activeTask.label}`
    : "Start typing a note…";

  const persist = useCallback(
    async (next: ShiftTask[]) => {
      setLocalTasks(next);
      saveTasksLocally(shiftId, next);
      onTasksChange(next);
      if (tutorialDemo) return;
      setBusy(true);
      try {
        await updateShiftTasks(shiftId, next);
      } catch (err) {
        toast({
          title: translate("tasks.saveFailed"),
          description: (err as Error).message || translate("toast.tryAgain"),
          variant: "destructive",
        });
      } finally {
        setBusy(false);
      }
    },
    [shiftId, onTasksChange, toast, translate, tutorialDemo],
  );

  const toggleTask = async (taskId: string) => {
    const task = localTasks.find((t) => t.task_id === taskId);
    if (!task) return;

    if (!task.completed && !taskHasMobileDocumentation(task, localSessionNotes)) {
      toast({
        title: translate("tasks.evidenceRequired"),
        description: translate("tasks.evidenceRequiredHint"),
        variant: "destructive",
      });
      setActiveTaskId(taskId);
      return;
    }

    const now = new Date().toISOString();
    const next = localTasks.map((t) => {
      if (t.task_id !== taskId) return t;
      const withEvidence = attachSessionNotesToTask(t, localSessionNotes);
      return applyTaskCompletion(withEvidence, !t.completed, now);
    });
    await persist(next);
  };

  const handleNoteSaved = useCallback(
    async (note: SessionNoteRecord) => {
      const mergedNotes = (() => {
        const without = localSessionNotes.filter((n) => n.note_id !== note.note_id);
        return [...without, note];
      })();
      setLocalSessionNotes(mergedNotes);

      const taskId = note.task_id;
      if (taskId) {
        const task = localTasks.find((t) => t.task_id === taskId);
        if (task && !task.completed && taskHasMobileDocumentation(task, mergedNotes)) {
          const now = new Date().toISOString();
          const next = localTasks.map((t) => {
            if (t.task_id !== taskId) return t;
            const withEvidence = attachSessionNotesToTask(t, mergedNotes);
            return applyTaskCompletion(withEvidence, true, now);
          });
          await persist(next);
        }
      }

      onNotesRefresh();
    },
    [localSessionNotes, localTasks, onNotesRefresh, persist],
  );

  const taskLabel = (taskId?: string) =>
    localTasks.find((t) => t.task_id === taskId)?.label;

  const handleOpenIncident = useCallback(
    (noteId: string, content: string) => {
      onOpenIncidentReport?.(noteId, content);
    },
    [onOpenIncidentReport],
  );

  const handleNotificationAction = useCallback(() => {
    const failing = compliance.noteFlags.find((f) => f.ruleId === 9 && f.severity === "fail");
    if (failing) {
      const note = localSessionNotes.find((n) => n.note_id === failing.noteId);
      onOpenIncidentReport?.(failing.noteId, note?.content);
      return;
    }
    onOpenIncidentReport?.();
  }, [compliance.noteFlags, localSessionNotes, onOpenIncidentReport]);

  const showNotes = localSessionNotes.length > 0;
  const showScore = showNotes || compliance.score > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <WorkerMobileParticipantStrip participantName={participantName} />

      {visibleNotifications.length > 0 && (
        <ComplianceNotificationStack
          notifications={visibleNotifications}
          onDismiss={onDismissNotification}
          onAction={handleNotificationAction}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        <WorkerMobileRiskStrip alerts={healthAlerts} />

        {clockedInAt && (
          <ClockedInBanner clockedInAt={clockedInAt} />
        )}

        {longShiftBreak?.onBreak && (
          <BreakStatusBanner
            variant="mobile"
            breakElapsed={longShiftBreak.breakElapsed}
          />
        )}

        {sessionId && longShiftBreak && (
          <div className="mx-3 mt-3">
            <LongShiftEngagementPanel
              sessionId={sessionId}
              shiftId={shiftId}
              clockedInAt={clockedInAt}
              sessionElapsed={sessionElapsed}
              breakControl={longShiftBreak}
              initialCheckinStatus={initialCheckinStatus}
            />
          </div>
        )}

        <div className="mx-3 mt-3 overflow-hidden rounded-2xl border" style={{ borderColor: WM.border, background: WM.surface }}>
          <div className="flex items-center justify-between border-b px-3 py-2.5" style={{ borderColor: WM.border }}>
            <p className="text-[14px] font-semibold" style={{ color: WM.text }}>
              Tasks
            </p>
            <span className="text-[12px] font-medium" style={{ color: WM.muted }}>
              {progressLabel}
            </span>
          </div>

          <WorkerMobileTaskList
            tasks={localTasks}
            activeTaskId={activeTaskId}
            onSelectTask={setActiveTaskId}
            onToggleTask={(id) => void toggleTask(id)}
            taskCanComplete={(t) => t.completed || taskHasMobileDocumentation(t, localSessionNotes)}
            disabled={disabled || busy}
          />
        </div>

        {!showNotes && (
          <p className="mt-3 text-center text-[12px] font-medium" style={{ color: WM.muted }}>
            Tap any task above to start noting
          </p>
        )}

        {showScore && (
          <div className="mt-3">
            <ComplianceScoreBar score={compliance.score} label="Note quality" />
          </div>
        )}

        {showNotes && (
          <div className="mt-4 px-3">
            <p
              className="mb-2 text-[10px] font-bold uppercase tracking-widest"
              style={{ color: WM.muted }}
            >
              Notes this session
            </p>
            <div className="space-y-2.5">
              {localSessionNotes.map((note) => {
                const flag = compliance.noteFlags.find((f) => f.noteId === note.note_id);
                return (
                  <WorkerMobileNoteBubble
                    key={note.note_id}
                    note={note}
                    taskLabel={taskLabel(note.task_id ?? undefined)}
                    goalTitle={localTasks.find((t) => t.task_id === note.task_id)?.goal_title || undefined}
                    flag={flag}
                    onIncidentReport={flag?.severity === "fail" ? handleOpenIncident : undefined}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      <WorkerMobileComposer
        sessionId={sessionId}
        taskId={activeTaskId}
        taskLabel={composerPlaceholder}
        disabled={disabled || !sessionId}
        onNoteSaved={(note) => void handleNoteSaved(note)}
      />
    </div>
  );
}
