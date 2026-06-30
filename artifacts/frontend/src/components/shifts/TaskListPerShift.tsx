import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Loader2,
  Badge,
  Clock,
  Flag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { jsonFetch } from "@/services/http";
import { TaskCompletionModal } from "./TaskCompletionModal";
import type { TaskInstance } from "@/types/task";

type Props = {
  shiftId: string;
  participantId: string;
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-blue-100 text-blue-800",
  medium: "bg-yellow-100 text-yellow-800",
  high: "bg-red-100 text-red-800",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <AlertCircle className="h-4 w-4 text-yellow-600" />,
  completed: <CheckCircle2 className="h-4 w-4 text-green-600" />,
  missed: <AlertCircle className="h-4 w-4 text-red-600" />,
  carried_over: <Clock className="h-4 w-4 text-orange-600" />,
};

export function TaskListPerShift({ shiftId, participantId }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [completingInstanceId, setCompletingInstanceId] = useState<string | null>(null);
  const [completionModalOpen, setCompletionModalOpen] = useState(false);

  // Fetch task instances for shift
  const { data: instances = [], isLoading, error } = useQuery({
    queryKey: ["tasks", "shifts", shiftId],
    queryFn: async () => {
      const response = await jsonFetch<TaskInstance[]>(`/api/tasks/shifts/${shiftId}/instances`);
      // Sort: pending first, then by priority (high > medium > low), then by created_at
      return response.sort((a: TaskInstance, b: TaskInstance) => {
        const statusOrder = { pending: 0, carried_over: 1, completed: 2, missed: 3 };
        const priorityOrder = { high: 0, medium: 1, low: 2 };

        const statusDiff = (statusOrder[a.status as keyof typeof statusOrder] || 99) -
          (statusOrder[b.status as keyof typeof statusOrder] || 99);
        if (statusDiff !== 0) return statusDiff;

        // Sort by priority (higher priority first)
        const priorityDiff = (priorityOrder[(a as any).priority as keyof typeof priorityOrder] || 99) -
          (priorityOrder[(b as any).priority as keyof typeof priorityOrder] || 99);
        if (priorityDiff !== 0) return priorityDiff;

        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
    },
  });

  const handleCompleteClick = (instanceId: string) => {
    setCompletingInstanceId(instanceId);
    setCompletionModalOpen(true);
  };

  const handleCompletionSuccess = () => {
    setCompletionModalOpen(false);
    setCompletingInstanceId(null);
    queryClient.invalidateQueries({ queryKey: ["tasks", "shifts", shiftId] });
    toast({ title: "Task completed", description: "Task marked as complete." });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded bg-red-50 p-4 text-sm text-red-700">
        Failed to load tasks for this shift.
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <div className="rounded bg-gray-50 p-4 text-center text-sm text-gray-500">
        No tasks for this shift.
      </div>
    );
  }

  // Separate pending/carried-over from completed/missed
  const activeInstances = instances.filter(
    (i) => i.status === "pending" || i.status === "carried_over"
  );
  const completedInstances = instances.filter(
    (i) => i.status === "completed" || i.status === "missed"
  );

  return (
    <div className="space-y-4">
      {/* Active Tasks */}
      {activeInstances.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-gray-700">Active</h4>
          <div className="space-y-2">
            {activeInstances.map((instance) => (
              <TaskInstanceRow
                key={instance.id}
                instance={instance}
                onComplete={() => handleCompleteClick(instance.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Completed/Missed Tasks */}
      {completedInstances.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-gray-500">History</h4>
          <div className="space-y-1 opacity-60">
            {completedInstances.map((instance) => (
              <TaskInstanceRow
                key={instance.id}
                instance={instance}
                disabled
                onComplete={() => {}}
              />
            ))}
          </div>
        </div>
      )}

      {/* Task Completion Modal */}
      {completingInstanceId && (
        <TaskCompletionModal
          isOpen={completionModalOpen}
          onClose={() => setCompletionModalOpen(false)}
          instanceId={completingInstanceId}
          onSuccess={handleCompletionSuccess}
        />
      )}
    </div>
  );
}

type TaskInstanceRowProps = {
  instance: TaskInstance & { priority?: string; requirement_level?: string };
  onComplete: () => void;
  disabled?: boolean;
};

function TaskInstanceRow({ instance, onComplete, disabled = false }: TaskInstanceRowProps) {
  // For display purposes, we'd need to fetch the template to get title, category, priority
  // This component assumes those are attached to the instance via JOIN in the API response
  // If not available, we fetch them separately
  const [templateInfo, setTemplateInfo] = useState<any>(null);

  useQuery({
    queryKey: ["tasks", "templates", instance.task_template_id],
    queryFn: async () => {
      if (!instance.task_template_id) return null;
      try {
        const response = await jsonFetch(
          `/api/tasks/templates/${instance.task_template_id}`
        );
        setTemplateInfo(response);
        return response;
      } catch {
        return null;
      }
    },
    enabled: !!instance.task_template_id && !templateInfo,
  });

  const title = templateInfo?.title || "Task";
  const priority = templateInfo?.priority || "medium";
  const category = templateInfo?.category || "";
  const requirementLevel = templateInfo?.requirement_level || "mandatory";
  const evidenceRequired = templateInfo?.evidence_required || "none";
  const isCarriedOver = instance.carried_over_from_instance_id !== null;

  const formatTime = (time: string | null) => {
    if (!time) return null;
    return new Date(`2000-01-01T${time}`).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const dueStart = formatTime(instance.due_window_start);
  const dueEnd = formatTime(instance.due_window_end);
  const dueWindow = dueStart && dueEnd ? `${dueStart} - ${dueEnd}` : null;

  return (
    <div
      className={`flex items-center justify-between rounded border px-3 py-2 transition-colors ${
        disabled
          ? "border-gray-200 bg-gray-50"
          : "border-gray-300 bg-white hover:bg-blue-50"
      }`}
    >
      <div className="flex flex-1 items-center gap-3">
        {/* Status Icon */}
        <div>{STATUS_ICONS[instance.status] || null}</div>

        {/* Task Info */}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900">{title}</span>

            {/* Priority Badge */}
            <span
              className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                PRIORITY_COLORS[priority] || PRIORITY_COLORS.medium
              }`}
            >
              {priority.charAt(0).toUpperCase() + priority.slice(1)}
            </span>

            {/* Requirement Level Badge */}
            <span
              className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                requirementLevel === "mandatory"
                  ? "bg-red-100 text-red-800"
                  : "bg-gray-100 text-gray-800"
              }`}
            >
              {requirementLevel === "mandatory" ? "Required" : "Optional"}
            </span>

            {/* Carried Over Badge */}
            {isCarriedOver && (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-1 text-xs font-medium text-orange-800">
                <Clock className="h-3 w-3" />
                From previous
              </span>
            )}
          </div>

          {/* Secondary Info */}
          <div className="mt-1 flex items-center gap-4 text-xs text-gray-500">
            {category && <span>{category}</span>}
            {dueWindow && <span>Due: {dueWindow}</span>}
            {evidenceRequired !== "none" && (
              <span className="flex items-center gap-1">
                <Badge className="h-3 w-3" />
                Evidence: {evidenceRequired.replace("_", " ")}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Action Button */}
      {!disabled && instance.status === "pending" ? (
        <Button
          size="sm"
          onClick={onComplete}
          variant="outline"
          className="ml-2 gap-2"
        >
          Complete
          <ChevronRight className="h-4 w-4" />
        </Button>
      ) : instance.status === "carried_over" ? (
        <Button
          size="sm"
          onClick={onComplete}
          variant="outline"
          className="ml-2 gap-2"
        >
          Complete
          <ChevronRight className="h-4 w-4" />
        </Button>
      ) : (
        <span className="text-xs font-medium text-gray-500">
          {instance.status === "completed" ? "✓ Done" : "✗ Missed"}
        </span>
      )}
    </div>
  );
}
