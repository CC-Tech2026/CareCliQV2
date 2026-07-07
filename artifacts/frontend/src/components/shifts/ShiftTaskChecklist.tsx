import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  MessageCircle,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { ShiftTaskEvidencePanel } from "@/components/shifts/ShiftTaskEvidencePanel";
import { TaskFeedComplianceFlag } from "@/components/shifts/TaskFeedComplianceFlag";
import { WorkerShiftCompliancePanel } from "@/components/compliance/WorkerShiftCompliancePanel";
import {
  contextNoteComplianceId,
  useGoalLinkedTaskComplianceNotes,
} from "@/hooks/useGoalLinkedTaskComplianceNotes";
import { useWorkerCompliance } from "@/hooks/useWorkerCompliance";
import {
  loadTasksLocally,
  saveTasksLocally,
  updateShiftTasks,
  type ShiftTask,
} from "@/services/shiftService";
import {
  applyEvidencePatch,
  applyTaskCompletion,
  countTasksWithoutEvidence,
  getTaskVisualState,
  hasTaskEvidence,
  TASK_STATE_STYLES,
  QUICK_NOTE_MAX,
  QUICK_NOTE_PREVIEW,
} from "@/lib/task-evidence-status";
import { handleNoteTextareaKeyDown } from "@/lib/note-textarea-keyboard";
import {
  groupShiftTasksByGoal,
  canMarkTaskComplete,
  isMandatoryTask,
  MUTED,
  PLUM,
  taskUpdateCount,
  TEXT,
} from "@/lib/shift-utils";
import { shiftTaskDomId } from "@/lib/shift-end-focus";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useWorkerTutorialOptional } from "@/hooks/useWorkerTutorial";
import type { NoteComplianceFlag } from "@/lib/worker-compliance-engine";
import type { TaskVisualState } from "@/lib/task-evidence-status";

const TASK_STATE_KEYS: Record<TaskVisualState, string> = {
  not_started: "tasks.state.notStarted",
  in_progress: "tasks.state.inProgress",
  evidence_required: "tasks.state.evidenceRequired",
  complete: "tasks.state.complete",
};

type Props = {
  shiftId: string;
  sessionId?: string | null;
  participantName?: string;
  participantFirstName?: string;
  shiftEndIso?: string | null;
  tasks: ShiftTask[];
  onTasksChange: (tasks: ShiftTask[]) => void;
  disabled?: boolean;
  sessionStyle?: boolean;
  focusTaskId?: string | null;
  tutorialDemo?: boolean;
  onOpenIncidentReport?: () => void;
};

function isMandatory(task: ShiftTask) {
  return isMandatoryTask(task);
}

function TaskStatusCheckbox({
  task,
  disabled,
  onToggle,
  translateParams,
}: {
  task: ShiftTask;
  disabled?: boolean;
  onToggle: () => void;
  translateParams: (key: string, params: Record<string, string>) => string;
}) {
  if (!task.completed) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-cc-border bg-cc-surface"
        aria-label={translateParams("tasks.markComplete", { label: task.label })}
      />
    );
  }

  if (task.completed && hasTaskEvidence(task)) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-emerald-500 bg-emerald-500"
        aria-label={translateParams("tasks.markIncomplete", { label: task.label })}
      >
        <CheckCircle2 size={12} className="text-white" />
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-amber-400 bg-amber-100"
      aria-label={translateParams("tasks.markIncomplete", { label: task.label })}
    >
      <AlertTriangle size={11} className="text-amber-700" />
    </button>
  );
}

