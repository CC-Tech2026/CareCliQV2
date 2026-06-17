import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, ChevronUp, MessageCircle, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { ShiftTaskEvidencePanel } from "@/components/shifts/ShiftTaskEvidencePanel";
import {
  loadTasksLocally,
  saveTasksLocally,
  updateShiftTasks,
  type ShiftTask,
} from "@/services/shiftService";
import {
  groupShiftTasksByGoal,
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

  const markTaskComplete = async (taskId: string, completed = true) => {
    const now = new Date().toISOString();
    const next = localTasks.map((task) =>
      task.task_id === taskId
        ? {
            ...task,
            completed,
            completed_at: completed ? task.completed_at ?? now : null,
          }
        : task,
    );
    await persist(next);
  };

  const saveEvidence = async (taskId: string, patch: Partial<ShiftTask>) => {
    const now = new Date().toISOString();
    const next = localTasks.map((task) => {
      if (task.task_id !== taskId) return task;
      const updated = { ...task, ...patch };
      const hasEvidence =
        Boolean(patch.photo_evidence) ||
        Boolean(patch.voice_evidence) ||
        Boolean(patch.note?.trim());
      if (sessionStyle && hasEvidence && !updated.completed) {
        updated.completed = true;
        updated.completed_at = now;
      }
      return updated;
    });
    await persist(next);
  };

  const sorted = [...localTasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const goalGroups = groupShiftTasksByGoal(sorted);

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
          Message-style task tracking
        </p>
        <p className="mt-1 text-[11px] font-semibold" style={{ color: MUTED }}>
          Tap any task to open its thread. Add a photo, voice note, or quick text — the task completes automatically.
        </p>
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

function SessionTaskGroup({
  tasks,
  expandedNote,
  setExpandedNote,
  disabled,
  saveEvidence,
  markTaskComplete,
  sessionId,
  participantName,
}: {
  tasks: ShiftTask[];
  expandedNote: string | null;
  setExpandedNote: (id: string | null) => void;
  disabled?: boolean;
  saveEvidence: (taskId: string, patch: Partial<ShiftTask>) => void;
  markTaskComplete: (taskId: string, completed?: boolean) => void;
  sessionId?: string | null;
  participantName?: string;
}) {
  return (
    <div className="space-y-2">
      {tasks.map((task) => {
        const required = isMandatory(task);
        const expanded = expandedNote === task.task_id;
        const updates = taskUpdateCount(task);

        if (task.completed && !expanded) {
          return (
            <button
              key={task.task_id}
              type="button"
              className="flex w-full items-center gap-3 rounded-xl border-2 border-emerald-400 bg-emerald-50/60 p-3 text-left"
              onClick={() => setExpandedNote(task.task_id)}
            >
              <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black" style={{ color: TEXT }}>{task.label}</p>
                <p className="mt-0.5 text-[11px] font-semibold text-emerald-700">
                  {updates || 1} update{updates === 1 ? "" : "s"} · Complete ✓
                </p>
              </div>
              <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-black text-white">{updates || 1}</span>
              <ChevronRight size={18} className="shrink-0" style={{ color: MUTED }} />
            </button>
          );
        }

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
                onClick={() => setExpandedNote(expanded ? null : task.task_id)}
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
                  <p className={cn("text-sm font-bold", task.completed && "text-slate-500")} style={{ color: task.completed ? undefined : TEXT }}>
                    {task.label}
                  </p>
                  <p className="mt-0.5 text-[11px] font-semibold" style={{ color: MUTED }}>
                    {required ? "Required" : "Optional"} · Tap to add updates
                  </p>
                </div>
                {expanded ? (
                  <ChevronUp size={18} className="shrink-0" style={{ color: MUTED }} />
                ) : (
                  <ChevronRight size={18} className="shrink-0" style={{ color: MUTED }} />
                )}
              </button>
            </div>

            {expanded && sessionId && (
              <ShiftTaskEvidencePanel
                task={task}
                sessionId={sessionId}
                participantName={participantName}
                disabled={disabled}
                variant="thread"
                onTaskPatch={(patch) => void saveEvidence(task.task_id, patch)}
                onMarkComplete={() => void markTaskComplete(task.task_id, true)}
              />
            )}
            {expanded && !sessionId && (
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
