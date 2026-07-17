import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Badge,
} from "lucide-react";
import { jsonFetch } from "@/services/http";
import { useAccessibility } from "@/contexts/AccessibilityContext";

type ShiftLinkedTask = {
  id: string;
  task_id?: string;
  shift_id: string;
  status: "pending" | "completed" | "missed" | "carried_over";
  completed_at?: string | null;
  title?: string;
  name?: string;
  priority?: string;
  requirement_level?: string;
  evidence_required?: string;
  goal_id?: string | null;
  goal_title?: string | null;
};

type Props = {
  shiftId: string;
  participantId: string;
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200",
  high: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

/**
 * Lists tasks linked to a shift via shift_tasks → participant_tasks (CARECLIQV2-331).
 * Completion is owned by the worker checklist (/api/worker/shifts/.../tasks).
 */
export function TaskListPerShift({ shiftId }: Props) {
  const { translate } = useAccessibility();

  const { data: instances = [], isLoading, error } = useQuery({
    queryKey: ["tasks", "shifts", shiftId],
    queryFn: async () => {
      const response = await jsonFetch<ShiftLinkedTask[]>(
        `/api/tasks/shifts/${shiftId}/instances`
      );
      return [...response].sort((a, b) => {
        const statusOrder = { pending: 0, carried_over: 1, completed: 2, missed: 3 };
        const aStatus = statusOrder[a.status] ?? 99;
        const bStatus = statusOrder[b.status] ?? 99;
        if (aStatus !== bStatus) return aStatus - bStatus;
        return (a.title || a.name || "").localeCompare(b.title || b.name || "");
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded bg-destructive/10 p-4 text-sm text-destructive">
        {translate("shifts.tasks.loadFailed")}
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <div className="rounded bg-muted p-4 text-center text-sm text-muted-foreground">
        {translate("shifts.tasks.empty")}
      </div>
    );
  }

  const activeInstances = instances.filter((i) => i.status === "pending");
  const completedInstances = instances.filter((i) => i.status === "completed");

  return (
    <div className="space-y-4">
      {activeInstances.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-foreground">
            {translate("shifts.tasks.active")}
          </h4>
          <div className="space-y-2">
            {activeInstances.map((instance) => (
              <ShiftTaskRow key={instance.id} instance={instance} />
            ))}
          </div>
        </div>
      )}

      {completedInstances.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-muted-foreground">
            {translate("shifts.tasks.history")}
          </h4>
          <div className="space-y-1 opacity-60">
            {completedInstances.map((instance) => (
              <ShiftTaskRow key={instance.id} instance={instance} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ShiftTaskRow({ instance }: { instance: ShiftLinkedTask }) {
  const { translate } = useAccessibility();
  const title = instance.title || instance.name || translate("shifts.tasks.untitled");
  const priority = instance.priority || "medium";
  const requirementLevel = instance.requirement_level || "mandatory";
  const evidenceRequired = instance.evidence_required || "none";
  const done = instance.status === "completed";

  return (
    <div
      className={`flex items-center justify-between rounded border px-3 py-2 ${
        done ? "border-border bg-muted/50" : "border-border bg-background"
      }`}
    >
      <div className="flex flex-1 items-center gap-3">
        <div>
          {done ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : (
            <AlertCircle className="h-4 w-4 text-yellow-600" />
          )}
        </div>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{title}</span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                PRIORITY_COLORS[priority] || PRIORITY_COLORS.medium
              }`}
            >
              {priority.charAt(0).toUpperCase() + priority.slice(1)}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                requirementLevel === "mandatory"
                  ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {requirementLevel === "mandatory"
                ? translate("shifts.tasks.required")
                : translate("shifts.tasks.optional")}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            {instance.goal_title && <span>{instance.goal_title}</span>}
            {evidenceRequired !== "none" && (
              <span className="flex items-center gap-1">
                <Badge className="h-3 w-3" />
                {translate("shifts.tasks.evidence")}: {evidenceRequired.replace(/_/g, " ")}
              </span>
            )}
          </div>
        </div>
      </div>
      <span className="text-xs font-medium text-muted-foreground">
        {done ? translate("shifts.tasks.done") : translate("shifts.tasks.pending")}
      </span>
    </div>
  );
}
