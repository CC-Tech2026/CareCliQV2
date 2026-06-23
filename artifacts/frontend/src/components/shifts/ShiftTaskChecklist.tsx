import { useCallback, useEffect, useRef, useState } from "react";
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
  hasTaskEvidence,
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

type Props = {
  shiftId: string;
  sessionId?: string | null;
  participantName?: string;
  tasks: ShiftTask[];
  onTasksChange: (tasks: ShiftTask[]) => void;
  disabled?: boolean;
  sessionStyle?: boolean;
  focusTaskId?: string | null;
};

function isMandatory(task: ShiftTask) {
  return isMandatoryTask(task);
}

function TaskStatusCheckbox({
  task,
  disabled,
  onToggle,
}: {
  task: ShiftTask;
  disabled?: boolean;
  onToggle: () => void;
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
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-[#D8D0EE] bg-white"
        aria-label={`Mark ${task.label} complete`}
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
        aria-label={`Mark ${task.label} incomplete`}
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
      aria-label={`Mark ${task.label} incomplete`}
    >
      <AlertTriangle size={11} className="text-amber-700" />
    </button>
  );
}

export function ShiftTaskChecklist({
  shiftId,
  sessionId,
  participantName,
  tasks,
  onTasksChange,
  disabled,
  sessionStyle,
  focusTaskId,
}: Props) {
  const { toast } = useToast();
  const [localTasks, setLocalTasks] = useState<ShiftTask[]>(tasks);
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openGoals, setOpenGoals] = useState<Record<string, boolean>>({});
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (focusTaskId) setExpandedNote(focusTaskId);
  }, [focusTaskId]);

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
        title: "Evidence required",
        description:
          "Mandatory tasks need a photo, voice memo, or written note of at least 20 characters. Type your note in the task thread and press Enter, or use Mark task complete.",
        variant: "destructive",
      });
      setExpandedNote(task.task_id);
      return true;
    },
    [toast],
  );

  const persist = useCallback(
    async (next: ShiftTask[]) => {
      setLocalTasks(next);
      saveTasksLocally(shiftId, next);
      onTasksChange(next);
      setBusy(true);
      try {
        await updateShiftTasks(shiftId, next);
      } catch (err) {
        toast({
          title: "Could not save tasks",
          description: (err as Error).message || "Please try again.",
          variant: "destructive",
        });
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [shiftId, onTasksChange, toast],
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

  const sorted = [...localTasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const goalGroups = groupShiftTasksByGoal(sorted);
  const noEvidenceCount = countTasksWithoutEvidence(localTasks);

  useEffect(() => {
    if (!sessionStyle) return;
    setOpenGoals((current) => {
      const next = { ...current };
      goalGroups.forEach((group) => {
        if (next[group.key] === undefined) next[group.key] = true;
      });
      return next;
    });
  }, [goalGroups, sessionStyle]);

  if (!sessionStyle) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-dashed border-[#DCD4F2] bg-[#F7F4FF] px-3 py-2.5">
          <p className="flex items-center gap-2 text-[11px] font-black" style={{ color: PLUM }}>
            <MessageCircle size={13} />
            Task list preview
          </p>
          <p className="mt-1 text-[11px] font-semibold" style={{ color: MUTED }}>
            Start session to open task threads and capture updates.
          </p>
        </div>

        {goalGroups.map((group) => (
          <div
            key={group.key}
            className="overflow-hidden rounded-xl border border-[#E2DEF2] bg-white"
            style={{ borderLeftWidth: 4, borderLeftColor: group.accent.main }}
          >
            <div className="flex w-full items-center gap-2 px-3 py-2.5 text-left" style={{ background: group.accent.soft }}>
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                style={{ background: `${group.accent.main}18`, color: group.accent.main }}
              >
                <Target size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: group.accent.main }}>
                  NDIS GOAL · {group.category}
                </p>
                <p className="truncate text-sm font-black" style={{ color: TEXT }}>
                  {group.title}
                </p>
              </div>
              <span
                className="rounded-full border px-2 py-0.5 text-[10px] font-black"
                style={{ borderColor: group.accent.border, background: "white", color: group.accent.main }}
              >
                {group.tasks.filter((t) => t.completed).length}/{group.tasks.length}
              </span>
            </div>

            <div className="space-y-2 border-t border-[#E2DEF2] bg-[#FCFBFF] p-2">
              {group.tasks.map((task) => (
                <PreviewTaskRow key={task.task_id} task={task} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-dashed border-[#DCD4F2] bg-[#F7F4FF] px-3 py-2.5">
        <p className="flex items-center gap-2 text-[11px] font-black" style={{ color: PLUM }}>
          <MessageCircle size={13} />
          Task completion with evidence tracking
        </p>
        <p className="mt-1 text-[11px] font-semibold" style={{ color: MUTED }}>
          Expand a task to add photo, voice, or notes. Mandatory tasks cannot be checked off until evidence is added.
        </p>
        {noEvidenceCount > 0 && (
          <p className="mt-1 text-[11px] font-bold text-amber-700">
            {noEvidenceCount} task{noEvidenceCount === 1 ? "" : "s"} flagged for review at shift end
          </p>
        )}
      </div>

      {goalGroups.map((group) => {
        const open = openGoals[group.key] ?? true;
        const done = group.tasks.filter((t) => t.completed).length;
        return (
          <div
            key={group.key}
            className="overflow-hidden rounded-xl border border-[#E2DEF2] bg-white"
            style={{ borderLeftWidth: 4, borderLeftColor: group.accent.main }}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
              style={{ background: group.accent.soft }}
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
                  NDIS GOAL · {group.category}
                </p>
                <p className="truncate text-sm font-black" style={{ color: TEXT }}>
                  {group.title}
                </p>
              </div>
              <span
                className="rounded-full border px-2 py-0.5 text-[10px] font-black"
                style={{ borderColor: group.accent.border, background: "white", color: group.accent.main }}
              >
                {done}/{group.tasks.length}
              </span>
              <ChevronDown size={16} className={cn("transition", open && "rotate-180")} style={{ color: MUTED }} />
            </button>
            {open && (
              <div className="space-y-2 border-t border-[#E2DEF2] bg-[#FCFBFF] p-2">
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
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PreviewTaskRow({ task }: { task: ShiftTask }) {
  const required = isMandatory(task);
  return (
    <div className="rounded-xl border border-[#E2DEF2] bg-white px-3 py-2.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-[#D8D0EE] bg-white" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold" style={{ color: TEXT }}>{task.label}</p>
          <p className="mt-0.5 text-[11px] font-semibold" style={{ color: MUTED }}>
            {required ? "Required" : "Optional"} · Start session to add updates
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
}: {
  task: ShiftTask;
  disabled?: boolean;
  onSave: (note: string) => void;
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
        [Add Note]
      </button>
    );
  }

  if (!open && saved) {
    return (
      <button
        type="button"
        disabled={disabled}
        className="mt-2 w-full rounded-lg border border-[#E2DEF2] bg-[#F8F6FE] px-2.5 py-1.5 text-left text-[11px] font-medium italic"
        style={{ color: MUTED }}
        onClick={() => {
          setDraft(task.context_note ?? "");
          setOpen(true);
        }}
      >
        {notePreview(saved)}
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-1">
      <textarea
        disabled={disabled}
        maxLength={QUICK_NOTE_MAX}
        rows={2}
        value={draft}
        placeholder="What was done? Any observations?"
        className="w-full resize-none rounded-lg border border-[#E2DEF2] bg-white px-2.5 py-1.5 text-xs"
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
        {draft.length}/{QUICK_NOTE_MAX} · Enter to save · Ctrl+Enter for new line · Context only, not evidence
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
}) {
  const [evidenceReady, setEvidenceReady] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-2">
      {tasks.map((task) => {
        const required = isMandatory(task);
        const expanded = expandedNote === task.task_id;
        const panelOpen = expanded || (required && !task.completed);
        const updates = taskUpdateCount(task);
        const withEvidence = task.completed && hasTaskEvidence(task);
        const withoutEvidence = task.completed && !hasTaskEvidence(task);
        const readyToComplete =
          !task.completed &&
          (canMarkTaskComplete(task) || evidenceReady[task.task_id] === true);
        const needsEvidence = required && !task.completed && !readyToComplete;

        if (task.completed && !expanded) {
          return (
            <div
              key={task.task_id}
              className={cn(
                "overflow-hidden rounded-xl border-2 p-3",
                withEvidence ? "border-emerald-400 bg-emerald-50/60" : "border-amber-300 bg-amber-50/70",
              )}
            >
              <div className="flex items-center gap-3">
                <TaskStatusCheckbox
                  task={task}
                  disabled={disabled}
                  onToggle={() => void toggleTaskComplete(task.task_id)}
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setExpandedNote(task.task_id)}
                >
                  <p className="text-sm font-black" style={{ color: TEXT }}>{task.label}</p>
                  <p
                    className={cn(
                      "mt-0.5 text-[11px] font-semibold",
                      withEvidence ? "text-emerald-700" : "text-amber-800",
                    )}
                  >
                    {withEvidence
                      ? `${updates || 1} update${updates === 1 ? "" : "s"} · With evidence ✓`
                      : "No evidence · Tap to add photo or voice"}
                  </p>
                  {task.context_note && (
                    <p className="mt-1 text-[11px] font-medium italic" style={{ color: MUTED }}>
                      {notePreview(task.context_note)}
                    </p>
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
                  Add evidence
                </button>
              )}
            </div>
          );
        }

        return (
          <div
            key={task.task_id}
            className={cn(
              "overflow-hidden rounded-xl border transition-colors",
              panelOpen ? "border-[#C4B5FD] shadow-sm" : "border-[#E2DEF2]",
              task.completed ? "bg-slate-50" : needsEvidence ? "bg-white" : readyToComplete ? "bg-emerald-50/30" : "bg-white",
            )}
          >
            <div className="flex w-full items-center gap-1 p-3">
              <TaskStatusCheckbox
                task={task}
                disabled={disabled}
                onToggle={() => void toggleTaskComplete(task.task_id)}
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => setExpandedNote(expanded ? null : task.task_id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-bold", task.completed && "text-slate-500")} style={{ color: task.completed ? undefined : TEXT }}>
                    {task.label}
                  </p>
                  <p className="mt-0.5 text-[11px] font-semibold" style={{ color: MUTED }}>
                    {required ? "Mandatory · evidence required" : "Optional"}
                    {task.completed && withoutEvidence && " · ⚠️ No evidence"}
                    {task.completed && withEvidence && " · With evidence"}
                    {!task.completed && needsEvidence && " · Add photo, voice, or note (20+ chars)"}
                    {!task.completed && readyToComplete && " · Ready to complete"}
                  </p>
                  {task.context_note && !panelOpen && (
                    <p className="mt-1 text-[11px] font-medium italic" style={{ color: MUTED }}>
                      {notePreview(task.context_note)}
                    </p>
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
              <div className="border-t border-[#ECE6FB] px-3 pb-3">
                <QuickNoteField
                  task={task}
                  disabled={disabled}
                  onSave={(note) => void saveQuickNote(task.task_id, note)}
                />
              </div>
            )}

            {panelOpen && sessionId && (
              <ShiftTaskEvidencePanel
                task={task}
                sessionId={sessionId}
                participantName={participantName}
                disabled={disabled}
                variant="thread"
                onTaskPatch={(patch) => saveEvidence(task.task_id, patch)}
                onStrongEvidence={(patch) => saveStrongEvidence(task.task_id, patch)}
                onMarkComplete={(merge) => markTaskComplete(task.task_id, true, merge)}
                onReadyChange={(ready) => {
                  setEvidenceReady((prev) =>
                    prev[task.task_id] === ready ? prev : { ...prev, [task.task_id]: ready },
                  );
                }}
              />
            )}
            {panelOpen && !sessionId && (
              <div className="border-t border-[#E2DEF2] bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">
                Start a session to capture photo, voice, and written evidence for this task.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
