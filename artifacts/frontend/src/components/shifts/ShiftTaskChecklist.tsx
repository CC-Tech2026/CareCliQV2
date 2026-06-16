import { useCallback, useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, ChevronDown, ChevronUp, StickyNote, Trash2, MessageCircle, Camera, Mic, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ShiftTaskEvidencePanel } from "@/components/shifts/ShiftTaskEvidencePanel";
import { deleteAllTaskEvidenceForTask } from "@/lib/task-evidence-storage";
import {
  addCustomShiftTask,
  deleteCustomShiftTask,
  loadTasksLocally,
  saveTasksLocally,
  updateShiftTasks,
  type ShiftTask,
} from "@/services/shiftService";
import { isCustomShiftTask, isMandatoryTask, MUTED, PLUM, TEXT } from "@/lib/shift-utils";

const NOTE_MAX = 150;

type Props = {
  shiftId: string;
  sessionId?: string | null;
  participantName?: string;
  tasks: ShiftTask[];
  onTasksChange: (tasks: ShiftTask[]) => void;
  disabled?: boolean;
  sessionStyle?: boolean;
};

function isMandatory(task: ShiftTask) {
  return isMandatoryTask(task);
}

export function ShiftTaskChecklist({
  shiftId,
  sessionId,
  participantName,
  tasks,
  onTasksChange,
  disabled,
  sessionStyle,
}: Props) {
  const [localTasks, setLocalTasks] = useState<ShiftTask[]>(tasks);
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [openGoals, setOpenGoals] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const cached = loadTasksLocally(shiftId);
    if (cached?.length) {
      setLocalTasks(cached);
    } else {
      setLocalTasks(tasks);
    }
  }, [shiftId, tasks]);

  const persist = useCallback(
    async (next: ShiftTask[]) => {
      setLocalTasks(next);
      saveTasksLocally(shiftId, next);
      onTasksChange(next);
      setBusy(true);
      try {
        await updateShiftTasks(shiftId, next);
      } finally {
        setBusy(false);
      }
    },
    [shiftId, onTasksChange],
  );

  const toggleTask = async (taskId: string) => {
    const now = new Date().toISOString();
    const next = localTasks.map((task) =>
      task.task_id === taskId
        ? {
            ...task,
            completed: !task.completed,
            completed_at: !task.completed ? now : null,
          }
        : task,
    );
    await persist(next);
  };

  const saveNote = async (taskId: string, note: string, keepOpen = false) => {
    const trimmed = note.slice(0, keepOpen ? 500 : NOTE_MAX);
    const next = localTasks.map((task) =>
      task.task_id === taskId ? { ...task, note: trimmed } : task,
    );
    await persist(next);
    if (!keepOpen) setExpandedNote(null);
  };

  const saveEvidence = async (taskId: string, patch: Partial<ShiftTask>) => {
    const next = localTasks.map((task) =>
      task.task_id === taskId ? { ...task, ...patch } : task,
    );
    await persist(next);
  };

  const handleAddCustom = async () => {
    const label = customLabel.trim();
    if (!label) return;
    setBusy(true);
    try {
      const updated = await addCustomShiftTask(shiftId, label);
      const next = updated.tasks ?? localTasks;
      setLocalTasks(next);
      saveTasksLocally(shiftId, next);
      onTasksChange(next);
      setCustomLabel("");
      setAddingCustom(false);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCustom = async (taskId: string) => {
    if (confirmDeleteId !== taskId) {
      setConfirmDeleteId(taskId);
      return;
    }
    setBusy(true);
    try {
      if (sessionId) {
        await deleteAllTaskEvidenceForTask(sessionId, taskId);
      }
      const updated = await deleteCustomShiftTask(shiftId, taskId);
      const next = updated.tasks ?? localTasks.filter((task) => task.task_id !== taskId);
      setLocalTasks(next);
      saveTasksLocally(shiftId, next);
      onTasksChange(next);
      if (expandedNote === taskId) setExpandedNote(null);
      setConfirmDeleteId(null);
    } finally {
      setBusy(false);
    }
  };

  const sorted = [...localTasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const mandatory = sorted.filter(isMandatory);
  const optional = sorted.filter((t) => !isMandatory(t));
  const mandatoryDone = mandatory.filter((t) => t.completed).length;
  const goalGroups = groupTasksByGoal(sorted);

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

  return (
    <div className="space-y-3">
      {mandatory.length > 0 && !sessionStyle && (
        <p
          className={cn(
            "text-xs font-black",
            mandatoryDone === mandatory.length ? "text-emerald-600" : "text-amber-600",
          )}
        >
          {mandatoryDone}/{mandatory.length} mandatory done
        </p>
      )}

      {sessionStyle && (
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>
            Goal-Linked Task Feed
          </p>
          <div className="rounded-xl border border-dashed border-[#DCD4F2] bg-[#F7F4FF] px-3 py-2.5">
            <p className="flex items-center gap-2 text-[11px] font-black" style={{ color: PLUM }}>
              <MessageCircle size={13} />
              Message-style task tracking
            </p>
            <p className="mt-1 text-[11px] font-semibold" style={{ color: MUTED }}>
              Tap any task to open its thread. Add a photo, voice note, or quick text.
            </p>
          </div>
        </div>
      )}

      {!sessionStyle && busy && <span className="text-[11px] font-bold" style={{ color: MUTED }}>Saving…</span>}

      {!sessionStyle && mandatory.length > 0 && (
        <TaskGroup label="Mandatory" tasks={mandatory} sessionStyle={sessionStyle} {...taskProps()} />
      )}

      {!sessionStyle && optional.length > 0 && (
        <TaskGroup label="Optional" tasks={optional} sessionStyle={sessionStyle} {...taskProps()} />
      )}

      {sessionStyle && goalGroups.map((group) => {
        const open = openGoals[group.key] ?? true;
        const done = group.tasks.filter((t) => t.completed).length;
        return (
          <div key={group.key} className="rounded-xl border border-[#E2DEF2] bg-[#FCFBFF] p-2">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left"
              onClick={() => setOpenGoals((prev) => ({ ...prev, [group.key]: !open }))}
            >
              <span
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full"
                style={{ background: group.accent.soft, color: group.accent.main }}
              >
                <MessageCircle size={12} />
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-[10px] font-black uppercase tracking-[0.16em]"
                  style={{ color: group.accent.main }}
                >
                  NDIS GOAL · {group.category}
                </p>
                <p className="truncate text-sm font-black" style={{ color: TEXT }}>
                  {group.title}
                </p>
              </div>
              <span
                className="rounded-full border px-2 py-0.5 text-[10px] font-black"
                style={{ borderColor: group.accent.border, background: group.accent.soft, color: group.accent.main }}
              >
                {done}/{group.tasks.length}
              </span>
              <ChevronDown size={16} className={cn("transition", open && "rotate-180")} style={{ color: MUTED }} />
            </button>
            {open && <TaskGroup label={group.title} tasks={group.tasks} sessionStyle {...taskProps()} />}
          </div>
        );
      })}

      {!disabled && !sessionStyle && (
        <div className="pt-1">
          {addingCustom ? (
            <div className="flex gap-2">
              <Input
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="Custom task name"
                className="text-sm"
                maxLength={80}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleAddCustom();
                  if (e.key === "Escape") setAddingCustom(false);
                }}
              />
              <Button
                size="sm"
                className="shrink-0 rounded-full font-bold"
                style={{ background: PLUM }}
                disabled={busy || !customLabel.trim()}
                onClick={() => void handleAddCustom()}
              >
                Add
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full gap-1.5 rounded-xl text-xs font-bold"
              disabled={busy}
              onClick={() => setAddingCustom(true)}
            >
              <Plus size={14} /> Add Custom Task
            </Button>
          )}
        </div>
      )}
    </div>
  );

  function taskProps() {
    return {
      expandedNote,
      setExpandedNote,
      disabled: disabled || busy,
      toggleTask,
      saveNote,
      saveEvidence,
      sessionId,
      participantName,
      confirmDeleteId,
      setConfirmDeleteId,
      deleteCustomTask: handleDeleteCustom,
    };
  }
}

