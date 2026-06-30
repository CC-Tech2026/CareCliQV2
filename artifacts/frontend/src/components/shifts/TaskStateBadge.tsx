import { AlertCircle, CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { TaskVisualState } from "@/lib/task-evidence-status";
import { TASK_STATE_STYLES } from "@/lib/task-evidence-status";
import { cn } from "@/lib/utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const TASK_ICONS = {
  not_started: Circle,
  in_progress: Loader2,
  evidence_required: AlertCircle,
  complete: CheckCircle2,
} as const;

const TASK_STATE_KEYS: Record<TaskVisualState, string> = {
  not_started: "tasks.state.notStarted",
  in_progress: "tasks.state.inProgress",
  evidence_required: "tasks.state.evidenceRequired",
  complete: "tasks.state.complete",
};

type Props = {
  state: TaskVisualState;
  className?: string;
};

export function TaskStateBadge({ state, className }: Props) {
  const { translate } = useAccessibility();
  const style = TASK_STATE_STYLES[state];
  const Icon = TASK_ICONS[state];
  const label = translate(TASK_STATE_KEYS[state]);

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
      aria-label={label}
    >
      <Icon
        size={12}
        className={cn("shrink-0", state === "in_progress" && "animate-spin")}
        aria-hidden
      />
      {label}
    </span>
  );
}
