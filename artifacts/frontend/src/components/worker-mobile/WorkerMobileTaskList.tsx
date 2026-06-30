import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { WM } from "@/lib/worker-mobile-tokens";
import type { ShiftTask } from "@/services/shiftService";

type Props = {
  tasks: ShiftTask[];
  activeTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onToggleTask: (taskId: string) => void;
  taskCanComplete?: (task: ShiftTask) => boolean;
  disabled?: boolean;
};

export function WorkerMobileTaskList({
  tasks,
  activeTaskId,
  onSelectTask,
  onToggleTask,
  taskCanComplete,
  disabled,
}: Props) {
  const active = tasks.filter((t) => !t.marked_na);

  return (
    <div>
      {active.map((task, index) => {
        const focused = activeTaskId === task.task_id;
        const done = task.completed;
        const canComplete = taskCanComplete?.(task) ?? true;
        return (
          <div
            key={task.task_id}
            className={cn(
              "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors",
              focused && "relative",
            )}
            style={{
              background: focused ? WM.taskActiveBg : "transparent",
              borderTop: index > 0 ? `0.5px solid ${WM.border}` : undefined,
            }}
          >
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                if (!done && !canComplete) {
                  onSelectTask(task.task_id);
                  onToggleTask(task.task_id);
                  return;
                }
                onToggleTask(task.task_id);
              }}
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border"
              style={{
                borderColor: done ? WM.green : WM.checkboxBorder,
                borderWidth: done ? 0 : 1.5,
                background: done ? WM.green : "transparent",
                opacity: !done && !canComplete ? 0.4 : 1,
              }}
              aria-label={done ? `Mark ${task.label} incomplete` : `Mark ${task.label} complete`}
            >
              {done && <Check size={12} className="text-white" strokeWidth={3} />}
            </button>

            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelectTask(task.task_id)}
              className="min-w-0 flex-1 text-left"
            >
              {focused && (
                <span
                  className="mb-1 inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: WM.pink }}
                />
              )}
              <p
                className={cn(
                  "text-[14px] font-semibold leading-snug",
                  done && "line-through",
                )}
                style={{ color: done ? WM.taskDoneText : WM.text }}
              >
                {task.label}
              </p>
              {task.description && (
                <p className="mt-0.5 text-[12px] leading-snug" style={{ color: WM.muted }}>
                  {task.description}
                </p>
              )}
              {task.goal_title && (
                <span
                  className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{ background: WM.infoBg, color: WM.infoTitle }}
                >
                  {task.goal_title}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
