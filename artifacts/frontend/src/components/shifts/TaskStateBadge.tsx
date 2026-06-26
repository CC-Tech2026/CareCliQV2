import { AlertCircle, CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { TaskVisualState } from "@/lib/task-evidence-status";
import { TASK_STATE_STYLES } from "@/lib/task-evidence-status";
import { cn } from "@/lib/utils";

const TASK_ICONS = {
  not_started: Circle,
  in_progress: Loader2,
  evidence_required: AlertCircle,
  complete: CheckCircle2,
} as const;

type Props = {
  state: TaskVisualState;
  className?: string;
};

export function TaskStateBadge({ state, className }: Props) {
  const style = TASK_STATE_STYLES[state];
  const Icon = TASK_ICONS[state];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide",
        className,
      )}
      style={{
        borderColor: style.border,
        background: style.bg,
        color: style.text,
      }}
      aria-label={style.label}
    >
      <Icon
        size={12}
        className={cn("shrink-0", state === "in_progress" && "animate-spin")}
        aria-hidden
      />
      {style.label}
    </span>
  );
}