function TaskGroup({
  label,
  tasks,
  sessionStyle,
  expandedNote,
  setExpandedNote,
  disabled,
  toggleTask,
  saveNote,
  saveEvidence,
  sessionId,
  participantName,
  confirmDeleteId,
  setConfirmDeleteId,
  deleteCustomTask,
}: {
  label: string;
  tasks: ShiftTask[];
  sessionStyle?: boolean;
  expandedNote: string | null;
  setExpandedNote: (id: string | null) => void;
  disabled?: boolean;
  toggleTask: (id: string) => void;
  saveNote: (id: string, note: string, keepOpen?: boolean) => void;
  saveEvidence: (taskId: string, patch: Partial<ShiftTask>) => void;
  sessionId?: string | null;
  participantName?: string;
  confirmDeleteId: string | null;
  setConfirmDeleteId: (id: string | null) => void;
  deleteCustomTask: (taskId: string) => void;
}) {
  return (
    <div className="space-y-2">
      {!sessionStyle && (
        <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>
          {label}
          {label === "Mandatory" && tasks.length > 0 && (
            <span className="ml-2 normal-case tracking-normal">
              ({tasks.filter((t) => t.completed).length}/{tasks.length} completed)
            </span>
          )}
        </p>
      )}
      {sessionStyle && <div className="h-0.5" />}
      {tasks.map((task) => {
        const required = isMandatory(task);
        const expanded = expandedNote === task.task_id;
        const noteOpen = expanded;
        const deletable = isCustomShiftTask(task);
        const confirmingDelete = confirmDeleteId === task.task_id;

        if (sessionStyle) {
          return (
            <div
              key={task.task_id}
              className={cn(
                "overflow-hidden rounded-xl border transition-colors",
                expanded ? "border-[#C4B5FD] shadow-sm" : "border-[#E2DEF2]",
                task.completed ? "bg-slate-50" : "bg-white",
              )}
            >
              <div className="flex w-full items-center gap-1 p-3">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setConfirmDeleteId(null);
                    setExpandedNote(expanded ? null : task.task_id);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span
                    className={cn(
                      "grid h-5 w-5 shrink-0 place-items-center rounded-full border-2",
                      task.completed ? "border-emerald-500 bg-emerald-500" : "border-[#D8D0EE] bg-white",
                    )}
                  >
                    {task.completed && <span className="h-2 w-2 rounded-full bg-white" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "text-sm font-bold",
                        task.completed && "text-slate-400 line-through",
                      )}
                      style={{ color: task.completed ? undefined : TEXT }}
                    >
                      {task.label}
                    </p>
                    {required && !task.completed && (
                      <p className="mt-0.5 text-[11px] font-semibold" style={{ color: MUTED }}>
                        Required · Tap to add updates
                      </p>
                    )}
                    {task.note && !expanded && (
                      <p className="mt-0.5 truncate text-xs font-medium text-slate-500">{task.note}</p>
                    )}
                  </div>
                  {expanded ? (
                    <ChevronUp size={18} className="shrink-0" style={{ color: MUTED }} />
                  ) : (
                  <ChevronRight size={18} className="shrink-0" style={{ color: MUTED }} />
                  )}
                </button>
              </div>

              {expanded && (
                <div className="border-t border-[#ECE6FB] bg-[#FBFAFF] p-3">
                  {task.description && (
                    <p className="mb-2 text-xs italic font-semibold" style={{ color: MUTED }}>
                      {task.description}
                    </p>
                  )}
                  {!task.note && (
                    <div className="mb-2 rounded-xl border border-dashed border-[#E2DEF2] px-3 py-5 text-center">
                      <MessageCircle size={18} className="mx-auto mb-1 text-[#C4B5FD]" />
                      <p className="text-xs font-black" style={{ color: TEXT }}>No updates yet</p>
                      <p className="text-[11px] font-semibold" style={{ color: MUTED }}>
                        Type a note, take a photo, or record your voice below.
                      </p>
                    </div>
                  )}
                  <div className="mb-2 flex items-center gap-2">
                    <button
                      type="button"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#E2DEF2] bg-white text-[#8B75D9]"
                      aria-label="Add photo"
                    >
                      <Camera size={14} />
                    </button>
                    <Input
                      defaultValue={task.note ?? ""}
                      placeholder="Write a progress update..."
                      className="h-9 rounded-full border-[#E2DEF2] bg-white text-sm"
                      onBlur={(e) => void saveNote(task.task_id, e.target.value, true)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveNote(task.task_id, e.currentTarget.value, true);
                      }}
                    />
                    <button
                      type="button"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#6D4BDA] text-white"
                      aria-label="Record voice note"
                    >
                      <Mic size={14} />
                    </button>
                  </div>
                  {/* Match new mockup: thread composer only, no extra evidence panel shown inline */}
                </div>
              )}
              {!sessionId && expanded && (
                <div className="border-t border-[#E2DEF2] bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">
                  Start a session to capture photo, voice, and written evidence for this task.
                </div>
              )}
            </div>
          );
        }

        return (
          <div
            key={task.task_id}
            className={cn(
              "rounded-xl border p-3 transition-colors",
              task.completed ? "bg-slate-50 border-slate-200" : "bg-white border-[#E2DEF2]",
            )}
          >
            <div className="flex items-start gap-3">
              <Checkbox
                checked={task.completed}
                disabled={disabled}
                onCheckedChange={() => toggleTask(task.task_id)}
                className="mt-1 h-5 w-5"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p
                    className={cn(
                      "text-sm font-bold",
                      task.completed && "line-through text-slate-400",
                      task.type === "custom" && !task.completed && "italic",
                    )}
                    style={{ color: task.completed ? undefined : task.type === "custom" ? PLUM : TEXT }}
                  >
                    {task.label}
                  </p>
                  {required && !task.completed && (
                    <span className="rounded bg-red-50 px-1.5 py-0.5 text-[9px] font-black uppercase text-red-600">
                      Required
                    </span>
                  )}
                </div>
                {task.description && (
                  <p
                    className={cn("mt-0.5 text-xs font-medium", task.completed && "line-through text-slate-400")}
                    style={{ color: MUTED }}
                  >
                    {task.description}
                  </p>
                )}
                {task.note && !noteOpen && (
                  <p className="mt-1 truncate text-xs font-medium text-slate-500">
                    {task.note.slice(0, 50)}{task.note.length > 50 ? "…" : ""}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setConfirmDeleteId(null);
                  setExpandedNote(noteOpen ? null : task.task_id);
                }}
                className="shrink-0 rounded-lg p-1.5 hover:bg-black/5"
                style={{ color: MUTED }}
                title="Add note"
              >
                <StickyNote size={16} />
              </button>
              {deletable && !disabled && (
                <Button
                  type="button"
                  variant={confirmingDelete ? "destructive" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-8 shrink-0 rounded-lg px-2 text-xs font-bold",
                    !confirmingDelete && "text-red-600 hover:bg-red-50 hover:text-red-700",
                  )}
                  onClick={() => void deleteCustomTask(task.task_id)}
                  aria-label={confirmingDelete ? "Confirm remove custom task" : "Remove custom task"}
                >
                  {confirmingDelete ? "Remove?" : <Trash2 size={16} />}
                </Button>
              )}
            </div>

            {noteOpen && (
              <div className="mt-3 space-y-2 pl-8">
                <NoteInput task={task} saveNote={saveNote} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NoteInput({
  task,
  saveNote,
}: {
  task: ShiftTask;
  saveNote: (taskId: string, note: string) => void;
}) {
  const [value, setValue] = useState(task.note ?? "");

  return (
    <>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, NOTE_MAX))}
        maxLength={NOTE_MAX}
        placeholder="What was done? Any observations?"
        className="text-sm"
        onKeyDown={(e) => {
          if (e.key === "Enter") saveNote(task.task_id, value);
        }}
        onBlur={() => saveNote(task.task_id, value)}
        autoFocus
      />
      <p className="text-[10px] font-bold" style={{ color: MUTED }}>
        {value.length}/{NOTE_MAX} characters
      </p>
    </>
  );
}

function groupTasksByGoal(tasks: ShiftTask[]) {
  type GoalGroup = {
    key: string;
    title: string;
    tasks: ShiftTask[];
    category: string;
    accent: { main: string; soft: string; border: string };
  };
  const groups = new Map<string, GoalGroup>();
  tasks.forEach((task) => {
    const raw = (task.goal_title || "").trim();
    const title = raw || "General Support";
    const key = (task.goal_id || title).toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.tasks.push(task);
      return;
    }
    const lower = title.toLowerCase();
    let category = "CORE SUPPORT";
    let accent = { main: "#6D4BDA", soft: "#F1EAFF", border: "#D7CCF4" };
    if (lower.includes("community")) {
      category = "COMMUNITY SUPPORT";
      accent = { main: "#2497B7", soft: "#E8F8FC", border: "#BFE6F1" };
    } else if (lower.includes("plan") || lower.includes("document")) {
      category = "PLAN MANAGEMENT";
      accent = { main: "#D48A22", soft: "#FFF3E3", border: "#F7D9AF" };
    } else if (lower.includes("health") || lower.includes("wellbeing")) {
      category = "CORE SUPPORT";
      accent = { main: "#2BAE86", soft: "#E9FBF4", border: "#BFEEDA" };
    }
    groups.set(key, { key, title, tasks: [task], category, accent });
  });
  return [...groups.values()];
}