export function ShiftTaskChecklist({
  shiftId,
  sessionId,
  participantName,
  participantFirstName,
  shiftEndIso,
  tasks,
  onTasksChange,
  disabled,
  sessionStyle,
  focusTaskId,
  tutorialDemo,
  onOpenIncidentReport,
}: Props) {
  const { toast } = useToast();
  const { translate, translateParams } = useAccessibility();
  const tutorial = useWorkerTutorialOptional();
  const [localTasks, setLocalTasks] = useState<ShiftTask[]>(tasks);
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openGoals, setOpenGoals] = useState<Record<string, boolean>>({});
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!focusTaskId) return;
    setExpandedNote(focusTaskId);
    requestAnimationFrame(() => {
      document.getElementById(shiftTaskDomId(focusTaskId))?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, [focusTaskId]);

  useEffect(() => {
    const stepKey = tutorial?.activeStep?.key;
    if (stepKey !== "task_evidence" && stepKey !== "evidence_attach") {
      document.body.removeAttribute("data-tutorial-task-evidence-ready");
      return;
    }
    const firstTask = tasks[0];
    if (firstTask) setExpandedNote(firstTask.task_id);
    if (stepKey !== "task_evidence") return;
    const timer = window.setTimeout(() => {
      document.body.setAttribute("data-tutorial-task-evidence-ready", "1");
    }, 1400);
    return () => {
      window.clearTimeout(timer);
      document.body.removeAttribute("data-tutorial-task-evidence-ready");
    };
  }, [tutorial?.activeStep?.key, tasks]);

  useEffect(() => {
    hydratedRef.current = false;
  }, [shiftId]);

  useEffect(() => {
    if (hydratedRef.current) return;
    const cached = loadTasksLocally(shiftId);
    const initial =
      typeof navigator !== "undefined" && navigator.onLine && tasks.length > 0
        ? tasks
        : cached?.length
          ? cached
          : tasks;
    setLocalTasks(initial);
    hydratedRef.current = true;
    onTasksChange(initial);
  }, [shiftId, tasks, onTasksChange]);

  const blockMandatoryComplete = useCallback(
    (task: ShiftTask) => {
      if (canMarkTaskComplete(task)) return false;
      toast({
        title: translate("tasks.evidenceRequired"),
        description: translate("tasks.evidenceRequiredHint"),
        variant: "destructive",
      });
      setExpandedNote(task.task_id);
      return true;
    },
    [toast, translate],
  );

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
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [shiftId, onTasksChange, toast, translate, tutorialDemo],
  );

  const toggleTaskComplete = async (taskId: string) => {
    const task = localTasks.find((t) => t.task_id === taskId);
    if (!task) return;
    if (!task.completed && blockMandatoryComplete(task)) return;
    const now = new Date().toISOString();
    const next = localTasks.map((t) =>
      t.task_id === taskId ? applyTaskCompletion(t, !t.completed, now) : t,
    );
    await persist(next);
  };

  const markTaskComplete = async (taskId: string, completed = true, merge?: Partial<ShiftTask>) => {
    const task = localTasks.find((t) => t.task_id === taskId);
    if (!task) return;
    const merged: ShiftTask = { ...task, ...merge };
    if (completed && blockMandatoryComplete(merged)) return;
    const now = new Date().toISOString();
    const next = localTasks.map((t) =>
      t.task_id === taskId ? applyTaskCompletion({ ...t, ...merge }, completed, now) : t,
    );
    await persist(next);
  };

  const saveEvidence = async (taskId: string, patch: Partial<ShiftTask>) => {
    const now = new Date().toISOString();
    const next = localTasks.map((task) =>
      task.task_id === taskId ? applyEvidencePatch(task, patch, now) : task,
    );
    await persist(next);
  };

  const saveQuickNote = async (taskId: string, contextNote: string) => {
    const now = new Date().toISOString();
    const next = localTasks.map((task) =>
      task.task_id === taskId
        ? applyEvidencePatch(task, { context_note: contextNote.slice(0, QUICK_NOTE_MAX) }, now)
        : task,
    );
    await persist(next);
  };

  const saveStrongEvidence = async (taskId: string, patch: Partial<ShiftTask>) => {
    const now = new Date().toISOString();
    const next = localTasks.map((task) => {
      if (task.task_id !== taskId) return task;
      const withEvidence = applyEvidencePatch(task, patch, now);
      return withEvidence.completed ? withEvidence : applyTaskCompletion(withEvidence, true, now);
    });
    await persist(next);
  };

  const sorted = useMemo(
    () => [...localTasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [localTasks],
  );
  const goalGroups = useMemo(() => groupShiftTasksByGoal(sorted), [sorted]);
  const noEvidenceCount = countTasksWithoutEvidence(localTasks);

  const { notes: complianceNotes } = useGoalLinkedTaskComplianceNotes(
    sessionStyle ? sessionId : null,
    localTasks,
  );
  const { compliance, visibleNotifications, dismissNotification, flagForNote } = useWorkerCompliance({
    notes: complianceNotes,
    tasks: localTasks.map((task) => ({
      task_id: task.task_id,
      label: task.label,
      completed: task.completed,
      marked_na: task.marked_na,
      goal_title: task.goal_title,
    })),
    participantFirstName: participantFirstName ?? participantName?.split(" ")[0],
    shiftEndIso,
    sessionId,
  });

  useEffect(() => {
    if (!sessionStyle) return;
    setOpenGoals((current) => {
      let changed = false;
      const next = { ...current };
      goalGroups.forEach((group) => {
        if (next[group.key] === undefined) {
          next[group.key] = true;
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [goalGroups, sessionStyle]);

  if (!sessionStyle) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-dashed border-cc-border bg-cc-soft px-3 py-2.5">
          <p className="flex items-center gap-2 text-[11px] font-black" style={{ color: PLUM }}>
            <MessageCircle size={13} />
            {translate("tasks.previewTitle")}
          </p>
          <p className="mt-1 text-[11px] font-semibold" style={{ color: MUTED }}>
            {translate("tasks.previewHint")}
          </p>
        </div>

        {goalGroups.map((group) => (
          <div
            key={group.key}
            className="overflow-hidden rounded-xl border border-cc-border bg-cc-surface"
            style={{ borderLeftWidth: 4, borderLeftColor: group.accent.main }}
          >
            <div className="flex w-full items-center gap-2 bg-cc-soft px-3 py-2.5 text-left">
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                style={{ background: `${group.accent.main}18`, color: group.accent.main }}
              >
                <Target size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: group.accent.main }}>
                  {translate("tasks.ndisGoal")} · {group.category}
                </p>
                <p className="truncate text-sm font-black" style={{ color: TEXT }}>
                  {group.title}
                </p>
              </div>
              <span
                className="rounded-full border px-2 py-0.5 text-[10px] font-black"
                style={{ borderColor: group.accent.border, background: "var(--cc-bg)", color: group.accent.main }}
              >
                {group.tasks.filter((t) => t.completed).length}/{group.tasks.length}
              </span>
            </div>

            <div className="space-y-2 border-t border-cc-border bg-cc-bg p-2">
              {group.tasks.map((task) => (
                <PreviewTaskRow key={task.task_id} task={task} translate={translate} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sessionId && (
        <WorkerShiftCompliancePanel
          compliance={compliance}
          notifications={visibleNotifications}
          onDismissNotification={dismissNotification}
          onNotificationAction={onOpenIncidentReport ? () => onOpenIncidentReport() : undefined}
          compact
        />
      )}

      <div className="rounded-xl border border-dashed border-cc-border bg-cc-soft px-3 py-2.5">
        <p className="flex items-center gap-2 text-[11px] font-black" style={{ color: PLUM }}>
          <MessageCircle size={13} />
          {translate("tasks.trackingTitle")}
        </p>
        <p className="mt-1 text-[11px] font-semibold" style={{ color: MUTED }}>
          {translate("tasks.trackingHint")}
        </p>
        {noEvidenceCount > 0 && (
          <p className="mt-1 text-[11px] font-bold text-amber-700">
            {translateParams("tasks.flaggedReview", { count: String(noEvidenceCount) })}
          </p>
        )}
      </div>

      {goalGroups.map((group) => {
        const open = openGoals[group.key] ?? true;
        const done = group.tasks.filter((t) => t.completed).length;
        return (
          <div
            key={group.key}
            className="overflow-hidden rounded-xl border border-cc-border bg-cc-surface"
            style={{ borderLeftWidth: 4, borderLeftColor: group.accent.main }}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 bg-cc-soft px-3 py-2.5 text-left"
              onClick={() => setOpenGoals((prev) => ({ ...prev, [group.key]: !open }))}
            >
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                style={{ background: `${group.accent.main}18`, color: group.accent.main }}
              >
                <Target size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: group.accent.main }}>
                  {translate("tasks.ndisGoal")} · {group.category}
                </p>
                <p className="truncate text-sm font-black" style={{ color: TEXT }}>
                  {group.title}
                </p>
              </div>
              <span
                className="rounded-full border px-2 py-0.5 text-[10px] font-black"
                style={{ borderColor: group.accent.border, background: "var(--cc-bg)", color: group.accent.main }}
              >
                {done}/{group.tasks.length}
              </span>
              <ChevronDown size={16} className={cn("transition", open && "rotate-180")} style={{ color: MUTED }} />
            </button>
            {open && (
              <div className="space-y-2 border-t border-cc-border bg-cc-bg p-2">
                <SessionTaskGroup
                  tasks={group.tasks}
                  expandedNote={expandedNote}
                  setExpandedNote={setExpandedNote}
                  disabled={disabled || busy}
                  saveEvidence={saveEvidence}
                  saveStrongEvidence={saveStrongEvidence}
                  saveQuickNote={saveQuickNote}
                  toggleTaskComplete={toggleTaskComplete}
                  markTaskComplete={markTaskComplete}
                  sessionId={sessionId}
                  participantName={participantName}
                  translate={translate}
                  translateParams={translateParams}
                  tutorialDemo={tutorialDemo}
                  flagForNote={flagForNote}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PreviewTaskRow({ task, translate }: { task: ShiftTask; translate: (key: string) => string }) {
  const required = isMandatory(task);
  return (
    <div className="rounded-xl border border-cc-border bg-cc-surface px-3 py-2.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-[#D8D0EE] bg-white" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold" style={{ color: TEXT }}>{task.label}</p>
          <p className="mt-0.5 text-[11px] font-semibold" style={{ color: MUTED }}>
            {required ? translate("tasks.required") : translate("tasks.optional")} · {translate("tasks.startSessionHint")}
          </p>
        </div>
        <ChevronRight size={16} className="shrink-0" style={{ color: MUTED }} />
      </div>
    </div>
  );
}

function notePreview(text: string) {
  const trimmed = text.trim();
  if (trimmed.length <= QUICK_NOTE_PREVIEW) return trimmed;
  return `${trimmed.slice(0, QUICK_NOTE_PREVIEW)}…`;
}

function QuickNoteField({
  task,
  disabled,
  onSave,
  translate,
  translateParams,
  flag,
}: {
  task: ShiftTask;
  disabled?: boolean;
  onSave: (note: string) => void;
  translate: (key: string) => string;
  translateParams: (key: string, params: Record<string, string>) => string;
  flag?: NoteComplianceFlag;
}) {
  const [draft, setDraft] = useState(task.context_note ?? "");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setDraft(task.context_note ?? "");
  }, [task.context_note, task.task_id]);

  const saved = (task.context_note ?? "").trim();

  if (!open && !saved) {
    return (
      <button
        type="button"
        disabled={disabled}
        className="text-[11px] font-bold text-[#6D4BDA] underline-offset-2 hover:underline"
        onClick={() => setOpen(true)}
      >
        [{translate("tasks.addNote")}]
      </button>
    );
  }

  if (!open && saved) {
    return (
      <div className="mt-2 space-y-1.5">
        {flag && (
          <TaskFeedComplianceFlag flag={flag} taskLabel={task.label} className="rounded-lg border px-2.5 py-1.5" />
        )}
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "w-full rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-medium italic",
            flag ? "border-red-200 bg-red-50" : "border-[#E8E8EA] bg-[#F8F6FE]",
          )}
          style={{ color: MUTED }}
          onClick={() => {
            setDraft(task.context_note ?? "");
            setOpen(true);
          }}
        >
          {notePreview(saved)}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1">
      <textarea
        disabled={disabled}
        maxLength={QUICK_NOTE_MAX}
        rows={2}
        value={draft}
        placeholder={translate("tasks.contextPlaceholder")}
        className="w-full resize-none rounded-lg border border-[#E8E8EA] bg-white px-2.5 py-1.5 text-xs"
        onChange={(e) => setDraft(e.target.value.slice(0, QUICK_NOTE_MAX))}
        onBlur={() => {
          onSave(draft.trim());
          if (!draft.trim()) setOpen(false);
        }}
        onKeyDown={(e) =>
          handleNoteTextareaKeyDown(e, {
            maxLength: QUICK_NOTE_MAX,
            setValue: setDraft,
            onSave: (value) => {
              onSave(value);
              setOpen(false);
            },
          })
        }
      />
      <p className="text-[10px] font-semibold" style={{ color: MUTED }}>
        {translateParams("tasks.noteCharCount", {
          current: String(draft.length),
          max: String(QUICK_NOTE_MAX),
        })}
      </p>
    </div>
  );
}

function SessionTaskGroup({
  tasks,
  expandedNote,
  setExpandedNote,
  disabled,
  saveEvidence,
  saveStrongEvidence,
  saveQuickNote,
  toggleTaskComplete,
  markTaskComplete,
  sessionId,
  participantName,
  translate,
  translateParams,
  tutorialDemo,
  flagForNote,
}: {
  tasks: ShiftTask[];
  expandedNote: string | null;
  setExpandedNote: (id: string | null) => void;
  disabled?: boolean;
  saveEvidence: (taskId: string, patch: Partial<ShiftTask>) => void;
  saveStrongEvidence: (taskId: string, patch: Partial<ShiftTask>) => void;
  saveQuickNote: (taskId: string, note: string) => void;
  toggleTaskComplete: (taskId: string) => void;
  markTaskComplete: (taskId: string, completed?: boolean, merge?: Partial<ShiftTask>) => void;
  sessionId?: string | null;
  participantName?: string;
  translate: (key: string) => string;
  translateParams: (key: string, params: Record<string, string>) => string;
  tutorialDemo?: boolean;
  flagForNote: (noteId: string) => NoteComplianceFlag | undefined;
}) {
  const [evidenceReady, setEvidenceReady] = useState<Record<string, boolean>>({});

  const taskStateLabel = (state: TaskVisualState) => translate(TASK_STATE_KEYS[state]);

  return (
    <div className="space-y-2">
      {tasks.map((task) => {
        const required = isMandatory(task);
        const expanded = expandedNote === task.task_id;
        const panelOpen = expanded || (required && !task.completed);
        const updates = taskUpdateCount(task);
        const withEvidence = task.completed && hasTaskEvidence(task);
        const withoutEvidence = task.completed && !hasTaskEvidence(task);
        const contextFlag = task.context_note
          ? flagForNote(contextNoteComplianceId(task.task_id))
          : undefined;
        const readyToComplete =
          !task.completed &&
          (canMarkTaskComplete(task) || evidenceReady[task.task_id] === true);
        const needsEvidence = required && !task.completed && !readyToComplete;
        const visualState = getTaskVisualState(task, {
          panelOpen,
          isMandatory: required,
          canComplete: readyToComplete || hasTaskEvidence(task),
        });
        const stateStyle = TASK_STATE_STYLES[visualState];

        if (task.completed && !expanded) {
          return (
            <div
              key={task.task_id}
              id={shiftTaskDomId(task.task_id)}
              className={cn(
                "overflow-hidden rounded-xl border-2 p-3",
              )}
              style={{ borderColor: stateStyle.border, background: stateStyle.bg }}
            >
              <div className="flex items-center gap-3">
                <TaskStatusCheckbox
                  task={task}
                  disabled={disabled}
                  onToggle={() => void toggleTaskComplete(task.task_id)}
                  translateParams={translateParams}
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setExpandedNote(task.task_id)}
                >
                  <p className="text-sm font-black" style={{ color: TEXT }}>{task.label}</p>
                  <p className="mt-0.5 text-[11px] font-semibold" style={{ color: stateStyle.text }}>
                    {taskStateLabel(visualState)}
                    {withEvidence
                      ? ` · ${translateParams("tasks.updates", { count: String(updates || 1) })} · ${translate("tasks.withEvidenceCheck")}`
                      : ` · ${translate("tasks.noEvidence")} · ${translate("tasks.tapAddEvidence")}`}
                  </p>
                  {task.context_note && (
                    <div className="mt-1 space-y-1">
                      {contextFlag && (
                        <TaskFeedComplianceFlag
                          flag={contextFlag}
                          taskLabel={task.label}
                          className="rounded-lg border px-2 py-1"
                        />
                      )}
                      <p className="text-[11px] font-medium italic" style={{ color: MUTED }}>
                        {notePreview(task.context_note)}
                      </p>
                    </div>
                  )}
                </button>
                {withoutEvidence ? (
                  <AlertTriangle size={18} className="shrink-0 text-amber-600" />
                ) : (
                  <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
                )}
                <ChevronRight size={18} className="shrink-0" style={{ color: MUTED }} />
              </div>
              {withoutEvidence && (
                <button
                  type="button"
                  className="mt-2 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-left text-[11px] font-bold text-amber-800"
                  onClick={() => setExpandedNote(task.task_id)}
                >
                  {translate("tasks.addEvidence")}
                </button>
              )}
            </div>
          );
        }

        return (
          <div
            key={task.task_id}
            id={shiftTaskDomId(task.task_id)}
            className={cn(
              "overflow-hidden rounded-xl border-2 transition-colors",
              panelOpen && "shadow-sm",
              !required && "opacity-95",
            )}
            style={{
              borderColor: stateStyle.border,
              background: task.completed ? "var(--cc-bg)" : stateStyle.bg,
            }}
          >
            <div className="flex w-full items-center gap-1 p-3">
              {required && (
                <AlertTriangle size={14} className="shrink-0 text-red-500" aria-hidden />
              )}
              <TaskStatusCheckbox
                task={task}
                disabled={disabled}
                onToggle={() => void toggleTaskComplete(task.task_id)}
                translateParams={translateParams}
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => setExpandedNote(expanded ? null : task.task_id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-bold", task.completed && "line-through text-slate-500")} style={{ color: task.completed ? undefined : TEXT }}>
                    {task.label}
                  </p>
                  <p className="mt-0.5 text-[11px] font-semibold" style={{ color: stateStyle.text }}>
                    {required ? `${translate("tasks.mandatoryLabel")} · ` : `${translate("tasks.optional")} · `}
                    {taskStateLabel(visualState)}
                    {task.completed && withoutEvidence && ` · ${translate("tasks.noEvidence")}`}
                    {task.completed && withEvidence && ` · ${translate("tasks.withEvidence")}`}
                    {!task.completed && needsEvidence && ` · ${translate("tasks.needsEvidenceHint")}`}
                    {!task.completed && readyToComplete && ` · ${translate("tasks.readyToComplete")}`}
                  </p>
                  {task.context_note && !panelOpen && (
                    <div className="mt-1 space-y-1">
                      {contextFlag && (
                        <TaskFeedComplianceFlag
                          flag={contextFlag}
                          taskLabel={task.label}
                          className="rounded-lg border px-2 py-1"
                        />
                      )}
                      <p className="text-[11px] font-medium italic" style={{ color: MUTED }}>
                        {notePreview(task.context_note)}
                      </p>
                    </div>
                  )}
                </div>
                {!task.completed && needsEvidence && (
                  <AlertTriangle size={18} className="shrink-0 text-amber-600" />
                )}
                {!task.completed && readyToComplete && (
                  <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
                )}
                {panelOpen ? (
                  <ChevronUp size={18} className="shrink-0" style={{ color: MUTED }} />
                ) : (
                  <ChevronRight size={18} className="shrink-0" style={{ color: MUTED }} />
                )}
              </button>
            </div>

            {!panelOpen && (
              <div className="border-t border-cc-border px-3 pb-3">
                <QuickNoteField
                  task={task}
                  disabled={disabled}
                  onSave={(note) => void saveQuickNote(task.task_id, note)}
                  translate={translate}
                  translateParams={translateParams}
                  flag={contextFlag}
                />
              </div>
            )}

            {panelOpen && sessionId && (
              <div data-tutorial="task-evidence-panel-open">
                <ShiftTaskEvidencePanel
                  task={task}
                  sessionId={sessionId}
                  participantName={participantName}
                  disabled={disabled}
                  variant="thread"
                  tutorialDemo={tutorialDemo}
                  onTaskPatch={(patch) => saveEvidence(task.task_id, patch)}
                  onStrongEvidence={(patch) => saveStrongEvidence(task.task_id, patch)}
                  onMarkComplete={(merge) => markTaskComplete(task.task_id, true, merge)}
                  onReadyChange={(ready) => {
                    setEvidenceReady((prev) =>
                      prev[task.task_id] === ready ? prev : { ...prev, [task.task_id]: ready },
                    );
                  }}
                />
              </div>
            )}
            {panelOpen && !sessionId && (
              <div className="border-t border-cc-border bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">
                {translate("tasks.startSessionEvidence")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
